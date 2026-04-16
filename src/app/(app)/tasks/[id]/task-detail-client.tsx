"use client";

import { fireCompletionConfetti } from "@/lib/confetti";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
    addTaskSubtask,
    cancelRepetition,
    deleteTaskSubtask,
    finalizeTaskProofUpload,
    overrideTask,
    initAwaitingVoucherProofUpload,
    markTaskCompleteWithProofIntent,
    ownerTempDeleteTask,
    postponeTask,
    removeAwaitingVoucherProof,
    renameTaskSubtask,
    replaceTaskReminders,
    revertTaskCompletionAfterProofFailure,
    undoTaskComplete,
    toggleTaskSubtask,
} from "@/actions/tasks";
import { escalateToHumanVoucher } from "@/actions/voucher";
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
import { localDateTimeToIso } from "@/lib/datetime-local";
import { runOptimisticMutation } from "@/lib/ui/runOptimisticMutation";
import { usePomodoro } from "@/components/PomodoroProvider";
import { canOwnerTemporarilyDelete } from "@/lib/task-delete-window";
import { MAX_SUBTASKS_PER_TASK } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { formatCurrencyFromCents, normalizeCurrency, type SupportedCurrency } from "@/lib/currency";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";
import { formatRecurrenceSummary } from "@/lib/recurrence-display";
import { AI_PROFILE_ID } from "@/lib/ai-voucher/constants";
import {
    getProofIntentFromPreparedProof,
    prepareTaskProof,
    type PreparedTaskProof,
} from "@/lib/task-proof-client";
import { getWarmProofSrc, purgeLocalProofMedia } from "@/lib/proof-media-warmup";
import { ProofMedia } from "@/components/ProofMedia";
import {
    isDefaultDeadlineReminderSource,
    MANUAL_REMINDER_SOURCE,
} from "@/lib/task-reminder-defaults";
import { subscribeRealtimeTaskChanges } from "@/lib/realtime-task-events";
import { isIncomingNewer, patchTaskScalars } from "@/lib/tasks-realtime-patch";
import { getVoucherResponseDeadlineLocal } from "@/lib/voucher-deadline";
import {
    buildBeforeStartSubmissionMessage,
    getTaskSubmissionWindowState,
} from "@/lib/task-submission-window";
import type { TaskStatus } from "@/lib/xstate/task-machine";
import {
    ACTIVITY_TIMELINE_META_TEXT_CLASS,
    ActivityEventBadge,
    RecurringIndicator,
    TaskStatusBadge,
} from "@/design-system/badges";
import { TASK_DETAIL_BUTTON_CLASSES } from "@/design-system/task_detail_buttons";
import { WebcamCaptureModal, isMobileDevice } from "@/components/WebcamCaptureModal";

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

interface TaskProofDraft {
    proof: PreparedTaskProof;
    previewUrl: string;
}

type RestoredTaskStatus = "ACTIVE" | "POSTPONED";

interface ActivityStep {
    id: string;
    tag:
        | { kind: "status"; status: TaskStatus }
        | { kind: "event"; eventType: string; elapsedSeconds?: number };
    detail: string | null;
    timestamp: string;
    tone: "success" | "danger" | "warning" | "info" | "proof" | "neutral";
}

interface ProofUploadTarget {
    bucket: string;
    objectPath: string;
    uploadToken?: string;
}

type ProofPickerMode = "draft" | "awaiting-upload";

const TASK_STATUS_VALUE_SET = new Set<TaskStatus>([
    "ACTIVE",
    "POSTPONED",
    "MARKED_COMPLETE",
    "AWAITING_VOUCHER",
    "AWAITING_AI",
    "AI_DENIED",
    "AWAITING_USER",
    "ESCALATED",
    "ACCEPTED",
    "AUTO_ACCEPTED",
    "AI_ACCEPTED",
    "DENIED",
    "MISSED",
    "RECTIFIED",
    "DELETED",
    "SETTLED",
]);

function isTaskStatus(value: string | null | undefined): value is TaskStatus {
    if (!value) return false;
    return TASK_STATUS_VALUE_SET.has(value as TaskStatus);
}

function getRestoredStatusFromRevertResult(
    result: Awaited<ReturnType<typeof revertTaskCompletionAfterProofFailure>>
): RestoredTaskStatus | null {
    if (!result || typeof result !== "object" || !("status" in result)) return null;
    const status = (result as { status?: unknown }).status;
    return status === "ACTIVE" || status === "POSTPONED" ? status : null;
}

