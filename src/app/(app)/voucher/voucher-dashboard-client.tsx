"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { authorizeRectify, getVouchHistoryPage, voucherAccept, voucherDeny, voucherRequestProof } from "@/actions/voucher";
import { sortPendingTasks } from "@/lib/voucher-pending-sort";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { FriendPomoActivity, TaskWithRelations, VoucherPendingTask } from "@/lib/types";
import { Check, ChevronDown, ChevronRight, CircleHelp, Loader2, Timer, X } from "lucide-react";
import { runOptimisticMutation } from "@/lib/ui/runOptimisticMutation";
import { toast } from "sonner";
import { HardRefreshButton } from "@/components/HardRefreshButton";
import { TaskDetailPrefetcher } from "@/components/TaskDetailPrefetcher";
import { getWarmProofSrc, purgeLocalProofMedia } from "@/lib/proof-media-warmup";
import { subscribeRealtimeTaskChanges, type RealtimeTaskRow } from "@/lib/realtime-task-events";
import { isIncomingNewer, patchTaskScalars } from "@/lib/tasks-realtime-patch";
import { reconcilePendingTasksFromServer } from "@/lib/voucher-pending-reconcile";
import { ProofMedia } from "@/components/ProofMedia";
import { canVoucherSeeTask } from "@/lib/voucher-task-visibility";
import { useCollapsibleSection } from "@/lib/ui/useCollapsibleSection";
import {
    TaskStatusBadge,
    HistoryTaskStatusBadge,
    VoucherDeadlineBadge,
    VoucherPomoAccumulatedBadge,
    VoucherProofRequestBadge,
} from "@/design-system/badges";

interface VoucherDashboardClientProps {
    pendingTasks: VoucherPendingTask[];
    workingFriends?: FriendPomoActivity[];
}

type HistoryTask = TaskWithRelations & { rectify_passes_used?: number };

const HISTORY_PAGE_SIZE = 10;
const RECTIFY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const VOUCH_HISTORY_OPEN_SESSION_KEY = "voucher.history.open";
const PENDING_FALLBACK_POLL_MS = 60000;
const ACCEPTED_STATUS_ERROR = "Cannot accept task in ACCEPTED status";
const ACTIVE_PENDING_STATUSES = new Set(["ACTIVE", "POSTPONED"]);
const ALL_PENDING_STATUSES = new Set(["ACTIVE", "POSTPONED", "AWAITING_VOUCHER", "AWAITING_AI", "MARKED_COMPLETE"]);
const HISTORY_STATUSES = new Set(["ACCEPTED", "AUTO_ACCEPTED", "AI_ACCEPTED", "DENIED", "MISSED", "RECTIFIED", "SETTLED", "DELETED"]);

function mergeTasksById(
    existing: HistoryTask[],
    incoming: HistoryTask[],
    mode: "append" | "prepend" = "append"
): HistoryTask[] {
    const result = mode === "prepend" ? [...incoming, ...existing] : [...existing, ...incoming];
    const seen = new Set<string>();

    return result.filter((task) => {
        if (seen.has(task.id)) return false;
        seen.add(task.id);
        return true;
    });
}

function isWithinRectifyWindow(updatedAt: string, referenceTimestamp: number): boolean {
    const failedAtTs = new Date(updatedAt).getTime();
    if (Number.isNaN(failedAtTs)) return false;

    return referenceTimestamp <= failedAtTs + RECTIFY_WINDOW_MS;
}

function deriveAwaitingDeadline(task: { voucher_response_deadline: string | null; marked_completed_at: string | null }): string | null {
    if (task.voucher_response_deadline) return task.voucher_response_deadline;
    if (!task.marked_completed_at) return null;

    const derived = new Date(task.marked_completed_at);
    if (Number.isNaN(derived.getTime())) return null;
    derived.setDate(derived.getDate() + 2);
    derived.setHours(23, 59, 59, 999);
    return derived.toISOString();
}

