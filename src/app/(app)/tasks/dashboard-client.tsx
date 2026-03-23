"use client";

import { fireCompletionConfetti } from "@/lib/confetti";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
    createTask,
    finalizeTaskProofUpload,
    markTaskCompleteWithProofIntent,
    ownerTempDeleteTask,
    postponeTask,
    revertTaskCompletionAfterProofFailure,
} from "@/actions/tasks";
import { setDashboardTipsHidden } from "@/actions/auth";
import { getUserReputationScore } from "@/actions/reputation";
import { DashboardHeaderActions, type DashboardSortMode } from "@/components/DashboardHeaderActions";
import { TaskInput, type TaskInputCreatePayload } from "@/components/TaskInput";
import { FloatingTaskCreator, type FloatingTaskCreatorHandle } from "@/components/task-creator-variants/FloatingTaskCreator";
import { PostponeDeadlineDialog } from "@/components/PostponeDeadlineDialog";
import { TaskRow } from "@/components/TaskRow";
import { CollapsibleCompletedList } from "@/components/CollapsibleCompletedList";
import { CollapsibleFutureList } from "@/components/CollapsibleFutureList";
import { TaskDetailPrefetcher } from "@/components/TaskDetailPrefetcher";
import { runOptimisticMutation } from "@/lib/ui/runOptimisticMutation";
import type { Profile, Task } from "@/lib/types";
import type { SupportedCurrency } from "@/lib/currency";
import { toast } from "sonner";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
    getProofIntentFromPreparedProof,
    prepareTaskProof,
    type PreparedTaskProof,
} from "@/lib/task-proof-client";
import { splitDashboardActiveTaskBuckets } from "@/lib/dashboard-task-buckets";
import { ReputationBar } from "@/components/ReputationBar";
import type { ReputationScoreData } from "@/lib/reputation/types";
import { purgeLocalProofMedia } from "@/lib/proof-media-warmup";
import { subscribeRealtimeTaskChanges } from "@/lib/realtime-task-events";
import { isIncomingNewer, patchTaskScalars } from "@/lib/tasks-realtime-patch";
import { getVoucherResponseDeadlineLocal } from "@/lib/voucher-deadline";
import {
    buildBeforeStartSubmissionMessage,
    getTaskSubmissionWindowState,
} from "@/lib/task-submission-window";

const MAX_COMPLETED_TASKS = 10;
const EVENT_TOKEN_REGEX = /(^|\s)-event(?=\s|$)/i;

interface TaskProofDraft {
    proof: PreparedTaskProof;
    previewUrl: string;
}

interface ProofUploadTarget {
    bucket: string;
    objectPath: string;
    uploadToken?: string;
}

interface DashboardClientProps {
    initialTasks: Task[];
    friends: Profile[];
    defaultFailureCostEuros: string;
    currency: SupportedCurrency;
    defaultVoucherId: string | null;
    defaultPomoDurationMinutes: number;
    defaultEventDurationMinutes: number;
    userId: string;
    username: string;
    initialHideTips: boolean;
    reputationScore: ReputationScoreData | null;
}

function isDashboardActiveStatus(status: Task["status"]): boolean {
    return status === "CREATED" || status === "POSTPONED";
}

function splitTasks(tasks: Task[]) {
    const active = tasks.filter((task) => isDashboardActiveStatus(task.status));
    const completed = tasks.filter((task) => !isDashboardActiveStatus(task.status));

    return { active, completed };
}

function safeTimestamp(value: string): number {
    const ts = new Date(value).getTime();
    return Number.isNaN(ts) ? 0 : ts;
}

function sortActiveTasks(tasks: Task[], sortMode: DashboardSortMode): Task[] {
    return [...tasks].sort((a, b) => {
        const deadlineA = safeTimestamp(a.deadline);
        const deadlineB = safeTimestamp(b.deadline);
        const createdA = safeTimestamp(a.created_at);
        const createdB = safeTimestamp(b.created_at);

        if (sortMode === "deadline_asc") {
            if (deadlineA !== deadlineB) return deadlineA - deadlineB;
            // For same deadline, newer task first.
            if (createdA !== createdB) return createdB - createdA;
            return 0;
        }

        if (sortMode === "deadline_desc") {
            if (deadlineA !== deadlineB) return deadlineB - deadlineA;
            if (createdA !== createdB) return createdB - createdA;
            return 0;
        }

        if (sortMode === "created_asc") {
            if (createdA !== createdB) return createdA - createdB;
            if (deadlineA !== deadlineB) return deadlineA - deadlineB;
            return 0;
        }

        if (createdA !== createdB) return createdB - createdA;
        if (deadlineA !== deadlineB) return deadlineA - deadlineB;
        return 0;
    });
}

