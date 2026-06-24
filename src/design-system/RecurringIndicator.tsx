import { cn } from "@/lib/utils";
import { Pause, Repeat } from "lucide-react";

interface RecurringIndicatorProps {
    className?: string;
    paused?: boolean;
}

export function RecurringIndicator({ className, paused = false }: RecurringIndicatorProps) {
    return (
        <span
            className={cn("inline-flex items-center gap-0.5 text-purple-400 shrink-0", className)}
            aria-label={paused ? "Repeating task, repetitions paused" : "Repeating task"}
        >
            <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
            {paused && <Pause className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true" />}
        </span>
    );
}