function toPendingTask(task: VoucherPendingTask, incoming: RealtimeTaskRow): VoucherPendingTask {
    const patched = patchTaskScalars(task, incoming);
    const pendingDisplayType = ACTIVE_PENDING_STATUSES.has(patched.status) ? "ACTIVE" : "AWAITING_VOUCHER";
    const pendingDeadlineAt = ACTIVE_PENDING_STATUSES.has(patched.status)
        ? patched.deadline
        : deriveAwaitingDeadline({
            voucher_response_deadline: patched.voucher_response_deadline,
            marked_completed_at: patched.marked_completed_at,
        });

    return {
        ...patched,
        pending_display_type: pendingDisplayType,
        pending_deadline_at: pendingDeadlineAt,
        pending_actionable: patched.status === "AWAITING_VOUCHER",
        proof_request_count: task.proof_request_count || 0,
    };
}

export function applyProofRequestSuccessToPendingTasks(
    tasks: VoucherPendingTask[],
    taskId: string,
    nowIso: string = new Date().toISOString()
): VoucherPendingTask[] {
    return tasks.map((task) =>
        task.id === taskId
            ? {
                ...task,
                proof_request_open: true,
                proof_requested_at: nowIso,
                updated_at: nowIso,
                proof_request_count: Math.max(0, task.proof_request_count || 0) + 1,
            }
            : task
    );
}

