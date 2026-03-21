"use client";

import { fireCompletionConfetti } from "@/lib/confetti";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
    addTaskSubtask,
    cancelRepetition,
    deleteTaskSubtask,
    finalizeTaskProofUpload,
    forceMajeureTask,
    initAwaitingVoucherProofUpload,
    markTaskCompleteWithProofIntent,
    ownerTempDeleteTask,
    postponeTask,
    removeAwaitingVoucherProof,
    replaceTaskReminders,
    revertTaskCompletionAfterProofFailure,
    undoTaskComplete,
    toggleTaskSubtask,
} from "@/actions/tasks";
import { escalateToHumanVoucher } from "@/actions/voucher";
import { Button } from "@/components/ui/button";
import { Camera, Check, ChevronDown, Plus, Repeat, Trash2, X } from "lucide-react";
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
import { HardRefreshButton } from "@/components/HardRefreshButton";
import { usePomodoro } from "@/components/PomodoroProvider";
import { canOwnerTemporarilyDelete } from "@/lib/task-delete-window";
import { MAX_SUBTASKS_PER_TASK } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { formatCurrencyFromCents, normalizeCurrency, type SupportedCurrency } from "@/lib/currency";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";
import { formatRecurrenceSummary } from "@/lib/recurrence-display";
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
}

interface TaskProofDraft {
    proof: PreparedTaskProof;
    previewUrl: string;
}

type RestoredTaskStatus = "CREATED" | "POSTPONED";

interface ProofUploadTarget {
    bucket: string;
    objectPath: string;
    uploadToken?: string;
}

type ProofPickerMode = "draft" | "awaiting-upload";