function buildCreateTaskFormData(payload: TaskInputCreatePayload): FormData {
    const formData = new FormData();
    formData.append("title", payload.title);
    formData.append("rawTitle", payload.rawTitle);
    formData.append("deadline", payload.deadlineIso);
    if (payload.eventStartIso) {
        formData.append("eventStartIso", payload.eventStartIso);
    }
    if (payload.eventEndIso) {
        formData.append("eventEndIso", payload.eventEndIso);
    }
    formData.append("voucherId", payload.voucherId);
    formData.append("failureCost", payload.failureCost);
    if (payload.subtasks.length > 0) {
        formData.append("subtasks", JSON.stringify(payload.subtasks));
    }
    if (payload.requiredPomoMinutes != null) {
        formData.append("requiredPomoMinutes", String(payload.requiredPomoMinutes));
    }
    formData.append("requiresProof", payload.requiresProof ? "true" : "false");
    if (payload.reminderIsos.length > 0) {
        formData.append("reminders", JSON.stringify(payload.reminderIsos));
    }

    if (payload.recurrenceType) {
        formData.append("recurrenceType", payload.recurrenceType);
        formData.append("userTimezone", payload.userTimezone);
        formData.append("recurrenceInterval", "1");

        if (payload.recurrenceType === "WEEKLY" && payload.recurrenceDays.length > 0) {
            formData.append("recurrenceDays", JSON.stringify(payload.recurrenceDays));
        }
    }

    return formData;
}

