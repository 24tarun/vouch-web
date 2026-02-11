"use client";

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
import { DashboardHeaderActions } from "@/components/DashboardHeaderActions";
import { TaskInput, type TaskInputCreatePayload } from "@/components/TaskInput";
import { TaskRow } from "@/components/TaskRow";
import { CollapsibleCompletedList } from "@/components/CollapsibleCompletedList";
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
import { pickProofFileFromNativeUi } from "@/lib/native-proof-picker";
import { purgeLocalProofMedia } from "@/lib/proof-media-warmup";

const MAX_COMPLETED_TASKS = 10;

interface TaskProofDraft {
    proof: PreparedTaskProof;
    previewUrl: string;
}

interface ProofUploadTarget {
    bucket: string;
    objectPath: string;
    uploadToken?: string;
}

function getVoucherResponseDeadlineLocal(baseDate: Date = new Date()): Date {
    const deadline = new Date(baseDate);
    deadline.setDate(deadline.getDate() + 2);
    deadline.setHours(23, 59, 59, 999);
    return deadline;
}

interface DashboardClientProps {
    initialTasks: Task[];
    friends: Profile[];
    defaultFailureCostEuros: string;
    currency: SupportedCurrency;
    defaultVoucherId: string | null;
    defaultPomoDurationMinutes: number;
    userId: string;
    username: string;
    initialHideTips: boolean;
}

function isTaskCompletedToday(task: Task, reference: Date = new Date()): boolean {
    const completionTimestamp = task.marked_completed_at || task.updated_at;
    const completedAt = new Date(completionTimestamp);
    if (Number.isNaN(completedAt.getTime())) return false;

    const startOfDay = new Date(reference);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfNextDay = new Date(startOfDay);
    startOfNextDay.setDate(startOfNextDay.getDate() + 1);

    return completedAt >= startOfDay && completedAt < startOfNextDay;
}

function splitTasks(tasks: Task[]) {
    const active = tasks.filter((task) => ["CREATED", "POSTPONED"].includes(task.status));
    const completed = tasks.filter((task) =>
        ["COMPLETED", "AWAITING_VOUCHER", "RECTIFIED", "SETTLED", "FAILED", "DELETED"].includes(task.status) &&
        isTaskCompletedToday(task)
    );

    return { active, completed };
}

