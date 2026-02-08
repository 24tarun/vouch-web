"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Task } from "@/lib/types";
import { Check, ExternalLink, Repeat, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { canOwnerTemporarilyDelete } from "@/lib/task-delete-window";


interface TaskRowProps {
    task: Task;
    onComplete?: (task: Task) => void;
    isCompleting?: boolean;
    onDelete?: (task: Task) => void;
    isDeleting?: boolean;
}

export function TaskRow({
    task,
    onComplete,
    isCompleting = false,
    onDelete,
    isDeleting = false,
}: TaskRowProps) {
    const router = useRouter();
    const hasPrefetchedRef = useRef(false);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const isActuallyCompleted = useMemo(
        () => ["AWAITING_VOUCHER", "COMPLETED", "FAILED", "RECTIFIED", "SETTLED", "DELETED"].includes(task.status),
        [task.status]
    );
    const deadline = new Date(task.deadline);
    const isOverdue = deadline < new Date() && !isActuallyCompleted;
    const isTempTask = task.id.startsWith("temp-");
    const canDelete = Boolean(
        onDelete &&
        !isTempTask &&
        canOwnerTemporarilyDelete(task, nowMs)
    );

    const handleCheck = () => {
        if (!onComplete || isCompleting || isActuallyCompleted || isOverdue) return;
        onComplete(task);
    };

    const handleDelete = () => {
        if (!onDelete || isDeleting || !canDelete) return;
        onDelete(task);
    };

    useEffect(() => {
        if (!onDelete) return;
        const id = window.setInterval(() => {
            setNowMs(Date.now());
        }, 15000);

        return () => {
            window.clearInterval(id);
        };
    }, [onDelete]);

    // Solarized-inspired colors for states
    const statusColors: Record<string, string> = {
        AWAITING_VOUCHER: "text-amber-400 border-amber-400", // Bright Yellow
        COMPLETED: "text-emerald-400 border-emerald-400",   // Bright Green
        FAILED: "text-red-500 border-red-500",              // High-sat Red
        DELETED: "text-slate-400 border-slate-600 opacity-60", // Brighter Grey
        SETTLED: "text-cyan-400 border-cyan-400",           // Bright Cyan
        RECTIFIED: "text-orange-500 border-orange-500",     // Bright Orange
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
        <div className={cn(
            "group flex items-center gap-3 py-3 border-b border-slate-800/50 last:border-0 hover:bg-slate-900/20 -mx-4 px-4 transition-colors",
            isActuallyCompleted && "opacity-80"
        )}
            onMouseEnter={prefetchTaskDetails}
            onFocus={prefetchTaskDetails}
            onTouchStart={prefetchTaskDetails}
            onDoubleClick={handleRowDoubleClick}
            title="Double-click to open task details"
        >
            {/* Checkbox */}
            <button
                onClick={handleCheck}
                disabled={isActuallyCompleted || isCompleting || isOverdue || !onComplete}
                className={cn(
                    "flex-shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all",
                    isActuallyCompleted ? (currentStatusColor || "bg-slate-700 border-slate-700 text-slate-400") :
                        ("border-slate-600 hover:border-slate-500 text-transparent")
                )}
            >
                {isActuallyCompleted && <Check className="h-3 w-3" strokeWidth={3} />}
            </button>

            {/* Content */}
            <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
                <p className={cn(
                    "text-sm font-medium truncate",
                    isActuallyCompleted ? cn("line-through", currentStatusColor || "text-slate-400") :
                        "text-white"
                )}>
                    {task.title}
                </p>
                {task.recurrence_rule_id && (
                    <Repeat className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                )}
            </div>


            {/* Right Side Actions/Info */}
            <div className="flex items-center gap-2 text-xs">
                {/* Deadline */}
                <div className={cn("flex items-center gap-1.5", isOverdue ? "text-red-500 font-bold" : "text-slate-400")}>
                    <span suppressHydrationWarning>
                        {`${deadline.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${deadline.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}`}
                    </span>
                </div>

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
    );
}
