"use client";

import { useState } from "react";
import { ArrowUpDown, Bell, Check, Lightbulb } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { showSampleNotification } from "@/lib/client-notifications";
import { HardRefreshButton } from "@/components/HardRefreshButton";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type DashboardSortMode =
    | "deadline_asc"
    | "deadline_desc"
    | "created_asc"
    | "created_desc";

interface SortOption {
    mode: DashboardSortMode;
    label: string;
}

const SORT_OPTIONS: SortOption[] = [
    { mode: "deadline_asc", label: "Sort by deadline ascending" },
    { mode: "deadline_desc", label: "Sort by deadline descending" },
    { mode: "created_asc", label: "Sort by time created ascending" },
    { mode: "created_desc", label: "Sort by time created descending" },
];

interface DashboardHeaderActionsProps {
    tipsVisible: boolean;
    onToggleTips: () => void;
    isTogglingTips: boolean;
    sortMode: DashboardSortMode;
    onSortModeChange: (mode: DashboardSortMode) => void;
}

export function DashboardHeaderActions({
    tipsVisible,
    onToggleTips,
    isTogglingTips,
    sortMode,
    onSortModeChange,
}: DashboardHeaderActionsProps) {
    const [isTestingNotification, setIsTestingNotification] = useState(false);

    const handleTestNotification = async () => {
        if (isTestingNotification) return;

        setIsTestingNotification(true);
        const result = await showSampleNotification();
        setIsTestingNotification(false);

        if (!result.success) {
            toast.error(result.message);
            return;
        }

        toast.success("Sample notification sent.");
    };

    return (
        <div className="flex items-center gap-2">
            <Button
                variant="ghost"
                size="icon"
                className={tipsVisible ? "text-yellow-400 hover:text-yellow-300" : "text-slate-500 hover:text-slate-200"}
                onClick={onToggleTips}
                disabled={isTogglingTips}
                aria-label={tipsVisible ? "Hide tips" : "Show tips"}
                title={tipsVisible ? "Hide tips" : "Show tips"}
                haptic="light"
            >
                <Lightbulb className="h-4 w-4" />
            </Button>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-slate-400 hover:text-white"
                        aria-label="Sort tasks"
                        title="Sort tasks"
                        haptic="light"
                    >
                        <ArrowUpDown className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-slate-900 border-slate-800 text-slate-200 min-w-[220px]">
                    {SORT_OPTIONS.map((option) => (
                        <DropdownMenuItem
                            key={option.mode}
                            onSelect={() => onSortModeChange(option.mode)}
                            className="focus:bg-slate-800 focus:text-white cursor-pointer text-xs flex items-center justify-between"
                        >
                            <span>{option.label}</span>
                            {sortMode === option.mode && <Check className="h-3.5 w-3.5 text-cyan-300" />}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>

            <Button
                variant="ghost"
                size="icon"
                className="text-slate-400 hover:text-white"
                onClick={handleTestNotification}
                disabled={isTestingNotification}
                aria-label="Test notification"
                title="Test notification"
                haptic="light"
            >
                <Bell className="h-4 w-4" />
            </Button>

            <HardRefreshButton ariaLabel="Refresh dashboard" title="Refresh dashboard" />
        </div>
    );
}
