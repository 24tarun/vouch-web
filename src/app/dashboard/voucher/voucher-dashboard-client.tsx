"use client";

import { useEffect, useState, useTransition } from "react";
import { authorizeRectify, getVouchHistoryPage, voucherAccept, voucherDeny } from "@/actions/voucher";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { TaskWithRelations, VoucherPendingTask } from "@/lib/types";
import { Check, ChevronDown, ChevronRight, Loader2, Timer, X } from "lucide-react";
import { runOptimisticMutation } from "@/lib/ui/runOptimisticMutation";
import { toast } from "sonner";
import { HardRefreshButton } from "@/components/HardRefreshButton";

interface VoucherDashboardClientProps {
    pendingTasks: VoucherPendingTask[];
}

type HistoryTask = TaskWithRelations & { rectify_passes_used?: number };

const HISTORY_PAGE_SIZE = 10;
const RECTIFY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const VOUCH_HISTORY_OPEN_SESSION_KEY = "voucher.history.open";

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

export default function VoucherDashboardClient({
    pendingTasks,
}: VoucherDashboardClientProps) {
    const router = useRouter();
    const [, startRefreshTransition] = useTransition();

    const [pendingState, setPendingState] = useState<VoucherPendingTask[]>(pendingTasks);
    const [historyState, setHistoryState] = useState<HistoryTask[]>([]);
    const [inFlightIds, setInFlightIds] = useState<Set<string>>(new Set());

    const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        return window.sessionStorage.getItem(VOUCH_HISTORY_OPEN_SESSION_KEY) === "1";
    });
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyOffset, setHistoryOffset] = useState(0);
    const [historyHasMore, setHistoryHasMore] = useState(true);

    const refreshInBackground = () => {
        startRefreshTransition(() => {
            router.refresh();
        });
    };

    const setTaskInFlight = (taskId: string, pending: boolean) => {
        setInFlightIds((prev) => {
            const next = new Set(prev);
            if (pending) {
                next.add(taskId);
            } else {
                next.delete(taskId);
            }
            return next;
        });
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

    const handleHistoryToggle = () => {
        setIsHistoryOpen((prev) => {
            const next = !prev;
            if (typeof window !== "undefined") {
                if (next) {
                    window.sessionStorage.setItem(VOUCH_HISTORY_OPEN_SESSION_KEY, "1");
                } else {
                    window.sessionStorage.removeItem(VOUCH_HISTORY_OPEN_SESSION_KEY);
                }
            }
            return next;
        });
    };

    const handleLoadMore = () => {
        if (historyLoading || !historyHasMore) return;
        void loadHistoryPage(historyOffset, false);
    };

    async function handleAccept(taskId: string) {
        if (inFlightIds.has(taskId)) return;
        const currentTask = pendingState.find((task) => task.id === taskId);
        if (!currentTask) return;

        setTaskInFlight(taskId, true);
        const nowIso = new Date().toISOString();

        await runOptimisticMutation({
            captureSnapshot: () => ({ pendingState, historyState }),
            applyOptimistic: () => {
                setPendingState((prev) => prev.filter((task) => task.id !== taskId));

                if (historyLoaded) {
                    const optimisticHistoryTask: HistoryTask = {
                        ...currentTask,
                        status: "COMPLETED",
                        updated_at: nowIso,
                    };
                    setHistoryState((prev) => mergeTasksById(prev, [optimisticHistoryTask], "prepend"));
                }
            },
            runMutation: () => voucherAccept(taskId),
            rollback: (snapshot) => {
                setPendingState(snapshot.pendingState);
                setHistoryState(snapshot.historyState);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        setTaskInFlight(taskId, false);
    }

    async function handleDeny(taskId: string) {
        if (inFlightIds.has(taskId)) return;
        const currentTask = pendingState.find((task) => task.id === taskId);
        if (!currentTask) return;

        setTaskInFlight(taskId, true);
        const nowIso = new Date().toISOString();

        await runOptimisticMutation({
            captureSnapshot: () => ({ pendingState, historyState }),
            applyOptimistic: () => {
                setPendingState((prev) => prev.filter((task) => task.id !== taskId));

                if (historyLoaded) {
                    const optimisticHistoryTask: HistoryTask = {
                        ...currentTask,
                        status: "FAILED",
                        updated_at: nowIso,
                    };
                    setHistoryState((prev) => mergeTasksById(prev, [optimisticHistoryTask], "prepend"));
                }
            },
            runMutation: () => voucherDeny(taskId),
            rollback: (snapshot) => {
                setPendingState(snapshot.pendingState);
                setHistoryState(snapshot.historyState);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        setTaskInFlight(taskId, false);
    }

    async function handleRectify(taskId: string) {
        if (inFlightIds.has(taskId)) return;
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
            onSuccess: () => {
                refreshInBackground();
            },
        });

        setTaskInFlight(taskId, false);
    }

    return (
        <div className="max-w-3xl mx-auto space-y-12 pb-20 mt-12 px-4 md:px-0">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-3xl font-bold text-white">Vouch Requests</h1>
                    <p className="text-slate-400 mt-1">
                        Review and verify task completions for your friends
                    </p>
                </div>
                <HardRefreshButton />
            </div>

            <section className="space-y-4">
                <h2 className="text-xl font-semibold text-slate-500 border-b border-slate-900 pb-2">
                    Pending
                </h2>
                {pendingState.length === 0 ? (
                    <div className="bg-slate-900/40 border border-slate-800/20 rounded-xl py-12 text-center">
                        <p className="text-slate-500 text-sm">No pending vouch requests</p>
                    </div>
                ) : (
                    <div className="flex flex-col">
                        {pendingState.map((task) => (
                            <CompactPendingItem
                                key={task.id}
                                task={task}
                                onOpenTask={() => router.push(`/dashboard/tasks/${task.id}`)}
                                onAccept={() => handleAccept(task.id)}
                                onDeny={() => handleDeny(task.id)}
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
                                        onOpenTask={() => router.push(`/dashboard/tasks/${task.id}`)}
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

function CompactPendingItem({
    task,
    onOpenTask,
    onAccept,
    onDeny,
    isLoading,
}: {
    task: VoucherPendingTask;
    onOpenTask: () => void;
    onAccept: () => void;
    onDeny: () => void;
    isLoading: boolean;
}) {
    const [renderTimestamp] = useState(() => Date.now());

    const formatPomoBadge = (seconds: number) => {
        if (seconds < 60) return "<1m";
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
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
    const pomoTotalSeconds = task.pomo_total_seconds || 0;
    const statusLabel = task.pending_display_type === "ACTIVE" ? "ACTIVE" : "AWAITING VOUCHER";
    const statusClass = task.pending_display_type === "ACTIVE"
        ? "bg-blue-500/10 text-blue-300 border-blue-500/30 text-[10px]"
        : "bg-purple-500/10 text-purple-300 border-purple-500/30 text-[10px]";
    const deadlineClass = !hasValidDeadline
        ? "bg-slate-500/10 text-slate-400 border-slate-500/20 text-[10px]"
        : (hoursLeft < 6
            ? "bg-red-500/10 text-red-500 border-red-500/30 text-[10px]"
            : "bg-purple-500/10 text-purple-400 border-purple-500/30 text-[10px]");

    return (
        <div className="group flex items-center gap-3 py-6 border-b border-slate-900 last:border-0 hover:bg-slate-900/10 -mx-4 px-4 transition-colors">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onOpenTask}
                        className="block min-w-0 max-w-[58vw] md:max-w-[24rem] overflow-hidden text-ellipsis whitespace-nowrap text-left [direction:ltr] text-lg font-medium text-slate-100 hover:text-white underline-offset-2 hover:underline"
                        title={task.title}
                        aria-label={`Open task ${task.title}`}
                    >
                        {task.title}
                    </button>
                    <Badge variant="outline" className={statusClass}>
                        {statusLabel}
                    </Badge>
                    <Badge variant="outline" className={deadlineClass}>
                        {deadlineLabel}
                    </Badge>
                    {pomoTotalSeconds > 0 && (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-[10px]">
                            <Timer className="h-3 w-3 mr-1" />
                            {formatPomoBadge(pomoTotalSeconds)}
                        </Badge>
                    )}
                </div>
                <p className="text-sm text-slate-500 mt-1">
                    <span className="text-slate-300">{task.user?.username || "Unknown"}</span> .{" "}
                    <span className="text-slate-400 font-mono">{"\u20ac"}{(task.failure_cost_cents / 100).toFixed(2)}</span>
                </p>
            </div>

            <div className="flex items-center gap-3">
                {task.pending_actionable && (
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
                    </>
                )}
            </div>
        </div>
    );
}

function CompactHistoryItem({
    task,
    onOpenTask,
    onRectify,
    isLoading,
}: {
    task: HistoryTask;
    onOpenTask: () => void;
    onRectify: () => void;
    isLoading: boolean;
}) {
    const [renderNow] = useState(() => Date.now());

    const statusColors: Record<string, string> = {
        COMPLETED: "text-lime-300",
        FAILED: "text-[#dc322f]",
        RECTIFIED: "text-[#cb4b16]",
        SETTLED: "text-[#2aa198]",
        DELETED: "text-slate-500",
    };

    const isRectifiable = task.status === "FAILED";
    const withinRectifyWindow = isWithinRectifyWindow(task.updated_at, renderNow);
    const passLimitReached = (task.rectify_passes_used ?? 0) >= 5;

    return (
        <div className="group flex items-center gap-3 py-4 border-b border-slate-900/50 last:border-0 hover:bg-slate-900/10 -mx-4 px-4 transition-colors">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onOpenTask}
                        className="block min-w-0 max-w-[58vw] md:max-w-[24rem] overflow-hidden text-ellipsis whitespace-nowrap text-left [direction:ltr] text-base font-medium text-slate-300 hover:text-white underline-offset-2 hover:underline"
                        title={task.title}
                        aria-label={`Open task ${task.title}`}
                    >
                        {task.title}
                    </button>
                    <Badge variant="outline" className={`text-[10px] h-4 py-0 px-1 border-slate-800 ${statusColors[task.status] || "text-slate-400"}`}>
                        {task.status === "FAILED"
                            ? (task.marked_completed_at ? "DENIED" : "FAILED")
                            : task.status === "COMPLETED"
                                ? "ACCEPTED"
                                : task.status}
                    </Badge>
                </div>
                <p className="text-xs text-slate-600 mt-1">
                    <span className="text-slate-400">{task.user?.username || "Unknown"}</span> .{" "}
                    <span>{new Date(task.updated_at).toLocaleDateString()}</span> .{" "}
                    <span className="font-mono">{"\u20ac"}{(task.failure_cost_cents / 100).toFixed(2)}</span>
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
