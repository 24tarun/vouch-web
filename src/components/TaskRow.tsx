"use client";

import { useState, useEffect } from "react";
import type { Task } from "@/lib/types";
import { Check, Clock, MoreHorizontal } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "./ui/button";
import { markTaskCompleted, postponeTask } from "@/actions/tasks";
import { cn } from "@/lib/utils";

interface TaskRowProps {
    task: Task;
}

export function TaskRow({ task }: TaskRowProps) {
    const isActuallyCompleted = ["AWAITING_VOUCHER", "COMPLETED", "FAILED", "RECTIFIED", "SETTLED", "DELETED"].includes(task.status);
    const [isCompleted, setIsCompleted] = useState(isActuallyCompleted);
    const [isLoading, setIsLoading] = useState(false);
    const [mounted, setMounted] = useState(false);

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
        if (isActuallyCompleted) return;
        try {
            await postponeTask(task.id);
        } catch (error) {
            console.error("Failed to postpone", error);
        }
    };

    const deadline = new Date(task.deadline);
    const isOverdue = deadline < new Date() && !isCompleted && !isActuallyCompleted;

    // Solarized-inspired colors for states
    const statusColors: Record<string, string> = {
        AWAITING_VOUCHER: "text-[#b58900] border-[#b58900]", // Yellow
        COMPLETED: "text-[#859900] border-[#859900]",       // Green
        FAILED: "text-[#dc322f] border-[#dc322f]",          // Red
        DELETED: "text-slate-500 border-slate-700 opacity-50", // Grey/Dimmed
        SETTLED: "text-[#2aa198] border-[#2aa198]",         // Cyan/Sjöberg
        RECTIFIED: "text-[#cb4b16] border-[#cb4b16]",       // Orange
    };

    const currentStatusColor = statusColors[task.status] || "";

    return (
        <div className={cn(
            "group flex items-center gap-3 py-3 border-b border-slate-800/50 last:border-0 hover:bg-slate-900/20 -mx-4 px-4 transition-colors",
            isActuallyCompleted && "opacity-80"
        )}>
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
            <div className="flex-1 min-w-0">
                <p className={cn(
                    "text-sm font-medium truncate",
                    isActuallyCompleted ? cn("line-through", currentStatusColor || "text-slate-500") :
                        isCompleted ? "text-slate-500 line-through" : "text-slate-200"
                )}>
                    {task.title}
                </p>
            </div>

            {/* Right Side Actions/Info */}
            <div className="flex items-center gap-4 text-xs">
                {/* Deadline */}
                <div className={cn("flex items-center gap-1.5", isOverdue ? "text-red-400" : "text-slate-500")}>
                    <span>
                        {mounted ? `${deadline.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${deadline.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}` : ""}
                    </span>
                </div>

                {/* Hover Actions - Only show if not completed */}
                {!isActuallyCompleted && (
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
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}
            </div>
        </div>
    );
}
