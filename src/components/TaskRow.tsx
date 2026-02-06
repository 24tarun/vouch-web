"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Task } from "@/lib/types";
import { Check, Clock, MoreHorizontal } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "./ui/button";
import { markTaskCompleted, postponeTask, cancelRepetition } from "@/actions/tasks";
import { cn } from "@/lib/utils";
import { Repeat } from "lucide-react";


interface TaskRowProps {
    task: Task;
}

export function TaskRow({ task }: TaskRowProps) {
    const router = useRouter();
    const isActuallyCompleted = ["AWAITING_VOUCHER", "COMPLETED", "FAILED", "RECTIFIED", "SETTLED", "DELETED"].includes(task.status);
    const [isCompleted, setIsCompleted] = useState(isActuallyCompleted);
    const [isLoading, setIsLoading] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [isRepetitionStopped, setIsRepetitionStopped] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const handleCheck = async () => {
        if (isLoading || isCompleted || isActuallyCompleted) return;
        setIsLoading(true);
        // Optimistic update
        setIsCompleted(true);
        try {
            await markTaskCompleted(task.id);
        } catch (error) {
            console.error("Failed to mark completed", error);
            setIsCompleted(false); // Revert
        } finally {
            setIsLoading(false);
        }
    };

    const handlePostpone = async () => {
        if (isActuallyCompleted || isOverdue) return;
        try {
            await postponeTask(task.id);
        } catch (error) {
            console.error("Failed to postpone", error);
        }
    };

    const handleCancelRepetition = async () => {
        if (isRepetitionStopped) return;
        try {
            const result = await cancelRepetition(task.id);
            if (!result?.error) {
                setIsRepetitionStopped(true);
            }
        } catch (error) {
            console.error("Failed to cancel repetition", error);
        }
    };


    const deadline = new Date(task.deadline);
    const isOverdue = deadline < new Date() && !isCompleted && !isActuallyCompleted;

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

    const handleRowDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        if (target.closest("button,[role='menuitem'],a,input,select,textarea")) {
            return;
        }
        router.push(detailPath);
    };

    return (
        <div className={cn(
            "group flex items-center gap-3 py-3 border-b border-slate-800/50 last:border-0 hover:bg-slate-900/20 -mx-4 px-4 transition-colors",
            isActuallyCompleted && "opacity-80"
        )}
            onDoubleClick={handleRowDoubleClick}
            title="Double-click to open task details"
        >
            {/* Checkbox */}
            <button
                onClick={handleCheck}
                disabled={isCompleted || isLoading || isActuallyCompleted}
                className={cn(
                    "flex-shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all",
                    isActuallyCompleted ? (currentStatusColor || "bg-slate-700 border-slate-700 text-slate-400") :
                        (isCompleted
                            ? "bg-slate-700 border-slate-700 text-slate-400"
                            : "border-slate-600 hover:border-slate-500 text-transparent")
                )}
            >
                {(isCompleted || isActuallyCompleted) && <Check className="h-3 w-3" strokeWidth={3} />}
            </button>

            {/* Content */}
            <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
                <p className={cn(
                    "text-sm font-medium truncate",
                    isActuallyCompleted ? cn("line-through", currentStatusColor || "text-slate-400") :
                        isCompleted ? "text-slate-400 line-through" : "text-white"
                )}>
                    {task.title}
                </p>
                {task.recurrence_rule_id && (
                    <Repeat className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                )}
            </div>


            {/* Right Side Actions/Info */}
            <div className="flex items-center gap-4 text-xs">
                {/* Deadline */}
                <div className={cn("flex items-center gap-1.5", isOverdue ? "text-red-500 font-bold" : "text-slate-400")}>
                    <span>
                        {mounted ? `${deadline.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${deadline.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}` : ""}
                    </span>
                </div>

                {/* Hover Actions - Only show if not completed and not overdue */}
                {!isActuallyCompleted && !isOverdue && (
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-6 w-6 p-0 hover:bg-slate-800 text-slate-500">
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-slate-900 border-slate-800">
                                <DropdownMenuItem onClick={handlePostpone} className="text-slate-300 focus:bg-slate-800 focus:text-white cursor-pointer text-xs">
                                    <Clock className="mr-2 h-3.5 w-3.5" />
                                    Postpone
                                </DropdownMenuItem>
                                {task.recurrence_rule_id && (
                                    <DropdownMenuItem
                                        onClick={handleCancelRepetition}
                                        disabled={isRepetitionStopped}
                                        className={cn(
                                            "text-xs",
                                            isRepetitionStopped
                                                ? "text-slate-500 cursor-not-allowed focus:bg-slate-900/60 focus:text-slate-500"
                                                : "text-red-400 focus:bg-slate-800 focus:text-red-300 cursor-pointer"
                                        )}
                                    >
                                        <Repeat className="mr-2 h-3.5 w-3.5" />
                                        {isRepetitionStopped ? "Repetition Stopped" : "Stop Future Repetitions"}
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuContent>

                        </DropdownMenu>
                    </div>
                )}
            </div>
        </div>
    );
}
