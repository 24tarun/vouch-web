import { cn } from "@/lib/utils";
import { Repeat } from "lucide-react";

interface RecurringIndicatorProps {
    className?: string;
}

export function RecurringIndicator({ className }: RecurringIndicatorProps) {
    return <Repeat className={cn("h-3.5 w-3.5 text-purple-400 shrink-0", className)} aria-label="Repeating task" />;
}