function buildCreateTaskFormData(payload: TaskInputCreatePayload): FormData {
    const formData = new FormData();
    formData.append("title", payload.title);
    formData.append("deadline", payload.deadlineIso);
    formData.append("voucherId", payload.voucherId);
    formData.append("failureCost", payload.failureCost);
    if (payload.subtasks.length > 0) {
        formData.append("subtasks", JSON.stringify(payload.subtasks));
    }
    if (payload.requiredPomoMinutes != null) {
        formData.append("requiredPomoMinutes", String(payload.requiredPomoMinutes));
    }
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
    userId,
    username,
    initialHideTips,
}: DashboardClientProps) {
    const router = useRouter();
    const [, startRefreshTransition] = useTransition();
    const split = useMemo(() => splitTasks(initialTasks), [initialTasks]);

    const [activeTasks, setActiveTasks] = useState<Task[]>(split.active);
    const [completedTasks, setCompletedTasks] = useState<Task[]>(split.completed.slice(0, MAX_COMPLETED_TASKS));
    const [completingTaskIds, setCompletingTaskIds] = useState<Set<string>>(new Set());
    const [postponingTaskIds, setPostponingTaskIds] = useState<Set<string>>(new Set());
    const [deletingTaskIds, setDeletingTaskIds] = useState<Set<string>>(new Set());
    const [proofByTaskId, setProofByTaskId] = useState<Record<string, TaskProofDraft>>({});
    const [proofUploadErrors, setProofUploadErrors] = useState<Record<string, string>>({});
    const [proofPickerTaskId, setProofPickerTaskId] = useState<string | null>(null);
    const [tipsHidden, setTipsHidden] = useState(initialHideTips);
    const [isTogglingTips, setIsTogglingTips] = useState(false);
    const proofInputRef = useRef<HTMLInputElement>(null);
    const proofByTaskIdRef = useRef<Record<string, TaskProofDraft>>({});

    useEffect(() => {
        setActiveTasks(split.active);
        setCompletedTasks(split.completed.slice(0, MAX_COMPLETED_TASKS));
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

        const nativeFile = await pickProofFileFromNativeUi();
        if (nativeFile) {
            await processPickedProofFile(task.id, nativeFile);
            return;
        }

        setProofPickerTaskId(task.id);
        proofInputRef.current?.click();
    };

    const handleProofInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const pickedTaskId = proofPickerTaskId;
        const selectedFile = event.target.files?.[0];
        event.target.value = "";
        setProofPickerTaskId(null);

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
        const nowIso = new Date().toISOString();
        const tempTaskId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const optimisticTask: Task = {
            id: tempTaskId,
            user_id: userId,
            voucher_id: payload.voucherId,
            title: payload.title,
            description: null,
            failure_cost_cents: Math.round(Number(payload.failureCost) * 100),
            required_pomo_minutes: payload.requiredPomoMinutes,
            deadline: payload.deadlineIso,
            status: "CREATED",
            postponed_at: null,
            marked_completed_at: null,
            voucher_response_deadline: null,
            recurrence_rule_id: payload.recurrenceType ? "optimistic" : null,
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
                setActiveTasks((prev) => [optimisticTask, ...prev]);
            },
            runMutation: () => createTask(buildCreateTaskFormData(payload)),
            rollback: (snapshot) => {
                setActiveTasks(snapshot.activeTasks);
                setCompletedTasks(snapshot.completedTasks);
            },
            onSuccess: (result) => {
                if (result && "taskId" in result && result.taskId) {
                    setActiveTasks((prev) =>
                        prev.map((task) =>
                            task.id === tempTaskId
                                ? {
                                    ...task,
                                    id: result.taskId as string,
                                    recurrence_rule_id: payload.recurrenceType ? task.recurrence_rule_id : null,
                                    subtasks: (task.subtasks || []).map((subtask) => ({
                                        ...subtask,
                                        parent_task_id: result.taskId as string,
                                    })),
                                }
                                : task
                        )
                    );
                }
                refreshInBackground();
            },
        });
    };

    const handleCompleteTaskOptimistic = async (task: Task) => {
        if (completingTaskIds.has(task.id)) return;
        setTaskCompleting(task.id, true);

        const now = new Date();
        const voucherResponseDeadline = getVoucherResponseDeadlineLocal(now);
        const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const proofDraft = proofByTaskId[task.id] || null;
        const proofIntent = proofDraft ? getProofIntentFromPreparedProof(proofDraft.proof) : null;
        if (proofIntent || task.completion_proof) {
            void purgeLocalProofMedia(task.id);
        }
        const nowIso = now.toISOString();
        const optimisticTask: Task = {
            ...task,
            status: "AWAITING_VOUCHER",
            marked_completed_at: nowIso,
            voucher_response_deadline: voucherResponseDeadline.toISOString(),
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
                if (!proofIntent) {
                    void purgeLocalProofMedia(task.id);
                }
                refreshInBackground();
            },
        });

        if (!result.ok) {
            refreshInBackground();
        }

        if (result.ok && proofDraft) {
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

    const handlePostponeTaskOptimistic = async (task: Task) => {
        if (postponingTaskIds.has(task.id) || task.id.startsWith("temp-")) return;
        if (!["CREATED", "POSTPONED"].includes(task.status)) return;
        if (task.postponed_at) return;
        const currentDeadline = new Date(task.deadline);
        if (Number.isNaN(currentDeadline.getTime()) || currentDeadline.getTime() <= Date.now()) return;

        setTaskPostponing(task.id, true);
        const nowIso = new Date().toISOString();
        const optimisticDeadlineIso = new Date(currentDeadline.getTime() + 60 * 60 * 1000).toISOString();

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
            runMutation: () => postponeTask(task.id),
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
    };

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
            <TaskDetailPrefetcher tasks={[...activeTasks, ...completedTasks]} />
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">{`Hi ${username}`}</h1>
                <DashboardHeaderActions
                    tipsVisible={!tipsHidden}
                    onToggleTips={() => {
                        void handleToggleTips();
                    }}
                    isTogglingTips={isTogglingTips}
                />
            </div>

            <TaskInput
                friends={friends}
                defaultFailureCostEuros={defaultFailureCostEuros}
                defaultCurrency={currency}
                defaultVoucherId={defaultVoucherId}
                onCreateTaskOptimistic={handleCreateTaskOptimistic}
            />
            {!tipsHidden && (
                <div className="space-y-1 px-1 text-[10px] text-slate-400 font-mono uppercase tracking-wider">
                    <p>Parser tips:</p>
                    <p>Deadline: use @20:45 or @2045</p>
                    <p>Timer: use timer 25 (minutes from now)</p>
                    <p>Reminder: use remind 10:00 or remind 1000</p>
                    <p>Pomodoro: use pomo 75</p>
                    <p>Voucher: use vouch bob</p>
                    <p>Subtasks: separate with /</p>
                    <p>Ticking a task marks it complete instantly</p>
                    <p>A new task can be deleted within 5 mins</p>
                    <p> hide tips with the bulb botton </p>
                </div>
            )}

            <div className="flex flex-col">
                {activeTasks.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-slate-500 text-sm">All tasks completed! Relax or add more.</p>
                    </div>
                ) : (
                    activeTasks.map((task) => (
                        <TaskRow
                            key={task.id}
                            task={task}
                            onComplete={handleCompleteTaskOptimistic}
                            isCompleting={completingTaskIds.has(task.id)}
                            onAttachProof={openTaskProofPicker}
                            hasProofAttached={Boolean(proofByTaskId[task.id])}
                            proofUploadError={proofUploadErrors[task.id] || null}
                            onPostpone={handlePostponeTaskOptimistic}
                            isPostponing={postponingTaskIds.has(task.id)}
                            defaultPomoDurationMinutes={defaultPomoDurationMinutes}
                            onDelete={handleDeleteTaskOptimistic}
                            isDeleting={deletingTaskIds.has(task.id)}
                            layoutVariant="active"
                        />
                    ))
                )}
            </div>

            <input
                ref={proofInputRef}
                type="file"
                accept="image/*,video/*"
                capture="environment"
                className="hidden"
                onChange={handleProofInputChange}
            />

            {completedTasks.length > 0 && (
                <CollapsibleCompletedList tasks={completedTasks} />
            )}
        </div>
    );
}
