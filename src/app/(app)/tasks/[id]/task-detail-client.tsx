"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
    postponeTask,
} from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import { Camera, Check, Plus, Repeat, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PostponeDeadlineDialog } from "@/components/PostponeDeadlineDialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import type { TaskWithRelations, TaskEvent } from "@/lib/types";
import { PomoButton } from "@/components/ui/PomoButton";
import { runOptimisticMutation } from "@/lib/ui/runOptimisticMutation";
import { usePomodoro } from "@/components/PomodoroProvider";
import { canOwnerTemporarilyDelete } from "@/lib/task-delete-window";
import { cn } from "@/lib/utils";
import { formatCurrencyFromCents, normalizeCurrency, type SupportedCurrency } from "@/lib/currency";
import { formatRecurrenceSummary } from "@/lib/recurrence-display";
import { AI_PROFILE_ID } from "@/lib/ai-voucher/constants";
import { getWarmProofSrc } from "@/lib/proof-media-warmup";
import { ProofMedia } from "@/components/ProofMedia";
import {
    isDefaultDeadlineReminderSource,
} from "@/lib/task-reminder-defaults";
import { subscribeRealtimeTaskChanges } from "@/lib/realtime-task-events";
import { isIncomingNewer, patchTaskScalars } from "@/lib/tasks-realtime-patch";
import {
    buildBeforeStartSubmissionMessage,
    getTaskSubmissionWindowState,
} from "@/lib/task-submission-window";
import {
    ACTIVITY_TIMELINE_META_TEXT_CLASS,
    ActivityEventBadge,
    RecurringIndicator,
    TaskStatusBadge,
} from "@/design-system/badges";
import { TASK_DETAIL_BUTTON_CLASSES } from "@/design-system/task_detail_buttons";
import { WebcamCaptureModal } from "@/components/WebcamCaptureModal";
import {
    getTaskDetailButtonVisibility,
    getTaskDetailReminderButtonVisibility,
    getTaskDetailSubtaskButtonVisibility,
} from "@/lib/task-detail-button-visibility";
import {
    formatDateTimeDdMmYy,
    formatFocusTime,
    formatOrdinal,
    sortTaskReminders,
} from "@/app/(app)/tasks/[id]/task-detail/utils/task-detail-helpers";
import { useTaskDetailActivitySteps } from "@/app/(app)/tasks/[id]/task-detail/hooks/use-task-detail-activity-steps";
import { useTaskDetailReminders } from "@/app/(app)/tasks/[id]/task-detail/hooks/use-task-detail-reminders";
import { useTaskDetailSubtasks } from "@/app/(app)/tasks/[id]/task-detail/hooks/use-task-detail-subtasks";
import { useTaskDetailProof, type TaskProofDraft } from "@/app/(app)/tasks/[id]/task-detail/hooks/use-task-detail-proof";
import { useTaskDetailActions } from "@/app/(app)/tasks/[id]/task-detail/hooks/use-task-detail-actions";
import { TaskDetailStatsStrip } from "@/app/(app)/tasks/[id]/task-detail/sections/task-detail-stats-strip";

interface TaskDetailClientProps {
    task: TaskWithRelations;
    events: TaskEvent[];
    pomoSummary: {
        totalSeconds: number;
        sessionCount: number;
        completedSessions: number;
        lastCompletedAt: string | null;
    } | null;
    defaultPomoDurationMinutes: number;
    viewerId: string;
    viewerCurrency: SupportedCurrency;
    potentialRp: number | null;
    hasUsedOverrideThisMonth: boolean;
}

type ProofPickerMode = "draft" | "awaiting-upload";

