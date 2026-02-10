"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteTaskSubtask, toggleTaskSubtask } from "@/actions/tasks";
import type { Task } from "@/lib/types";
import { Camera, Check, ChevronDown, ChevronRight, ExternalLink, Repeat, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { canOwnerTemporarilyDelete } from "@/lib/task-delete-window";
import { runOptimisticMutation } from "@/lib/ui/runOptimisticMutation";

interface TaskRowProps {
    task: Task;
    onComplete?: (task: Task) => void;
    isCompleting?: boolean;
    onAttachProof?: (task: Task) => void;
    hasProofAttached?: boolean;
    proofUploadError?: string | null;
    onDelete?: (task: Task) => void;
    isDeleting?: boolean;
}

export function TaskRow({
    task,
    onComplete,
    isCompleting = false,
    onAttachProof,
    hasProofAttached = false,
    proofUploadError = null,
    onDelete,
    isDeleting = false,
}: TaskRowProps) {
    const router = useRouter();
    const hasPrefetchedRef = useRef(false);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [subtasks, setSubtasks] = useState(task.subtasks || []);
    const [subtaskPendingIds, setSubtaskPendingIds] = useState<Set<string>>(new Set());
    const [isExpanded, setIsExpanded] = useState(false);

    const isActuallyCompleted = useMemo(
        () => ["AWAITING_VOUCHER", "COMPLETED", "FAILED", "RECTIFIED", "SETTLED", "DELETED"].includes(task.status),
        [task.status]
    );
    const deadline = new Date(task.deadline);
    const isOverdue = deadline < new Date() && !isActuallyCompleted;
    const isTempTask = task.id.startsWith("temp-");
    const isParentActive = ["CREATED", "POSTPONED"].includes(task.status);
    const hasSubtasks = subtasks.length > 0;
    const completedSubtasksCount = subtasks.filter((subtask) => subtask.is_completed).length;
    const hasIncompleteSubtasks = subtasks.some((subtask) => !subtask.is_completed);
    const requiredPomoSeconds = (task.required_pomo_minutes || 0) * 60;
    const pomoTotalSeconds = task.pomo_total_seconds || 0;
    const hasIncompletePomoRequirement =
        requiredPomoSeconds > 0 && pomoTotalSeconds < requiredPomoSeconds;
    const disabledCompleteTitle = hasIncompleteSubtasks
        ? "Complete all subtasks first"
        : hasIncompletePomoRequirement
            ? `Log ${Math.ceil((requiredPomoSeconds - pomoTotalSeconds) / 60)} more focus minute(s) first`
            : "Mark complete";
    const canEditSubtasks = isParentActive && !isTempTask;
    const canDelete = Boolean(
        onDelete &&
        !isTempTask &&
        canOwnerTemporarilyDelete(task, nowMs)
    );
    const canAttachProof = Boolean(onAttachProof && !isActuallyCompleted && !isOverdue);

    const subtaskExpandStorageKey = `task-subtasks-expanded:${task.id}`;

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
        if (!onComplete || isCompleting || isActuallyCompleted || isOverdue || hasIncompleteSubtasks || hasIncompletePomoRequirement) return;
        onComplete(task);
    };

    const handleDelete = () => {
        if (!onDelete || isDeleting || !canDelete) return;
        onDelete(task);
    };

    const handleSubtaskToggle = async (subtaskId: string) => {
        if (!canEditSubtasks || subtaskPendingIds.has(subtaskId)) return;

        const current = subtasks.find((subtask) => subtask.id === subtaskId);
        if (!current) return;

        const nextCompleted = !current.is_completed;
        setSubtaskPending(subtaskId, true);

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

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ subtasks }),
            applyOptimistic: () => {
                setSubtasks((prev) => prev.filter((subtask) => subtask.id !== subtaskId));
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
            try {
                if (next) {
                    window.localStorage.setItem(subtaskExpandStorageKey, "1");
                } else {
                    window.localStorage.removeItem(subtaskExpandStorageKey);
                }
            } catch {
                // Ignore localStorage access failures.
            }
            return next;
        });
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
        if (!hasSubtasks) {
            setIsExpanded(false);
            try {
                window.localStorage.removeItem(subtaskExpandStorageKey);
            } catch {
                // Ignore localStorage access failures.
            }
            return;
        }

        try {
            const saved = window.localStorage.getItem(subtaskExpandStorageKey);
            setIsExpanded(saved === "1");
        } catch {
            setIsExpanded(false);
        }
    }, [hasSubtasks, subtaskExpandStorageKey]);

    const statusColors: Record<string, string> = {
        AWAITING_VOUCHER: "text-amber-400 border-amber-400",
        COMPLETED: "text-emerald-400 border-emerald-400",
        FAILED: "text-red-500 border-red-500",
        DELETED: "text-slate-400 border-slate-600 opacity-60",
        SETTLED: "text-cyan-400 border-cyan-400",
        RECTIFIED: "text-orange-500 border-orange-500",
    };

    const currentStatusColor = statusColors[task.status] || "";
    const detailPath = `/dashboard/tasks/${task.id}`;

    const prefetchTaskDetails = () => {
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

    return (
        <div>
            <div
                className={cn(
                    "group flex items-center gap-3 py-3 border-b border-slate-800/50 last:border-0 hover:bg-slate-900/20 -mx-4 px-4 transition-colors",
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
                    disabled={isActuallyCompleted || isCompleting || isOverdue || !onComplete || hasIncompleteSubtasks || hasIncompletePomoRequirement}
                    className={cn(
                        "flex-shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all",
                        isActuallyCompleted
                            ? (currentStatusColor || "bg-slate-700 border-slate-700 text-slate-400")
                            : ("border-slate-600 hover:border-slate-500 text-transparent"),
                        (hasIncompleteSubtasks || hasIncompletePomoRequirement) && !isActuallyCompleted && "opacity-50 cursor-not-allowed"
                    )}
                    title={disabledCompleteTitle}
                >
                    {isActuallyCompleted && <Check className="h-3 w-3" strokeWidth={3} />}
                </button>

                <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
                    <p
                        className={cn(
                            "text-sm font-medium truncate",
                            isActuallyCompleted
                                ? cn("line-through", currentStatusColor || "text-slate-400")
                                : "text-white"
                        )}
                    >
                        {task.title}
                    </p>
                    {task.recurrence_rule_id && (
                        <Repeat className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    )}
                    {hasSubtasks && (
                        <span className="text-[10px] text-slate-500 font-mono shrink-0">
                            {completedSubtasksCount}/{subtasks.length}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2 text-xs">
                    <div className={cn("flex items-center gap-1.5", isOverdue ? "text-red-500 font-bold" : "text-slate-400")}>
                        <span suppressHydrationWarning>
                            {`${deadline.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${deadline.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}`}
                        </span>
                    </div>

                    {hasSubtasks && (
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={handleExpandToggle}
                            className="h-7 w-7 p-0 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/80"
                            aria-label={isExpanded ? "Collapse subtasks" : "Expand subtasks"}
                            title={isExpanded ? "Collapse subtasks" : "Expand subtasks"}
                        >
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
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
                            title={hasProofAttached ? "Proof attached" : "Attach proof (optional)"}
                        >
                            <Camera className="h-3.5 w-3.5" />
                        </Button>
                    )}

                    {canDelete && (
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className={cn(
                                "h-7 w-7 p-0 border transition-colors",
                                "text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/30"
                            )}
                            aria-label="Delete task"
                            title="Delete task (available for 5 minutes after creation)"
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

            {proofUploadError && (
                <div className="ml-8 mr-3 mb-2 mt-0.5 rounded border border-red-900/60 bg-red-950/30 px-2 py-1">
                    <p className="text-[11px] text-red-300">{proofUploadError}</p>
                </div>
            )}

            {hasSubtasks && isExpanded && (
                <div className="ml-8 mr-3 mb-3 mt-1 border-l border-slate-800/70 pl-3 space-y-1.5">
                    {subtasks.map((subtask) => {
                        const isPending = subtaskPendingIds.has(subtask.id);
                        return (
                            <div key={subtask.id} className="flex items-center gap-2">
                                <button
                                    type="button"
                                    disabled={!canEditSubtasks || isPending}
                                    onClick={() => handleSubtaskToggle(subtask.id)}
                                    className={cn(
                                        "h-4 w-4 rounded-full border flex items-center justify-center transition-colors",
                                        subtask.is_completed
                                            ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                                            : "border-slate-600 text-transparent",
                                        (!canEditSubtasks || isPending) && "opacity-60 cursor-not-allowed"
                                    )}
                                    title={canEditSubtasks ? "Toggle subtask" : "Subtasks are locked"}
                                >
                                    {subtask.is_completed && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                                </button>
                                <button
                                    type="button"
                                    disabled={!canEditSubtasks || isPending}
                                    onClick={() => handleSubtaskToggle(subtask.id)}
                                    className={cn(
                                        "flex-1 min-w-0 text-left text-xs transition-colors",
                                        subtask.is_completed ? "text-slate-500 line-through" : "text-slate-300",
                                        (!canEditSubtasks || isPending) && "cursor-not-allowed"
                                    )}
                                    title={subtask.title}
                                >
                                    <span className="block truncate">{subtask.title}</span>
                                </button>
                                {canEditSubtasks && (
                                    <button
                                        type="button"
                                        disabled={isPending}
                                        onClick={() => handleSubtaskDelete(subtask.id)}
                                        className={cn(
                                            "h-6 w-6 rounded border flex items-center justify-center",
                                            "border-red-500/30 text-red-400 hover:bg-red-500/10",
                                            isPending && "opacity-60 cursor-not-allowed"
                                        )}
                                        aria-label="Delete subtask"
                                        title="Delete subtask"
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