export default function DashboardClient({
    initialTasks,
    friends,
    defaultFailureCostEuros,
    currency,
    defaultVoucherId,
    defaultPomoDurationMinutes,
    defaultEventDurationMinutes,
    userId,
    username,
    initialHideTips,
    reputationScore,
}: DashboardClientProps) {
    const router = useRouter();
    const [, startRefreshTransition] = useTransition();
    const split = useMemo(() => splitTasks(initialTasks), [initialTasks]);

    const [activeTasks, setActiveTasks] = useState<Task[]>(split.active);
    const [completedTasks, setCompletedTasks] = useState<Task[]>(split.completed.slice(0, MAX_COMPLETED_TASKS));
    const [completingTaskIds, setCompletingTaskIds] = useState<Set<string>>(new Set());
    const [postponingTaskIds, setPostponingTaskIds] = useState<Set<string>>(new Set());
    const [postponeDialogTaskId, setPostponeDialogTaskId] = useState<string | null>(null);
    const [deletingTaskIds, setDeletingTaskIds] = useState<Set<string>>(new Set());
    const [proofByTaskId, setProofByTaskId] = useState<Record<string, TaskProofDraft>>({});
    const [proofUploadErrors, setProofUploadErrors] = useState<Record<string, string>>({});
    const [tipsHidden, setTipsHidden] = useState(initialHideTips);
    const [isTogglingTips, setIsTogglingTips] = useState(false);
    const [sortMode, setSortMode] = useState<DashboardSortMode>("deadline_asc");
    const [floatingCreatorOpen, setFloatingCreatorOpen] = useState(false);
    const floatingCreatorRef = useRef<FloatingTaskCreatorHandle>(null);
    const [liveReputationScore, setLiveReputationScore] = useState<ReputationScoreData | null>(reputationScore);
    const proofInputRef = useRef<HTMLInputElement>(null);
    const proofByTaskIdRef = useRef<Record<string, TaskProofDraft>>({});
    const proofPickerTaskIdRef = useRef<string | null>(null);
    const activeTasksRef = useRef<Task[]>(split.active);
    const completedTasksRef = useRef<Task[]>(split.completed.slice(0, MAX_COMPLETED_TASKS));
    const sortedActiveTaskBuckets = useMemo(() => {
        const { activeDueSoonTasks, futureTasks } = splitDashboardActiveTaskBuckets(activeTasks);
        return {
            activeDueSoonTasks: sortActiveTasks(activeDueSoonTasks, sortMode),
            futureTasks: sortActiveTasks(futureTasks, sortMode),
        };
    }, [activeTasks, sortMode]);
    const postponeDialogTask = useMemo(() => {
        if (!postponeDialogTaskId) return null;
        return activeTasks.find((task) => task.id === postponeDialogTaskId) || null;
    }, [activeTasks, postponeDialogTaskId]);
    const canPostponeDialogTask = useMemo(() => {
        if (!postponeDialogTask) return false;
        return (
            postponeDialogTask.status === "CREATED" &&
            !postponeDialogTask.postponed_at
        );
    }, [postponeDialogTask]);
    const isPostponeDialogOpen = Boolean(
        postponeDialogTask &&
        canPostponeDialogTask
    );
    const activeDueSoonTasks = sortedActiveTaskBuckets.activeDueSoonTasks;
    const futureTasks = sortedActiveTaskBuckets.futureTasks;

    useEffect(() => {
        const nextActiveTasks = split.active;
        const nextCompletedTasks = split.completed.slice(0, MAX_COMPLETED_TASKS);

        activeTasksRef.current = nextActiveTasks;
        completedTasksRef.current = nextCompletedTasks;
        setActiveTasks(nextActiveTasks);
        setCompletedTasks(nextCompletedTasks);
        setCompletingTaskIds((prev) => {
            if (prev.size === 0) return prev;
            const activeIds = new Set(split.active.map((task) => task.id));
            const next = new Set(Array.from(prev).filter((taskId) => activeIds.has(taskId)));
            return next.size === prev.size ? prev : next;
        });
        setPostponingTaskIds((prev) => {
            if (prev.size === 0) return prev;
            const activeIds = new Set(split.active.map((task) => task.id));
            const next = new Set(Array.from(prev).filter((taskId) => activeIds.has(taskId)));
            return next.size === prev.size ? prev : next;
        });
        setDeletingTaskIds((prev) => {
            if (prev.size === 0) return prev;
            const activeIds = new Set(split.active.map((task) => task.id));
            const next = new Set(Array.from(prev).filter((taskId) => activeIds.has(taskId)));
            return next.size === prev.size ? prev : next;
        });
    }, [split]);

    useEffect(() => {
        setTipsHidden(initialHideTips);
    }, [initialHideTips]);

    useEffect(() => {
        proofByTaskIdRef.current = proofByTaskId;
    }, [proofByTaskId]);

    useEffect(() => {
        activeTasksRef.current = activeTasks;
    }, [activeTasks]);

    useEffect(() => {
        completedTasksRef.current = completedTasks;
    }, [completedTasks]);

    useEffect(() => {
        return () => {
            for (const entry of Object.values(proofByTaskIdRef.current)) {
                URL.revokeObjectURL(entry.previewUrl);
            }
        };
    }, []);

    const refreshInBackground = () => {
        startRefreshTransition(() => {
            router.refresh();
        });
    };

    const refreshReputation = () => {
        getUserReputationScore(userId).then((score) => {
            if (score) setLiveReputationScore(score);
        });
    };

    const setTaskCompleting = (taskId: string, completing: boolean) => {
        setCompletingTaskIds((prev) => {
            const next = new Set(prev);
            if (completing) {
                next.add(taskId);
            } else {
                next.delete(taskId);
            }
            return next;
        });
    };

    const setTaskDeleting = (taskId: string, deleting: boolean) => {
        setDeletingTaskIds((prev) => {
            const next = new Set(prev);
            if (deleting) {
                next.add(taskId);
            } else {
                next.delete(taskId);
            }
            return next;
        });
    };

    const setTaskPostponing = (taskId: string, postponing: boolean) => {
        setPostponingTaskIds((prev) => {
            const next = new Set(prev);
            if (postponing) {
                next.add(taskId);
            } else {
                next.delete(taskId);
            }
            return next;
        });
    };

    const setTaskProofDraft = (taskId: string, nextDraft: TaskProofDraft | null) => {
        setProofByTaskId((prev) => {
            const current = prev[taskId];
            if (current && (!nextDraft || current.previewUrl !== nextDraft.previewUrl)) {
                URL.revokeObjectURL(current.previewUrl);
            }

            if (!nextDraft) {
                if (!current) return prev;
                const next = { ...prev };
                delete next[taskId];
                return next;
            }

            return {
                ...prev,
                [taskId]: nextDraft,
            };
        });
    };

    useEffect(() => {
        const clearTaskTransientState = (taskId: string) => {
            setCompletingTaskIds((prev) => {
                if (!prev.has(taskId)) return prev;
                const next = new Set(prev);
                next.delete(taskId);
                return next;
            });
            setPostponingTaskIds((prev) => {
                if (!prev.has(taskId)) return prev;
                const next = new Set(prev);
                next.delete(taskId);
                return next;
            });
            setDeletingTaskIds((prev) => {
                if (!prev.has(taskId)) return prev;
                const next = new Set(prev);
                next.delete(taskId);
                return next;
            });
            setProofByTaskId((prev) => {
                const current = prev[taskId];
                if (!current) return prev;
                URL.revokeObjectURL(current.previewUrl);
                const next = { ...prev };
                delete next[taskId];
                return next;
            });
            setProofUploadErrors((prev) => {
                if (!prev[taskId]) return prev;
                const next = { ...prev };
                delete next[taskId];
                return next;
            });
        };

        const unsubscribe = subscribeRealtimeTaskChanges((change) => {
            const incoming = change.newRow || change.oldRow;
            if (!incoming || incoming.user_id !== userId) return;

            const taskId = incoming.id;
            const currentActiveTasks = activeTasksRef.current;
            const currentCompletedTasks = completedTasksRef.current;
            const existingTask =
                currentActiveTasks.find((task) => task.id === taskId) ||
                currentCompletedTasks.find((task) => task.id === taskId);

            // If the task moved to a terminal/non-active status, remove it from all lists
            // even if it wasn't previously tracked (e.g. AWAITING_VOUCHER → COMPLETED via Orca).
            const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "RECTIFIED", "SETTLED", "DELETED"];
            if (!existingTask) {
                if (change.newRow && TERMINAL_STATUSES.includes(change.newRow.status)) {
                    const nextActiveTasks = currentActiveTasks.filter((task) => task.id !== taskId);
                    if (nextActiveTasks.length !== currentActiveTasks.length) {
                        activeTasksRef.current = nextActiveTasks;
                        setActiveTasks(nextActiveTasks);
                    }
                }
                return;
            }

            if (change.eventType === "DELETE") {
                const nextActiveTasks = currentActiveTasks.filter((task) => task.id !== taskId);
                const nextCompletedTasks = currentCompletedTasks.filter((task) => task.id !== taskId);
                activeTasksRef.current = nextActiveTasks;
                completedTasksRef.current = nextCompletedTasks;
                setActiveTasks(nextActiveTasks);
                setCompletedTasks(nextCompletedTasks);
                clearTaskTransientState(taskId);
                return;
            }

            if (!isIncomingNewer(existingTask.updated_at, incoming.updated_at)) return;

            const patchedTask = patchTaskScalars(existingTask, incoming);
            const nextActiveTasks = currentActiveTasks.filter((task) => task.id !== taskId);
            const nextCompletedTasks = currentCompletedTasks.filter((task) => task.id !== taskId);

            if (isDashboardActiveStatus(patchedTask.status)) {
                const mergedActiveTasks = [patchedTask, ...nextActiveTasks];
                activeTasksRef.current = mergedActiveTasks;
                completedTasksRef.current = nextCompletedTasks;
                setActiveTasks(mergedActiveTasks);
                setCompletedTasks(nextCompletedTasks);
                return;
            }

            const mergedCompletedTasks = [patchedTask, ...nextCompletedTasks].slice(0, MAX_COMPLETED_TASKS);
            activeTasksRef.current = nextActiveTasks;
            completedTasksRef.current = mergedCompletedTasks;
            setActiveTasks(nextActiveTasks);
            setCompletedTasks(mergedCompletedTasks);

            clearTaskTransientState(taskId);

            const finalStatuses = new Set(["COMPLETED", "FAILED", "RECTIFIED", "SETTLED"]);
            if (finalStatuses.has(patchedTask.status)) {
                refreshReputation();
            }
        });

        return unsubscribe;
    }, [userId]);

    const processPickedProofFile = async (taskId: string, selectedFile: File) => {
        try {
            const preparedProof = await prepareTaskProof(selectedFile);
            const previewUrl = URL.createObjectURL(preparedProof.file);

            setTaskProofDraft(taskId, {
                proof: preparedProof,
                previewUrl,
            });
            setProofUploadErrors((prev) => {
                if (!prev[taskId]) return prev;
                const next = { ...prev };
                delete next[taskId];
                return next;
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Could not process proof file.";
            toast.error(message);
        }
    };

    const openTaskProofPicker = async (task: Task) => {
        if (completingTaskIds.has(task.id)) return;
        if (proofByTaskId[task.id]) {
            const shouldReplace = window.confirm(
                "A proof file is already attached. Press OK to replace it, or Cancel to remove it."
            );
            if (!shouldReplace) {
                setTaskProofDraft(task.id, null);
                setProofUploadErrors((prev) => {
                    if (!prev[task.id]) return prev;
                    const next = { ...prev };
                    delete next[task.id];
                    return next;
                });
                return;
            }
        }

        proofPickerTaskIdRef.current = task.id;
        proofInputRef.current?.click();
    };

    const handleProofInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const pickedTaskId = proofPickerTaskIdRef.current;
        const selectedFile = event.target.files?.[0];
        event.target.value = "";
        proofPickerTaskIdRef.current = null;

        if (!pickedTaskId || !selectedFile) return;
        await processPickedProofFile(pickedTaskId, selectedFile);
    };

    const uploadProofInBackground = async (
        taskId: string,
        draft: TaskProofDraft,
        target: ProofUploadTarget
    ) => {
        const supabase = createBrowserSupabaseClient();
        const uploadResponse = target.uploadToken
            ? await supabase.storage
                .from(target.bucket)
                .uploadToSignedUrl(target.objectPath, target.uploadToken, draft.proof.file, {
                    contentType: draft.proof.mimeType,
                    upsert: true,
                })
            : await supabase.storage
                .from(target.bucket)
                .upload(target.objectPath, draft.proof.file, {
                    upsert: true,
                    contentType: draft.proof.mimeType,
                    cacheControl: "120",
                });

        const uploadError = uploadResponse.error;

        if (uploadError) {
            console.error("Task proof upload failed (dashboard):", uploadError);
            const uploadMessage = uploadError.message || "Unknown upload error";
            setProofUploadErrors((prev) => ({
                ...prev,
                [taskId]: `Proof upload failed (${uploadMessage}). Task reverted to active state.`,
            }));
            toast.error(`Proof upload failed: ${uploadMessage}`);
            const reverted = await revertTaskCompletionAfterProofFailure(taskId);
            if (reverted?.error) {
                toast.error(reverted.error);
            }
            void purgeLocalProofMedia(taskId);
            refreshInBackground();
            return;
        }

        const finalize = await finalizeTaskProofUpload(taskId, {
            mediaKind: draft.proof.mediaKind,
            mimeType: draft.proof.mimeType,
            sizeBytes: draft.proof.sizeBytes,
            durationMs: draft.proof.durationMs,
            overlayTimestampText: draft.proof.overlayTimestampText,
            bucket: target.bucket,
            objectPath: target.objectPath,
        });

        if (finalize?.error) {
            setProofUploadErrors((prev) => ({
                ...prev,
                [taskId]: "Proof finalize failed. Task reverted to active state. Re-attach or retry.",
            }));
            toast.error(`Proof upload failed: ${finalize.error}`);
            const reverted = await revertTaskCompletionAfterProofFailure(taskId);
            if (reverted?.error) {
                toast.error(reverted.error);
            }
            void purgeLocalProofMedia(taskId);
            refreshInBackground();
            return;
        }

        setTaskProofDraft(taskId, null);
        setProofUploadErrors((prev) => {
            if (!prev[taskId]) return prev;
            const next = { ...prev };
            delete next[taskId];
            return next;
        });
        toast.success("Proof uploaded successfully.");
        refreshInBackground();
    };

    const handleCreateTaskOptimistic = (payload: TaskInputCreatePayload) => {
        const now = new Date();
        const nowIso = now.toISOString();
        const tempTaskId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const optimisticIsEventTask = EVENT_TOKEN_REGEX.test(payload.title);
        const optimisticEventStart =
            optimisticIsEventTask && payload.eventStartIso ? new Date(payload.eventStartIso) : null;
        const optimisticEventEnd = optimisticIsEventTask && payload.eventEndIso ? new Date(payload.eventEndIso) : null;
        const shouldAutoCompletePastEvent = Boolean(
            optimisticIsEventTask &&
            optimisticEventStart &&
            optimisticEventEnd &&
            !Number.isNaN(optimisticEventStart.getTime()) &&
            !Number.isNaN(optimisticEventEnd.getTime()) &&
            optimisticEventStart.getTime() <= now.getTime() &&
            optimisticEventEnd.getTime() <= now.getTime()
        );
        const optimisticTask: Task = {
            id: tempTaskId,
            user_id: userId,
            voucher_id: payload.voucherId,
            title: payload.title,
            description: null,
            failure_cost_cents: Math.round(Number(payload.failureCost) * 100),
            required_pomo_minutes: payload.requiredPomoMinutes,
            requires_proof: payload.requiresProof,
            deadline: payload.deadlineIso,
            status: shouldAutoCompletePastEvent ? "COMPLETED" : "CREATED",
            postponed_at: null,
            marked_completed_at: shouldAutoCompletePastEvent ? nowIso : null,
            voucher_response_deadline: null,
            recurrence_rule_id: payload.recurrenceType ? "optimistic" : null,
            google_sync_for_task: optimisticIsEventTask,
            google_event_start_at: optimisticIsEventTask ? payload.eventStartIso : null,
            google_event_end_at: optimisticIsEventTask ? payload.eventEndIso : null,
            created_at: nowIso,
            updated_at: nowIso,
            subtasks: payload.subtasks.map((subtaskTitle, index) => ({
                id: `temp-subtask-${index}-${Math.random().toString(36).slice(2, 8)}`,
                parent_task_id: tempTaskId,
                user_id: userId,
                title: subtaskTitle,
                is_completed: false,
                completed_at: null,
                created_at: nowIso,
                updated_at: nowIso,
            })),
        };

        void runOptimisticMutation({
            captureSnapshot: () => ({
                activeTasks,
                completedTasks,
            }),
            applyOptimistic: () => {
                if (shouldAutoCompletePastEvent) {
                    setCompletedTasks((prev) => [optimisticTask, ...prev].slice(0, MAX_COMPLETED_TASKS));
                } else {
                    setActiveTasks((prev) => [optimisticTask, ...prev]);
                }
            },
            runMutation: () => createTask(buildCreateTaskFormData(payload)),
            rollback: (snapshot) => {
                setActiveTasks(snapshot.activeTasks);
                setCompletedTasks(snapshot.completedTasks);
            },
            onSuccess: (result) => {
                if (result && "taskId" in result && result.taskId) {
                    const realTaskId = result.taskId as string;
                    const patchTaskId = (task: Task) =>
                        task.id === tempTaskId
                            ? {
                                ...task,
                                id: realTaskId,
                                recurrence_rule_id: payload.recurrenceType ? task.recurrence_rule_id : null,
                                subtasks: (task.subtasks || []).map((subtask) => ({
                                    ...subtask,
                                    parent_task_id: realTaskId,
                                })),
                            }
                            : task;

                    setActiveTasks((prev) =>
                        prev.map((task) =>
                            patchTaskId(task)
                        )
                    );
                    setCompletedTasks((prev) =>
                        prev.map((task) =>
                            patchTaskId(task)
                        )
                    );
                    setProofByTaskId((prev) => {
                        const draft = prev[tempTaskId];
                        if (!draft) return prev;
                        const next = { ...prev };
                        next[realTaskId] = draft;
                        delete next[tempTaskId];
                        return next;
                    });
                    setProofUploadErrors((prev) => {
                        if (!prev[tempTaskId]) return prev;
                        const next = { ...prev };
                        next[realTaskId] = next[tempTaskId];
                        delete next[tempTaskId];
                        return next;
                    });
                    if (proofPickerTaskIdRef.current === tempTaskId) {
                        proofPickerTaskIdRef.current = realTaskId;
                    }
                }
                refreshInBackground();
            },
        });
    };

    const handleCompleteTaskOptimistic = async (task: Task) => {
        if (completingTaskIds.has(task.id)) return;
        const submissionWindow = getTaskSubmissionWindowState({
            startAtIso: task.google_event_start_at ?? null,
            deadlineIso: task.deadline,
        });
        if (submissionWindow.beforeStart) {
            toast.error(buildBeforeStartSubmissionMessage(submissionWindow.startDate));
            return;
        }
        if (submissionWindow.pastDeadline) {
            toast.error("Deadline has passed");
            return;
        }

        const isSelfVouched = task.voucher_id === userId;
        const requiresProofForCompletion =
            Boolean(task.requires_proof) &&
            !isSelfVouched;
        const proofDraft = proofByTaskId[task.id] || null;
        if (requiresProofForCompletion && !proofDraft) {
            toast.error("Attach proof before marking this task complete.");
            return;
        }

        setTaskCompleting(task.id, true);
        fireCompletionConfetti();

        const now = new Date();
        const voucherResponseDeadline = getVoucherResponseDeadlineLocal(now);
        const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const proofIntent = proofDraft ? getProofIntentFromPreparedProof(proofDraft.proof) : null;
        if (proofIntent || task.completion_proof) {
            void purgeLocalProofMedia(task.id);
        }
        const nowIso = now.toISOString();
        const optimisticTask: Task = {
            ...task,
            status: isSelfVouched ? "COMPLETED" : "AWAITING_VOUCHER",
            marked_completed_at: nowIso,
            voucher_response_deadline: isSelfVouched ? null : voucherResponseDeadline.toISOString(),
            updated_at: nowIso,
        };

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({
                activeTasks,
                completedTasks,
            }),
            applyOptimistic: () => {
                setActiveTasks((prev) => prev.filter((currentTask) => currentTask.id !== task.id));
                setCompletedTasks((prev) =>
                    [optimisticTask, ...prev.filter((currentTask) => currentTask.id !== task.id)].slice(0, MAX_COMPLETED_TASKS)
                );
            },
            runMutation: () => markTaskCompleteWithProofIntent(task.id, userTimeZone, proofIntent),
            rollback: (snapshot) => {
                setActiveTasks(snapshot.activeTasks);
                setCompletedTasks(snapshot.completedTasks);
            },
            onSuccess: () => {
                if (isSelfVouched) {
                    setTaskProofDraft(task.id, null);
                    setProofUploadErrors((prev) => {
                        if (!prev[task.id]) return prev;
                        const next = { ...prev };
                        delete next[task.id];
                        return next;
                    });
                    void purgeLocalProofMedia(task.id);
                } else if (!proofIntent) {
                    void purgeLocalProofMedia(task.id);
                }
                refreshInBackground();
            },
        });

        if (!result.ok) {
            refreshInBackground();
        }

        if (result.ok && proofDraft && !isSelfVouched) {
            const mutationResult = result.result as { proofUploadTarget?: ProofUploadTarget } | undefined;
            const uploadTarget = mutationResult?.proofUploadTarget;

            if (!uploadTarget) {
                setProofUploadErrors((prev) => ({
                    ...prev,
                    [task.id]: "Proof upload target missing. Task reverted to active state.",
                }));
                toast.error("Proof upload failed: Upload target missing.");
                const reverted = await revertTaskCompletionAfterProofFailure(task.id);
                if (reverted?.error) {
                    toast.error(reverted.error);
                }
                refreshInBackground();
            } else {
                void uploadProofInBackground(task.id, proofDraft, uploadTarget);
            }
        }

        setTaskCompleting(task.id, false);
    };

    const handleDeleteTaskOptimistic = async (task: Task) => {
        if (deletingTaskIds.has(task.id) || task.id.startsWith("temp-")) return;
        setTaskDeleting(task.id, true);
        setTaskProofDraft(task.id, null);
        setProofUploadErrors((prev) => {
            if (!prev[task.id]) return prev;
            const next = { ...prev };
            delete next[task.id];
            return next;
        });

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({
                activeTasks,
                completedTasks,
            }),
            applyOptimistic: () => {
                setActiveTasks((prev) => prev.filter((currentTask) => currentTask.id !== task.id));
                setCompletedTasks((prev) => prev.filter((currentTask) => currentTask.id !== task.id));
            },
            runMutation: () => ownerTempDeleteTask(task.id),
            rollback: (snapshot) => {
                setActiveTasks(snapshot.activeTasks);
                setCompletedTasks(snapshot.completedTasks);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        if (!result.ok) {
            refreshInBackground();
        }

        setTaskDeleting(task.id, false);
    };

    const handlePostponeTaskOptimistic = async (task: Task, newDeadlineIso: string): Promise<boolean> => {
        if (postponingTaskIds.has(task.id) || task.id.startsWith("temp-")) return false;
        if (!["CREATED", "POSTPONED"].includes(task.status)) return false;
        if (task.postponed_at) return false;
        const currentDeadline = new Date(task.deadline);
        const selectedDeadline = new Date(newDeadlineIso);
        if (Number.isNaN(currentDeadline.getTime()) || currentDeadline.getTime() <= Date.now()) return false;
        if (Number.isNaN(selectedDeadline.getTime()) || selectedDeadline.getTime() <= Date.now()) return false;

        setTaskPostponing(task.id, true);
        const nowIso = new Date().toISOString();
        const optimisticDeadlineIso = selectedDeadline.toISOString();

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({
                activeTasks,
                completedTasks,
            }),
            applyOptimistic: () => {
                setActiveTasks((prev) =>
                    prev.map((currentTask) =>
                        currentTask.id === task.id
                            ? {
                                ...currentTask,
                                status: "POSTPONED",
                                deadline: optimisticDeadlineIso,
                                postponed_at: nowIso,
                                updated_at: nowIso,
                            }
                            : currentTask
                    )
                );
            },
            runMutation: () => postponeTask(task.id, optimisticDeadlineIso),
            rollback: (snapshot) => {
                setActiveTasks(snapshot.activeTasks);
                setCompletedTasks(snapshot.completedTasks);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        if (!result.ok) {
            refreshInBackground();
        }

        setTaskPostponing(task.id, false);
        return result.ok;
    };

    const handlePostponeTaskClick = (task: Task) => {
        if (postponingTaskIds.has(task.id) || task.id.startsWith("temp-")) return;
        if (task.status !== "CREATED" || task.postponed_at) return;
        const currentDeadline = new Date(task.deadline);
        if (Number.isNaN(currentDeadline.getTime()) || currentDeadline.getTime() <= Date.now()) return;
        setPostponeDialogTaskId(task.id);
    };

    const handlePostponeConfirm = async (newDeadlineIso: string) => {
        if (!postponeDialogTask || !canPostponeDialogTask) return;
        const success = await handlePostponeTaskOptimistic(postponeDialogTask, newDeadlineIso);
        if (success) {
            setPostponeDialogTaskId(null);
        }
    };

    const renderActiveTaskRow = (task: Task) => (
        <TaskRow
            key={task.id}
            task={task}
            onComplete={handleCompleteTaskOptimistic}
            isCompleting={completingTaskIds.has(task.id)}
            onAttachProof={openTaskProofPicker}
            hasProofAttached={Boolean(proofByTaskId[task.id])}
            proofUploadError={proofUploadErrors[task.id] || null}
            onPostpone={handlePostponeTaskClick}
            isPostponing={postponingTaskIds.has(task.id)}
            defaultPomoDurationMinutes={defaultPomoDurationMinutes}
            onDelete={handleDeleteTaskOptimistic}
            isDeleting={deletingTaskIds.has(task.id)}
            layoutVariant="active"
        />
    );

    const handleToggleTips = async () => {
        if (isTogglingTips) return;
        const nextTipsHidden = !tipsHidden;
        setIsTogglingTips(true);

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ tipsHidden }),
            applyOptimistic: () => {
                setTipsHidden(nextTipsHidden);
            },
            runMutation: () => setDashboardTipsHidden(nextTipsHidden),
            rollback: (snapshot) => {
                setTipsHidden(snapshot.tipsHidden);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        if (!result.ok) {
            refreshInBackground();
        }

        setIsTogglingTips(false);
    };

    return (
        <div className="max-w-3xl mx-auto space-y-6 px-4 md:px-0 pb-14">
            <TaskDetailPrefetcher tasks={[...activeDueSoonTasks, ...futureTasks, ...completedTasks]} />
            <div className="mb-8 space-y-3">
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold text-white">{`Hi ${username}`}</h1>
                    <DashboardHeaderActions
                        tipsVisible={!tipsHidden}
                        onToggleTips={() => {
                            void handleToggleTips();
                        }}
                        isTogglingTips={isTogglingTips}
                        sortMode={sortMode}
                        onSortModeChange={setSortMode}
                    />
                </div>
                {liveReputationScore !== null && (
                    <ReputationBar data={liveReputationScore} />
                )}
            </div>

            <TaskInput
                friends={friends}
                defaultFailureCostEuros={defaultFailureCostEuros}
                defaultCurrency={currency}
                defaultVoucherId={defaultVoucherId}
                defaultEventDurationMinutes={defaultEventDurationMinutes}
                selfUserId={userId}
                onCreateTaskOptimistic={handleCreateTaskOptimistic}
            />

            {/* Mobile FAB */}
            <button
                onClick={() => { setFloatingCreatorOpen(true); }}
                aria-label="Create task"
                className="md:hidden fixed bottom-20 right-8 h-14 w-14 rounded-full flex items-center justify-center transition-all active:scale-95 z-30 backdrop-blur-sm"
                style={{
                    border: "1px solid rgba(52, 211, 153, 0.25)",
                    background: "rgba(52, 211, 153, 0.06)",
                }}
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" style={{ color: "#34d399", filter: "drop-shadow(0 0 8px rgba(52, 211, 153, 0.9)) drop-shadow(0 0 16px rgba(52, 211, 153, 0.5))" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
            </button>

            {/* Mobile floating task creator */}
            <FloatingTaskCreator
                ref={floatingCreatorRef}
                isOpen={floatingCreatorOpen}
                onClose={() => setFloatingCreatorOpen(false)}
                friends={friends}
                selfUserId={userId}
                defaultFailureCost={parseFloat(defaultFailureCostEuros) || 1}
            />
            {!tipsHidden && (
                <div className="space-y-1 px-1 text-[10px] text-slate-400 font-mono uppercase tracking-wider">
                    <p>Parser tips:</p>
                    <p>Time: use @20:45, @2045, or @8</p>
                    <p>Date: use 28th, 05/03, 5/3, or 05/03/2026</p>
                    <p>If date has no @time, deadline defaults to end of day</p>
                    <p>Events: add -event with -start or -end (e.g., -start930, -end09:30)</p>
                    <p>Event auto-fill: -start uses default duration for end, and -end backfills start</p>
                    <p>Event colors: type -color, then pick an alias (e.g., -pink, -blue)</p>
                    <p>Color tags work only with -event and sync as Google event colors</p>
                    <p>Timer: use timer 25 (minutes from now)</p>
                    <p>Reminder: use remind@20, remind@2200, or remind@08:30</p>
                    <p>Pomodoro: use pomo 75 (max 120)</p>
                    <p>Proof required: use -proof (blocks completion until proof is attached)</p>
                    <p>Voucher: use vouch bob or .v bob</p>
                    <p>Subtasks: separate with /</p>
                    <p>Ticking a task marks it complete instantly</p>
                    <p>A new task can be deleted within 5 mins</p>
                    <p> hide tips with the bulb botton </p>
                </div>
            )}

            <div className="flex flex-col">
                {activeDueSoonTasks.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-slate-500 text-sm">no tasks for today or tmrw, maybe check future?</p>
                    </div>
                ) : (
                    activeDueSoonTasks.map((task) => renderActiveTaskRow(task))
                )}
            </div>

            <CollapsibleFutureList
                tasks={futureTasks}
                renderTask={renderActiveTaskRow}
            />

            <input
                ref={proofInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={handleProofInputChange}
            />

            <PostponeDeadlineDialog
                open={isPostponeDialogOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        setPostponeDialogTaskId(null);
                    }
                }}
                currentDeadlineIso={postponeDialogTask?.deadline || null}
                isSubmitting={postponeDialogTask ? postponingTaskIds.has(postponeDialogTask.id) : false}
                onConfirm={handlePostponeConfirm}
            />

            {completedTasks.length > 0 && (
                <CollapsibleCompletedList tasks={completedTasks} />
            )}
        </div>
    );
}