function sortTaskReminders(reminders: TaskWithRelations["reminders"] | null | undefined) {
    return (reminders || []).slice().sort((a, b) =>
        new Date(a.reminder_at).getTime() - new Date(b.reminder_at).getTime()
    );
}


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
        !["ACCEPTED", "AUTO_ACCEPTED", "AI_ACCEPTED", "DENIED", "MISSED", "RECTIFIED", "SETTLED", "AWAITING_USER"].includes(taskState.status);

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
    const aiVouches = taskState.ai_vouches ?? [];
    const denials = aiVouches.filter((v) => v.decision === "denied");
    const latestDenial = denials.at(-1) ?? null;

    const formatDateDdMmYy = (value: Date | string) =>
        new Date(value).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
        });

    const formatTime24h = (value: Date | string) =>
        new Date(value).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });

    const formatDateTimeDdMmYy = (value: Date | string) =>
        `${formatDateDdMmYy(value)} ${formatTime24h(value)}`;
    const formatOrdinal = (value: number) => {
        const abs = Math.abs(Math.trunc(value));
        const mod100 = abs % 100;
        if (mod100 >= 11 && mod100 <= 13) return `${abs}th`;
        const mod10 = abs % 10;
        if (mod10 === 1) return `${abs}st`;
        if (mod10 === 2) return `${abs}nd`;
        if (mod10 === 3) return `${abs}rd`;
        return `${abs}th`;
    };
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
    const proofRequestedByLabel = taskState.voucher?.username || "Your voucher";
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

    const setSubtaskPending = (subtaskId: string, pending: boolean) => {
        setPendingSubtaskIds((prev) => {
            const next = new Set(prev);
            if (pending) {
                next.add(subtaskId);
            } else {
                next.delete(subtaskId);
            }
            return next;
        });
    };

    const startEditingSubtask = (subtaskId: string, currentTitle: string) => {
        if (!canManageActionChildren || pendingSubtaskIds.has(subtaskId)) return;
        setSubtaskError(null);
        setEditingSubtaskId(subtaskId);
        setEditingSubtaskTitle(currentTitle);
    };

    const setTaskProofDraft = (nextDraft: TaskProofDraft | null) => {
        setProofDraft((prev) => {
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

    const toReminderIso = (value: string) => {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.toISOString();
    };

    const normalizeReminderIsos = (values: string[]) => {
        const deduped = new Map<number, string>();
        for (const value of values) {
            const normalizedIso = toReminderIso(value);
            if (!normalizedIso) continue;
            deduped.set(new Date(normalizedIso).getTime(), normalizedIso);
        }
        return Array.from(deduped.values()).sort(
            (a, b) => new Date(a).getTime() - new Date(b).getTime()
        );
    };

    const splitCurrentRemindersByTime = (referenceNowMs: number) => {
        const pastReminders: typeof reminders = [];
        const futureReminders: typeof reminders = [];

        for (const reminder of reminders || []) {
            const reminderMs = new Date(reminder.reminder_at).getTime();
            if (Number.isNaN(reminderMs)) continue;

            if (reminderMs <= referenceNowMs) {
                pastReminders.push(reminder);
            } else {
                futureReminders.push(reminder);
            }
        }

        const sortByReminderAt = (a: { reminder_at: string }, b: { reminder_at: string }) =>
            new Date(a.reminder_at).getTime() - new Date(b.reminder_at).getTime();

        return {
            pastReminders: pastReminders.slice().sort(sortByReminderAt),
            futureReminders: futureReminders.slice().sort(sortByReminderAt),
        };
    };

    const getCurrentFutureReminderIsos = (referenceNowMs: number = Date.now()) =>
        normalizeReminderIsos(
            splitCurrentRemindersByTime(referenceNowMs).futureReminders.map(
                (reminder) => reminder.reminder_at
            )
        );

    const hasInvalidFutureReminderForTask = (futureReminderIsos: string[]) => {
        const deadlineDate = new Date(taskState.deadline);
        return futureReminderIsos.some((reminderIso) => {
            const reminderDate = new Date(reminderIso);
            return reminderDate.getTime() <= Date.now() || reminderDate.getTime() > deadlineDate.getTime();
        });
    };

    async function saveReminderSet(futureReminderIsos: string[], clearReminderInput: boolean) {
        if (isActionPending("saveReminders")) return { ok: false as const };
        if (!canManageActionChildren) {
            toast.error("Reminders can only be edited for active tasks.");
            return { ok: false as const };
        }

        if (hasInvalidFutureReminderForTask(futureReminderIsos)) {
            toast.error("All reminders must be in the future and before or at the deadline.");
            return { ok: false as const };
        }

        setActionPending("saveReminders", true);
        const nowIso = new Date().toISOString();

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ reminders, taskState, newReminderLocal }),
            applyOptimistic: () => {
                const referenceNowMs = Date.now();
                const { pastReminders } = splitCurrentRemindersByTime(referenceNowMs);
                const existingByIso = new Map<string, (typeof reminders)[number]>();
                for (const reminder of reminders || []) {
                    const normalizedIso = toReminderIso(reminder.reminder_at);
                    if (!normalizedIso) continue;
                    existingByIso.set(normalizedIso, reminder);
                }

                const optimisticFutureReminders = futureReminderIsos.map((reminderIso, index) => {
                    const existingReminder = existingByIso.get(reminderIso);
                    if (existingReminder) {
                        return {
                            ...existingReminder,
                            reminder_at: reminderIso,
                        };
                    }

                    return {
                        id: `temp-reminder-${index}-${Math.random().toString(36).slice(2, 8)}`,
                        parent_task_id: taskState.id,
                        user_id: taskState.user_id,
                        reminder_at: reminderIso,
                        source: MANUAL_REMINDER_SOURCE,
                        notified_at: null,
                        created_at: nowIso,
                        updated_at: nowIso,
                    };
                });

                const optimisticReminders = [...pastReminders, ...optimisticFutureReminders].sort(
                    (a, b) => new Date(a.reminder_at).getTime() - new Date(b.reminder_at).getTime()
                );
                setReminders(optimisticReminders);
                setTaskState((prev) => ({
                    ...prev,
                    reminders: optimisticReminders,
                }));
                if (clearReminderInput) {
                    setNewReminderLocal("");
                }
            },
            runMutation: () => replaceTaskReminders(taskState.id, futureReminderIsos),
            rollback: (snapshot) => {
                setReminders(snapshot.reminders);
                setTaskState(snapshot.taskState);
                setNewReminderLocal(snapshot.newReminderLocal);
            },
            getFailureMessage: (mutationResult) => mutationResult.error || null,
            fallbackErrorMessage: "Could not save reminders.",
            onSuccess: () => {
                refreshInBackground();
            },
        });

        if (!result.ok) {
            refreshInBackground();
        }

        setActionPending("saveReminders", false);
        return result;
    }

    async function handleAddReminder(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!canManageActionChildren || isActionPending("saveReminders")) return;
        if (!newReminderLocal.trim()) return;

        const reminderIso = localDateTimeToIso(newReminderLocal.trim());
        if (!reminderIso) {
            toast.error("Please choose a valid reminder.");
            return;
        }

        const reminderDate = new Date(reminderIso);
        const deadlineDate = new Date(taskState.deadline);
        const now = Date.now();
        if (reminderDate.getTime() <= now) {
            toast.error("Reminder must be in the future.");
            return;
        }
        if (reminderDate.getTime() > deadlineDate.getTime()) {
            toast.error("Reminder must be before or at the deadline.");
            return;
        }

        const nextFutureReminderIsos = normalizeReminderIsos([
            ...getCurrentFutureReminderIsos(now),
            reminderIso,
        ]);
        await saveReminderSet(nextFutureReminderIsos, true);
    }

    async function handleRemoveReminder(reminderIso: string) {
        if (!canManageActionChildren || isActionPending("saveReminders")) return;
        const reminderMs = new Date(reminderIso).getTime();
        if (!Number.isNaN(reminderMs) && reminderMs <= Date.now()) {
            toast.info("Past reminders are kept as history.");
            return;
        }
        const nextFutureReminderIsos = getCurrentFutureReminderIsos().filter((value) => value !== reminderIso);
        await saveReminderSet(nextFutureReminderIsos, false);
    }

    const processPickedProofFile = async (selectedFile: File) => {
        try {
            const prepared = await prepareTaskProof(selectedFile);
            const previewUrl = URL.createObjectURL(prepared.file);
            setTaskProofDraft({ proof: prepared, previewUrl });
            setProofUploadError(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Could not process proof file.";
            toast.error(message);
        }
    };

    const openProofPicker = async (mode: ProofPickerMode = "draft") => {
        const canOpenForDraft = isOwner && isActiveParentTask && !isActionPending("markComplete");
        const canOpenForAwaitingUpload =
            isOwner &&
            (
                taskState.status === "AWAITING_VOUCHER" ||
                taskState.status === "AWAITING_AI" ||
                taskState.status === "AWAITING_USER" ||
                taskState.status === "MARKED_COMPLETE"
            ) &&
            !isActionPending("awaitingProofUpload");
        if ((mode === "draft" && !canOpenForDraft) || (mode === "awaiting-upload" && !canOpenForAwaitingUpload)) {
            return;
        }
        if (proofDraft) {
            const shouldReplace = window.confirm(
                "A proof file is already attached. Press OK to replace it, or Cancel to remove it."
            );
            if (!shouldReplace) {
                setTaskProofDraft(null);
                setProofUploadError(null);
                return;
            }
        }

        proofPickerModeRef.current = mode;
        if (isMobileDevice()) {
            proofInputRef.current?.click();
        } else {
            setShowWebcamModal(true);
        }
    };

    const handleProofInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const pickerMode = proofPickerModeRef.current;
        proofPickerModeRef.current = "draft";
        const selectedFile = event.target.files?.[0];
        event.target.value = "";
        if (!selectedFile) return;
        if (pickerMode === "awaiting-upload") {
            setActionPending("awaitingProofUpload", true);
            try {
                const prepared = await prepareTaskProof(selectedFile);
                const previewUrl = URL.createObjectURL(prepared.file);
                const awaitingDraft = { proof: prepared, previewUrl };

                // Optimistic UI: immediately show proof as uploaded
                const optimisticProof = {
                    media_kind: prepared.mediaKind,
                    mime_type: prepared.mimeType,
                    size_bytes: prepared.sizeBytes,
                    duration_ms: prepared.durationMs,
                    overlay_timestamp_text: prepared.overlayTimestampText,
                    upload_state: "UPLOADED" as const,
                    updated_at: new Date().toISOString(),
                };
                const snapshotCompletionProof = taskState.completion_proof;
                setTaskState((prev) => ({
                    ...prev,
                    completion_proof: optimisticProof as any,
                    proof_request_open: false,
                    proof_requested_at: null,
                    proof_requested_by: null,
                    updated_at: new Date().toISOString(),
                }));
                setTaskProofDraft(null);
                setProofUploadError(null);

                // Run the real upload in background
                try {
                    await uploadAwaitingProofInBackground(taskState.id, awaitingDraft);
                } catch (uploadErr) {
                    // Revert optimistic state on failure
                    setTaskState((prev) => ({
                        ...prev,
                        completion_proof: snapshotCompletionProof,
                    }));
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : "Could not process proof file.";
                toast.error(message);
            } finally {
                setActionPending("awaitingProofUpload", false);
            }
            return;
        }
        await processPickedProofFile(selectedFile);
    };

    const uploadProofInBackground = async (
        taskId: string,
        draft: TaskProofDraft,
        uploadTarget: ProofUploadTarget
    ) => {
        const supabase = createBrowserSupabaseClient();
        const uploadResponse = uploadTarget.uploadToken
            ? await supabase.storage
                .from(uploadTarget.bucket)
                .uploadToSignedUrl(uploadTarget.objectPath, uploadTarget.uploadToken, draft.proof.file, {
                    contentType: draft.proof.mimeType,
                    upsert: true,
                })
            : await supabase.storage
                .from(uploadTarget.bucket)
                .upload(uploadTarget.objectPath, draft.proof.file, {
                    upsert: true,
                    contentType: draft.proof.mimeType,
                    cacheControl: "120",
                });

        const uploadError = uploadResponse.error;

        if (uploadError) {
            console.error("Task proof upload failed (task detail):", uploadError);
            const uploadMessage = uploadError.message || "Unknown upload error";
            setProofUploadError(`Proof upload failed (${uploadMessage}). Task reverted to active state.`);
            toast.error(`Proof upload failed: ${uploadMessage}`);
            const reverted = await revertTaskCompletionAfterProofFailure(taskId);
            if (reverted?.error) {
                toast.error(reverted.error);
            }
            const restoredStatus = getRestoredStatusFromRevertResult(reverted);
            if (reverted?.success && restoredStatus) {
                setTaskState((prev) => ({
                    ...prev,
                    status: restoredStatus,
                    marked_completed_at: null,
                    voucher_response_deadline: null,
                    updated_at: new Date().toISOString(),
                }));
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
            bucket: uploadTarget.bucket,
            objectPath: uploadTarget.objectPath,
        });

        if (finalize?.error) {
            setProofUploadError("Proof finalize failed. Task reverted to active state.");
            toast.error(`Proof upload failed: ${finalize.error}`);
            const reverted = await revertTaskCompletionAfterProofFailure(taskId);
            if (reverted?.error) {
                toast.error(reverted.error);
            }
            const restoredStatus = getRestoredStatusFromRevertResult(reverted);
            if (reverted?.success && restoredStatus) {
                setTaskState((prev) => ({
                    ...prev,
                    status: restoredStatus,
                    marked_completed_at: null,
                    voucher_response_deadline: null,
                    updated_at: new Date().toISOString(),
                }));
            }
            void purgeLocalProofMedia(taskId);
            refreshInBackground();
            return;
        }

        setTaskProofDraft(null);
        setProofUploadError(null);
        refreshInBackground();
    };

    const uploadAwaitingProofInBackground = async (
        taskId: string,
        draft: TaskProofDraft
    ) => {
        const init = await initAwaitingVoucherProofUpload(
            taskId,
            getProofIntentFromPreparedProof(draft.proof)
        );
        if (init?.error) {
            setProofUploadError(init.error);
            toast.error(init.error);
            refreshInBackground();
            return;
        }

        const uploadTarget = (init as { proofUploadTarget?: ProofUploadTarget } | undefined)?.proofUploadTarget;
        if (!uploadTarget) {
            const message = "Proof upload target missing.";
            setProofUploadError(message);
            toast.error(`Proof upload failed: ${message}`);
            refreshInBackground();
            return;
        }

        const supabase = createBrowserSupabaseClient();
        const uploadResponse = uploadTarget.uploadToken
            ? await supabase.storage
                .from(uploadTarget.bucket)
                .uploadToSignedUrl(uploadTarget.objectPath, uploadTarget.uploadToken, draft.proof.file, {
                    contentType: draft.proof.mimeType,
                    upsert: true,
                })
            : await supabase.storage
                .from(uploadTarget.bucket)
                .upload(uploadTarget.objectPath, draft.proof.file, {
                    upsert: true,
                    contentType: draft.proof.mimeType,
                    cacheControl: "120",
                });

        const uploadError = uploadResponse.error;
        if (uploadError) {
            console.error("Awaiting-voucher proof upload failed (task detail):", uploadError);
            const uploadMessage = uploadError.message || "Unknown upload error";
            setProofUploadError(`Proof upload failed (${uploadMessage}). Task is still awaiting voucher.`);
            toast.error(`Proof upload failed: ${uploadMessage}`);
            refreshInBackground();
            return;
        }

        const finalize = await finalizeTaskProofUpload(taskId, {
            mediaKind: draft.proof.mediaKind,
            mimeType: draft.proof.mimeType,
            sizeBytes: draft.proof.sizeBytes,
            durationMs: draft.proof.durationMs,
            overlayTimestampText: draft.proof.overlayTimestampText,
            bucket: uploadTarget.bucket,
            objectPath: uploadTarget.objectPath,
        });

        if (finalize?.error) {
            setProofUploadError(finalize.error);
            toast.error(`Proof finalize failed: ${finalize.error}`);
            refreshInBackground();
            return;
        }

        setTaskState((prev) => ({
            ...prev,
            proof_request_open: false,
            proof_requested_at: null,
            proof_requested_by: null,
            updated_at: new Date().toISOString(),
        }));
        setTaskProofDraft(null);
        setProofUploadError(null);
        refreshInBackground();
    };

    const proofSummary = storedProof
        ? `Uploaded (${storedProof.media_kind})`
        : proofDraft
            ? `Attached (${proofDraft.proof.mediaKind})`
            : "None";
    const googleSyncDirectionLabel =
        taskState.google_sync_linked && taskState.google_sync_last_origin === "APP"
            ? "App -> Google Calendar"
            : taskState.google_sync_linked && taskState.google_sync_last_origin === "GOOGLE"
                ? "Google Calendar -> App"
                : null;
    const googleSyncDirectionClassName =
        taskState.google_sync_last_origin === "APP" ? "text-emerald-300" : "text-cyan-300";

    async function handleMarkComplete() {
        if (isActionPending("markComplete")) return;
        if (isBeforeStart) {
            toast.error(beforeStartMessage);
            return;
        }
        if (incompleteSubtasksCount > 0) {
            toast.error("Complete all subtasks before marking this task complete.");
            return;
        }
        if (hasIncompletePomoRequirement) {
            const remainingMinutes = Math.ceil(remainingRequiredPomoSeconds / 60);
            toast.error(`Log ${remainingMinutes} more focus minute${remainingMinutes === 1 ? "" : "s"} before marking this task complete.`);
            return;
        }
        if (hasRunningPomoForTask) {
            toast.error("Stop the running pomodoro for this task before marking it complete.");
            return;
        }
        if (requiresProofForCompletion && !proofDraft && !storedProof) {
            toast.error("Attach proof before marking this task complete.");
            return;
        }
        setActionPending("markComplete", true);
        setProofUploadError(null);
        fireCompletionConfetti();

        const now = new Date();
        const voucherResponseDeadline = getVoucherResponseDeadlineLocal(now);
        const draft = proofDraft;
        const proofIntent = draft ? getProofIntentFromPreparedProof(draft.proof) : null;
        if (proofIntent || storedProof) {
            // Drop any previously warmed proof immediately when replacing/removing proof state.
            void purgeLocalProofMedia(taskState.id);
        }

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ taskState }),
            applyOptimistic: () => {
                setTaskState((prev) => ({
                    ...prev,
                    status: isSelfVouched
                        ? "ACCEPTED"
                        : (isAiVouched ? "AWAITING_AI" : "AWAITING_VOUCHER"),
                    marked_completed_at: now.toISOString(),
                    voucher_response_deadline:
                        (isSelfVouched || isAiVouched) ? null : voucherResponseDeadline.toISOString(),
                    proof_request_open: false,
                    proof_requested_at: null,
                    proof_requested_by: null,
                    updated_at: now.toISOString(),
                }));
            },
            runMutation: () => markTaskCompleteWithProofIntent(taskState.id, userTimeZone, proofIntent),
            rollback: (snapshot) => {
                setTaskState(snapshot.taskState);
            },
            onSuccess: () => {
                if (isSelfVouched) {
                    setTaskProofDraft(null);
                    setProofUploadError(null);
                    void purgeLocalProofMedia(taskState.id);
                } else if (!proofIntent) {
                    void purgeLocalProofMedia(taskState.id);
                }
                if (potentialRp !== null && potentialRp > 0) {
                    toast.success(`You may earn +${potentialRp} RP`);
                }
                refreshInBackground();
            },
        });

        if (result.ok && draft && !isSelfVouched) {
            const mutationResult = result.result as { proofUploadTarget?: ProofUploadTarget } | undefined;
            const uploadTarget = mutationResult?.proofUploadTarget;

            if (!uploadTarget) {
                setProofUploadError("Proof upload target missing. Task reverted to active state.");
                toast.error("Proof upload failed: Upload target missing.");
                const reverted = await revertTaskCompletionAfterProofFailure(taskState.id);
                if (reverted?.error) {
                    toast.error(reverted.error);
                }
                refreshInBackground();
            } else {
                void uploadProofInBackground(taskState.id, draft, uploadTarget);
            }
        }

        setActionPending("markComplete", false);
    }

    async function handleUndoComplete() {
        if (isActionPending("undoComplete")) return;
        if (!isOwner || (taskState.status !== "AWAITING_VOUCHER" && taskState.status !== "AWAITING_AI" && taskState.status !== "MARKED_COMPLETE")) return;
        if (new Date() >= new Date(taskState.deadline)) {
            toast.error("Cannot undo completion after the deadline.");
            return;
        }

        setActionPending("undoComplete", true);
        const restoredStatus: "ACTIVE" | "POSTPONED" = taskState.postponed_at ? "POSTPONED" : "ACTIVE";
        const nowIso = new Date().toISOString();

        await runOptimisticMutation({
            captureSnapshot: () => ({ taskState }),
            applyOptimistic: () => {
                setTaskState((prev) => ({
                    ...prev,
                    status: restoredStatus,
                    marked_completed_at: null,
                    voucher_response_deadline: null,
                    proof_request_open: false,
                    proof_requested_at: null,
                    proof_requested_by: null,
                    updated_at: nowIso,
                }));
            },
            runMutation: () => undoTaskComplete(taskState.id),
            rollback: (snapshot) => {
                setTaskState(snapshot.taskState);
            },
            onSuccess: () => {
                setTaskProofDraft(null);
                setProofUploadError(null);
                void purgeLocalProofMedia(taskState.id);
                refreshInBackground();
            },
        });

        setActionPending("undoComplete", false);
    }

    async function handleRemoveStoredProof() {
        if (isActionPending("removeStoredProof")) return;
        if (!isOwner || !storedProof) return;
        if (!["AWAITING_VOUCHER", "AWAITING_AI", "MARKED_COMPLETE"].includes(taskState.status)) {
            toast.error("Proof can only be removed while awaiting voucher response.");
            return;
        }

        setActionPending("removeStoredProof", true);
        const nowIso = new Date().toISOString();

        await runOptimisticMutation({
            captureSnapshot: () => ({ taskState }),
            applyOptimistic: () => {
                setTaskState((prev) => ({
                    ...prev,
                    completion_proof: null,
                    updated_at: nowIso,
                }));
                setProofUploadError(null);
            },
            runMutation: () => removeAwaitingVoucherProof(taskState.id),
            rollback: (snapshot) => {
                setTaskState(snapshot.taskState);
            },
            onSuccess: () => {
                void purgeLocalProofMedia(taskState.id);
                toast.success("Proof removed.");
                refreshInBackground();
            },
        });

        setActionPending("removeStoredProof", false);
    }

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

    async function handleAddSubtask(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!canManageActionChildren || isAddingSubtask) return;

        const normalizedTitle = newSubtaskTitle.trim();
        if (!normalizedTitle) {
            setSubtaskError("Subtask title cannot be empty.");
            return;
        }

        if (subtasks.length >= MAX_SUBTASKS_PER_TASK) {
            setSubtaskError(`You can add up to ${MAX_SUBTASKS_PER_TASK} subtasks.`);
            return;
        }

        setSubtaskError(null);
        setIsAddingSubtask(true);

        const nowIso = new Date().toISOString();
        const optimisticId = `temp-subtask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const optimisticSubtask = {
            id: optimisticId,
            parent_task_id: taskState.id,
            user_id: taskState.user_id,
            title: normalizedTitle,
            is_completed: false,
            completed_at: null,
            created_at: nowIso,
            updated_at: nowIso,
        };

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ subtasks, newSubtaskTitle }),
            applyOptimistic: () => {
                setSubtasks((prev) => [...prev, optimisticSubtask]);
                setNewSubtaskTitle("");
            },
            runMutation: () => addTaskSubtask(taskState.id, normalizedTitle),
            rollback: (snapshot) => {
                setSubtasks(snapshot.subtasks);
                setNewSubtaskTitle(snapshot.newSubtaskTitle);
            },
            onSuccess: (mutationResult) => {
                if (mutationResult && "subtask" in mutationResult && mutationResult.subtask) {
                    setSubtasks((prev) =>
                        prev.map((subtask) =>
                            subtask.id === optimisticId
                                ? (mutationResult.subtask as typeof optimisticSubtask)
                                : subtask
                        )
                    );
                }
            },
        });

        if (!result.ok && result.error) {
            setSubtaskError(result.error);
        } else if (!result.ok) {
            setSubtaskError("Could not add subtask.");
        } else if (subtasks.length + 1 < MAX_SUBTASKS_PER_TASK) {
            shouldRestoreSubtaskInputFocusRef.current = true;
        }

        setIsAddingSubtask(false);
    }

    async function handleToggleSubtask(subtaskId: string) {
        if (!canManageActionChildren || pendingSubtaskIds.has(subtaskId)) return;

        const current = subtasks.find((subtask) => subtask.id === subtaskId);
        if (!current) return;

        const nextCompleted = !current.is_completed;
        setSubtaskPending(subtaskId, true);
        setSubtaskError(null);

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ subtasks }),
            applyOptimistic: () => {
                setSubtasks((prev) =>
                    prev.map((subtask) =>
                        subtask.id === subtaskId
                            ? {
                                ...subtask,
                                is_completed: nextCompleted,
                                completed_at: nextCompleted ? new Date().toISOString() : null,
                                updated_at: new Date().toISOString(),
                            }
                            : subtask
                    )
                );
            },
            runMutation: () => toggleTaskSubtask(taskState.id, subtaskId, nextCompleted),
            rollback: (snapshot) => {
                setSubtasks(snapshot.subtasks);
            },
            onSuccess: () => {
                // Local optimistic state is already updated.
            },
        });

        if (!result.ok && result.error) {
            setSubtaskError(result.error);
        }

        setSubtaskPending(subtaskId, false);
    }

    async function handleDeleteSubtask(subtaskId: string) {
        if (!canManageActionChildren || pendingSubtaskIds.has(subtaskId)) return;

        setSubtaskPending(subtaskId, true);
        setSubtaskError(null);

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ subtasks }),
            applyOptimistic: () => {
                setSubtasks((prev) => prev.filter((subtask) => subtask.id !== subtaskId));
            },
            runMutation: () => deleteTaskSubtask(taskState.id, subtaskId),
            rollback: (snapshot) => {
                setSubtasks(snapshot.subtasks);
            },
            onSuccess: () => {
                // Local optimistic state is already updated.
            },
        });

        if (!result.ok && result.error) {
            setSubtaskError(result.error);
        }

        setSubtaskPending(subtaskId, false);
    }

    async function handleRenameSubtask() {
        if (!editingSubtaskId) return;
        const targetId = editingSubtaskId;
        const trimmed = editingSubtaskTitle.trim();
        const currentSubtask = subtasks.find((subtask) => subtask.id === targetId);

        setEditingSubtaskId(null);
        setEditingSubtaskTitle("");

        if (!currentSubtask) return;
        if (!trimmed) {
            setSubtaskError("Subtask title cannot be empty.");
            return;
        }
        if (trimmed === currentSubtask.title) return;

        setSubtaskPending(targetId, true);
        setSubtaskError(null);
        const nowIso = new Date().toISOString();

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ subtasks }),
            applyOptimistic: () => {
                setSubtasks((prev) =>
                    prev.map((subtask) =>
                        subtask.id === targetId
                            ? { ...subtask, title: trimmed, updated_at: nowIso }
                            : subtask
                    )
                );
            },
            runMutation: () => renameTaskSubtask(taskState.id, targetId, trimmed),
            rollback: (snapshot) => {
                setSubtasks(snapshot.subtasks);
            },
            onSuccess: (mutationResult) => {
                if (mutationResult && "subtask" in mutationResult && mutationResult.subtask) {
                    setSubtasks((prev) =>
                        prev.map((subtask) =>
                            subtask.id === targetId
                                ? (mutationResult.subtask as typeof subtask)
                                : subtask
                        )
                    );
                }
            },
        });

        if (!result.ok && result.error) {
            setSubtaskError(result.error);
        }

        setSubtaskPending(targetId, false);
    }

    async function handleOverride() {
        if (isActionPending("override")) return;
        if (hasUsedOverrideThisMonth) {
            toast.error("You have already used your override for this month");
            return;
        }
        if (!confirm("Are you sure? This uses your 1 monthly Override pass and will settle the task without failure cost.")) return;

        setActionPending("override", true);
        const optimisticUpdatedAt = new Date().toISOString();

        await runOptimisticMutation({
            captureSnapshot: () => ({ taskState }),
            applyOptimistic: () => {
                setTaskState((prev) => ({
                    ...prev,
                    status: "SETTLED",
                    updated_at: optimisticUpdatedAt,
                }));
            },
            runMutation: () => overrideTask(taskState.id),
            rollback: (snapshot) => {
                setTaskState(snapshot.taskState);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        setActionPending("override", false);
    }

    async function handleCancelRepetition() {
        if (isRepetitionStopped || isActionPending("cancelRepetition")) return;
        if (!confirm("Are you sure you want to stop future repetitions? This task will remain, but no more will be created.")) return;

        setActionPending("cancelRepetition", true);

        await runOptimisticMutation({
            captureSnapshot: () => ({ taskState, isRepetitionStopped }),
            applyOptimistic: () => {
                setIsRepetitionStopped(true);
                setTaskState((prev) => ({
                    ...prev,
                    recurrence_rule_id: null,
                    recurrence_rule: null,
                }));
            },
            runMutation: () => cancelRepetition(taskState.id),
            rollback: (snapshot) => {
                setTaskState(snapshot.taskState);
                setIsRepetitionStopped(snapshot.isRepetitionStopped);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        setActionPending("cancelRepetition", false);
    }

    async function handleTempDelete() {
        if (isActionPending("tempDelete") || !canTempDelete) return;
        setActionPending("tempDelete", true);

        const result = await ownerTempDeleteTask(taskState.id);
        if (result?.error) {
            toast.error(result.error);
            setActionPending("tempDelete", false);
            return;
        }

        refreshInBackground();
        router.push("/tasks");
        setActionPending("tempDelete", false);
    }

    async function loadFriendsForEscalation() {
        setFriendsLoading(true);
        try {
            const supabase = createBrowserSupabaseClient();
            const { data, error } = await supabase
                .from("friendships")
                .select("friend_id, friend:profiles!friendships_friend_id_fkey(id, username, email)")
                .eq("user_id", viewerId);

            if (!error && data) {
                const friendsList = data
                    .map((f) => (f.friend as any))
                    .filter((f) => f && f.id);
                setFriends(friendsList);
            }
        } catch (error) {
            console.error("Failed to load friends:", error);
        } finally {
            setFriendsLoading(false);
        }
    }

    async function handleEscalateToFriend(friendId: string) {
        if (escalationPending) return;
        setEscalationPending(true);

        const result = await escalateToHumanVoucher(taskState.id, friendId);

        if (result?.error) {
            toast.error(result.error);
        } else if (result?.success) {
            toast.success("Task escalated to friend for review");
            setShowEscalationPicker(false);
            refreshInBackground();
        }

        setEscalationPending(false);
    }

    const formatFocusTime = (seconds: number) => {
        if (!seconds || seconds <= 0) return "0m";
        if (seconds < 60) return `${seconds}s`;
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    };

    const getPomoElapsedSeconds = (event: TaskEvent) => {
        const elapsedRaw = event.metadata?.elapsed_seconds;
        return typeof elapsedRaw === "number" ? elapsedRaw : Number(elapsedRaw ?? 0);
    };

    const formatDateDdMmYyyy = (value: Date | string) =>
        new Date(value).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        });

    const formatDateTimeDdMmYyyy24h = (value: Date | string) =>
        `${formatDateDdMmYyyy(value)} ${formatTime24h(value)}`;

    const formatEventTimestamp = (event: TaskEvent) => {
        if (event.event_type !== "POMO_COMPLETED") {
            return formatDateTimeDdMmYyyy24h(event.created_at);
        }

        const elapsedSeconds = getPomoElapsedSeconds(event);
        const endDate = new Date(event.created_at);
        if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || Number.isNaN(endDate.getTime())) {
            return formatDateTimeDdMmYyyy24h(event.created_at);
        }

        const startDate = new Date(endDate.getTime() - elapsedSeconds * 1000);
        return `${formatDateTimeDdMmYyyy24h(startDate)} -> ${formatDateTimeDdMmYyyy24h(endDate)}`;
    };

    const getActivityStepTone = (event: TaskEvent): ActivityStep["tone"] => {
        const toStatus = event.to_status;
        if (["ACCEPTED", "AUTO_ACCEPTED", "AI_ACCEPTED", "RECTIFIED", "SETTLED"].includes(toStatus)) {
            return "success";
        }
        if (["DENIED", "MISSED"].includes(toStatus)) {
            return "danger";
        }
        if (event.event_type === "DEADLINE_WARNING_1H" || event.event_type === "DEADLINE_WARNING_10M") {
            return "warning";
        }
        if (["PROOF_UPLOAD_FAILED_REVERT", "PROOF_REQUESTED", "PROOF_UPLOADED", "PROOF_REMOVED"].includes(event.event_type)) {
            return "proof";
        }
        if (["POMO_COMPLETED", "REPETITION_STOPPED"].includes(event.event_type)) {
            return "info";
        }
        return "neutral";
    };

    const visibleEvents = useMemo(() => {
        const seenSessionIds = new Set<string>();
        const filtered = events.filter((event) => {
            if (event.event_type !== "POMO_COMPLETED") return true;
            const sessionIdRaw = event.metadata?.session_id;
            const sessionId = typeof sessionIdRaw === "string" ? sessionIdRaw : "";
            if (!sessionId) return true;
            if (seenSessionIds.has(sessionId)) return false;
            seenSessionIds.add(sessionId);
            return true;
        });

        const minuteBucket = (iso: string) => {
            const ms = new Date(iso).getTime();
            return Number.isNaN(ms) ? Number.NaN : Math.floor(ms / 60000);
        };

        const isAwaitingTransition = (event: TaskEvent) =>
            event.from_status !== event.to_status &&
            typeof event.to_status === "string" &&
            event.to_status.startsWith("AWAITING_");

        return [...filtered].sort((a, b) => {
            const aMinute = minuteBucket(a.created_at);
            const bMinute = minuteBucket(b.created_at);

            if (Number.isNaN(aMinute) || Number.isNaN(bMinute) || aMinute !== bMinute) {
                return 0;
            }

            const aIsProofUploaded = a.event_type === "PROOF_UPLOADED";
            const bIsProofUploaded = b.event_type === "PROOF_UPLOADED";
            const aIsAwaiting = isAwaitingTransition(a);
            const bIsAwaiting = isAwaitingTransition(b);

            if (aIsProofUploaded && bIsAwaiting) return -1;
            if (bIsProofUploaded && aIsAwaiting) return 1;
            return 0;
        });
    }, [events]);

    const activitySteps = useMemo<ActivityStep[]>(() => {
        let aiEventCounter = 0;
        return visibleEvents.map((event) => {
            const hasTransition = event.from_status !== event.to_status;
            const toStatus = event.to_status;
            const elapsedSeconds = event.event_type === "POMO_COMPLETED"
                ? getPomoElapsedSeconds(event)
                : undefined;
            const tag: ActivityStep["tag"] =
                event.event_type === "MARK_COMPLETE"
                    ? { kind: "status", status: "MARKED_COMPLETE" }
                    : hasTransition && isTaskStatus(toStatus)
                    ? { kind: "status", status: toStatus }
                    : { kind: "event", eventType: event.event_type, elapsedSeconds };

            const detailParts: string[] = [];
            if (event.event_type === "POSTPONE") {
                const newDeadlineRaw = event.metadata?.new_deadline;
                const newDeadlineIso = typeof newDeadlineRaw === "string" ? newDeadlineRaw : null;
                if (newDeadlineIso) {
                    detailParts.push(`new deadline: ${formatDateTimeDdMmYyyy24h(newDeadlineIso)}`);
                }
            }

            if (event.event_type === "POMO_COMPLETED") {
                detailParts.push(`focus duration: ${formatFocusTime(getPomoElapsedSeconds(event))}`);
            }

            if (event.event_type === "AI_APPROVE" || event.event_type === "AI_DENY") {
                const vouch = aiVouches[aiEventCounter];
                aiEventCounter += 1;
                if (vouch?.reason) {
                    detailParts.push(`"${vouch.reason}"`);
                }
            }

            const detail = detailParts.length > 0 ? detailParts.join(" | ") : null;

            return {
                id: event.id,
                tag,
                detail,
                timestamp: formatEventTimestamp(event),
                tone: getActivityStepTone(event),
            };
        });
    }, [visibleEvents, aiVouches]);

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

        <div className="max-w-3xl mx-auto px-4 md:px-0 pb-12 space-y-7">

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
                                <TaskStatusBadge status={taskState.status} />
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
                        </div>

                    </div>
                </div>
            </div>

            {/* ② STATS STRIP */}
            <div className="td-rise td-d2 rounded-xl border border-slate-800/80 bg-slate-950/40 px-4 py-4 sm:px-5">
                <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-3 min-h-[32px]">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Deadline</p>
                        <p className="text-xs font-mono text-right text-slate-200">
                            {formatDateTimeDdMmYy(deadline)}
                        </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 min-h-[32px]">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Failure Cost</p>
                        <p className="text-xs font-mono text-slate-200 text-right">{formattedFailureCost}</p>
                    </div>
                    <div className="flex items-center justify-between gap-3 min-h-[32px]">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Voucher</p>
                        <p className="text-xs font-mono text-slate-200 text-right truncate">
                            {isAiVouched ? "AI" : (taskState.voucher?.username || "Unassigned")}
                        </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 min-h-[32px]">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Focused</p>
                        <p className="text-xs font-mono text-slate-200 text-right">
                            {`${formatFocusTime(totalPomoSeconds)}, ${pomoSummary?.sessionCount ?? 0} session${(pomoSummary?.sessionCount ?? 0) === 1 ? "" : "s"}`}
                        </p>
                    </div>
                </div>
            </div>

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
                            Waiting for {isAiVouched ? 'AI' : (taskState.voucher?.username || 'your voucher')} to respond
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
                        <div className="flex flex-wrap gap-2 pt-1">
                            {isOwner && (
                                <Button type="button" variant="outline" onClick={() => openProofPicker("awaiting-upload")} disabled={isActionPending("awaitingProofUpload")}
                                    className={cn(uniformActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.awaiting.addProof)}>
                                    {storedProof ? "Replace Proof" : "Add Proof"}
                                </Button>
                            )}
                            {isOwner && (
                                <Button type="button" variant="outline" onClick={handleUndoComplete}
                                    disabled={isActionPending("undoComplete") || isOverdue}
                                    title={isOverdue ? "Undo complete is unavailable after deadline" : "Undo complete"}
                                    className={cn(uniformActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.awaiting.undoComplete)}>
                                    Undo Complete
                                </Button>
                            )}
                        </div>
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
                        <div className="flex flex-wrap gap-2 pt-1">
                            {isOwner && (
                                <Button type="button" variant="outline" onClick={() => openProofPicker("awaiting-upload")} disabled={isActionPending("awaitingProofUpload")}
                                    className={cn(uniformActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.awaiting.addProof)}>
                                    {storedProof ? "Replace Proof" : "Add Proof"}
                                </Button>
                            )}
                            {isOwner && (
                                <Button type="button" variant="outline" onClick={handleUndoComplete}
                                    disabled={isActionPending("undoComplete") || isOverdue}
                                    title={isOverdue ? "Undo complete is unavailable after deadline" : "Undo complete"}
                                    className={cn(uniformActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.awaiting.undoComplete)}>
                                    Undo Complete
                                </Button>
                            )}
                        </div>
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
                        <div className="flex flex-wrap gap-2 pt-1">
                            {canResubmit && isOwner && (
                                <button type="button" onClick={() => openProofPicker("awaiting-upload")} disabled={isActionPending("awaitingProofUpload")}
                                    className={cn(TASK_DETAIL_BUTTON_CLASSES.awaiting.resubmitProof, uniformActionButtonClass)}>
                                    <Camera className="h-3.5 w-3.5" />
                                    Upload New Proof
                                </button>
                            )}
                            {isOwner && (
                                <Button variant="ghost" onClick={() => { if (!friends.length && !friendsLoading) loadFriendsForEscalation(); setShowEscalationPicker(true); }} disabled={escalationPending}
                                    className={cn(uniformActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.awaiting.escalateToFriend)}>
                                    Escalate to Friend
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {taskState.status === "DENIED" && (
                <div className="td-rise td-d3 rounded-xl border border-red-500/20 bg-red-950/10 overflow-hidden">
                    <div className="h-px bg-gradient-to-r from-red-500/60 via-red-400/20 to-transparent" />
                    <div className="px-5 py-4 space-y-3">
                        <div className="flex items-center gap-3 mb-1">
                            <div style={{ width: 24, height: 1, background: '#f87171', boxShadow: '0 0 6px rgba(248,113,113,0.4)', flexShrink: 0 }} />
                            <span className="text-[10px] uppercase tracking-wider font-bold text-red-400">
                                {taskState.status === "DENIED" ? "task denied" : "task missed"}
                            </span>
                        </div>
                        <p className="text-base font-medium text-red-200">
                            {taskState.status === "DENIED"
                                ? (isAiVouched && latestDenial?.reason ? `Denied — ${latestDenial.reason}` : "Denied by voucher.")
                                : `Missed deadline. ${formattedFailureCost} added to ledger.`}
                        </p>
                        {isAiVouched && denials.length > 0 && (
                            <div className="space-y-1.5">
                                {denials.map((denial) => (
                                    <div key={denial.id} className="border-l border-red-500/25 pl-3">
                                        <p className="text-xs font-mono text-red-400/70">Attempt {denial.attempt_number}:</p>
                                        <p className="text-red-200/50 text-xs mt-0.5">{denial.reason}</p>
                                    </div>
                                ))}
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
                        {isOwner && ["AWAITING_VOUCHER", "AWAITING_AI", "MARKED_COMPLETE"].includes(taskState.status) && (
                            <Button type="button" variant="ghost" onClick={handleRemoveStoredProof} disabled={isActionPending("removeStoredProof")}
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
                <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3 sm:p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        <div className={cn(!isOwner || !isActiveParentTask ? TASK_DETAIL_BUTTON_CLASSES.actions.pomoWrapperDisabled : "")}>
                            <PomoButton
                                taskId={taskState.id}
                                variant="full"
                                className={TASK_DETAIL_BUTTON_CLASSES.actions.pomoButton}
                                defaultDurationMinutes={defaultPomoDurationMinutes}
                                fullDurationSuffixText="m pomodoro?"
                            />
                        </div>
                        <Button type="button" variant="ghost" onClick={() => openProofPicker("draft")} disabled={isActionPending("markComplete") || !isOwner}
                            className={cn(TASK_DETAIL_BUTTON_CLASSES.actions.attachProofBase,
                                proofDraft && isOwner
                                    ? TASK_DETAIL_BUTTON_CLASSES.actions.attachProofAttached
                                    : TASK_DETAIL_BUTTON_CLASSES.actions.attachProofEnabled,
                                (!isOwner) && TASK_DETAIL_BUTTON_CLASSES.actions.attachProofDisabled)}
                            style={proofDraft && isOwner ? { boxShadow: '0 0 12px rgba(244,114,182,0.2)' } : {}}
                            title={proofDraft ? "Proof attached" : (requiresProofForCompletion ? "Attach proof (required)" : "Attach proof (optional)")}
                            aria-label="Attach proof">
                            <Camera className="h-5 w-5" />
                        </Button>
                        <Button onClick={handleMarkComplete}
                            disabled={isActionPending("markComplete") || !isOwner || !isActiveParentTask || isOverdue || isBeforeStart || incompleteSubtasksCount > 0 || hasIncompletePomoRequirement || hasRunningPomoForTask}
                            className={cn(activeRowActionButtonClass, "w-full justify-center transition-all border",
                                (!isOwner || !isActiveParentTask || isBeforeStart || incompleteSubtasksCount > 0 || hasIncompletePomoRequirement || hasRunningPomoForTask || isOverdue)
                                    ? TASK_DETAIL_BUTTON_CLASSES.actions.markCompleteDisabled
                                    : TASK_DETAIL_BUTTON_CLASSES.actions.markCompleteEnabled)}
                            title={isBeforeStart ? beforeStartMessage : "Mark complete"}>
                            {isActionPending("markComplete") ? "..." : "Mark Complete"}
                        </Button>
                        <Button type="button" variant="outline" onClick={() => setIsPostponeDialogOpen(true)}
                            disabled={isActionPending("postpone") || !isOwner || taskState.status !== "ACTIVE" || Boolean(taskState.postponed_at) || isOverdue}
                            className={cn(activeRowActionButtonClass, "w-full justify-center border",
                                (!isOwner || taskState.status !== "ACTIVE" || Boolean(taskState.postponed_at) || isOverdue)
                                    ? TASK_DETAIL_BUTTON_CLASSES.actions.postponeDisabled
                                    : TASK_DETAIL_BUTTON_CLASSES.actions.postponeEnabled)}>
                            Postpone once?
                        </Button>
                        <Button variant="ghost" onClick={handleCancelRepetition}
                            disabled={isActionPending("cancelRepetition") || !isOwner || !taskState.recurrence_rule_id || isRepetitionStopped}
                            className={cn(activeRowActionButtonClass, "w-full justify-center border",
                                (!isOwner || !taskState.recurrence_rule_id || isRepetitionStopped)
                                    ? TASK_DETAIL_BUTTON_CLASSES.actions.stopRepeatingDisabled
                                    : TASK_DETAIL_BUTTON_CLASSES.actions.stopRepeatingEnabled)}>
                            <Repeat className="mr-1.5 h-3.5 w-3.5" />
                            {isRepetitionStopped ? "Repetitions Stopped" : "Stop Repeating"}
                        </Button>
                        <Button variant="ghost" onClick={handleOverride}
                            disabled={isActionPending("override") || !canUseOverride}
                            className={cn(activeRowActionButtonClass, "w-full justify-center border",
                                !canUseOverride
                                    ? TASK_DETAIL_BUTTON_CLASSES.actions.overrideDisabled
                                    : TASK_DETAIL_BUTTON_CLASSES.actions.overrideEnabled)}>
                            Use Override
                        </Button>
                        <Button type="button" variant="ghost" onClick={handleTempDelete} disabled={isActionPending("tempDelete") || !isOwner || !canTempDelete}
                            className={cn("h-12 w-full p-0 border transition-colors justify-center",
                                (isOwner && canTempDelete)
                                    ? TASK_DETAIL_BUTTON_CLASSES.actions.deleteEnabled
                                    : TASK_DETAIL_BUTTON_CLASSES.actions.deleteDisabled)}
                            title={canTempDelete ? "Delete task" : "Delete available only within 5 min of creation"}
                            aria-label="Delete task">
                            <Trash2 className="h-5 w-5" />
                        </Button>
                        <Button type="button" variant="ghost" onClick={handleToggleSubtasksSection} disabled={!isOwner}
                            className={cn(activeRowActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.actions.toggleBase,
                                !isOwner
                                    ? TASK_DETAIL_BUTTON_CLASSES.actions.toggleDisabled
                                    : TASK_DETAIL_BUTTON_CLASSES.actions.addSubtask)}>
                            <span className="text-[13px] leading-none">Subtasks</span>
                            <span className="text-[13px] leading-none opacity-80">{completedSubtasksCount}/{subtasks.length}</span>
                        </Button>
                        <Button type="button" variant="ghost" onClick={handleToggleRemindersSection} disabled={!isOwner}
                            className={cn(activeRowActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.actions.toggleBase,
                                !isOwner
                                    ? TASK_DETAIL_BUTTON_CLASSES.actions.toggleDisabled
                                    : TASK_DETAIL_BUTTON_CLASSES.actions.addReminder)}>
                            <span className="text-[13px] leading-none">Reminders</span>
                            <span className="text-[13px] leading-none opacity-80">{reminders.length}</span>
                        </Button>
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
                                            <Button type="submit" onPointerDown={(e) => e.preventDefault()}
                                                disabled={!canManageActionChildren || isAddingSubtask}
                                                className={cn(uniformActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.actions.addSubtask)}>
                                                <Plus className="h-4 w-4" />
                                                Add Subtask
                                            </Button>
                                        </div>
                                    </form>
                                    {subtasks.length > 0 && (
                                        <div className="space-y-0.5">
                                            {subtasks.map((subtask) => {
                                                const isPending = pendingSubtaskIds.has(subtask.id);
                                                return (
                                                    <div key={subtask.id} className="flex items-center gap-3 px-1 py-1.5 rounded-lg hover:bg-slate-900/40 transition-colors group/sub">
                                                        <button type="button" disabled={!canManageActionChildren || isPending}
                                                            onClick={() => handleToggleSubtask(subtask.id)}
                                                            className={cn("h-5 w-5 rounded-full border flex items-center justify-center shrink-0 transition-all",
                                                                subtask.is_completed ? "border-emerald-500/50 bg-emerald-600/15 text-emerald-400" : "border-slate-700 text-transparent hover:border-slate-500",
                                                                (!canManageActionChildren || isPending) && "cursor-not-allowed opacity-40")}
                                                            style={subtask.is_completed ? { boxShadow: "0 0 6px rgba(52,211,153,0.25)" } : {}}>
                                                            {subtask.is_completed && <Check className="h-3 w-3" strokeWidth={3} />}
                                                        </button>
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
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                disabled={!canManageActionChildren || isPending}
                                                                onClick={() => startEditingSubtask(subtask.id, subtask.title)}
                                                                className={cn(
                                                                    "flex-1 min-w-0 text-left text-sm font-mono transition-colors py-0.5",
                                                                    subtask.is_completed ? "text-slate-600 line-through" : "text-slate-300",
                                                                    canManageActionChildren && !isPending && "hover:text-white cursor-text",
                                                                    (!canManageActionChildren || isPending) && "cursor-not-allowed"
                                                                )}
                                                                title={canManageActionChildren ? "Click to edit" : "Subtasks are locked"}
                                                            >
                                                                <span className="truncate block">{subtask.title}</span>
                                                            </button>
                                                        )}
                                                        <button type="button" disabled={!canManageActionChildren || isPending}
                                                            onClick={() => handleDeleteSubtask(subtask.id)}
                                                            className="h-6 w-6 flex items-center justify-center text-red-400 hover:text-red-300 transition-colors opacity-100 cursor-pointer"
                                                            aria-label="Delete subtask">
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </button>
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
                                            <Button type="submit" variant="outline"
                                                disabled={!canManageActionChildren || isActionPending("saveReminders") || !newReminderLocal.trim()}
                                                className={cn(uniformActionButtonClass, TASK_DETAIL_BUTTON_CLASSES.actions.addReminder)}>
                                                Add Reminder
                                            </Button>
                                        </div>
                                    </form>
                                    {reminders.length > 0 && (
                                        <div className="space-y-0.5">
                                            {reminders.map((reminder) => {
                                                const reminderDate = new Date(reminder.reminder_at);
                                                const reminderMs = reminderDate.getTime();
                                                const reminderIso = Number.isNaN(reminderMs) ? reminder.reminder_at : reminderDate.toISOString();
                                                const isPastReminder = Number.isNaN(reminderMs) || reminderMs <= nowMs;
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
                                                        ) : (
                                                            <button type="button"
                                                                disabled={!canManageActionChildren || isActionPending("saveReminders")}
                                                                onClick={() => void handleRemoveReminder(reminderIso)}
                                                                className="text-xs font-mono text-red-500/60 hover:text-red-400 transition-colors disabled:text-slate-700 disabled:cursor-not-allowed cursor-pointer">
                                                                Remove
                                                            </button>
                                                        )}
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
            </div>

            {/* Divider */}
            <div className="h-px bg-gradient-to-r from-transparent via-slate-800/80 to-transparent" />

            {/* ⑦ ACTIVITY LOG */}
            <div className="td-rise td-d5 space-y-4">
                <div className="mx-auto flex w-full max-w-2xl items-center gap-3">
                    <div className="h-px flex-1 bg-cyan-400/80 shadow-[0_0_6px_rgba(0,217,255,0.35)]" />
                    <span className="text-[10px] uppercase tracking-wider font-bold text-cyan-400">activity</span>
                    <div className="h-px flex-1 bg-cyan-400/80 shadow-[0_0_6px_rgba(0,217,255,0.35)]" />
                </div>
                {activitySteps.length === 0 ? (
                    <p className="text-center text-xs font-mono text-slate-700">No activity yet</p>
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
                                Choose a friend to review AI's decision
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                            {friendsLoading ? (
                                <p className="text-xs font-mono text-slate-600 py-4">Loading friends...</p>
                            ) : friends.length === 0 ? (
                                <p className="text-xs font-mono text-slate-600 py-4">No friends available</p>
                            ) : (
                                friends.map((friend) => (
                                    <button key={friend.id} onClick={() => handleEscalateToFriend(friend.id)} disabled={escalationPending}
                                        className="w-full text-left px-4 py-3 rounded-lg bg-slate-800/40 hover:bg-slate-800/70 border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer disabled:opacity-50">
                                        <div className="text-sm font-medium text-slate-200">{friend.username || friend.email}</div>
                                        {friend.username && <div className="text-xs font-mono text-slate-600">{friend.email}</div>}
                                    </button>
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

