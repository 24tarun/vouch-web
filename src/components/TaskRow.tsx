"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addTaskSubtask, deleteTaskSubtask, renameTaskSubtask, toggleTaskSubtask } from "@/actions/tasks";
import type { Task } from "@/lib/types";
import { Camera, Check, ChevronDown, ChevronRight, ExternalLink, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "./ui/button";
import { PomoButton } from "./ui/PomoButton";
import { usePomodoro } from "@/components/PomodoroProvider";
import { cn } from "@/lib/utils";
import { canOwnerTemporarilyDelete } from "@/lib/task-delete-window";
import { runOptimisticMutation } from "@/lib/ui/runOptimisticMutation";
import { DEFAULT_POMO_DURATION_MINUTES } from "@/lib/constants";
import { normalizePomoDurationMinutes } from "@/lib/pomodoro";
import { RecurringIndicator } from "@/components/tasks/RecurringIndicator";
import {
    buildBeforeStartSubmissionMessage,
    getTaskSubmissionWindowState,
} from "@/lib/task-submission-window";

interface TaskRowProps {
    task: Task;
    onComplete?: (task: Task) => void;
    isCompleting?: boolean;
    onAttachProof?: (task: Task) => void;
    hasProofAttached?: boolean;
    proofUploadError?: string | null;
    onPostpone?: (task: Task) => void;
    isPostponing?: boolean;
    defaultPomoDurationMinutes?: number;
    onDelete?: (task: Task) => void;
    isDeleting?: boolean;
    layoutVariant?: "active" | "completed";
}

const PREFETCH_STATUSES = new Set(["ACTIVE", "POSTPONED", "MARKED_COMPLETE", "AWAITING_VOUCHER", "AWAITING_ORCA", "AWAITING_USER"]);

export function TaskRow({
    task,
    onComplete,
    isCompleting = false,
    onAttachProof,
    hasProofAttached = false,
    proofUploadError = null,
    onPostpone,
    isPostponing = false,
    defaultPomoDurationMinutes = DEFAULT_POMO_DURATION_MINUTES,
    onDelete,
    isDeleting = false,
    layoutVariant = "active",
}: TaskRowProps) {
    const router = useRouter();
    const { session } = usePomodoro();
    const hasPrefetchedRef = useRef(false);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [subtasks, setSubtasks] = useState(task.subtasks || []);
    const [subtaskPendingIds, setSubtaskPendingIds] = useState<Set<string>>(new Set());
    const [isExpanded, setIsExpanded] = useState(false);
    const [isMobileTrayOpen, setIsMobileTrayOpen] = useState(false);
    const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
    const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
    const [editingSubtaskTitle, setEditingSubtaskTitle] = useState("");
    const newSubtaskInputRef = useRef<HTMLInputElement>(null);

    const isActuallyCompleted = useMemo(
        () =>
            [
                "MARKED_COMPLETE",
                "AWAITING_VOUCHER",
                "AWAITING_ORCA",
                "AWAITING_USER",
                "ACCEPTED",
                "AUTO_ACCEPTED",
                "ORCA_ACCEPTED",
                "DENIED",
                "MISSED",
                "RECTIFIED",
                "SETTLED",
                "DELETED",
            ].includes(task.status),
        [task.status]
    );
    const deadline = new Date(task.deadline);
    const deadlineLabel = useMemo(() => {
        if (Number.isNaN(deadline.getTime())) return "Invalid date";
        return `${deadline.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        })} ${deadline.toLocaleDateString("en-GB", { day: "2-digit" })} ${deadline
            .toLocaleDateString("en-GB", { month: "short" })
            .toLowerCase()}`;
    }, [task.deadline]);
    const submissionWindow = useMemo(
        () => getTaskSubmissionWindowState({
            startAtIso: task.google_event_start_at ?? null,
            deadlineIso: task.deadline,
            now: new Date(nowMs),
        }),
        [nowMs, task.deadline, task.google_event_start_at]
    );
    const isOverdue = submissionWindow.pastDeadline && !isActuallyCompleted;
    const isBeforeStart = submissionWindow.beforeStart && !isActuallyCompleted;
    const beforeStartMessage = buildBeforeStartSubmissionMessage(submissionWindow.startDate);
    const isTempTask = task.id.startsWith("temp-");
    const isParentActive = ["ACTIVE", "POSTPONED"].includes(task.status);
    const hasSubtasks = subtasks.length > 0;
    const completedSubtasksCount = subtasks.filter((subtask) => subtask.is_completed).length;
    const hasIncompleteSubtasks = subtasks.some((subtask) => !subtask.is_completed);
    const requiredPomoSeconds = (task.required_pomo_minutes || 0) * 60;
    const pomoTotalSeconds = task.pomo_total_seconds || 0;
    const hasIncompletePomoRequirement =
        requiredPomoSeconds > 0 && pomoTotalSeconds < requiredPomoSeconds;
    const isSelfVouched = task.voucher_id === task.user_id;
    const requiresProofForCompletion =
        Boolean(task.requires_proof) &&
        !isSelfVouched;
    const hasRunningPomoForTask = session?.status === "ACTIVE" && session.task_id === task.id;
    const disabledCompleteTitle = hasIncompleteSubtasks
        ? "Complete all subtasks first"
        : hasRunningPomoForTask
            ? "Stop the running pomodoro first"
            : hasIncompletePomoRequirement
                ? `Log ${Math.ceil((requiredPomoSeconds - pomoTotalSeconds) / 60)} more focus minute(s) first`
                : isBeforeStart
                    ? beforeStartMessage
                : "Mark complete";
    const canEditSubtasks = isParentActive && !isTempTask;
    const canDeleteWindowOpen = canOwnerTemporarilyDelete(task, nowMs);
    const canDelete = Boolean(
        onDelete &&
        !isTempTask &&
        canDeleteWindowOpen
    );
    const canDeleteButtonBeShown = Boolean(onDelete && isParentActive);
    const canAttachProof = Boolean(onAttachProof && !isActuallyCompleted && !isOverdue);
    const canPostpone = Boolean(
        onPostpone &&
        !isTempTask &&
        task.status === "ACTIVE" &&
        !task.postponed_at &&
        !isOverdue &&
        !isPostponing
    );
    const normalizedDefaultPomoDuration = normalizePomoDurationMinutes(
        defaultPomoDurationMinutes,
        DEFAULT_POMO_DURATION_MINUTES
    );
    const isCompleteActionDisabled =
        isActuallyCompleted ||
        isCompleting ||
        isOverdue ||
        isBeforeStart ||
        !onComplete ||
        hasIncompleteSubtasks ||
        hasIncompletePomoRequirement ||
        hasRunningPomoForTask;

    const subtaskExpandStorageKey = `task-subtasks-expanded:${task.id}`;
    const persistSubtaskExpandedState = (expanded: boolean) => {
        try {
            if (expanded) {
                window.localStorage.setItem(subtaskExpandStorageKey, "1");
            } else {
                window.localStorage.removeItem(subtaskExpandStorageKey);
            }
        } catch {
            // Ignore localStorage access failures.
        }
    };

    const setSubtaskPending = (subtaskId: string, pending: boolean) => {
        setSubtaskPendingIds((prev) => {
            const next = new Set(prev);
            if (pending) {
                next.add(subtaskId);
            } else {
                next.delete(subtaskId);
            }
            return next;
        });
    };

    const handleCheck = () => {
        if (
            !onComplete ||
            isCompleting ||
            isActuallyCompleted ||
            isOverdue ||
            isBeforeStart ||
            hasIncompleteSubtasks ||
            hasIncompletePomoRequirement ||
            hasRunningPomoForTask
        ) return;
        onComplete(task);
    };

    const handleDelete = () => {
        if (!onDelete || isDeleting || !canDelete) return;
        onDelete(task);
    };

    const handlePostpone = () => {
        if (!canPostpone || !onPostpone) return;
        onPostpone(task);
    };

    const handleSubtaskToggle = async (subtaskId: string) => {
        if (!canEditSubtasks || subtaskPendingIds.has(subtaskId)) return;

        const current = subtasks.find((subtask) => subtask.id === subtaskId);
        if (!current) return;

        const nextCompleted = !current.is_completed;
        setSubtaskPending(subtaskId, true);

        await runOptimisticMutation({
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
            runMutation: () => toggleTaskSubtask(task.id, subtaskId, nextCompleted),
            rollback: (snapshot) => {
                setSubtasks(snapshot.subtasks);
            },
            onSuccess: () => {
                // Local optimistic state is already updated.
            },
        });

        setSubtaskPending(subtaskId, false);
    };

    const handleSubtaskDelete = async (subtaskId: string) => {
        if (!canEditSubtasks || subtaskPendingIds.has(subtaskId)) return;

        setSubtaskPending(subtaskId, true);

        await runOptimisticMutation({
            captureSnapshot: () => ({ subtasks }),
            applyOptimistic: () => {
                const nextSubtasks = subtasks.filter((subtask) => subtask.id !== subtaskId);
                setSubtasks(nextSubtasks);
                if (nextSubtasks.length === 0) {
                    setTimeout(() => newSubtaskInputRef.current?.focus(), 0);
                }
            },
            runMutation: () => deleteTaskSubtask(task.id, subtaskId),
            rollback: (snapshot) => {
                setSubtasks(snapshot.subtasks);
            },
            onSuccess: () => {
                // Local optimistic state is already updated.
            },
        });

        setSubtaskPending(subtaskId, false);
    };

    const handleExpandToggle = () => {
        setIsExpanded((prev) => {
            const next = !prev;
            persistSubtaskExpandedState(next);
            return next;
        });
    };

    const handleAddSubtask = () => {
        const trimmed = newSubtaskTitle.trim();
        if (!trimmed || !isParentActive || isTempTask) return;

        const tempId = `temp-subtask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const nowIso = new Date().toISOString();
        const optimisticSubtask = {
            id: tempId,
            parent_task_id: task.id,
            user_id: task.user_id,
            title: trimmed,
            is_completed: false,
            completed_at: null,
            created_at: nowIso,
            updated_at: nowIso,
        };

        setNewSubtaskTitle("");

        setSubtasks((prev) => [...prev, optimisticSubtask]);
        window.requestAnimationFrame(() => {
            const input = newSubtaskInputRef.current;
            if (!input) return;
            input.focus();
            try {
                const cursorPos = input.value.length;
                input.setSelectionRange(cursorPos, cursorPos);
            } catch {
                // Some environments do not support selection ranges on this input.
            }
        });

        void addTaskSubtask(task.id, trimmed)
            .then((result) => {
                if (result?.error) {
                    setSubtasks((prev) => prev.filter((s) => s.id !== tempId));
                    return;
                }
                if (result && typeof result === "object" && "subtask" in result && result.subtask) {
                    setSubtasks((prev) =>
                        prev.map((s) => (s.id === tempId ? (result.subtask as typeof s) : s))
                    );
                }
            })
            .catch(() => {
                setSubtasks((prev) => prev.filter((s) => s.id !== tempId));
            });
    };

    const startEditingSubtask = (subtaskId: string, currentTitle: string) => {
        if (!canEditSubtasks) return;
        setEditingSubtaskId(subtaskId);
        setEditingSubtaskTitle(currentTitle);
    };

    const handleSubtaskRename = async () => {
        if (!editingSubtaskId) return;
        const trimmed = editingSubtaskTitle.trim();
        const subtask = subtasks.find((s) => s.id === editingSubtaskId);
        if (!trimmed || !subtask) {
            setEditingSubtaskId(null);
            setEditingSubtaskTitle("");
            return;
        }
        if (trimmed === subtask.title) {
            setEditingSubtaskId(null);
            setEditingSubtaskTitle("");
            return;
        }
        const targetId = editingSubtaskId;
        setEditingSubtaskId(null);
        setEditingSubtaskTitle("");
        setSubtaskPending(targetId, true);

        await runOptimisticMutation({
            captureSnapshot: () => ({ subtasks }),
            applyOptimistic: () => {
                setSubtasks((prev) =>
                    prev.map((s) => (s.id === targetId ? { ...s, title: trimmed, updated_at: new Date().toISOString() } : s))
                );
            },
            runMutation: () => renameTaskSubtask(task.id, targetId, trimmed),
            rollback: (snapshot) => {
                setSubtasks(snapshot.subtasks);
            },
            onSuccess: () => { },
        });

        setSubtaskPending(targetId, false);
    };

    useEffect(() => {
        setSubtasks(task.subtasks || []);
    }, [task.id, task.subtasks]);

    useEffect(() => {
        if (!onDelete) return;
        const id = window.setInterval(() => {
            setNowMs(Date.now());
        }, 15000);

        return () => {
            window.clearInterval(id);
        };
    }, [onDelete]);

    useEffect(() => {
        try {
            const saved = window.localStorage.getItem(subtaskExpandStorageKey);
            setIsExpanded(saved === "1");
        } catch {
            setIsExpanded(false);
        }
    }, [subtaskExpandStorageKey]);

    const statusColors: Record<string, string> = {
        ACTIVE: "text-blue-400 border-blue-400",
        POSTPONED: "text-amber-400 border-amber-400",
        MARKED_COMPLETE: "text-amber-400 border-amber-400",
        AWAITING_VOUCHER: "text-amber-400 border-amber-400",
        AWAITING_ORCA: "text-amber-400 border-amber-400",
        AWAITING_USER: "text-orange-300 border-orange-300",
        ACCEPTED: "text-emerald-400 border-emerald-400",
        AUTO_ACCEPTED: "text-emerald-400 border-emerald-400",
        ORCA_ACCEPTED: "text-emerald-400 border-emerald-400",
        DENIED: "text-red-500 border-red-500",
        MISSED: "text-red-500 border-red-500",
        DELETED: "text-slate-400 border-slate-600 opacity-60",
        SETTLED: "text-[#F2C7D0] border-[#5B0A1E]",
        RECTIFIED: "text-orange-500 border-orange-500",
    };

    const currentStatusColor = statusColors[task.status] || "";
    const detailPath = `/tasks/${task.id}`;
    const shouldPrefetchDetail = PREFETCH_STATUSES.has(task.status);

    const prefetchTaskDetails = () => {
        if (!shouldPrefetchDetail) return;
        if (hasPrefetchedRef.current) return;
        hasPrefetchedRef.current = true;
        void router.prefetch(detailPath);
    };

    const handleRowDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        if (target.closest("button,[role='menuitem'],a,input,select,textarea")) {
            return;
        }
        prefetchTaskDetails();
        router.push(detailPath);
    };

    const quickActionButtonClass = "h-10 w-10 p-0";

    const renderCheckQuickAction = () => (
        <button
            onClick={handleCheck}
            disabled={isCompleteActionDisabled}
            className={cn(
                `${quickActionButtonClass} group -ml-2.5 md:ml-0 flex items-center justify-center shrink-0`,
                (hasIncompleteSubtasks || hasIncompletePomoRequirement || hasRunningPomoForTask || isBeforeStart) &&
                !isActuallyCompleted &&
                "opacity-60 cursor-not-allowed"
            )}
            title={disabledCompleteTitle}
            aria-label="Mark complete"
        >
            <span
                className={cn(
                    "h-[20px] w-[20px] rounded-full border flex items-center justify-center transition-all",
                    isActuallyCompleted
                        ? (currentStatusColor || "bg-slate-700 border-slate-700 text-slate-400")
                        : "border-slate-600 text-transparent group-hover:border-slate-500"
                )}
            >
                {isActuallyCompleted && <Check className="h-[12px] w-[12px]" strokeWidth={3} />}
            </span>
        </button>
    );

    const renderActiveQuickActions = (includeCheck: boolean) => (
        <>
            {includeCheck && renderCheckQuickAction()}

            <Button
                type="button"
                variant="ghost"
                onClick={() => onAttachProof?.(task)}
                disabled={!canAttachProof}
                className={cn(
                    quickActionButtonClass,
                    "text-blue-300 hover:text-blue-200 hover:bg-slate-800",
                    !canAttachProof && "cursor-not-allowed opacity-50"
                )}
                aria-label="Attach proof"
                title={hasProofAttached ? "Proof attached" : (requiresProofForCompletion ? "Attach proof (required)" : "Attach proof (optional)")}
            >
                <Camera className="h-[18px] w-[18px]" />
            </Button>

            <Button
                type="button"
                variant="ghost"
                onClick={handlePostpone}
                disabled={!canPostpone}
                className={cn(
                    quickActionButtonClass,
                    canPostpone
                        ? "text-amber-300 hover:text-amber-200 hover:bg-slate-800"
                        : "text-slate-500 cursor-not-allowed"
                )}
                aria-label="Postpone task"
                title={canPostpone ? "Postpone deadline (1x only)" : "Postpone unavailable"}
            >
                <TriangleAlert className="h-[18px] w-[18px]" />
            </Button>

            <PomoButton
                taskId={task.id}
                variant="icon"
                defaultDurationMinutes={normalizedDefaultPomoDuration}
                className="h-10 w-10 p-0 justify-center text-cyan-300 hover:text-cyan-200 disabled:text-slate-500 [&_svg]:h-[18px] [&_svg]:w-[18px]"
            />

            {canDeleteButtonBeShown && (
                <Button
                    type="button"
                    variant="ghost"
                    onClick={handleDelete}
                    disabled={isDeleting || !canDelete}
                    className={cn(
                        quickActionButtonClass,
                        canDelete
                            ? "text-red-400 hover:text-red-300 hover:bg-slate-800"
                            : "text-slate-500 cursor-not-allowed"
                    )}
                    aria-label="Delete task"
                    title={canDelete
                        ? "Delete task (available for 5 minutes after creation)"
                        : isTempTask
                            ? "Saving task..."
                            : "Delete available only within 5 minutes of creation"}
                >
                    <Trash2 className="h-[18px] w-[18px]" />
                </Button>
            )}

            {(!isActuallyCompleted || hasSubtasks) && (
                <Button
                    type="button"
                    variant="ghost"
                    onClick={handleExpandToggle}
                    className="h-10 w-10 p-0 text-slate-300 hover:text-white hover:bg-slate-800 js-subtask-toggle"
                    aria-label={isExpanded ? "Collapse subtasks" : (hasSubtasks ? "Expand subtasks" : "Add subtasks")}
                    title={isExpanded ? "Collapse subtasks" : (hasSubtasks ? "Expand subtasks" : "Add subtasks")}
                >
                    {isExpanded
                        ? <ChevronDown className="h-[18px] w-[18px]" />
                        : (hasSubtasks ? <ChevronRight className="h-[18px] w-[18px]" /> : <Plus className="h-[18px] w-[18px]" />)
                    }
                </Button>
            )}

            <Button
                asChild
                variant="ghost"
                className="h-10 w-10 p-0 text-slate-300 hover:text-white hover:bg-slate-800"
                aria-label="Open task"
                title="Open task"
            >
                <Link href={detailPath} prefetch>
                    <ExternalLink className="h-[18px] w-[18px]" />
                </Link>
            </Button>
        </>
    );

    return (
        <div>
            {layoutVariant === "completed" ? (
                <div
                    className={cn(
                        "group flex items-center gap-3 py-2 md:py-3 rounded-md hover:bg-slate-900/20 -mx-4 px-4 transition-colors",
                        isActuallyCompleted && "opacity-80"
                    )}
                    onMouseEnter={prefetchTaskDetails}
                    onFocus={prefetchTaskDetails}
                    onTouchStart={prefetchTaskDetails}
                    onDoubleClick={handleRowDoubleClick}
                    title="Double-click to open task details"
                >
                    <button
                        onClick={handleCheck}
                        disabled={isActuallyCompleted || isCompleting || isOverdue || isBeforeStart || !onComplete || hasIncompleteSubtasks || hasIncompletePomoRequirement || hasRunningPomoForTask}
                        className={cn(
                            "flex-shrink-0 h-10 w-10 p-0 -ml-2.5 md:ml-0 flex items-center justify-center transition-all",
                            (hasIncompleteSubtasks || hasIncompletePomoRequirement || hasRunningPomoForTask || isBeforeStart) &&
                            !isActuallyCompleted &&
                            "opacity-50 cursor-not-allowed"
                        )}
                        title={disabledCompleteTitle}
                    >
                        <span className={cn(
                            "h-[20px] w-[20px] rounded-full border flex items-center justify-center transition-all",
                            isActuallyCompleted
                                ? (currentStatusColor || "bg-slate-700 border-slate-700 text-slate-400")
                                : ("border-slate-600 hover:border-slate-500 text-transparent")
                        )}>
                            {isActuallyCompleted && <Check className="h-[12px] w-[12px]" strokeWidth={3} />}
                        </span>
                    </button>

                    <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
                            <p
                                className={cn(
                                "min-w-0 text-sm font-medium truncate",
                                    isActuallyCompleted
                                        ? cn("line-through", currentStatusColor || "text-slate-400")
                                        : "text-white"
                                )}
                        >
                            {task.title}
                        </p>
                        {task.recurrence_rule_id && <RecurringIndicator />}
                        {hasSubtasks && (
                            <span className="text-[10px] text-slate-500 font-mono shrink-0">
                                {completedSubtasksCount}/{subtasks.length}
                            </span>
                        )}
                    </div>

                    <div className="shrink-0 flex items-center gap-2 text-xs">
                        <div className={cn("flex items-center gap-1.5", isOverdue ? "text-red-500 font-bold" : "text-slate-400")}>
                            <span suppressHydrationWarning className="whitespace-nowrap">
                                {deadlineLabel}
                            </span>
                        </div>

                        {(!isActuallyCompleted || hasSubtasks) && (
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={handleExpandToggle}
                                className="h-7 w-7 p-0 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/80 js-subtask-toggle"
                                aria-label={isExpanded ? "Collapse subtasks" : (hasSubtasks ? "Expand subtasks" : "Add subtasks")}
                                title={isExpanded ? "Collapse subtasks" : (hasSubtasks ? "Expand subtasks" : "Add subtasks")}
                            >
                                {isExpanded
                                    ? <ChevronDown className="h-3.5 w-3.5" />
                                    : (hasSubtasks ? <ChevronRight className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />)
                                }
                            </Button>
                        )}

                        {canAttachProof && (
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => onAttachProof?.(task)}
                                className={cn(
                                    "h-7 w-7 p-0 border",
                                    hasProofAttached
                                        ? "text-blue-300 border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20"
                                        : "text-slate-300 border-slate-700/80 hover:text-white hover:bg-slate-800"
                                )}
                                aria-label="Attach proof"
                                title={hasProofAttached ? "Proof attached" : (requiresProofForCompletion ? "Attach proof (required)" : "Attach proof (optional)")}
                            >
                                <Camera className="h-3.5 w-3.5" />
                            </Button>
                        )}

                        {canDeleteButtonBeShown && (
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={handleDelete}
                                disabled={isDeleting || !canDelete}
                                className={cn(
                                    "h-7 w-7 p-0 border transition-colors",
                                    canDelete
                                        ? "text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/30"
                                        : "text-slate-500 border-slate-700/80 cursor-not-allowed"
                                )}
                                aria-label="Delete task"
                                title={canDelete
                                    ? "Delete task (available for 5 minutes after creation)"
                                    : isTempTask
                                        ? "Saving task..."
                                        : "Delete available only within 5 minutes of creation"}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        )}

                        <Button
                            asChild
                            variant="ghost"
                            className="h-7 w-7 p-0 text-slate-300 hover:text-white hover:bg-slate-800"
                            aria-label="Open task"
                            title="Open task"
                        >
                            <Link href={detailPath} prefetch>
                                <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                        </Button>
                    </div>
                </div>
            ) : (
                <div
                    className={cn(
                        "group py-2 md:py-3 rounded-md hover:bg-slate-900/20 -mx-4 px-4 transition-colors",
                        isActuallyCompleted && "opacity-80"
                    )}
                    onMouseEnter={prefetchTaskDetails}
                    onFocus={prefetchTaskDetails}
                    onTouchStart={prefetchTaskDetails}
                    onDoubleClick={handleRowDoubleClick}
                    title="Double-click to open task details"
                >
                    <div className="hidden md:flex md:items-center md:gap-3">
                        <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden">
                            {renderCheckQuickAction()}
                            <p
                                className={cn(
                                    "min-w-0 text-sm font-medium truncate",
                                    isActuallyCompleted
                                        ? cn("line-through", currentStatusColor || "text-slate-400")
                                        : "text-white"
                                )}
                                title={task.title}
                            >
                                {task.title}
                            </p>
                            {task.recurrence_rule_id && <RecurringIndicator />}
                            {hasSubtasks && (
                                <span className="text-[10px] text-slate-500 font-mono shrink-0">
                                    {completedSubtasksCount}/{subtasks.length}
                                </span>
                            )}
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                            <span suppressHydrationWarning className={cn("text-xs whitespace-nowrap", isOverdue ? "text-red-500 font-bold" : "text-slate-400")}>
                                {deadlineLabel}
                            </span>
                            {renderActiveQuickActions(false)}
                        </div>
                    </div>

                    <div className="md:hidden">
                        {/* Single tappable row: circle + title + deadline */}
                        <div
                            className="flex items-center gap-2 cursor-pointer select-none"
                            onClick={(e) => {
                                if ((e.target as HTMLElement).closest("button,a")) return;
                                setIsMobileTrayOpen((prev) => {
                                    const next = !prev;
                                    if (next) {
                                        setIsExpanded(true);
                                        persistSubtaskExpandedState(true);
                                    } else if (isExpanded) {
                                        setIsExpanded(false);
                                        persistSubtaskExpandedState(false);
                                    }
                                    return next;
                                });
                            }}
                        >
                            {renderCheckQuickAction()}
                            <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
                                <p
                                    className={cn(
                                        "text-sm font-medium truncate",
                                        isActuallyCompleted
                                            ? cn("line-through", currentStatusColor || "text-slate-400")
                                            : "text-white"
                                    )}
                                    title={task.title}
                                >
                                    {task.title}
                                </p>
                                {task.recurrence_rule_id && <RecurringIndicator />}
                                {hasSubtasks && (
                                    <span className="text-[10px] text-slate-500 font-mono shrink-0">
                                        {completedSubtasksCount}/{subtasks.length}
                                    </span>
                                )}
                            </div>
                            <span suppressHydrationWarning className={cn("text-xs shrink-0 whitespace-nowrap", isOverdue ? "text-red-500 font-bold" : "text-slate-400")}>
                                {deadlineLabel}
                            </span>
                        </div>

                        {/* Animated action tray */}
                        <div className={cn(
                            "overflow-hidden transition-[max-height] duration-200 ease-in-out",
                            isMobileTrayOpen ? "max-h-[56px]" : "max-h-0"
                        )}>
                            <div className="flex items-center justify-around pt-1 pb-2 pl-10">
                                <button
                                    type="button"
                                    onClick={() => onAttachProof?.(task)}
                                    disabled={!canAttachProof}
                                    className={cn(
                                        "h-10 w-10 flex items-center justify-center transition-colors",
                                        canAttachProof ? "text-blue-300" : "text-slate-600 cursor-not-allowed"
                                    )}
                                    aria-label="Attach proof"
                                    title={hasProofAttached ? "Proof attached" : (requiresProofForCompletion ? "Attach proof (required)" : "Attach proof (optional)")}
                                >
                                    <Camera className="h-[18px] w-[18px]" />
                                </button>

                                <button
                                    type="button"
                                    onClick={handlePostpone}
                                    disabled={!canPostpone}
                                    className={cn(
                                        "h-10 w-10 flex items-center justify-center transition-colors",
                                        canPostpone ? "text-amber-300" : "text-slate-600 cursor-not-allowed"
                                    )}
                                    aria-label="Postpone task"
                                    title={canPostpone ? "Postpone deadline (1x only)" : "Postpone unavailable"}
                                >
                                    <TriangleAlert className="h-[18px] w-[18px]" />
                                </button>

                                <PomoButton
                                    taskId={task.id}
                                    variant="icon"
                                    defaultDurationMinutes={normalizedDefaultPomoDuration}
                                    className="h-10 w-10 p-0 justify-center text-cyan-300 disabled:text-slate-600 [&_svg]:h-[18px] [&_svg]:w-[18px]"
                                />

                                <button
                                    type="button"
                                    onClick={handleDelete}
                                    disabled={!canDelete}
                                    className={cn(
                                        "h-10 w-10 flex items-center justify-center transition-colors",
                                        canDelete ? "text-red-400" : "text-slate-600 cursor-not-allowed"
                                    )}
                                    aria-label="Delete task"
                                    title={canDelete
                                        ? "Delete task (available for 5 minutes after creation)"
                                        : isTempTask ? "Saving task..." : "Delete available only within 5 minutes of creation"}
                                >
                                    <Trash2 className="h-[18px] w-[18px]" />
                                </button>

                                <button
                                    type="button"
                                    onClick={handleExpandToggle}
                                    className="h-10 w-10 flex items-center justify-center text-slate-400 js-subtask-toggle"
                                    aria-label={isExpanded ? "Collapse subtasks" : (hasSubtasks ? "Expand subtasks" : "Add subtasks")}
                                    title={isExpanded ? "Collapse subtasks" : (hasSubtasks ? "Expand subtasks" : "Add subtasks")}
                                >
                                    {isExpanded
                                        ? <ChevronDown className="h-[18px] w-[18px]" />
                                        : (hasSubtasks ? <ChevronRight className="h-[18px] w-[18px]" /> : <Plus className="h-[18px] w-[18px]" />)
                                    }
                                </button>

                                <Link
                                    href={detailPath}
                                    prefetch
                                    className="h-10 w-10 flex items-center justify-center text-slate-400"
                                    aria-label="Open task"
                                    title="Open task"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <ExternalLink className="h-[18px] w-[18px]" />
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {proofUploadError && (
                <div className="ml-8 mr-3 mb-2 mt-0.5 rounded border border-red-900/60 bg-red-950/30 px-2 py-1">
                    <p className="text-[11px] text-red-300">{proofUploadError}</p>
                </div>
            )}

            <div
                className={cn(
                    "grid overflow-hidden transition-[grid-template-rows,opacity,margin-top,margin-bottom] duration-250 ease-out",
                    isExpanded
                        ? "grid-rows-[1fr] opacity-100 mt-1 mb-3"
                        : "grid-rows-[0fr] opacity-0 mt-0 mb-0"
                )}
            >
                <div className="overflow-hidden">
                <div
                    className="ml-8 mr-3 border-l border-slate-800/70 pl-3 space-y-1"
                    onBlur={(e) => {
                        // If focus is still within this specific task's subtask section, don't close
                        if (e.relatedTarget && (e.currentTarget.contains(e.relatedTarget as Node) || (e.relatedTarget as HTMLElement).closest?.(".js-subtask-toggle"))) {
                            return;
                        }
                        // Only auto-close if the list is empty and user isn't actively adding one with text
                        if (subtasks.length === 0 && !newSubtaskTitle.trim()) {
                            setIsExpanded(false);
                            persistSubtaskExpandedState(false);
                        }
                    }}
                >
                    {subtasks.map((subtask) => {
                        const isPending = subtaskPendingIds.has(subtask.id);
                        return (
                            <div key={subtask.id} className="flex items-center gap-2">
                                <button
                                    type="button"
                                    disabled={!canEditSubtasks || isPending}
                                    onClick={() => handleSubtaskToggle(subtask.id)}
                                    className={cn(
                                        "group h-10 w-10 flex items-center justify-center shrink-0 p-0 transition-opacity",
                                        (!canEditSubtasks || isPending) && "opacity-60 cursor-not-allowed"
                                    )}
                                    title={canEditSubtasks ? "Toggle subtask" : "Subtasks are locked"}
                                >
                                    <span className={cn(
                                        "h-[20px] w-[20px] rounded-full border flex items-center justify-center transition-all shrink-0",
                                        subtask.is_completed
                                            ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                                            : "border-slate-600 text-transparent group-hover:border-slate-500"
                                    )}>
                                        {subtask.is_completed && <Check className="h-[12px] w-[12px]" strokeWidth={3} />}
                                    </span>
                                </button>
                                {editingSubtaskId === subtask.id ? (
                                    <input
                                        type="text"
                                        value={editingSubtaskTitle}
                                        onChange={(e) => setEditingSubtaskTitle(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                void handleSubtaskRename();
                                            }
                                            if (e.key === "Escape") {
                                                setEditingSubtaskId(null);
                                                setEditingSubtaskTitle("");
                                            }
                                        }}
                                        onBlur={() => void handleSubtaskRename()}
                                        autoFocus
                                        className="flex-1 min-w-0 bg-transparent border-b border-slate-500 text-base md:text-sm text-slate-300 focus:outline-none focus:border-slate-400 py-0.5"
                                    />
                                ) : (
                                    <button
                                        type="button"
                                        disabled={isPending}
                                        onClick={() => startEditingSubtask(subtask.id, subtask.title)}
                                        className={cn(
                                            "flex-1 min-w-0 text-left text-sm transition-colors py-1",
                                            subtask.is_completed ? "text-slate-500 line-through" : "text-slate-300",
                                            canEditSubtasks && !isPending && "hover:text-white cursor-text",
                                            isPending && "cursor-not-allowed opacity-60"
                                        )}
                                        title="Click to edit"
                                    >
                                        <span className="block truncate">{subtask.title}</span>
                                    </button>
                                )}
                                {canEditSubtasks && (
                                    <button
                                        type="button"
                                        disabled={isPending}
                                        onClick={() => handleSubtaskDelete(subtask.id)}
                                        className={cn(
                                            "h-10 w-10 rounded flex items-center justify-center shrink-0 transition-colors",
                                            "text-red-400/70 hover:text-red-300 hover:bg-red-500/10",
                                            isPending && "opacity-60 cursor-not-allowed"
                                        )}
                                        aria-label="Delete subtask"
                                        title="Delete subtask"
                                    >
                                        <Trash2 className="h-[18px] w-[18px]" />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                    {canEditSubtasks && (
                        <div className="flex items-center gap-2 pr-2">
                            <button
                                type="button"
                                onPointerDown={(e) => e.preventDefault()}
                                onClick={handleAddSubtask}
                                disabled={!newSubtaskTitle.trim()}
                                className={cn(
                                    "h-10 w-10 flex items-center justify-center shrink-0 rounded transition-colors",
                                    "text-slate-500 hover:text-slate-200 hover:bg-slate-800/60",
                                    !newSubtaskTitle.trim() && "cursor-not-allowed opacity-60 hover:text-slate-500 hover:bg-transparent"
                                )}
                                aria-label="Add subtask"
                                title="Add subtask"
                            >
                                <Plus className="h-[18px] w-[18px]" />
                            </button>
                            <input
                                type="text"
                                value={newSubtaskTitle}
                                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        handleAddSubtask();
                                    }
                                }}
                                placeholder="Add subtask…"
                                ref={newSubtaskInputRef}
                                className="flex-1 min-w-0 bg-transparent border-b border-slate-700/60 text-base md:text-sm text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-slate-500 py-1"
                            />
                        </div>
                    )
                    }
                    </div>
                </div>
            </div>
        </div>
    );
}