function getRestoredStatusFromRevertResult(
    result: Awaited<ReturnType<typeof revertTaskCompletionAfterProofFailure>>
): RestoredTaskStatus | null {
    if (!result || typeof result !== "object" || !("status" in result)) return null;
    const status = (result as { status?: unknown }).status;
    return status === "CREATED" || status === "POSTPONED" ? status : null;
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
    const [remindersSectionOpen, setRemindersSectionOpen] = useState(true);
    const [subtasksSectionOpen, setSubtasksSectionOpen] = useState(true);
    const [newReminderLocal, setNewReminderLocal] = useState("");
    const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
    const [subtaskError, setSubtaskError] = useState<string | null>(null);
    const [pendingSubtaskIds, setPendingSubtaskIds] = useState<Set<string>>(new Set());
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
    const shouldRestoreSubtaskInputFocusRef = useRef(false);

    const deadline = new Date(taskState.deadline);
    const isOverdue =
        deadline < new Date() &&
        !["COMPLETED", "FAILED", "RECTIFIED", "SETTLED", "AWAITING_USER"].includes(taskState.status);

    const userTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
    const canTempDelete = canOwnerTemporarilyDelete(taskState, nowMs);
    const isOwner = taskState.user_id === viewerId;
    const isSelfVouched = taskState.voucher_id === taskState.user_id;
    const requiresProofForCompletion =
        Boolean(taskState.requires_proof) &&
        !isSelfVouched;
    const isActiveParentTask = taskState.status === "CREATED" || taskState.status === "POSTPONED";
    const completedSubtasksCount = subtasks.filter((subtask) => subtask.is_completed).length;
    const incompleteSubtasksCount = subtasks.length - completedSubtasksCount;
    const totalPomoSeconds = pomoSummary?.totalSeconds || 0;
    const requiredPomoSeconds = (taskState.required_pomo_minutes || 0) * 60;
    const remainingRequiredPomoSeconds = Math.max(0, requiredPomoSeconds - totalPomoSeconds);
    const hasIncompletePomoRequirement =
        requiredPomoSeconds > 0 && remainingRequiredPomoSeconds > 0;
    const hasRunningPomoForTask = session?.status === "ACTIVE" && session.task_id === taskState.id;
    const canManageActionChildren = isOwner && isActiveParentTask;
    const ownerCurrency = normalizeCurrency(taskState.user?.currency ?? viewerCurrency);
    const formattedFailureCost = formatCurrencyFromCents(taskState.failure_cost_cents, ownerCurrency);

    // AI Voucher resubmit state
    const ORCA_ID = "00000000-0000-0000-0000-000000000001";
    const isAiVouched = taskState.voucher_id === ORCA_ID;
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
    const formatDateMmDdYyyy = (value: Date | string) =>
        new Date(value).toLocaleDateString("en-US", {
            month: "2-digit",
            day: "2-digit",
            year: "numeric",
        });
    const formatDateTimeMmDdYyyy24h = (value: Date | string) =>
        `${formatDateMmDdYyyy(value)} ${formatTime24h(value)}`;
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
    const canViewStoredProof =
        taskState.status === "AWAITING_VOUCHER" || taskState.status === "MARKED_COMPLETED" || taskState.status === "AWAITING_USER";
    const hasOpenProofRequest =
        Boolean(taskState.proof_request_open) &&
        (taskState.status === "AWAITING_VOUCHER" || taskState.status === "MARKED_COMPLETED");
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
            (taskState.status === "AWAITING_VOUCHER" || taskState.status === "AWAITING_USER") &&
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
        proofInputRef.current?.click();
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
        toast.success("Proof uploaded successfully.");
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
        toast.success("Proof uploaded successfully.");
        refreshInBackground();
    };

    const statusColors: Record<string, string> = {
        CREATED: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
        POSTPONED: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
        MARKED_COMPLETED: "bg-purple-500/20 text-purple-300 border border-purple-500/30",
        AWAITING_VOUCHER: "bg-purple-500/20 text-purple-300 border border-purple-500/30",
        AWAITING_USER: "bg-orange-500/20 text-orange-300 border border-orange-500/30",
        COMPLETED: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
        FAILED: "bg-red-500/20 text-red-300 border border-red-500/30",
        RECTIFIED: "bg-orange-500/20 text-orange-300 border border-orange-500/30",
        SETTLED: "bg-slate-600/40 text-slate-300 border border-slate-600/50",
    };
    const taskStatusLabel =
        taskState.status === "FAILED"
            ? (taskState.marked_completed_at ? "DENIED" : "FAILED")
            : taskState.status === "COMPLETED"
                ? (taskState.voucher_timeout_auto_accepted ? "VOUCHER DID NOT RESPOND" : "COMPLETED")
                : taskState.status === "SETTLED"
                    ? "FORCE MAJEURE"
                    : taskState.status.replace("_", " ");
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
                    status: isSelfVouched ? "COMPLETED" : "AWAITING_VOUCHER",
                    marked_completed_at: now.toISOString(),
                    voucher_response_deadline: isSelfVouched ? null : voucherResponseDeadline.toISOString(),
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
        if (!isOwner || taskState.status !== "AWAITING_VOUCHER") return;
        if (new Date() >= new Date(taskState.deadline)) {
            toast.error("Cannot undo completion after the deadline.");
            return;
        }

        setActionPending("undoComplete", true);
        const restoredStatus: "CREATED" | "POSTPONED" = taskState.postponed_at ? "POSTPONED" : "CREATED";
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
        if (!["AWAITING_VOUCHER", "MARKED_COMPLETED"].includes(taskState.status)) {
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

    async function handleForceMajeure() {
        if (isActionPending("forceMajeure")) return;
        if (!confirm("Are you sure? This uses your 1 monthly Force Majeure pass and will settle the task without failure cost.")) return;

        setActionPending("forceMajeure", true);
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
            runMutation: () => forceMajeureTask(taskState.id),
            rollback: (snapshot) => {
                setTaskState(snapshot.taskState);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        setActionPending("forceMajeure", false);
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
        router.push("/dashboard");
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

    const formatEventLabel = (event: TaskEvent) => {
        if (event.event_type === "POMO_COMPLETED") {
            const elapsedSeconds = getPomoElapsedSeconds(event);
            return `Focus session completed (${formatFocusTime(elapsedSeconds)})`;
        }
        if (event.event_type === "PROOF_REQUESTED") {
            return "Voucher requested proof";
        }
        if (event.event_type === "PROOF_REMOVED") {
            return "Proof removed";
        }
        if (event.event_type === "AI_APPROVE") {
            return "Orca approved";
        }
        if (event.event_type === "AI_DENY") {
            return "Orca denied";
        }
        return event.event_type.replace(/_/g, " ");
    };

    const formatEventTimestamp = (event: TaskEvent) => {
        if (event.event_type !== "POMO_COMPLETED") {
            return formatDateTimeDdMmYy(event.created_at);
        }

        const elapsedSeconds = getPomoElapsedSeconds(event);
        const endDate = new Date(event.created_at);
        if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || Number.isNaN(endDate.getTime())) {
            return formatDateTimeDdMmYy(event.created_at);
        }

        const startDate = new Date(endDate.getTime() - elapsedSeconds * 1000);
        const startDay = formatDateDdMmYy(startDate);
        const endDay = formatDateDdMmYy(endDate);

        if (startDay === endDay) {
            return `${endDay} ${formatTime24h(startDate)} to ${formatTime24h(endDate)}`;
        }

        return `${startDay} ${formatTime24h(startDate)} to ${endDay} ${formatTime24h(endDate)}`;
    };

    const visibleEvents = useMemo(() => {
        const seenSessionIds = new Set<string>();
        return events.filter((event) => {
            if (event.event_type !== "POMO_COMPLETED") return true;
            const sessionIdRaw = event.metadata?.session_id;
            const sessionId = typeof sessionIdRaw === "string" ? sessionIdRaw : "";
            if (!sessionId) return true;
            if (seenSessionIds.has(sessionId)) return false;
            seenSessionIds.add(sessionId);
            return true;
        });
    }, [events]);

    return (
        <div className="max-w-3xl mx-auto space-y-6 px-4 md:px-0">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        {taskState.title}
                        {taskState.recurrence_rule_id && (
                            <Repeat className="h-5 w-5 text-slate-500 shrink-0" />
                        )}
                    </h1>
                    {recurrenceSummary && (
                        <p className="mt-2 text-sm text-slate-400">{recurrenceSummary}</p>
                    )}
                    {iterationNumber !== null && (
                        <div className="mt-3 space-y-0.5">
                            <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Iteration</p>
                            <p className="text-2xl font-light text-orange-400 drop-shadow-[0_0_8px_rgba(251,146,60,0.6)]">
                                #{iterationNumber}
                            </p>
                        </div>
                    )}
                </div>
                <HardRefreshButton />
            </div>

            <input
                ref={proofInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={handleProofInputChange}
            />

            <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                    <CardTitle className="text-white">Task Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">Task State</p>
                            <div className="mt-2">
                                <Badge className={statusColors[taskState.status]}>{taskStatusLabel}</Badge>
                            </div>
                        </div>
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">Voucher</p>
                            <p className="mt-2 text-white font-medium">{taskState.voucher?.username || "Unassigned"}</p>
                        </div>
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">Deadline</p>
                            <p className={`mt-2 text-lg font-medium ${isOverdue ? "text-red-400" : "text-white"}`}>
                                {formatDateTimeDdMmYy(deadline)}
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">Hedge</p>
                            <p className="mt-2 text-lg font-medium text-pink-400">
                                {formattedFailureCost}
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">Time Spent</p>
                            <p className="mt-2 text-lg font-medium text-cyan-300">
                                {formatFocusTime(totalPomoSeconds)}
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">Proof</p>
                            <p className="mt-2 text-white font-medium">{proofSummary}</p>
                        </div>
                        {googleSyncDirectionLabel && (
                            <div>
                                <p className="text-[11px] uppercase tracking-wide text-slate-400">Google Sync</p>
                                <p className={`mt-2 font-medium ${googleSyncDirectionClassName}`}>
                                    {googleSyncDirectionLabel}
                                </p>
                            </div>
                        )}
                    </div>

                    {taskState.description && (
                        <div>
                            <p className="text-sm text-slate-400">Description</p>
                            <p className="text-white">{taskState.description}</p>
                        </div>
                    )}

                    {taskState.postponed_at && (
                        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                            <p className="text-sm text-amber-300">
                                Postponed once on {formatDateTimeDdMmYy(taskState.postponed_at)} to {formatDateTimeMmDdYyyy24h(taskState.deadline)}
                            </p>
                        </div>
                    )}

                    {taskState.voucher_response_deadline && (taskState.status === "AWAITING_VOUCHER" || taskState.status === "MARKED_COMPLETED") && (
                        <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
                            <p className="text-sm text-purple-300">
                                Voucher must respond before {voucherDeadlineForDisplay ? formatDateTimeDdMmYy(voucherDeadlineForDisplay) : formatDateTimeDdMmYy(taskState.voucher_response_deadline)}
                            </p>
                        </div>
                    )}

                    {storedProof && storedProofSrc && (
                        <div className="p-3 rounded-lg border border-slate-700 bg-slate-950/40 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-xs text-slate-300 uppercase tracking-wider font-mono">
                                    Completion proof ({storedProof.media_kind})
                                </p>
                                {isOwner && ["AWAITING_VOUCHER", "MARKED_COMPLETED"].includes(taskState.status) && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={handleRemoveStoredProof}
                                        disabled={isActionPending("removeStoredProof")}
                                        className="h-7 px-2 text-[11px] text-red-300 hover:text-red-200 hover:bg-red-950/40"
                                    >
                                        Remove proof
                                    </Button>
                                )}
                            </div>
                            <ProofMedia
                                mediaKind={storedProof.media_kind}
                                src={storedProofSrc}
                                alt="Completion proof"
                                overlayTimestampText={storedProof.overlay_timestamp_text}
                                imageClassName="max-h-64 rounded-md object-cover cursor-zoom-in"
                                videoClassName="max-h-64 rounded-md cursor-zoom-in"
                                imageProps={{
                                    loading: "lazy",
                                    onClick: () => setIsStoredProofFullscreen(true),
                                }}
                                videoProps={{
                                    controls: true,
                                    preload: "metadata",
                                    onClick: () => setIsStoredProofFullscreen(true),
                                }}
                            />
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                    <CardTitle className="text-white">Actions</CardTitle>
                    <CardDescription className="text-slate-400">
                        Available actions for this task
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {isOwner && (
                        <div className="space-y-3">
                            <div>
                                <button
                                    type="button"
                                    onClick={() => setRemindersSectionOpen((prev) => !prev)}
                                    className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-900/50"
                                    aria-expanded={remindersSectionOpen}
                                >
                                    <span className="text-sm font-medium text-slate-100">Reminders</span>
                                    <span className="flex items-center gap-2">
                                        <span className="text-xs text-slate-400">{reminders.length}</span>
                                        <ChevronDown
                                            className={cn(
                                                "h-4 w-4 text-slate-400 transition-transform",
                                                remindersSectionOpen && "rotate-180"
                                            )}
                                        />
                                    </span>
                                </button>
                                {remindersSectionOpen && (
                                    <div className="space-y-3 px-3 pb-3">
                                        <form onSubmit={handleAddReminder}>
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    type="datetime-local"
                                                    value={newReminderLocal}
                                                    onChange={(e) => setNewReminderLocal(e.target.value)}
                                                    disabled={!canManageActionChildren || isActionPending("saveReminders")}
                                                    className={cn(
                                                        "bg-slate-800/70 border-slate-600 text-white [color-scheme:dark]",
                                                        (!canManageActionChildren || isActionPending("saveReminders")) &&
                                                        "cursor-not-allowed border-slate-800 bg-slate-900/50 text-slate-500"
                                                    )}
                                                />
                                                <Button
                                                    type="submit"
                                                    variant="outline"
                                                    disabled={
                                                        !canManageActionChildren ||
                                                        isActionPending("saveReminders") ||
                                                        !newReminderLocal.trim()
                                                    }
                                                    className="bg-slate-800/80 border-slate-600 text-slate-100 hover:bg-slate-700/80 disabled:opacity-100 disabled:border-slate-800 disabled:bg-slate-900/50 disabled:text-slate-500"
                                                >
                                                    Add
                                                </Button>
                                            </div>
                                        </form>

                                        {reminders.length > 0 && (
                                            <div className="space-y-1.5 rounded-md border border-slate-800 bg-slate-950/40 p-2">
                                                {reminders.map((reminder) => {
                                                    const reminderDate = new Date(reminder.reminder_at);
                                                    const reminderMs = reminderDate.getTime();
                                                    const reminderIso = Number.isNaN(reminderMs)
                                                        ? reminder.reminder_at
                                                        : reminderDate.toISOString();
                                                    const isPastReminder = Number.isNaN(reminderMs) || reminderMs <= nowMs;
                                                    const notifiedAtMs = reminder.notified_at
                                                        ? new Date(reminder.notified_at).getTime()
                                                        : Number.NaN;
                                                    const createdAtMs = new Date(reminder.created_at).getTime();
                                                    const showPastForSeededHistory =
                                                        isDefaultDeadlineReminderSource(reminder.source) &&
                                                        !Number.isNaN(notifiedAtMs) &&
                                                        !Number.isNaN(createdAtMs) &&
                                                        createdAtMs === notifiedAtMs;
                                                    const pastReminderLabel = showPastForSeededHistory
                                                        ? "Past"
                                                        : (reminder.notified_at ? "Sent" : "Past");
                                                    return (
                                                        <div key={reminder.id} className="flex items-center justify-between gap-2">
                                                            <span className="text-xs text-slate-300">
                                                                {Number.isNaN(reminderMs)
                                                                    ? reminder.reminder_at
                                                                    : formatDateTimeDdMmYy(reminderIso)}
                                                            </span>
                                                            {isPastReminder ? (
                                                                <span className="text-[11px] uppercase tracking-wide text-slate-500">
                                                                    {pastReminderLabel}
                                                                </span>
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    disabled={!canManageActionChildren || isActionPending("saveReminders")}
                                                                    onClick={() => void handleRemoveReminder(reminderIso)}
                                                                    className={cn(
                                                                        "text-xs text-red-300 hover:text-red-200",
                                                                        (!canManageActionChildren || isActionPending("saveReminders")) &&
                                                                        "cursor-not-allowed text-slate-500 hover:text-slate-500"
                                                                    )}
                                                                >
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

                            <div>
                                <button
                                    type="button"
                                    onClick={() => setSubtasksSectionOpen((prev) => !prev)}
                                    className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-900/50"
                                    aria-expanded={subtasksSectionOpen}
                                >
                                    <span className="text-sm font-medium text-slate-100">Subtasks</span>
                                    <span className="flex items-center gap-2 text-xs text-slate-400">
                                        {completedSubtasksCount}/{subtasks.length} completed
                                        <ChevronDown
                                            className={cn(
                                                "h-4 w-4 transition-transform",
                                                subtasksSectionOpen && "rotate-180"
                                            )}
                                        />
                                    </span>
                                </button>
                                {subtasksSectionOpen && (
                                    <div className="space-y-3 px-3 pb-3">
                                        {subtasks.length > 0 && (
                                            <div className="ml-3 space-y-2 border-l border-slate-800/80 pl-3">
                                                {subtasks.map((subtask) => {
                                                    const isPending = pendingSubtaskIds.has(subtask.id);
                                                    return (
                                                        <div key={subtask.id} className="flex items-center gap-2">
                                                            <button
                                                                type="button"
                                                                disabled={!canManageActionChildren || isPending}
                                                                onClick={() => handleToggleSubtask(subtask.id)}
                                                                className={cn(
                                                                    "h-5 w-5 rounded-full border flex items-center justify-center",
                                                                    subtask.is_completed
                                                                        ? "bg-emerald-600/20 border-emerald-500/40 text-emerald-300"
                                                                        : "border-slate-600 text-transparent",
                                                                    (!canManageActionChildren || isPending) && "cursor-not-allowed opacity-60"
                                                                )}
                                                                title={canManageActionChildren ? "Toggle subtask" : "Subtasks are locked in this status"}
                                                            >
                                                                {subtask.is_completed && <Check className="h-3 w-3" strokeWidth={3} />}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={!canManageActionChildren || isPending}
                                                                onClick={() => handleToggleSubtask(subtask.id)}
                                                                className={cn(
                                                                    "flex-1 min-w-0 text-left text-sm",
                                                                    subtask.is_completed ? "text-slate-500 line-through" : "text-slate-200",
                                                                    (!canManageActionChildren || isPending) && "cursor-not-allowed"
                                                                )}
                                                                title={subtask.title}
                                                            >
                                                                <span className="truncate block">{subtask.title}</span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={!canManageActionChildren || isPending}
                                                                onClick={() => handleDeleteSubtask(subtask.id)}
                                                                className={cn(
                                                                    "h-7 w-7 rounded border border-red-500/30 text-red-400 flex items-center justify-center hover:bg-red-500/10",
                                                                    (!canManageActionChildren || isPending) && "cursor-not-allowed opacity-60 hover:bg-transparent"
                                                                )}
                                                                title={canManageActionChildren ? "Delete subtask" : "Subtasks are locked in this status"}
                                                                aria-label="Delete subtask"
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        <form onSubmit={handleAddSubtask}>
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    ref={newSubtaskInputRef}
                                                    value={newSubtaskTitle}
                                                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                                                    placeholder="e.g., draft intro paragraph"
                                                    maxLength={500}
                                                    className={cn(
                                                        "bg-slate-900/60 border-slate-700 text-slate-200",
                                                        !canManageActionChildren && "border-slate-800 text-slate-500 bg-slate-900/50 cursor-not-allowed"
                                                    )}
                                                    disabled={
                                                        !canManageActionChildren ||
                                                        isAddingSubtask
                                                    }
                                                />
                                                <Button
                                                    type="submit"
                                                    size="sm"
                                                    onPointerDown={(e) => e.preventDefault()}
                                                    disabled={
                                                        !canManageActionChildren ||
                                                        isAddingSubtask
                                                    }
                                                    className="bg-slate-200/10 border border-slate-600 text-slate-200 hover:bg-slate-200/20 disabled:opacity-100 disabled:border-slate-800 disabled:bg-slate-900/50 disabled:text-slate-500"
                                                >
                                                    <Plus className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </form>

                                        {subtaskError && (
                                            <p className="text-xs text-red-400">{subtaskError}</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {isOwner && isActiveParentTask && potentialRp !== null && potentialRp > 0 && (
                        <p
                            className="text-xs font-mono"
                            style={{ color: "rgba(251,146,60,0.85)" }}
                        >
                            You may earn +{potentialRp} RP
                        </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                        {(taskState.status === "CREATED" || taskState.status === "POSTPONED") && (
                            <>
                                <PomoButton
                                    taskId={taskState.id}
                                    variant="full"
                                    className="shrink-0"
                                    defaultDurationMinutes={defaultPomoDurationMinutes}
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => openProofPicker("draft")}
                                    disabled={isActionPending("markComplete")}
                                    className={cn(
                                        "h-9 w-9 p-0 border",
                                        proofDraft
                                            ? "text-blue-300 border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20"
                                            : "text-slate-300 border-slate-700/80 hover:text-white hover:bg-slate-800"
                                    )}
                                    title={proofDraft ? "Proof attached" : (requiresProofForCompletion ? "Attach proof (required)" : "Attach proof (optional)")}
                                    aria-label="Attach proof"
                                >
                                    <Camera className="h-4 w-4" />
                                </Button>
                                <Button
                                    onClick={handleMarkComplete}
                                    disabled={isActionPending("markComplete") || isOverdue || incompleteSubtasksCount > 0 || hasIncompletePomoRequirement || hasRunningPomoForTask}
                                    className={cn(
                                        "h-9 border text-emerald-300",
                                        (incompleteSubtasksCount > 0 || hasIncompletePomoRequirement || hasRunningPomoForTask)
                                            ? "bg-slate-800/50 border-slate-700/60 text-slate-500 cursor-not-allowed"
                                            : "bg-emerald-600/20 hover:bg-emerald-600/30 border-emerald-500/40"
                                    )}
                                >
                                    Mark Complete
                                </Button>

                                {proofDraft && (
                                    <div className="w-full rounded-lg border border-blue-500/20 bg-blue-950/20 p-3">
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                            <p className="text-xs text-blue-200 uppercase tracking-wider font-mono">
                                                Proof attached ({proofDraft.proof.mediaKind})
                                            </p>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="h-7 px-2 text-[11px] text-blue-200 hover:text-white hover:bg-blue-900/30"
                                                onClick={() => setTaskProofDraft(null)}
                                            >
                                                Remove
                                            </Button>
                                        </div>
                                        <ProofMedia
                                            mediaKind={proofDraft.proof.mediaKind}
                                            src={proofDraft.previewUrl}
                                            alt="Selected proof"
                                            overlayTimestampText={proofDraft.proof.overlayTimestampText}
                                            imageClassName="max-h-44 rounded-md object-cover"
                                            videoClassName="max-h-44 rounded-md"
                                            videoProps={{
                                                controls: true,
                                                preload: "metadata",
                                            }}
                                        />
                                    </div>
                                )}

                                {proofUploadError && (
                                    <div className="w-full rounded-lg border border-red-900/60 bg-red-950/30 p-3">
                                        <p className="text-sm text-red-300">{proofUploadError}</p>
                                    </div>
                                )}

                                {taskState.status === "CREATED" && !taskState.postponed_at && !isOverdue && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => setIsPostponeDialogOpen(true)}
                                        disabled={isActionPending("postpone")}
                                        className="h-9 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 disabled:opacity-60"
                                    >
                                        {isActionPending("postpone") ? "Postponing..." : "Postpone deadline (1x only)"}
                                    </Button>
                                )}

                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={handleTempDelete}
                                    disabled={isActionPending("tempDelete") || !canTempDelete}
                                    className={canTempDelete
                                        ? "h-9 w-9 p-0 bg-red-950/30 text-red-400 border border-red-900/50 hover:bg-red-900/40 hover:text-red-300"
                                        : "h-9 w-9 p-0 bg-slate-800/50 text-slate-500 border border-slate-700/60 cursor-not-allowed"}
                                    title={canTempDelete
                                        ? "Delete task (available for 5 minutes after creation)"
                                        : "Delete available only within 5 minutes of creation"}
                                    aria-label="Delete task"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </>
                        )}

                        {(taskState.status === "CREATED" || taskState.status === "POSTPONED") && incompleteSubtasksCount > 0 && (
                            <div className="w-full p-3 rounded-lg bg-slate-800/40 border border-slate-700/70">
                                <p className="text-sm text-slate-300">
                                    Complete all subtasks to enable parent completion ({completedSubtasksCount}/{subtasks.length}).
                                </p>
                            </div>
                        )}

                        {(taskState.status === "CREATED" || taskState.status === "POSTPONED") && hasIncompletePomoRequirement && (
                            <div className="w-full p-3 rounded-lg bg-slate-800/40 border border-slate-700/70">
                                <p className="text-sm text-slate-300">
                                    Log {formatFocusTime(remainingRequiredPomoSeconds)} more focus time to enable parent completion ({formatFocusTime(totalPomoSeconds)}/{taskState.required_pomo_minutes}m).
                                </p>
                            </div>
                        )}

                        {(taskState.status === "CREATED" || taskState.status === "POSTPONED") && hasRunningPomoForTask && (
                            <div className="w-full p-3 rounded-lg bg-slate-800/40 border border-slate-700/70">
                                <p className="text-sm text-slate-300">
                                    Stop the running pomodoro to enable parent completion.
                                </p>
                            </div>
                        )}

                        {taskState.status === "FAILED" && (
                            <div className="flex gap-2 flex-wrap">
                                {taskState.voucher_id === "00000000-0000-0000-0000-000000000001" && taskState.marked_completed_at && (
                                    <Button
                                        variant="ghost"
                                        onClick={() => {
                                            if (!friends.length && !friendsLoading) {
                                                loadFriendsForEscalation();
                                            }
                                            setShowEscalationPicker(true);
                                        }}
                                        disabled={escalationPending}
                                        className="bg-blue-800/40 border border-blue-700 text-blue-300 hover:text-blue-100 hover:bg-blue-700/40"
                                    >
                                        Escalate to Friend
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    onClick={handleForceMajeure}
                                    disabled={isActionPending("forceMajeure")}
                                    className="bg-slate-800/40 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700/40"
                                >
                                    Use Force Majeure
                                </Button>
                            </div>
                        )}

                        {(taskState.recurrence_rule_id || isRepetitionStopped) && (
                            <Button
                                variant="destructive"
                                onClick={handleCancelRepetition}
                                disabled={isActionPending("cancelRepetition") || isRepetitionStopped}
                                className={isRepetitionStopped
                                    ? "bg-slate-800/50 text-slate-500 border border-slate-700/60 cursor-not-allowed"
                                    : "bg-red-950/30 text-red-400 border border-red-900/50 hover:bg-red-900/40"}
                            >
                                <Repeat className="mr-2 h-4 w-4" />
                                {isRepetitionStopped ? "Repetition Stopped" : "Stop Future Repetitions"}
                            </Button>
                        )}

                        {taskState.status === "AWAITING_VOUCHER" && (
                            <div className="w-full p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 space-y-3">
                                <p className="text-slate-300">Waiting for voucher response...</p>
                                {hasOpenProofRequest && (
                                    <p className="text-amber-300 text-sm">
                                        {proofRequestedByLabel} has asked for proof.
                                    </p>
                                )}
                                <div className="flex flex-wrap items-center gap-3">
                                    {isOwner && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => openProofPicker("awaiting-upload")}
                                            disabled={isActionPending("awaitingProofUpload")}
                                            className="bg-slate-800/60 border-slate-600 text-slate-200 hover:bg-slate-700/60"
                                        >
                                            {storedProof ? "Replace Proof" : "Add Proof"}
                                        </Button>
                                    )}
                                    {isOwner && !isOverdue && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={handleUndoComplete}
                                            disabled={isActionPending("undoComplete")}
                                            className="bg-slate-800/60 border-slate-600 text-slate-200 hover:bg-slate-700/60"
                                        >
                                            Undo Complete
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}

                        {taskState.status === "AWAITING_VOUCHER" && proofDraft && (
                            <div className="w-full rounded-lg border border-blue-500/20 bg-blue-950/20 p-3">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <p className="text-xs text-blue-200 uppercase tracking-wider font-mono">
                                        Ready to upload ({proofDraft.proof.mediaKind})
                                    </p>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-7 px-2 text-[11px] text-blue-200 hover:text-white hover:bg-blue-900/30"
                                        onClick={() => setTaskProofDraft(null)}
                                    >
                                        Remove
                                    </Button>
                                </div>
                                <ProofMedia
                                    mediaKind={proofDraft.proof.mediaKind}
                                    src={proofDraft.previewUrl}
                                    alt="Selected proof"
                                    overlayTimestampText={proofDraft.proof.overlayTimestampText}
                                    imageClassName="max-h-44 rounded-md object-cover"
                                    videoClassName="max-h-44 rounded-md"
                                    videoProps={{
                                        controls: true,
                                        preload: "metadata",
                                    }}
                                />
                            </div>
                        )}

                        {taskState.status === "AWAITING_VOUCHER" && proofUploadError && (
                            <div className="w-full rounded-lg border border-red-900/60 bg-red-950/30 p-3">
                                <p className="text-sm text-red-300">{proofUploadError}</p>
                            </div>
                        )}

                        {taskState.status === "AWAITING_USER" && isAiVouched && (
                            <div className="space-y-3">
                                {latestDenial && (
                                    <div className="w-full p-3 rounded-lg bg-orange-500/10 border border-orange-500/30">
                                        <div className="flex justify-between items-start gap-2 mb-2">
                                            <p className="text-sm font-semibold text-orange-300">
                                                Proof Denied (Attempt {latestDenial.attempt_number}/3)
                                            </p>
                                        </div>
                                        <p className="text-sm text-orange-200">{latestDenial.reason}</p>
                                    </div>
                                )}

                                {denials.length > 1 && (
                                    <details className="w-full">
                                        <summary className="cursor-pointer text-sm text-orange-300 hover:text-orange-200 font-medium">
                                            View all denial reasons ({denials.length})
                                        </summary>
                                        <div className="mt-2 space-y-2 ml-2 border-l border-orange-500/30 pl-3">
                                            {denials.map((denial) => (
                                                <div key={denial.id} className="text-xs">
                                                    <p className="text-orange-300 font-mono">Attempt {denial.attempt_number}:</p>
                                                    <p className="text-orange-200">{denial.reason}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </details>
                                )}

                                <div className="flex flex-wrap gap-2">
                                    {canResubmit && isOwner && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => openProofPicker("awaiting-upload")}
                                            disabled={isActionPending("awaitingProofUpload")}
                                            className="bg-orange-800/40 border-orange-600 text-orange-300 hover:bg-orange-700/40 hover:text-orange-100"
                                        >
                                            <Camera className="mr-2 h-4 w-4" />
                                            Upload New Proof
                                        </Button>
                                    )}
                                    {isOwner && (
                                        <Button
                                            variant="ghost"
                                            onClick={() => {
                                                if (!friends.length && !friendsLoading) {
                                                    loadFriendsForEscalation();
                                                }
                                                setShowEscalationPicker(true);
                                            }}
                                            disabled={escalationPending}
                                            className="bg-blue-800/40 border border-blue-700 text-blue-300 hover:text-blue-100 hover:bg-blue-700/40"
                                        >
                                            Escalate to Friend
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}

                        {taskState.status === "COMPLETED" && (
                            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 w-full">
                                <p className="text-green-300">Task completed successfully.</p>
                            </div>
                        )}

                        {taskState.status === "FAILED" && (
                            <div className="space-y-3">
                                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 w-full">
                                    <p className="text-red-300">
                                        {taskState.marked_completed_at
                                            ? (isAiVouched && latestDenial?.reason
                                                ? `Denied by AI voucher: ${latestDenial.reason}`
                                                : "Denied by voucher.")
                                            : "Deadline missed. Failure cost:"} {formattedFailureCost} added to ledger.
                                    </p>
                                </div>
                                {isAiVouched && denials.length > 0 && (
                                    <div className="w-full p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                                        <p className="text-sm font-semibold text-red-300 mb-2">AI Voucher Denial History</p>
                                        <div className="space-y-2">
                                            {denials.map((denial) => (
                                                <div key={denial.id} className="text-xs">
                                                    <p className="text-red-300 font-mono">Attempt {denial.attempt_number}:</p>
                                                    <p className="text-red-200">{denial.reason}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                    <CardTitle className="text-white">Activity Log</CardTitle>
                </CardHeader>
                <CardContent>
                    {visibleEvents.length === 0 ? (
                        <p className="text-slate-400">No activity yet</p>
                    ) : (
                        <div className="space-y-3">
                            {visibleEvents.map((event) => (
                                <div key={event.id} className="flex items-start gap-3">
                                    <div className="h-2 w-2 rounded-full bg-purple-500 mt-2" />
                                    <div>
                                        <p className="text-white text-sm">
                                            {formatEventLabel(event)}
                                        </p>
                                        {(event.event_type === "AI_APPROVE" || event.event_type === "AI_DENY") && (() => {
                                            const aiEventIndex = visibleEvents.filter((e, i) => i <= visibleEvents.indexOf(event) && (e.event_type === "AI_APPROVE" || e.event_type === "AI_DENY")).length - 1;
                                            const vouch = aiVouches[aiEventIndex];
                                            return vouch?.reason ? (
                                                <p className={`text-xs mt-0.5 ${event.event_type === "AI_APPROVE" ? "text-green-400" : "text-red-400"}`}>
                                                    {vouch.reason}
                                                </p>
                                            ) : null;
                                        })()}
                                        <p className="text-xs text-slate-500">
                                            {formatEventTimestamp(event)}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <PostponeDeadlineDialog
                open={isPostponeDialogOpen}
                onOpenChange={setIsPostponeDialogOpen}
                currentDeadlineIso={taskState.deadline}
                isSubmitting={isActionPending("postpone")}
                onConfirm={(newDeadlineIso) => handlePostpone(newDeadlineIso)}
            />

            {isStoredProofFullscreen && storedProof && storedProofSrc && (
                <div
                    className="fixed inset-0 z-[100] bg-black/95 p-3 md:p-6 flex items-center justify-center"
                    onClick={() => setIsStoredProofFullscreen(false)}
                >
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            setIsStoredProofFullscreen(false);
                        }}
                        className="absolute top-3 right-3 md:top-5 md:right-5 h-9 w-9 rounded-full bg-slate-900/80 border border-slate-700 text-slate-200 hover:text-white"
                        aria-label="Close fullscreen proof"
                        title="Close"
                    >
                        <X className="h-4 w-4 mx-auto" />
                    </button>

                    <ProofMedia
                        mediaKind={storedProof.media_kind}
                        src={storedProofSrc}
                        alt="Completion proof fullscreen"
                        overlayTimestampText={storedProof.overlay_timestamp_text}
                        imageClassName="max-h-[95vh] max-w-[95vw] object-contain rounded-md"
                        videoClassName="max-h-[95vh] max-w-[95vw] rounded-md"
                        imageProps={{
                            onClick: (event) => event.stopPropagation(),
                        }}
                        videoProps={{
                            controls: true,
                            autoPlay: true,
                            preload: "auto",
                            onClick: (event) => event.stopPropagation(),
                        }}
                    />
                </div>
            )}

            {showEscalationPicker && (
                <Dialog open={showEscalationPicker} onOpenChange={setShowEscalationPicker}>
                    <DialogContent className="bg-slate-900 border-slate-800 text-slate-300">
                        <DialogHeader>
                            <DialogTitle>Escalate to a Friend</DialogTitle>
                            <DialogDescription>Choose a friend to review the Orca's decision</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                            {friendsLoading ? (
                                <p className="text-slate-400 text-sm py-4">Loading friends...</p>
                            ) : friends.length === 0 ? (
                                <p className="text-slate-400 text-sm py-4">No friends available to escalate to</p>
                            ) : (
                                friends.map((friend) => (
                                    <button
                                        key={friend.id}
                                        onClick={() => handleEscalateToFriend(friend.id)}
                                        disabled={escalationPending}
                                        className="w-full text-left p-3 rounded-lg bg-slate-800/40 hover:bg-slate-800/60 border border-slate-700 text-slate-300 hover:text-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <div className="font-medium">{friend.username || friend.email}</div>
                                        {friend.username && <div className="text-xs text-slate-400">{friend.email}</div>}
                                    </button>
                                ))
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}