export default function TaskDetailClient({
    task,
    events,
    pomoSummary,
    defaultPomoDurationMinutes,
    viewerId,
    viewerCurrency,
    potentialRp,
    hasUsedOverrideThisMonth,
}: TaskDetailClientProps) {
    const router = useRouter();
    const { session } = usePomodoro();
    const [, startRefreshTransition] = useTransition();
    const [taskState, setTaskState] = useState<TaskWithRelations>(task);
    const [isRepetitionStopped, setIsRepetitionStopped] = useState(false);
    const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [subtasks, setSubtasks] = useState(task.subtasks || []);
    const [reminders, setReminders] = useState(sortTaskReminders(task.reminders));
    const [remindersSectionOpen, setRemindersSectionOpen] = useState(false);
    const [subtasksSectionOpen, setSubtasksSectionOpen] = useState(false);
    const [newReminderLocal, setNewReminderLocal] = useState("");
    const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
    const [subtaskError, setSubtaskError] = useState<string | null>(null);
    const [pendingSubtaskIds, setPendingSubtaskIds] = useState<Set<string>>(new Set());
    const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
    const [editingSubtaskTitle, setEditingSubtaskTitle] = useState("");
    const [isAddingSubtask, setIsAddingSubtask] = useState(false);
    const [proofDraft, setProofDraft] = useState<TaskProofDraft | null>(null);
    const [proofUploadError, setProofUploadError] = useState<string | null>(null);
    const [isStoredProofFullscreen, setIsStoredProofFullscreen] = useState(false);
    const [isPostponeDialogOpen, setIsPostponeDialogOpen] = useState(false);
    const [showEscalationPicker, setShowEscalationPicker] = useState(false);
    const [escalationPending, setEscalationPending] = useState(false);
    const [friends, setFriends] = useState<Array<{ id: string; username: string | null; email: string }>>([]);
    const [friendsLoading, setFriendsLoading] = useState(false);
    const newSubtaskInputRef = useRef<HTMLInputElement>(null);
    const proofInputRef = useRef<HTMLInputElement>(null);
    const proofPreviewUrlRef = useRef<string | null>(null);
    const proofPickerModeRef = useRef<ProofPickerMode>("draft");
    const [showWebcamModal, setShowWebcamModal] = useState(false);
    const shouldRestoreSubtaskInputFocusRef = useRef(false);

    const submissionWindow = useMemo(
        () => getTaskSubmissionWindowState({
            startAtIso: taskState.start_at ?? null,
            deadlineIso: taskState.deadline,
            isStrict: taskState.is_strict ?? false,
            now: new Date(nowMs),
        }),
        [nowMs, taskState.deadline, taskState.start_at, taskState.is_strict]
    );
    const deadline = new Date(taskState.deadline);
    const isOverdue =
        submissionWindow.pastDeadline &&
        !["ACCEPTED", "AUTO_ACCEPTED", "AI_ACCEPTED", "DENIED", "MISSED", "RECTIFIED", "SETTLED", "AWAITING_USER", "AWAITING_VOUCHER", "AWAITING_AI", "MARKED_COMPLETE", "ESCALATED", "AI_DENIED", "DELETED"].includes(taskState.status);

    const userTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
    const canTempDelete = canOwnerTemporarilyDelete(taskState, nowMs);
    const isOwner = taskState.user_id === viewerId;
    const isSelfVouched = taskState.voucher_id === taskState.user_id;
    const requiresProofForCompletion =
        Boolean(taskState.requires_proof) &&
        !isSelfVouched;
    const isActiveParentTask = taskState.status === "ACTIVE" || taskState.status === "POSTPONED";
    const completedSubtasksCount = subtasks.filter((subtask) => subtask.is_completed).length;
    const incompleteSubtasksCount = subtasks.length - completedSubtasksCount;
    const totalPomoSeconds = pomoSummary?.totalSeconds || 0;
    const requiredPomoSeconds = (taskState.required_pomo_minutes || 0) * 60;
    const remainingRequiredPomoSeconds = Math.max(0, requiredPomoSeconds - totalPomoSeconds);
    const hasIncompletePomoRequirement =
        requiredPomoSeconds > 0 && remainingRequiredPomoSeconds > 0;
    const hasRunningPomoForTask = session?.status === "ACTIVE" && session.task_id === taskState.id;
    const isBeforeStart = isActiveParentTask && submissionWindow.beforeStart;
    const beforeStartMessage = buildBeforeStartSubmissionMessage(submissionWindow.startDate);
    const canManageActionChildren = isOwner && isActiveParentTask;
    const ownerCurrency = normalizeCurrency(taskState.user?.currency ?? viewerCurrency);
    const formattedFailureCost = formatCurrencyFromCents(taskState.failure_cost_cents, ownerCurrency);
    const uniformActionButtonClass = TASK_DETAIL_BUTTON_CLASSES.size.uniform;
    const activeRowActionButtonClass = TASK_DETAIL_BUTTON_CLASSES.size.active;
    const canUseOverride =
        isOwner &&
        (taskState.status === "DENIED" || taskState.status === "MISSED") &&
        !hasUsedOverrideThisMonth;
    const handleToggleSubtasksSection = () => {
        setSubtasksSectionOpen((prev) => {
            const next = !prev;
            if (next) setRemindersSectionOpen(false);
            return next;
        });
    };
    const handleToggleRemindersSection = () => {
        setRemindersSectionOpen((prev) => {
            const next = !prev;
            if (next) setSubtasksSectionOpen(false);
            return next;
        });
    };

    // AI Voucher resubmit state
    const isAiVouched = taskState.voucher_id === AI_PROFILE_ID;
    const resubmitCount = taskState.resubmit_count ?? 0;
    const MAX_RESUBMITS = 3;
    const canResubmit = taskState.status === "AWAITING_USER" && resubmitCount < MAX_RESUBMITS;
    const buttonVisibility = getTaskDetailButtonVisibility({
        status: taskState.status,
        pendingActions,
        isOwner,
        isActiveParentTask,
        isOverdue,
        isBeforeStart,
        incompleteSubtasksCount,
        hasIncompletePomoRequirement,
        hasRunningPomoForTask,
        hasPostponedAt: Boolean(taskState.postponed_at),
        hasRecurrenceRule: Boolean(taskState.recurrence_rule_id),
        isRepetitionStopped,
        canUseOverride,
        canTempDelete,
        canResubmit,
        escalationPending,
    });
    const subtaskAddButtonVisibility = getTaskDetailSubtaskButtonVisibility({
        canManageActionChildren,
        isPending: false,
        isAddingSubtask,
    });
    const reminderButtonVisibility = getTaskDetailReminderButtonVisibility({
        canManageActionChildren,
        isSavePending: pendingActions.has("saveReminders"),
        hasDraftValue: Boolean(newReminderLocal.trim()),
        isPastReminder: false,
    });
    const showAwaitingOwnerActionRow =
        buttonVisibility.awaiting.addProof ||
        buttonVisibility.awaiting.undoComplete;
    const showAwaitingUserActionRow =
        buttonVisibility.awaitingUser.resubmitProof ||
        buttonVisibility.awaitingUser.escalateToFriend;
    const hasVisibleActionGridButtons = Object.values(buttonVisibility.actions).some(Boolean);
    const aiVouches = taskState.ai_vouches ?? [];
    const denials = aiVouches.filter((v) => v.decision === "denied");
    const latestDenial = denials.at(-1) ?? null;

    const voucherDeadlineForDisplay = useMemo(() => {
        if (taskState.marked_completed_at) {
            const derived = new Date(taskState.marked_completed_at);
            derived.setDate(derived.getDate() + 2);
            derived.setHours(23, 59, 59, 999);
            return derived;
        }
        if (taskState.voucher_response_deadline) {
            return new Date(taskState.voucher_response_deadline);
        }
        return null;
    }, [taskState.marked_completed_at, taskState.voucher_response_deadline]);
    const recurrenceSummary = useMemo(() => {
        if (!taskState.recurrence_rule) return null;
        return formatRecurrenceSummary(taskState.recurrence_rule, taskState.deadline);
    }, [taskState.recurrence_rule, taskState.deadline]);
    const iterationNumber = taskState.iteration_number ?? null;
    const iterationLabel = iterationNumber !== null
        ? `${formatOrdinal(iterationNumber)} iteration`
        : "one-off task";
    const canViewStoredProof =
        taskState.status === "AWAITING_VOUCHER" || taskState.status === "AWAITING_AI" || taskState.status === "MARKED_COMPLETE" || taskState.status === "AWAITING_USER";
    const hasOpenProofRequest =
        Boolean(taskState.proof_request_open) &&
        (taskState.status === "AWAITING_VOUCHER" || taskState.status === "AWAITING_AI" || taskState.status === "MARKED_COMPLETE");
    const voucherDisplayLabel = isAiVouched
        ? "AI"
        : (isSelfVouched ? "Self" : (taskState.voucher?.username || "Your voucher"));
    const proofRequestedByLabel = voucherDisplayLabel;
    const storedProof = useMemo(() => {
        if (!canViewStoredProof) return null;
        const proof = taskState.completion_proof;
        if (!proof || proof.upload_state !== "UPLOADED") return null;
        return proof;
    }, [canViewStoredProof, taskState.completion_proof]);
    const storedProofVersion = useMemo(() => {
        if (!storedProof) return null;
        return storedProof.updated_at || taskState.updated_at;
    }, [storedProof, taskState.updated_at]);
    const storedProofSrc = useMemo(() => {
        if (!storedProof || !storedProofVersion) return null;
        const warmSrc = getWarmProofSrc(taskState.id, storedProofVersion);
        if (warmSrc) return warmSrc;
        return `/api/task-proofs/${taskState.id}?v=${encodeURIComponent(storedProofVersion)}`;
    }, [storedProof, storedProofVersion, taskState.id]);

    const refreshInBackground = () => {
        startRefreshTransition(() => {
            router.refresh();
        });
    };

    const setActionPending = (action: string, pending: boolean) => {
        setPendingActions((prev) => {
            const next = new Set(prev);
            if (pending) {
                next.add(action);
            } else {
                next.delete(action);
            }
            return next;
        });
    };

    const isActionPending = (action: string) => pendingActions.has(action);

    const setTaskProofDraft: React.Dispatch<React.SetStateAction<TaskProofDraft | null>> = (value) => {
        setProofDraft((prev) => {
            const nextDraft = typeof value === "function" ? value(prev) : value;
            if (prev?.previewUrl && (!nextDraft || prev.previewUrl !== nextDraft.previewUrl)) {
                URL.revokeObjectURL(prev.previewUrl);
            }
            return nextDraft;
        });
    };

    const focusNewSubtaskInput = () => {
        window.requestAnimationFrame(() => {
            const input = newSubtaskInputRef.current;
            if (!input) return;
            input.focus();
            const cursorPosition = input.value.length;
            try {
                input.setSelectionRange(cursorPosition, cursorPosition);
            } catch {
                // Some input types/platforms may not support selection range.
            }
        });
    };

    useEffect(() => {
        const id = window.setInterval(() => {
            setNowMs(Date.now());
        }, 15000);

        return () => {
            window.clearInterval(id);
        };
    }, []);

    /*
     * This screen keeps local editable copies of task data so optimistic actions (subtasks, reminders,
     * status transitions) can update instantly without waiting for server round-trips.
     *
     * A plain router.refresh() is not enough when local state was initialized from props once, because
     * refreshed server props do not automatically overwrite those local copies.
     *
     * Sync order is deliberate:
     * 1) Replace the primary task snapshot (`taskState`) from latest server truth.
     * 2) Replace local subtasks from server-provided relations.
     * 3) Replace local reminders with sorted server-provided relations.
     *
     * This intentionally does NOT reset local-only draft UI state such as proofDraft, form inputs,
     * dialog toggles, or pending flags.
     */
    useEffect(() => {
        setTaskState(task);
        setSubtasks(task.subtasks || []);
        setReminders(sortTaskReminders(task.reminders));
    }, [task]);

    useEffect(() => {
        setTaskState((prev) => ({
            ...prev,
            subtasks,
        }));
    }, [subtasks]);

    useEffect(() => {
        setTaskState((prev) => ({
            ...prev,
            reminders,
        }));
    }, [reminders]);

    useEffect(() => {
        if (!isAddingSubtask && shouldRestoreSubtaskInputFocusRef.current) {
            shouldRestoreSubtaskInputFocusRef.current = false;
            focusNewSubtaskInput();
        }
    }, [isAddingSubtask]);

    useEffect(() => {
        proofPreviewUrlRef.current = proofDraft?.previewUrl || null;
    }, [proofDraft]);

    useEffect(() => {
        return () => {
            if (proofPreviewUrlRef.current) {
                URL.revokeObjectURL(proofPreviewUrlRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (storedProof) return;
        setIsStoredProofFullscreen(false);
    }, [storedProof]);

    useEffect(() => {
        if (!isStoredProofFullscreen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setIsStoredProofFullscreen(false);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [isStoredProofFullscreen]);

    useEffect(() => {
        const unsubscribe = subscribeRealtimeTaskChanges((change) => {
            const incoming = change.newRow || change.oldRow;
            if (!incoming || incoming.id !== task.id) return;

            if (change.eventType === "DELETE") {
                startRefreshTransition(() => {
                    router.refresh();
                });
                return;
            }

            setTaskState((prev) => {
                if (prev.id !== incoming.id) return prev;
                if (!isIncomingNewer(prev.updated_at, incoming.updated_at)) return prev;
                return patchTaskScalars(prev, incoming);
            });
        });

        return unsubscribe;
    }, [task.id, router, startRefreshTransition]);

    const { handleAddReminder, handleRemoveReminder } = useTaskDetailReminders({
        reminders,
        taskState,
        newReminderLocal,
        setReminders,
        setTaskState,
        setNewReminderLocal,
        canManageActionChildren,
        isActionPending,
        setActionPending,
        refreshInBackground,
    });

    const {
        processPickedProofFile,
        openProofPicker,
        handleProofInputChange,
        handleMarkComplete,
        handleUndoComplete,
        handleRemoveStoredProof,
    } = useTaskDetailProof({
        taskState,
        isOwner,
        isActiveParentTask,
        isSelfVouched,
        isAiVouched,
        requiresProofForCompletion,
        isBeforeStart,
        beforeStartMessage,
        incompleteSubtasksCount,
        hasIncompletePomoRequirement,
        remainingRequiredPomoSeconds,
        hasRunningPomoForTask,
        userTimeZone,
        potentialRp,
        storedProof,
        proofDraft,
        setProofDraft: setTaskProofDraft,
        setProofUploadError,
        setTaskState,
        setActionPending,
        isActionPending,
        refreshInBackground,
        setShowWebcamModal,
        proofInputRef,
        proofPickerModeRef,
    });
    const googleSyncDirectionLabel =
        taskState.google_sync_linked && taskState.google_sync_last_origin === "APP"
            ? "App -> Google Calendar"
            : taskState.google_sync_linked && taskState.google_sync_last_origin === "GOOGLE"
                ? "Google Calendar -> App"
                : null;
    const googleSyncDirectionClassName =
        taskState.google_sync_last_origin === "APP" ? "text-emerald-300" : "text-cyan-300";


    async function handlePostpone(newDeadlineIso: string): Promise<boolean> {
        if (isActionPending("postpone")) return false;
        if (isOverdue) {
            toast.error("Cannot postpone an overdue task.");
            return false;
        }

        const currentDeadline = new Date(taskState.deadline);
        if (Number.isNaN(currentDeadline.getTime()) || currentDeadline.getTime() <= Date.now()) {
            toast.error("Cannot postpone this task.");
            return false;
        }
        const selectedDeadline = new Date(newDeadlineIso);
        if (Number.isNaN(selectedDeadline.getTime()) || selectedDeadline.getTime() <= Date.now()) {
            toast.error("Deadline must be in the future.");
            return false;
        }
        const optimisticDeadlineIso = selectedDeadline.toISOString();

        setActionPending("postpone", true);
        const optimisticUpdatedAt = new Date().toISOString();

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ taskState }),
            applyOptimistic: () => {
                setTaskState((prev) => ({
                    ...prev,
                    status: "POSTPONED",
                    deadline: optimisticDeadlineIso,
                    postponed_at: optimisticUpdatedAt,
                    updated_at: optimisticUpdatedAt,
                }));
            },
            runMutation: () => postponeTask(taskState.id, optimisticDeadlineIso),
            rollback: (snapshot) => {
                setTaskState(snapshot.taskState);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        if (!result.ok) {
            refreshInBackground();
        } else {
            setIsPostponeDialogOpen(false);
        }

        setActionPending("postpone", false);
        return result.ok;
    }

    const {
        startEditingSubtask,
        handleAddSubtask,
        handleToggleSubtask,
        handleDeleteSubtask,
        handleRenameSubtask,
    } = useTaskDetailSubtasks({
        taskState,
        subtasks,
        newSubtaskTitle,
        editingSubtaskId,
        editingSubtaskTitle,
        pendingSubtaskIds,
        isAddingSubtask,
        canManageActionChildren,
        setSubtasks,
        setNewSubtaskTitle,
        setSubtaskError,
        setPendingSubtaskIds,
        setEditingSubtaskId,
        setEditingSubtaskTitle,
        setIsAddingSubtask,
        shouldRestoreSubtaskInputFocusRef,
    });

    const {
        handleOverride,
        handleCancelRepetition,
        handleTempDelete,
        loadFriendsForEscalation,
        handleEscalateToFriend,
    } = useTaskDetailActions({
        taskState,
        viewerId,
        canTempDelete,
        hasUsedOverrideThisMonth,
        isRepetitionStopped,
        escalationPending,
        setEscalationPending,
        setShowEscalationPicker,
        setFriends,
        friendsLoading,
        setFriendsLoading,
        setIsRepetitionStopped,
        setTaskState,
        setActionPending,
        isActionPending,
        refreshInBackground,
        pushToTasks: () => router.push("/tasks"),
    });

    const activitySteps = useTaskDetailActivitySteps(events, aiVouches);

    return (
        <>
        <style>{`
            @keyframes riseUp {
                from { opacity: 0; transform: translateY(24px); }
                to   { opacity: 1; transform: translateY(0); }
            }
            .td-rise { animation: riseUp 0.75s cubic-bezier(0.16, 1, 0.3, 1) both; }
            .td-d1 { animation-delay: 0.06s; }
            .td-d2 { animation-delay: 0.18s; }
            .td-d3 { animation-delay: 0.30s; }
            .td-d4 { animation-delay: 0.42s; }
            .td-d5 { animation-delay: 0.56s; }
        `}</style>

        <div className="max-w-4xl mx-auto px-4 md:px-0 pb-12 space-y-7">

            {/* Hidden proof file input */}
            <input ref={proofInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleProofInputChange} />
            <WebcamCaptureModal
                open={showWebcamModal}
                onClose={() => setShowWebcamModal(false)}
                onCapture={async (file) => {
                    setShowWebcamModal(false);
                    await processPickedProofFile(file);
                }}
                onFallbackToFilePicker={() => {
                    proofInputRef.current?.click();
                }}
            />

            {/* ① HERO HEADER */}
            <div className="td-rise td-d1 relative pt-2">
                <div className="relative">
                    <div className="relative">

                        <div className="mx-auto max-w-2xl text-center">
                            <div className="flex flex-wrap items-center justify-center gap-3">
                                <h1 className="text-3xl font-bold text-white leading-tight">
                                    {iterationNumber !== null && (
                                        <span className="text-purple-400">{`#${iterationNumber} `}</span>
                                    )}
                                    {taskState.title}
                                </h1>
                            </div>
                            {recurrenceSummary && (
                                <div className="mt-2 flex items-center justify-center gap-1.5 text-purple-400">
                                    <RecurringIndicator className="text-purple-400" />
                                    <p className="text-xs uppercase tracking-wider font-bold">
                                        {recurrenceSummary}
                                    </p>
                                </div>
                            )}
                            {taskState.description && (
                                <p className="mt-3 text-slate-400 text-sm leading-relaxed">{taskState.description}</p>
                            )}
                            {taskState.creation_input && taskState.creation_input.length > 0 && (
                                <div className="mt-3 text-left inline-block max-w-full">
                                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Created with</p>
                                    <p className="mt-1 rounded-md border border-slate-800/80 bg-slate-950/60 px-2.5 py-2 text-xs font-mono text-slate-300 whitespace-pre-wrap break-words">
                                        {taskState.creation_input}
                                    </p>
                                </div>
                            )}
                        </div>

                    </div>
                </div>
            </div>

            {/* ② STATS STRIP */}
            <TaskDetailStatsStrip
                deadline={deadline}
                status={taskState.status}
                formattedFailureCost={formattedFailureCost}
                isAiVouched={isAiVouched}
                isSelfVouched={isSelfVouched}
                voucherUsername={taskState.voucher?.username}
                totalPomoSeconds={totalPomoSeconds}
                sessionCount={pomoSummary?.sessionCount ?? 0}
            />

            {/* Google Sync */}
            {googleSyncDirectionLabel && (
                <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-slate-600">Sync</span>
                    <span className={`text-xs font-medium font-mono ${googleSyncDirectionClassName}`}>{googleSyncDirectionLabel}</span>
                </div>
            )}

            {/* ③ STATUS CONTEXT BANNER */}
            {(taskState.status === "AWAITING_VOUCHER" || taskState.status === "MARKED_COMPLETE") && (
                <div className="td-rise td-d3 rounded-xl border border-purple-500/20 bg-purple-950/15 overflow-hidden">
                    <div className="h-px bg-gradient-to-r from-purple-500/60 via-purple-400/20 to-transparent" />
                    <div className="px-5 py-4 space-y-3">
                        <div className="flex items-center gap-3 mb-1">
                            <div style={{ width: 24, height: 1, background: '#c084fc', boxShadow: '0 0 6px rgba(192,132,252,0.4)', flexShrink: 0 }} />
                            <span className="text-[10px] uppercase tracking-wider font-bold text-purple-400">awaiting voucher</span>
                        </div>
                        <p className="text-base font-medium text-purple-200">
                            Waiting for {voucherDisplayLabel} to respond
                        </p>
                        {voucherDeadlineForDisplay && (
                            <p className="text-xs font-mono text-purple-400/60">
                                Review deadline: {formatDateTimeDdMmYy(voucherDeadlineForDisplay)}
                            </p>
                        )}
                        {hasOpenProofRequest && (
                            <p className="text-xs font-mono text-pink-400/80">
                                ↳ {proofRequestedByLabel} has asked for proof
                            </p>
                        )}
                        {showAwaitingOwnerActionRow && (
                            <div className="flex flex-wrap gap-2 pt-1">
                                {buttonVisibility.awaiting.addProof && (
                                    <Button type="button" variant="outline" onClick={() => openProofPicker("awaiting-upload")}
                                        className={cn(uniformActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.awaiting.addProof)}>
                                        {storedProof ? "Replace Proof" : "Add Proof"}
                                    </Button>
                                )}
                                {buttonVisibility.awaiting.undoComplete && (
                                    <Button type="button" variant="outline" onClick={handleUndoComplete}
                                        title="Undo complete"
                                        className={cn(uniformActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.awaiting.undoComplete)}>
                                        Undo Complete
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {taskState.status === "AWAITING_AI" && (
                <div className="td-rise td-d3 rounded-xl border border-purple-500/20 bg-purple-950/15 overflow-hidden">
                    <div className="h-px bg-gradient-to-r from-purple-500/60 via-purple-400/20 to-transparent" />
                    <div className="px-5 py-4 space-y-3">
                        <div className="flex items-center gap-3 mb-1">
                            <div style={{ width: 24, height: 1, background: '#c084fc', boxShadow: '0 0 6px rgba(192,132,252,0.4)', flexShrink: 0 }} />
                            <span className="text-[10px] uppercase tracking-wider font-bold text-purple-400">awaiting ai</span>
                        </div>
                        <p className="text-base font-medium text-purple-200">
                            Waiting for AI to review your completion
                        </p>
                        {showAwaitingOwnerActionRow && (
                            <div className="flex flex-wrap gap-2 pt-1">
                                {buttonVisibility.awaiting.addProof && (
                                    <Button type="button" variant="outline" onClick={() => openProofPicker("awaiting-upload")}
                                        className={cn(uniformActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.awaiting.addProof)}>
                                        {storedProof ? "Replace Proof" : "Add Proof"}
                                    </Button>
                                )}
                                {buttonVisibility.awaiting.undoComplete && (
                                    <Button type="button" variant="outline" onClick={handleUndoComplete}
                                        title="Undo complete"
                                        className={cn(uniformActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.awaiting.undoComplete)}>
                                        Undo Complete
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {taskState.status === "AWAITING_USER" && isAiVouched && (
                <div className="td-rise td-d3 rounded-xl border border-orange-500/20 bg-orange-950/10 overflow-hidden">
                    <div className="h-px bg-gradient-to-r from-orange-500/60 via-orange-400/20 to-transparent" />
                    <div className="px-5 py-4 space-y-3">
                        <div className="flex items-center gap-3 mb-1">
                            <div style={{ width: 24, height: 1, background: '#fb923c', boxShadow: '0 0 6px rgba(251,146,60,0.4)', flexShrink: 0 }} />
                            <span className="text-[10px] uppercase tracking-wider font-bold text-orange-400">ai denied</span>
                        </div>
                        {latestDenial && (
                            <>
                                <p className="text-base font-medium text-orange-200">
                                    Attempt {latestDenial.attempt_number} of {MAX_RESUBMITS}
                                </p>
                                <p className="text-sm text-orange-300/70 leading-relaxed">{latestDenial.reason}</p>
                            </>
                        )}
                        {denials.length > 1 && (
                            <details>
                                <summary className="cursor-pointer text-xs font-mono text-orange-400/70 hover:text-orange-300 transition-colors">
                                    View all denials ({denials.length})
                                </summary>
                                <div className="mt-2 space-y-2 border-l border-orange-500/25 pl-3">
                                    {denials.map((denial) => (
                                        <div key={denial.id}>
                                            <p className="text-xs font-mono text-orange-400/70">Attempt {denial.attempt_number}:</p>
                                            <p className="text-orange-200/50 text-xs mt-0.5">{denial.reason}</p>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        )}
                        {showAwaitingUserActionRow && (
                            <div className="flex flex-wrap gap-2 pt-1">
                                {buttonVisibility.awaitingUser.resubmitProof && (
                                    <button type="button" onClick={() => openProofPicker("awaiting-upload")}
                                        className={cn(TASK_DETAIL_BUTTON_CLASSES.awaiting.resubmitProof, uniformActionButtonClass)}>
                                        <Camera className="h-3.5 w-3.5" />
                                        Upload New Proof
                                    </button>
                                )}
                                {buttonVisibility.awaitingUser.escalateToFriend && (
                                    <Button variant="ghost" onClick={() => { if (!friends.length && !friendsLoading) loadFriendsForEscalation(); setShowEscalationPicker(true); }}
                                        className={cn(uniformActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.awaiting.escalateToFriend)}>
                                        Escalate to Friend
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Proof upload error */}
            {proofUploadError && (
                <div className="rounded-xl border border-red-900/50 bg-red-950/15 px-4 py-3">
                    <p className="text-sm font-mono text-red-300">{proofUploadError}</p>
                </div>
            )}

            {/* Stored proof */}
            {storedProof && storedProofSrc && (
                <div className="td-rise td-d3 space-y-2">
                    <div className="flex items-center gap-3">
                        <div style={{ width: 24, height: 1, background: '#f472b6', boxShadow: '0 0 6px rgba(244,114,182,0.35)', flexShrink: 0 }} />
                        <span className="text-[10px] uppercase tracking-wider font-bold text-pink-400">
                            completion proof ({storedProof.media_kind})
                        </span>
                        {["AWAITING_VOUCHER", "AWAITING_AI", "MARKED_COMPLETE"].includes(taskState.status) && buttonVisibility.proof.removeStored && (
                            <Button type="button" variant="ghost" onClick={handleRemoveStoredProof}
                                className={cn(uniformActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.proof.removeStored)}>
                                Remove Proof
                            </Button>
                        )}
                    </div>
                    <div className="relative rounded-xl overflow-hidden border border-slate-800">
                        <ProofMedia mediaKind={storedProof.media_kind} src={storedProofSrc} alt="Completion proof"
                            overlayTimestampText={storedProof.overlay_timestamp_text}
                            imageClassName="w-full max-h-72 object-cover cursor-zoom-in"
                            videoClassName="w-full max-h-72 cursor-zoom-in"
                            imageProps={{ loading: "lazy", onClick: () => setIsStoredProofFullscreen(true) }}
                            videoProps={{ controls: true, preload: "metadata", onClick: () => setIsStoredProofFullscreen(true) }} />
                    </div>
                </div>
            )}

            {/* Proof draft preview */}
            {proofDraft && (
                <div className="td-rise td-d3 space-y-2">
                    <div className="flex items-center gap-3">
                        <div style={{ width: 24, height: 1, background: '#f472b6', boxShadow: '0 0 6px rgba(244,114,182,0.35)', flexShrink: 0 }} />
                        <span className="text-[10px] uppercase tracking-wider font-bold text-pink-400">
                            {(taskState.status === "AWAITING_VOUCHER" || taskState.status === "AWAITING_AI" || taskState.status === "AWAITING_USER" || taskState.status === "MARKED_COMPLETE")
                                ? `ready to upload (${proofDraft.proof.mediaKind})`
                                : `proof attached (${proofDraft.proof.mediaKind})`}
                        </span>
                        <Button type="button" variant="ghost" onClick={() => setTaskProofDraft(null)}
                            className={cn(uniformActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.proof.removeDraft)}>
                            Remove Proof
                        </Button>
                    </div>
                    <div className="rounded-xl overflow-hidden border border-pink-400/20 bg-pink-950/10">
                        <ProofMedia mediaKind={proofDraft.proof.mediaKind} src={proofDraft.previewUrl} alt="Selected proof"
                            overlayTimestampText={proofDraft.proof.overlayTimestampText}
                            imageClassName="w-full max-h-56 object-cover"
                            videoClassName="w-full max-h-56"
                            videoProps={{ controls: true, preload: "metadata" }} />
                    </div>
                </div>
            )}

            {/* ACTIONS BAR */}
            <div className="td-rise td-d3 space-y-3">
                {isOwner && isActiveParentTask && potentialRp !== null && potentialRp > 0 && (
                    <p className="text-xs font-mono text-orange-400/80">
                        +{potentialRp} RP on completion
                    </p>
                )}
                {incompleteSubtasksCount > 0 && (
                    <div className="px-3 py-2 rounded-lg bg-slate-900/50 border border-slate-800">
                        <p className="text-xs font-mono text-slate-500">
                            Complete all subtasks first ({completedSubtasksCount}/{subtasks.length})
                        </p>
                    </div>
                )}
                {hasIncompletePomoRequirement && (
                    <div className="px-3 py-2 rounded-lg bg-slate-900/50 border border-slate-800">
                        <p className="text-xs font-mono text-slate-500">
                            Log {formatFocusTime(remainingRequiredPomoSeconds)} more focus time ({formatFocusTime(totalPomoSeconds)}/{taskState.required_pomo_minutes}m)
                        </p>
                    </div>
                )}
                {hasRunningPomoForTask && (
                    <div className="px-3 py-2 rounded-lg bg-slate-900/50 border border-slate-800">
                        <p className="text-xs font-mono text-slate-500">
                            Stop the running pomodoro before completing
                        </p>
                    </div>
                )}
                {hasVisibleActionGridButtons && (
                    <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3 sm:p-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {buttonVisibility.actions.pomo && (
                                <div>
                                    <PomoButton
                                        taskId={taskState.id}
                                        variant="full"
                                        className={TASK_DETAIL_BUTTON_CLASSES.actions.pomoButton}
                                        defaultDurationMinutes={defaultPomoDurationMinutes}
                                        fullDurationSuffixText="m pomodoro?"
                                    />
                                </div>
                            )}
                            {buttonVisibility.actions.attachProof && (
                                <Button type="button" variant="ghost" onClick={() => openProofPicker("draft")}
                                    className={cn(TASK_DETAIL_BUTTON_CLASSES.actions.attachProofBase,
                                        proofDraft
                                            ? TASK_DETAIL_BUTTON_CLASSES.actions.attachProofAttached
                                            : TASK_DETAIL_BUTTON_CLASSES.actions.attachProofEnabled)}
                                    style={proofDraft ? { boxShadow: '0 0 12px rgba(244,114,182,0.2)' } : {}}
                                    title={proofDraft ? "Proof attached" : (requiresProofForCompletion ? "Attach proof (required)" : "Attach proof (optional)")}
                                    aria-label="Attach proof">
                                    <Camera className="h-5 w-5" />
                                    <span className={cn("text-xs font-medium", proofDraft ? "" : requiresProofForCompletion ? "text-pink-400" : "text-slate-500")}>
                                        {proofDraft ? "attached" : requiresProofForCompletion ? "required" : "optional"}
                                    </span>
                                </Button>
                            )}
                            {buttonVisibility.actions.markComplete && (
                                <Button onClick={handleMarkComplete}
                                    className={cn(activeRowActionButtonClass, "w-full justify-center transition-all border",
                                        TASK_DETAIL_BUTTON_CLASSES.actions.markCompleteEnabled)}
                                    title={isBeforeStart ? beforeStartMessage : "Mark complete"}>
                                    Mark Complete
                                </Button>
                            )}
                            {buttonVisibility.actions.postpone && (
                                <Button type="button" variant="outline" onClick={() => setIsPostponeDialogOpen(true)}
                                    className={cn(activeRowActionButtonClass, "w-full justify-center border",
                                        TASK_DETAIL_BUTTON_CLASSES.actions.postponeEnabled)}>
                                    Postpone once?
                                </Button>
                            )}
                            {buttonVisibility.actions.cancelRepetition && (
                                <Button variant="ghost" onClick={handleCancelRepetition}
                                    className={cn(activeRowActionButtonClass, "w-full justify-center border",
                                        TASK_DETAIL_BUTTON_CLASSES.actions.stopRepeatingEnabled)}>
                                    <Repeat className="mr-1.5 h-3.5 w-3.5" />
                                    Stop Repeating
                                </Button>
                            )}
                            {buttonVisibility.actions.override && (
                                <Button variant="ghost" onClick={handleOverride}
                                    className={cn(activeRowActionButtonClass, "w-full justify-center border",
                                        TASK_DETAIL_BUTTON_CLASSES.actions.overrideEnabled)}>
                                    Use Override
                                </Button>
                            )}
                            {buttonVisibility.actions.tempDelete && (
                                <Button type="button" variant="ghost" onClick={handleTempDelete}
                                    className={cn("h-12 w-full p-0 border transition-colors justify-center",
                                        TASK_DETAIL_BUTTON_CLASSES.actions.deleteEnabled)}
                                    title="Delete task"
                                    aria-label="Delete task">
                                    <Trash2 className="h-5 w-5" />
                                </Button>
                            )}
                            {buttonVisibility.actions.subtasksToggle && (
                                <Button type="button" variant="ghost" onClick={handleToggleSubtasksSection}
                                    className={cn(activeRowActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.actions.toggleBase,
                                        TASK_DETAIL_BUTTON_CLASSES.actions.addSubtask)}>
                                    <span className="text-[13px] leading-none">Subtasks</span>
                                    <span className="text-[13px] leading-none opacity-80">{completedSubtasksCount}/{subtasks.length}</span>
                                </Button>
                            )}
                            {buttonVisibility.actions.remindersToggle && (
                                <Button type="button" variant="ghost" onClick={handleToggleRemindersSection}
                                    className={cn(activeRowActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.actions.toggleBase,
                                        TASK_DETAIL_BUTTON_CLASSES.actions.addReminder)}>
                                    <span className="text-[13px] leading-none">Reminders</span>
                                    <span className="text-[13px] leading-none opacity-80">{reminders.length}</span>
                                </Button>
                            )}
                        </div>
                    {isOwner && (subtasksSectionOpen || remindersSectionOpen) && (
                        <div className="mt-4 border-t border-slate-800/80 pt-4 space-y-4">
                            {subtasksSectionOpen && (
                                <div className="space-y-2">
                                    <form onSubmit={handleAddSubtask}>
                                        <div className="flex items-center gap-2">
                                            <Input ref={newSubtaskInputRef} value={newSubtaskTitle} onChange={(e) => setNewSubtaskTitle(e.target.value)}
                                                placeholder="add a subtask..." maxLength={500}
                                                className={cn("h-8 font-mono text-xs bg-slate-900/50 border-slate-800 text-slate-300 placeholder:text-slate-700",
                                                    !canManageActionChildren && "border-slate-900 text-slate-600 cursor-not-allowed")}
                                                disabled={!canManageActionChildren || isAddingSubtask} />
                                            {subtaskAddButtonVisibility.add && (
                                                <Button type="submit" onPointerDown={(e) => e.preventDefault()}
                                                    className={cn(uniformActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.actions.addSubtask)}>
                                                    <Plus className="h-4 w-4" />
                                                    Add Subtask
                                                </Button>
                                            )}
                                        </div>
                                    </form>
                                    {subtasks.length > 0 && (
                                        <div className="space-y-0.5">
                                            {subtasks.map((subtask) => {
                                                const isPending = pendingSubtaskIds.has(subtask.id);
                                                const subtaskButtonVisibility = getTaskDetailSubtaskButtonVisibility({
                                                    canManageActionChildren,
                                                    isPending,
                                                    isAddingSubtask: false,
                                                });
                                                return (
                                                    <div key={subtask.id} className="flex items-center gap-3 px-1 py-1.5 rounded-lg hover:bg-slate-900/40 transition-colors group/sub">
                                                        {subtaskButtonVisibility.toggle && (
                                                            <button type="button"
                                                                onClick={() => handleToggleSubtask(subtask.id)}
                                                                className={cn("h-5 w-5 rounded-full border flex items-center justify-center shrink-0 transition-all",
                                                                    subtask.is_completed ? "border-emerald-500/50 bg-emerald-600/15 text-emerald-400" : "border-slate-700 text-transparent hover:border-slate-500")}
                                                                style={subtask.is_completed ? { boxShadow: "0 0 6px rgba(52,211,153,0.25)" } : {}}>
                                                                {subtask.is_completed && <Check className="h-3 w-3" strokeWidth={3} />}
                                                            </button>
                                                        )}
                                                        {editingSubtaskId === subtask.id ? (
                                                            <input
                                                                type="text"
                                                                value={editingSubtaskTitle}
                                                                onChange={(event) => setEditingSubtaskTitle(event.target.value)}
                                                                onKeyDown={(event) => {
                                                                    if (event.key === "Enter") {
                                                                        event.preventDefault();
                                                                        void handleRenameSubtask();
                                                                    }
                                                                    if (event.key === "Escape") {
                                                                        setEditingSubtaskId(null);
                                                                        setEditingSubtaskTitle("");
                                                                    }
                                                                }}
                                                                onBlur={() => void handleRenameSubtask()}
                                                                autoFocus
                                                                disabled={isPending}
                                                                className="flex-1 min-w-0 bg-transparent border-b border-slate-500 text-sm font-mono text-slate-300 focus:outline-none focus:border-slate-400 py-0.5"
                                                            />
                                                        ) : subtaskButtonVisibility.rename ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => startEditingSubtask(subtask.id, subtask.title)}
                                                                className={cn(
                                                                    "flex-1 min-w-0 text-left text-sm font-mono transition-colors py-0.5",
                                                                    subtask.is_completed ? "text-slate-600 line-through" : "text-slate-300",
                                                                    "hover:text-white cursor-text"
                                                                )}
                                                                title="Click to edit"
                                                            >
                                                                <span className="truncate block">{subtask.title}</span>
                                                            </button>
                                                        ) : (
                                                            <span
                                                                className={cn(
                                                                    "flex-1 min-w-0 text-left text-sm font-mono py-0.5",
                                                                    subtask.is_completed ? "text-slate-600 line-through" : "text-slate-300"
                                                                )}
                                                            >
                                                                <span className="truncate block">{subtask.title}</span>
                                                            </span>
                                                        )}
                                                        {subtaskButtonVisibility.delete && (
                                                            <button type="button"
                                                                onClick={() => handleDeleteSubtask(subtask.id)}
                                                                className="h-6 w-6 flex items-center justify-center text-red-400 hover:text-red-300 transition-colors opacity-100 cursor-pointer"
                                                                aria-label="Delete subtask">
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {subtaskError && <p className="text-xs font-mono text-red-400">{subtaskError}</p>}
                                </div>
                            )}

                            {remindersSectionOpen && (
                                <div className="space-y-2">
                                    <form onSubmit={handleAddReminder}>
                                        <div className="flex items-center gap-2">
                                            <Input type="datetime-local" value={newReminderLocal} onChange={(e) => setNewReminderLocal(e.target.value)}
                                                disabled={!canManageActionChildren || isActionPending("saveReminders")}
                                                className={cn("h-8 font-mono text-xs bg-slate-900/50 border-slate-800 text-slate-300 [color-scheme:dark]",
                                                    (!canManageActionChildren || isActionPending("saveReminders")) && "opacity-40 cursor-not-allowed")} />
                                            {reminderButtonVisibility.add && (
                                                <Button type="submit" variant="outline"
                                                    className={cn(uniformActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.actions.addReminder)}>
                                                    Add Reminder
                                                </Button>
                                            )}
                                        </div>
                                    </form>
                                    {reminders.length > 0 && (
                                        <div className="space-y-0.5">
                                            {reminders.map((reminder) => {
                                                const reminderDate = new Date(reminder.reminder_at);
                                                const reminderMs = reminderDate.getTime();
                                                const reminderIso = Number.isNaN(reminderMs) ? reminder.reminder_at : reminderDate.toISOString();
                                                const isPastReminder = Number.isNaN(reminderMs) || reminderMs <= nowMs;
                                                const reminderRowButtonVisibility = getTaskDetailReminderButtonVisibility({
                                                    canManageActionChildren,
                                                    isSavePending: isActionPending("saveReminders"),
                                                    hasDraftValue: Boolean(newReminderLocal.trim()),
                                                    isPastReminder,
                                                });
                                                const notifiedAtMs = reminder.notified_at ? new Date(reminder.notified_at).getTime() : Number.NaN;
                                                const createdAtMs = new Date(reminder.created_at).getTime();
                                                const showPastForSeededHistory = isDefaultDeadlineReminderSource(reminder.source) && !Number.isNaN(notifiedAtMs) && !Number.isNaN(createdAtMs) && createdAtMs === notifiedAtMs;
                                                const pastReminderLabel = showPastForSeededHistory ? "Past" : (reminder.notified_at ? "Sent" : "Past");
                                                return (
                                                    <div key={reminder.id} className="flex items-center justify-between gap-3 px-1 py-1.5">
                                                        <span className="text-xs font-mono text-slate-400">
                                                            {Number.isNaN(reminderMs) ? reminder.reminder_at : formatDateTimeDdMmYy(reminderIso)}
                                                        </span>
                                                        {isPastReminder ? (
                                                            <span className="text-[10px] uppercase tracking-wider font-bold text-slate-700">
                                                                {pastReminderLabel}
                                                            </span>
                                                        ) : reminderRowButtonVisibility.remove ? (
                                                            <button type="button"
                                                                onClick={() => void handleRemoveReminder(reminderIso)}
                                                                className="text-xs font-mono text-red-500/60 hover:text-red-400 transition-colors cursor-pointer">
                                                                Remove
                                                            </button>
                                                        ) : null}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                )}
            </div>

            {/* Divider */}
            <div className="h-px bg-gradient-to-r from-transparent via-slate-800/80 to-transparent" />

            {/* ⑦ ACTIVITY LOG */}
            <div className="td-rise td-d5 space-y-4">
                <div className="mx-auto flex w-full max-w-2xl items-center gap-3">
                    <div className="h-px flex-1 bg-cyan-400/80 shadow-[0_0_6px_rgba(0,217,255,0.35)]" />
                    <span className="text-[10px] uppercase tracking-wider font-bold text-cyan-400">timeline</span>
                    <div className="h-px flex-1 bg-cyan-400/80 shadow-[0_0_6px_rgba(0,217,255,0.35)]" />
                </div>
                {activitySteps.length === 0 ? (
                    <p className="text-center text-xs font-mono text-slate-700">No timeline yet</p>
                ) : (
                    <div className="relative mx-auto w-full max-w-3xl">
                        <div className="pointer-events-none absolute left-1/2 top-2 bottom-2 w-px -translate-x-1/2 bg-cyan-500/35" />
                        {activitySteps.map((step, index) => {
                            const isRightSide = index % 2 === 0;
                            const toneConfig =
                                step.tone === "success"
                                    ? {
                                        dot: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.45)]",
                                    }
                                    : step.tone === "danger"
                                        ? {
                                            dot: "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.45)]",
                                        }
                                        : step.tone === "warning"
                                            ? {
                                                dot: "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.45)]",
                                            }
                                            : step.tone === "info"
                                                ? {
                                                    dot: "bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.45)]",
                                                }
                                                : step.tone === "proof"
                                                    ? {
                                                        dot: "bg-pink-400 shadow-[0_0_6px_rgba(244,114,182,0.45)]",
                                                    }
                                                : {
                                                    dot: "bg-slate-500 shadow-[0_0_6px_rgba(100,116,139,0.45)]",
                                                };

                            return (
                                <div key={step.id} className="relative pb-4 last:pb-0">
                                    <div className={cn("absolute left-1/2 top-1.5 h-2.5 w-2.5 -translate-x-1/2 rounded-full", toneConfig.dot)} />
                                    <div
                                        className={cn(
                                            "absolute top-[9px] h-px w-10",
                                            isRightSide
                                                ? "left-1/2 ml-1.5 bg-cyan-500/45"
                                                : "right-1/2 mr-1.5 bg-cyan-500/45"
                                        )}
                                    />
                                    <div className={cn(
                                        "space-y-1.5",
                                        isRightSide
                                            ? "ml-[calc(50%+2.75rem)] max-w-[calc(50%-2.75rem)] text-left"
                                            : "mr-[calc(50%+2.75rem)] max-w-[calc(50%-2.75rem)] text-right"
                                    )}>
                                        <div className={cn("flex", isRightSide ? "justify-start" : "justify-end")}>
                                            {step.tag.kind === "status" ? (
                                                <TaskStatusBadge status={step.tag.status} className="font-medium tracking-normal" />
                                            ) : (
                                                <ActivityEventBadge
                                                    eventType={step.tag.eventType}
                                                    elapsedSeconds={step.tag.elapsedSeconds}
                                                />
                                            )}
                                        </div>
                                        <p className={ACTIVITY_TIMELINE_META_TEXT_CLASS}>
                                            {step.timestamp}
                                        </p>
                                        {step.detail && (
                                            <p className="text-[11px] font-mono text-slate-500 break-words">
                                                {step.detail}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Postpone dialog */}
            <PostponeDeadlineDialog open={isPostponeDialogOpen} onOpenChange={setIsPostponeDialogOpen}
                currentDeadlineIso={taskState.deadline} isSubmitting={isActionPending("postpone")}
                onConfirm={(newDeadlineIso) => handlePostpone(newDeadlineIso)} />

            {/* Fullscreen proof overlay */}
            {isStoredProofFullscreen && storedProof && storedProofSrc && (
                <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4" onClick={() => setIsStoredProofFullscreen(false)}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setIsStoredProofFullscreen(false); }}
                        className="absolute top-4 right-4 h-9 w-9 rounded-full bg-slate-900/80 border border-slate-700 text-slate-300 hover:text-white flex items-center justify-center"
                        aria-label="Close fullscreen">
                        <X className="h-4 w-4" />
                    </button>
                    <ProofMedia mediaKind={storedProof.media_kind} src={storedProofSrc} alt="Completion proof fullscreen"
                        overlayTimestampText={storedProof.overlay_timestamp_text}
                        imageClassName="max-h-[95vh] max-w-[95vw] object-contain rounded-md"
                        videoClassName="max-h-[95vh] max-w-[95vw] rounded-md"
                        imageProps={{ onClick: (e) => e.stopPropagation() }}
                        videoProps={{ controls: true, autoPlay: true, preload: "auto", onClick: (e) => e.stopPropagation() }} />
                </div>
            )}

            {/* Escalation dialog */}
            {showEscalationPicker && (
                <Dialog open={showEscalationPicker} onOpenChange={setShowEscalationPicker}>
                    <DialogContent className="bg-slate-900 border-slate-800 text-slate-300">
                        <DialogHeader>
                            <DialogTitle className="text-xl font-bold text-white">
                                Escalate to a Friend
                            </DialogTitle>
                            <DialogDescription className="text-xs font-mono text-slate-600">
                                Choose a friend to review AI&apos;s decision
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                            {friendsLoading ? (
                                <p className="text-xs font-mono text-slate-600 py-4">Loading friends...</p>
                            ) : friends.length === 0 ? (
                                <p className="text-xs font-mono text-slate-600 py-4">No friends available</p>
                            ) : (
                                friends.map((friend) => (
                                    buttonVisibility.awaitingUser.escalationChoice ? (
                                        <button key={friend.id} onClick={() => handleEscalateToFriend(friend.id)}
                                            className="w-full text-left px-4 py-3 rounded-lg bg-slate-800/40 hover:bg-slate-800/70 border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer">
                                            <div className="text-sm font-medium text-slate-200">{friend.username || friend.email}</div>
                                            {friend.username && <div className="text-xs font-mono text-slate-600">{friend.email}</div>}
                                        </button>
                                    ) : null
                                ))
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </div>
        </>
    );
}