export default function VoucherDashboardClient({
    pendingTasks,
    workingFriends = [],
}: VoucherDashboardClientProps) {
    const router = useRouter();
    const [, startRefreshTransition] = useTransition();
    const [pendingListRef] = useAutoAnimate();

    const [pendingState, setPendingState] = useState<VoucherPendingTask[]>(pendingTasks);
    const [historyState, setHistoryState] = useState<HistoryTask[]>([]);
    const [inFlightIds, setInFlightIds] = useState<Set<string>>(new Set());
    const pendingStateRef = useRef<VoucherPendingTask[]>(pendingTasks);
    const historyStateRef = useRef<HistoryTask[]>([]);
    const historyLoadedRef = useRef(false);
    const inFlightIdsRef = useRef<Set<string>>(new Set());
    const suppressedPendingTaskIdsRef = useRef<Set<string>>(new Set());

    const [isHistoryOpen, handleHistoryToggle] = useCollapsibleSection(VOUCH_HISTORY_OPEN_SESSION_KEY);
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyOffset, setHistoryOffset] = useState(0);
    const [historyHasMore, setHistoryHasMore] = useState(true);

    const setTaskInFlight = (taskId: string, pending: boolean) => {
        const next = new Set(inFlightIdsRef.current);
        if (pending) {
            next.add(taskId);
        } else {
            next.delete(taskId);
        }
        inFlightIdsRef.current = next;
        setInFlightIds(next);
    };

    const suppressPendingTask = (taskId: string) => {
        const next = new Set(suppressedPendingTaskIdsRef.current);
        next.add(taskId);
        suppressedPendingTaskIdsRef.current = next;
    };

    const unsuppressPendingTask = (taskId: string) => {
        if (!suppressedPendingTaskIdsRef.current.has(taskId)) return;
        const next = new Set(suppressedPendingTaskIdsRef.current);
        next.delete(taskId);
        suppressedPendingTaskIdsRef.current = next;
    };

    const loadHistoryPage = async (offset: number, replace: boolean) => {
        if (historyLoading) return;

        setHistoryLoading(true);
        try {
            const result = await getVouchHistoryPage(offset, HISTORY_PAGE_SIZE);
            if (result?.error) {
                toast.error(result.error);
                return;
            }

            const tasks = (result?.tasks as HistoryTask[] | undefined) || [];
            setHistoryState((prev) => (replace ? tasks : mergeTasksById(prev, tasks, "append")));
            setHistoryOffset(result?.nextOffset ?? offset + tasks.length);
            setHistoryHasMore(Boolean(result?.hasMore));
            setHistoryLoaded(true);
        } finally {
            setHistoryLoading(false);
        }
    };

    useEffect(() => {
        if (isHistoryOpen && !historyLoaded && !historyLoading) {
            void loadHistoryPage(0, true);
        }
    }, [historyLoaded, historyLoading, isHistoryOpen]);

    useEffect(() => {
        const reconciled = reconcilePendingTasksFromServer(
            pendingTasks,
            suppressedPendingTaskIdsRef.current
        );
        suppressedPendingTaskIdsRef.current = reconciled.suppressedPendingTaskIds;

        // Merge server data with live realtime state — keep whichever has the newer
        // updated_at per task. This prevents a stale server response (cache not yet
        // invalidated when the reconcile refresh fires) from reverting a task that
        // the client already patched via realtime to a newer state (e.g. AWAITING_VOUCHER).
        const liveById = new Map(pendingStateRef.current.map((t) => [t.id, t]));
        const merged = reconciled.pendingTasks.map((serverTask) => {
            const liveTask = liveById.get(serverTask.id);
            if (!liveTask) return serverTask;
            return isIncomingNewer(liveTask.updated_at, serverTask.updated_at) ? serverTask : liveTask;
        });

        setPendingState(merged);
        pendingStateRef.current = merged;
    }, [pendingTasks]);

    useEffect(() => {
        pendingStateRef.current = pendingState;
    }, [pendingState]);

    useEffect(() => {
        historyStateRef.current = historyState;
    }, [historyState]);

    useEffect(() => {
        historyLoadedRef.current = historyLoaded;
    }, [historyLoaded]);

    useEffect(() => {
        inFlightIdsRef.current = inFlightIds;
    }, [inFlightIds]);

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            if (document.visibilityState !== "visible") return;
            if (inFlightIdsRef.current.size > 0) return;
            startRefreshTransition(() => {
                router.refresh();
            });
        }, PENDING_FALLBACK_POLL_MS);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [router, startRefreshTransition]);

    useEffect(() => {
        const unsubscribe = subscribeRealtimeTaskChanges((change) => {
            const incoming = change.newRow || change.oldRow;
            if (!incoming) return;

            const taskId = incoming.id;
            const currentPendingState = pendingStateRef.current;
            const currentHistoryState = historyStateRef.current;
            const pendingTask = currentPendingState.find((task) => task.id === taskId);
            const historyTask = currentHistoryState.find((task) => task.id === taskId);

            if (!pendingTask && !historyTask) return;

            if (change.eventType === "DELETE") {
                const nextPendingState = currentPendingState.filter((task) => task.id !== taskId);
                const nextHistoryState = currentHistoryState.filter((task) => task.id !== taskId);
                pendingStateRef.current = nextPendingState;
                historyStateRef.current = nextHistoryState;
                setPendingState(nextPendingState);
                setHistoryState(nextHistoryState);
                return;
            }

            const existingTask = pendingTask || historyTask;
            if (!existingTask) return;
            if (!isIncomingNewer(existingTask.updated_at, incoming.updated_at)) return;

            let nextPendingState = currentPendingState.filter((task) => task.id !== taskId);
            let nextHistoryState = currentHistoryState.filter((task) => task.id !== taskId);

            if (pendingTask && ALL_PENDING_STATUSES.has(incoming.status)) {
                const nextPendingTask = toPendingTask(pendingTask, incoming);
                if (canVoucherSeeTask(nextPendingTask)) {
                    nextPendingState = [nextPendingTask, ...nextPendingState];
                }
            }

            if (historyLoadedRef.current && HISTORY_STATUSES.has(incoming.status)) {
                const historySeed = (historyTask || pendingTask) as HistoryTask;
                const patchedHistoryTask = patchTaskScalars(historySeed, incoming);
                nextHistoryState = mergeTasksById(nextHistoryState, [patchedHistoryTask], "prepend");
            }

            pendingStateRef.current = nextPendingState;
            historyStateRef.current = nextHistoryState;
            setPendingState(nextPendingState);
            setHistoryState(nextHistoryState);
        });

        return unsubscribe;
    }, []);

    const handleLoadMore = () => {
        if (historyLoading || !historyHasMore) return;
        void loadHistoryPage(historyOffset, false);
    };

    async function handleAccept(taskId: string) {
        if (inFlightIdsRef.current.has(taskId)) return;
        const currentTask = pendingState.find((task) => task.id === taskId);
        if (!currentTask) return;

        setTaskInFlight(taskId, true);
        const nowIso = new Date().toISOString();

        const mutationResult = await runOptimisticMutation({
            captureSnapshot: () => ({ pendingState, historyState }),
            applyOptimistic: () => {
                suppressPendingTask(taskId);
                setPendingState((prev) => {
                    const next = prev.filter((task) => task.id !== taskId);
                    pendingStateRef.current = next;
                    return next;
                });

                if (historyLoaded) {
                    const optimisticHistoryTask: HistoryTask = {
                        ...currentTask,
                        status: "ACCEPTED",
                        updated_at: nowIso,
                    };
                    setHistoryState((prev) => {
                        const next = mergeTasksById(prev, [optimisticHistoryTask], "prepend");
                        historyStateRef.current = next;
                        return next;
                    });
                }
            },
            runMutation: () => voucherAccept(taskId),
            rollback: (snapshot) => {
                unsuppressPendingTask(taskId);
                pendingStateRef.current = snapshot.pendingState;
                historyStateRef.current = snapshot.historyState;
                setPendingState(snapshot.pendingState);
                setHistoryState(snapshot.historyState);
            },
            onSuccess: () => {
                void purgeLocalProofMedia(taskId);
            },
        });

        if (!mutationResult.ok && mutationResult.error === ACCEPTED_STATUS_ERROR) {
            startRefreshTransition(() => {
                router.refresh();
            });
        }

        setTaskInFlight(taskId, false);
    }

    async function handleDeny(taskId: string) {
        if (inFlightIdsRef.current.has(taskId)) return;
        const currentTask = pendingState.find((task) => task.id === taskId);
        if (!currentTask) return;

        setTaskInFlight(taskId, true);
        const nowIso = new Date().toISOString();

        await runOptimisticMutation({
            captureSnapshot: () => ({ pendingState, historyState }),
            applyOptimistic: () => {
                suppressPendingTask(taskId);
                setPendingState((prev) => {
                    const next = prev.filter((task) => task.id !== taskId);
                    pendingStateRef.current = next;
                    return next;
                });

                if (historyLoaded) {
                    const optimisticHistoryTask: HistoryTask = {
                        ...currentTask,
                        status: "DENIED",
                        updated_at: nowIso,
                    };
                    setHistoryState((prev) => {
                        const next = mergeTasksById(prev, [optimisticHistoryTask], "prepend");
                        historyStateRef.current = next;
                        return next;
                    });
                }
            },
            runMutation: () => voucherDeny(taskId),
            rollback: (snapshot) => {
                unsuppressPendingTask(taskId);
                pendingStateRef.current = snapshot.pendingState;
                historyStateRef.current = snapshot.historyState;
                setPendingState(snapshot.pendingState);
                setHistoryState(snapshot.historyState);
            },
            onSuccess: () => {
                void purgeLocalProofMedia(taskId);
            },
        });

        setTaskInFlight(taskId, false);
    }

    async function handleRectify(taskId: string) {
        if (inFlightIdsRef.current.has(taskId)) return;
        const currentTask = historyState.find((task) => task.id === taskId);
        if (!currentTask) return;

        if (!isWithinRectifyWindow(currentTask.updated_at, Date.now())) {
            toast.error("Rectify window expired (7 days).");
            return;
        }

        setTaskInFlight(taskId, true);
        const optimisticPassCount = (currentTask.rectify_passes_used ?? 0) + 1;
        const nowIso = new Date().toISOString();

        await runOptimisticMutation({
            captureSnapshot: () => ({ historyState }),
            applyOptimistic: () => {
                setHistoryState((prev) =>
                    prev.map((task) =>
                        task.id === taskId
                            ? {
                                ...task,
                                status: "RECTIFIED",
                                rectify_passes_used: optimisticPassCount,
                                updated_at: nowIso,
                            }
                            : task
                    )
                );
            },
            runMutation: () => authorizeRectify(taskId),
            rollback: (snapshot) => {
                setHistoryState(snapshot.historyState);
            },
        });

        setTaskInFlight(taskId, false);
    }

    async function handleRequestProof(taskId: string) {
        if (inFlightIdsRef.current.has(taskId)) return;
        setTaskInFlight(taskId, true);

        const result = await voucherRequestProof(taskId);
        if (result?.error) {
            toast.error(result.error);
        } else {
            const nowIso = new Date().toISOString();
            setPendingState((prev) => {
                const patched = applyProofRequestSuccessToPendingTasks(prev, taskId, nowIso);
                const next = sortPendingTasks(patched);
                pendingStateRef.current = next;
                return next;
            });
            toast.success("Proof request sent.");
        }

        setTaskInFlight(taskId, false);
    }

    return (
        <div className="max-w-3xl mx-auto space-y-12 pb-20 px-4 md:px-0">
            <TaskDetailPrefetcher tasks={pendingState} />
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-3xl font-bold text-white">Friends</h1>
                </div>
                <HardRefreshButton />
            </div>

            {workingFriends.length > 0 && (
                <section className="space-y-3">
                    <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3">
                        <div className="space-y-2">
                            {workingFriends.map((friend) => (
                                <p
                                    key={friend.friend_id}
                                    className="flex items-center gap-2 text-sm text-cyan-200"
                                >
                                    <Timer className="h-4 w-4 text-cyan-400 animate-pulse drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
                                    <span>
                                        <span className="font-semibold text-cyan-100">{friend.friend_username}</span>{" "}
                                        is currently focusing on a task
                                    </span>
                                </p>
                            ))}
                        </div>
                    </div>
                </section>
            )}

            <section className="space-y-4">
                <h2 className="text-xl font-semibold text-slate-500 border-b border-slate-900 pb-2">
                    Pending
                </h2>
                {pendingState.length === 0 ? (
                    <div className="bg-slate-900/40 border border-slate-800/20 rounded-xl py-12 text-center">
                        <p className="text-slate-500 text-sm">No pending vouch requests</p>
                    </div>
                ) : (
                    <div className="flex flex-col" ref={pendingListRef}>
                        {pendingState.map((task) => (
                            <CompactPendingItem
                                key={task.id}
                                task={task}
                                onAccept={() => handleAccept(task.id)}
                                onDeny={() => handleDeny(task.id)}
                                onRequestProof={() => handleRequestProof(task.id)}
                                isLoading={inFlightIds.has(task.id)}
                            />
                        ))}
                    </div>
                )}
            </section>

            <section className="space-y-4">
                <Button
                    variant="ghost"
                    onClick={handleHistoryToggle}
                    className="group flex items-center gap-2 text-slate-400 hover:text-white px-0 hover:bg-transparent"
                >
                    {isHistoryOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="font-medium text-sm">Vouched</span>
                </Button>

                {isHistoryOpen && (
                    <div className="flex flex-col border-t border-slate-900/50">
                        {historyLoading && !historyLoaded ? (
                            <div className="py-8 text-center text-slate-500 text-sm">Loading history...</div>
                        ) : historyState.length === 0 ? (
                            <div className="py-8 text-center">
                                <p className="text-slate-600 text-sm">No history yet</p>
                            </div>
                        ) : (
                            <>
                                {historyState.map((task) => (
                                    <CompactHistoryItem
                                        key={task.id}
                                        task={task}
                                        onRectify={() => handleRectify(task.id)}
                                        isLoading={inFlightIds.has(task.id)}
                                    />
                                ))}

                                {historyHasMore && (
                                    <div className="pt-4 flex justify-center">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={handleLoadMore}
                                            disabled={historyLoading}
                                            className="border-slate-800 bg-slate-900/50 text-slate-300 hover:text-white"
                                        >
                                            {historyLoading ? (
                                                <>
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    Loading...
                                                </>
                                            ) : (
                                                "Load more"
                                            )}
                                        </Button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
}

export function CompactPendingItem({
    task,
    onAccept,
    onDeny,
    onRequestProof,
    isLoading,
}: {
    task: VoucherPendingTask;
    onAccept: () => void;
    onDeny: () => void;
    onRequestProof: () => void;
    isLoading: boolean;
}) {
    const [renderTimestamp] = useState(() => Date.now());
    const [isProofFullscreen, setIsProofFullscreen] = useState(false);
    const blockSaveShortcut = (event: React.MouseEvent<HTMLElement>) => {
        event.preventDefault();
    };



    const deadline = (() => {
        if (task.pending_deadline_at) {
            return new Date(task.pending_deadline_at);
        }
        if (task.marked_completed_at) {
            const derived = new Date(task.marked_completed_at);
            derived.setDate(derived.getDate() + 2);
            derived.setHours(23, 59, 59, 999);
            return derived;
        }
        if (task.voucher_response_deadline) {
            return new Date(task.voucher_response_deadline);
        }
        return new Date(task.deadline || "");
    })();
    const hasValidDeadline = !Number.isNaN(deadline.getTime());
    const deadlineLabel = Number.isNaN(deadline.getTime())
        ? "No deadline"
        : deadline.toLocaleString("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });
    const hoursLeft = hasValidDeadline
        ? Math.max(0, Math.floor((deadline.getTime() - renderTimestamp) / (1000 * 60 * 60)))
        : Number.POSITIVE_INFINITY;
    const canReview = task.status === "AWAITING_VOUCHER" || task.status === "MARKED_COMPLETE";
    const canRequestProof = canReview;
    const proof = task.completion_proof;
    const proofVersion = proof
        ? (proof.updated_at || task.updated_at)
        : null;
    const proofSrc = proof && proofVersion
        ? (getWarmProofSrc(task.id, proofVersion) || `/api/task-proofs/${task.id}?v=${encodeURIComponent(proofVersion)}`)
        : null;

    useEffect(() => {
        if (!isProofFullscreen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setIsProofFullscreen(false);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [isProofFullscreen]);

    return (
        <div className="group flex items-start gap-3 py-6 border-b border-slate-900 last:border-0 hover:bg-slate-900/10 -mx-4 px-4 transition-colors">
            <div className="flex-1 min-w-0">
                <div>
                    <div
                        className="block w-full text-left [direction:ltr] text-lg font-medium leading-tight text-slate-100 whitespace-normal break-words"
                        title={task.title}
                    >
                        {task.title}
                    </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-purple-300">{task.user?.username || "Unknown"}</span>
                    <TaskStatusBadge
                        status={task.pending_display_type === "ACTIVE" ? "ACTIVE" : "AWAITING_VOUCHER"}
                        className="font-medium tracking-normal"
                    />
                    {task.pending_display_type !== "ACTIVE" && (
                        <VoucherDeadlineBadge
                            deadlineLabel={deadlineLabel}
                            hasValidDeadline={hasValidDeadline}
                            hoursLeft={hoursLeft}
                        />
                    )}
                    <VoucherPomoAccumulatedBadge totalSeconds={task.pomo_total_seconds || 0} />
                    <VoucherProofRequestBadge
                        proofRequestCount={task.proof_request_open ? (task.proof_request_count || 0) : 0}
                    />
                </div>

                {proof && proofSrc && (
                    <div
                        className="mt-3 rounded-lg border border-slate-800 bg-slate-950/50 p-2 max-w-sm select-none"
                        onContextMenu={blockSaveShortcut}
                    >
                        <ProofMedia
                            mediaKind={proof.media_kind}
                            src={proofSrc}
                            alt="Completion proof"
                            overlayTimestampText={proof.overlay_timestamp_text}
                            wrapperClassName="w-full"
                            imageClassName="w-full h-auto rounded-md object-cover cursor-zoom-in"
                            videoClassName="w-full rounded-md cursor-zoom-in"
                            imageProps={{
                                loading: "lazy",
                                draggable: false,
                                onContextMenu: blockSaveShortcut,
                                onClick: () => setIsProofFullscreen(true),
                            }}
                            videoProps={{
                                controls: true,
                                preload: "metadata",
                                controlsList: "nodownload noplaybackrate noremoteplayback",
                                disablePictureInPicture: true,
                                disableRemotePlayback: true,
                                onContextMenu: blockSaveShortcut,
                                onClick: () => setIsProofFullscreen(true),
                            }}
                        />
                    </div>
                )}
            </div>

            <div className="shrink-0 self-center flex items-center gap-2">
                {canReview && (
                    <>
                        <Button
                            size="sm"
                            onClick={onAccept}
                            disabled={isLoading}
                            aria-label={`Accept task ${task.title}`}
                            title="Accept task"
                            className="h-9 w-9 p-0 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200 border border-emerald-500/30 transition-all"
                        >
                            <Check className="h-4 w-4" strokeWidth={3} />
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={onDeny}
                            disabled={isLoading}
                            aria-label={`Deny task ${task.title}`}
                            title="Deny task"
                            className="h-9 w-9 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/30"
                        >
                            <X className="h-4 w-4" strokeWidth={3} />
                        </Button>
                        {canRequestProof && (
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={onRequestProof}
                                disabled={isLoading}
                                aria-label={`Request proof for task ${task.title}`}
                                title="Request proof"
                                className="h-9 w-9 p-0 text-pink-400 hover:text-pink-300 hover:bg-pink-400/10 border border-pink-400/30"
                            >
                                <CircleHelp className="h-4 w-4" strokeWidth={2.5} />
                            </Button>
                        )}
                    </>
                )}
            </div>

            {isProofFullscreen && proof && proofSrc && (
                <div
                    className="fixed inset-0 z-[100] bg-black/95 p-3 md:p-6 flex items-center justify-center"
                    onClick={() => setIsProofFullscreen(false)}
                    onContextMenu={blockSaveShortcut}
                >
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            setIsProofFullscreen(false);
                        }}
                        className="absolute top-3 right-3 md:top-5 md:right-5 h-9 w-9 rounded-full bg-slate-900/80 border border-slate-700 text-slate-200 hover:text-white"
                        aria-label="Close fullscreen proof"
                        title="Close"
                    >
                        <X className="h-4 w-4 mx-auto" />
                    </button>

                    <ProofMedia
                        mediaKind={proof.media_kind}
                        src={proofSrc}
                        alt="Completion proof fullscreen"
                        overlayTimestampText={proof.overlay_timestamp_text}
                        imageClassName="max-h-[95vh] max-w-[95vw] object-contain rounded-md"
                        videoClassName="max-h-[95vh] max-w-[95vw] rounded-md"
                        imageProps={{
                            draggable: false,
                            onClick: (event) => event.stopPropagation(),
                            onContextMenu: blockSaveShortcut,
                        }}
                        videoProps={{
                            controls: true,
                            autoPlay: true,
                            preload: "auto",
                            controlsList: "nodownload noplaybackrate noremoteplayback",
                            disablePictureInPicture: true,
                            disableRemotePlayback: true,
                            onClick: (event) => event.stopPropagation(),
                            onContextMenu: blockSaveShortcut,
                        }}
                    />
                </div>
            )}
        </div>
    );
}

function CompactHistoryItem({
    task,
    onRectify,
    isLoading,
}: {
    task: HistoryTask;
    onRectify: () => void;
    isLoading: boolean;
}) {
    const [renderNow] = useState(() => Date.now());

    const isRectifiable = task.status === "DENIED" || task.status === "MISSED";
    const withinRectifyWindow = isWithinRectifyWindow(task.updated_at, renderNow);
    const passLimitReached = (task.rectify_passes_used ?? 0) >= 5;
    return (
        <div className="group flex items-center gap-3 py-4 border-b border-slate-900/50 last:border-0 hover:bg-slate-900/10 -mx-4 px-4 transition-colors">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <div
                        className="block min-w-0 max-w-[58vw] md:max-w-[24rem] overflow-hidden text-ellipsis whitespace-nowrap text-left [direction:ltr] text-base font-medium text-slate-300"
                        title={task.title}
                    >
                        {task.title}
                    </div>
                    <HistoryTaskStatusBadge status={task.status} />
                </div>
                <p className="text-xs text-slate-600 mt-1">
                    <span className="text-purple-300">{task.user?.username || "Unknown"}</span> .{" "}
                    <span>{new Date(task.updated_at).toLocaleDateString()}</span>
                </p>
            </div>

            <div className="flex items-center gap-3">
                {isRectifiable && withinRectifyWindow && (
                    <div className="flex flex-col items-end">
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={onRectify}
                            disabled={isLoading || passLimitReached}
                            className="h-8 text-xs bg-orange-500/5 text-orange-400 hover:bg-orange-500/10 hover:text-orange-300 border border-orange-500/10"
                        >
                            {passLimitReached ? "Limit" : "Rectify"}
                        </Button>
                        <span className={`text-[9px] mt-1 font-mono ${passLimitReached ? "text-red-600" : "text-slate-700"}`}>
                            {task.rectify_passes_used ?? 0}/5 used
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
