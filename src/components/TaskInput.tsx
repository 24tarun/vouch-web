"use client";

import { useEffect, useRef, useState } from "react";
import { createTask } from "@/actions/tasks";
import { Calendar, Check, Loader2, Repeat, User } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/types";
import { isIOS } from "@/lib/platform";
import {
    combineDateAndTime,
    fromDateTimeLocalValue,
    getDatePartFromLocalDateTime,
    getTimePartFromLocalDateTime,
    toDateTimeLocalValue,
} from "@/lib/datetime-local";

interface TaskInputProps {
    friends: Profile[];
    defaultFailureCostEuros: string;
    defaultVoucherId: string | null;
    onCreateTaskOptimistic?: (payload: TaskInputCreatePayload) => void;
}

export interface TaskInputCreatePayload {
    title: string;
    deadlineIso: string;
    voucherId: string;
    failureCost: string;
    recurrenceType: string | null;
    recurrenceDays: number[];
    userTimezone: string;
}

export function TaskInput({
    friends,
    defaultFailureCostEuros,
    defaultVoucherId,
    onCreateTaskOptimistic,
}: TaskInputProps) {
    const isIOSDevice = isIOS();

    const getDefaultDeadline = () => {
        const defaultDeadline = new Date();
        defaultDeadline.setHours(23, 59, 0, 0);
        if (defaultDeadline.getTime() <= Date.now()) {
            defaultDeadline.setDate(defaultDeadline.getDate() + 1);
        }
        return defaultDeadline;
    };

    const [title, setTitle] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [hasMounted, setHasMounted] = useState(false);
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [selectedVoucherId, setSelectedVoucherId] = useState<string>(defaultVoucherId ?? "");
    const [failureCost, setFailureCost] = useState(defaultFailureCostEuros);

    const [isDateSheetOpen, setIsDateSheetOpen] = useState(false);
    const [dateDraft, setDateDraft] = useState("");
    const [timeDraft, setTimeDraft] = useState("");

    const [recurrenceType, setRecurrenceType] = useState<string>("");
    const [recurrenceLabel, setRecurrenceLabel] = useState<string>("");
    const [showCustomRecurrenceInline, setShowCustomRecurrenceInline] = useState(false);
    const [customDays, setCustomDays] = useState<number[]>([]);
    const [deadlineError, setDeadlineError] = useState<string | null>(null);

    const [showShake, setShowShake] = useState(false);

    const formRef = useRef<HTMLFormElement>(null);
    const dateInputRef = useRef<HTMLInputElement>(null);
    const lastCalendarTapRef = useRef(0);

    useEffect(() => {
        setFailureCost(defaultFailureCostEuros);
    }, [defaultFailureCostEuros]);

    useEffect(() => {
        setSelectedVoucherId(defaultVoucherId ?? "");
    }, [defaultVoucherId]);

    useEffect(() => {
        const defaultDeadline = getDefaultDeadline();
        setSelectedDate(defaultDeadline);
        setDateDraft(getDatePartFromLocalDateTime(toDateTimeLocalValue(defaultDeadline)));
        setTimeDraft(getTimePartFromLocalDateTime(toDateTimeLocalValue(defaultDeadline)));
        setHasMounted(true);
    }, []);

    useEffect(() => {
        if (!selectedVoucherId) return;
        const isStillFriend = friends.some((friend) => friend.id === selectedVoucherId);
        if (!isStillFriend) {
            setSelectedVoucherId("");
        }
    }, [friends, selectedVoucherId]);

    useEffect(() => {
        const localValue = toDateTimeLocalValue(selectedDate);
        if (!localValue) return;
        setDateDraft(getDatePartFromLocalDateTime(localValue));
        setTimeDraft(getTimePartFromLocalDateTime(localValue));
    }, [selectedDate]);

    const getSelectedWeekday = () => {
        return selectedDate?.getDay() ?? new Date().getDay();
    };

    const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
    const weekdayShort: Record<number, string> = {
        1: "M",
        2: "T",
        3: "W",
        4: "T",
        5: "F",
        6: "S",
        0: "S",
    };

    const formatCustomDaysLabel = (days: number[]) => {
        const ordered = weekdayOrder.filter((day) => days.includes(day));
        return ordered.map((day) => weekdayShort[day]).join(" ");
    };

    const formatDeadlineLabel = (date: Date | null) => {
        if (!hasMounted) return "Set date";
        if (!date) return "Set date";
        return date.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const formatDeadlineTitle = (date: Date | null) => {
        if (!hasMounted || !date) return "Set Date";
        return date.toLocaleString();
    };

    const resetDeadlineToDefault = () => {
        setDeadlineError(null);
        setSelectedDate(getDefaultDeadline());
    };

    const openDateSheet = () => {
        const localValue = toDateTimeLocalValue(selectedDate ?? getDefaultDeadline());
        setDateDraft(getDatePartFromLocalDateTime(localValue));
        setTimeDraft(getTimePartFromLocalDateTime(localValue));
        setIsDateSheetOpen(true);
    };

    const handleCalendarClick = () => {
        const now = Date.now();
        const isDoubleTap = now - lastCalendarTapRef.current <= 300;
        lastCalendarTapRef.current = now;

        if (isDoubleTap) {
            resetDeadlineToDefault();
            return;
        }

        if (isIOSDevice) {
            openDateSheet();
            return;
        }

        try {
            if (dateInputRef.current && typeof dateInputRef.current.showPicker === "function") {
                dateInputRef.current.showPicker();
                return;
            }
        } catch {
            // Fall through to modal fallback.
        }

        openDateSheet();
    };

    const applyDateSheet = () => {
        const localValue = combineDateAndTime(dateDraft, timeDraft);
        const parsed = fromDateTimeLocalValue(localValue);
        if (!parsed) return;
        if (parsed.getTime() <= Date.now()) {
            setDeadlineError("Deadline must be in the future.");
            return;
        }
        setDeadlineError(null);
        setSelectedDate(parsed);
        setIsDateSheetOpen(false);
    };

    const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== "Enter") return;
        if (e.nativeEvent.isComposing) return;
        e.preventDefault();
        formRef.current?.requestSubmit();
    };

    useEffect(() => {
        const timeMatch = title.match(/@(\d{1,2})(?::(\d{2}))?/);
        if (timeMatch) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2] || "0");

            if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
                setSelectedDate((previousDate) => {
                    const newDate = new Date(previousDate || new Date());
                    newDate.setHours(hours, minutes, 0, 0);

                    if (newDate < new Date() && !timeMatch[2]) {
                        newDate.setDate(newDate.getDate() + 1);
                    }

                    return newDate;
                });
            }
        }

        const vouchMatch = title.match(/vouch\s+(\w+)/i);
        if (vouchMatch) {
            const name = vouchMatch[1].toLowerCase();
            const friend = friends.find(
                (f) =>
                    f.username?.toLowerCase().includes(name) ||
                    f.email?.toLowerCase().includes(name)
            );
            if (friend) {
                setSelectedVoucherId(friend.id);
            }
        }
    }, [title, friends]);

    const stripMetadata = (text: string) => {
        return text
            .replace(/@\d{1,2}(?::\d{2})?/, "")
            .replace(/vouch\s+\w+/i, "")
            .trim();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const cleanTitle = stripMetadata(title);

        if (!cleanTitle || isLoading) return;

        if (!selectedVoucherId) {
            setShowShake(true);
            setTimeout(() => setShowShake(false), 500);
            return;
        }

        const deadlineToSubmit = selectedDate ?? getDefaultDeadline();
        if (deadlineToSubmit.getTime() <= Date.now()) {
            setDeadlineError("Deadline must be in the future.");
            return;
        }
        setDeadlineError(null);

        const recurrenceDaysToUse =
            recurrenceType === "WEEKLY"
                ? (customDays.length > 0 ? customDays : [getSelectedWeekday()])
                : [];

        const payload: TaskInputCreatePayload = {
            title: cleanTitle,
            deadlineIso: deadlineToSubmit.toISOString(),
            voucherId: selectedVoucherId,
            failureCost,
            recurrenceType: recurrenceType || null,
            recurrenceDays: recurrenceDaysToUse,
            userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };

        if (onCreateTaskOptimistic) {
            onCreateTaskOptimistic(payload);
            setTitle("");
            setRecurrenceType("");
            setRecurrenceLabel("");
            setShowCustomRecurrenceInline(false);
            return;
        }

        setIsLoading(true);
        try {
            const formData = new FormData();
            formData.append("title", payload.title);
            formData.append("deadline", payload.deadlineIso);
            formData.append("voucherId", payload.voucherId);
            formData.append("failureCost", payload.failureCost);

            if (payload.recurrenceType) {
                formData.append("recurrenceType", payload.recurrenceType);
                formData.append("userTimezone", payload.userTimezone);
                formData.append("recurrenceInterval", "1");

                if (payload.recurrenceType === "WEEKLY" && payload.recurrenceDays.length > 0) {
                    formData.append("recurrenceDays", JSON.stringify(payload.recurrenceDays));
                }
            }

            const result = await createTask(formData);
            if (result?.error) {
                console.error("Failed to create task", result.error);
            } else {
                setTitle("");
                setRecurrenceType("");
                setRecurrenceLabel("");
                setShowCustomRecurrenceInline(false);
            }
        } catch (error) {
            console.error("Failed to create task", error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form ref={formRef} onSubmit={handleSubmit} className="relative space-y-3 mb-8">
            <div className="bg-slate-900/50 border border-slate-800/50 focus-within:border-slate-700/50 rounded-xl transition-all shadow-2xl overflow-hidden">
                <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={handleTitleKeyDown}
                    enterKeyHint="done"
                    placeholder="buy milk @14 vouch bob"
                    className="w-full bg-transparent border-none py-4 px-5 text-white placeholder:text-slate-500/70 focus:outline-none transition-all font-medium text-lg"
                    disabled={isLoading}
                />

                <div className="p-2 border-t border-slate-800/30">
                    <div className="flex items-start gap-1.5">
                        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar min-w-0 flex-1 pr-1">
                            <div className="relative w-16 shrink-0">
                                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400 text-[9px] font-mono pointer-events-none z-10">{"\u20ac"}</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={failureCost}
                                    onChange={(e) => setFailureCost(e.target.value)}
                                    className="h-9 w-full pl-4 pr-1 bg-slate-800/30 hover:bg-slate-700/30 border border-slate-700/30 rounded-lg text-slate-300 text-[11px] font-mono focus:outline-none focus:border-slate-600 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-center"
                                    placeholder={defaultFailureCostEuros}
                                />
                            </div>

                            <div className={`flex-1 min-w-[92px] shrink ${showShake ? "animate-shake" : ""}`}>
                                <Select value={selectedVoucherId} onValueChange={setSelectedVoucherId}>
                                    <SelectTrigger className="h-9 w-full bg-slate-800/30 border-slate-700/30 text-slate-300 text-[10px] font-mono focus:ring-0 rounded-lg justify-start px-2">
                                        <User className="h-3 w-3 mr-1.5 shrink-0 opacity-70" />
                                        <SelectValue placeholder="Voucher" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-slate-900 border-slate-800 text-slate-300">
                                        {friends.map((friend) => (
                                            <SelectItem key={friend.id} value={friend.id}>
                                                {friend.username || friend.email}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <input
                                type="datetime-local"
                                ref={dateInputRef}
                                className="absolute -z-10 h-0 w-0 opacity-0 pointer-events-none"
                                value={toDateTimeLocalValue(selectedDate)}
                                onChange={(e) => {
                                    const parsed = fromDateTimeLocalValue(e.target.value);
                                    if (parsed && parsed.getTime() > Date.now()) {
                                        setDeadlineError(null);
                                        setSelectedDate(parsed);
                                    } else if (parsed) {
                                        setDeadlineError("Deadline must be in the future.");
                                    }
                                }}
                                tabIndex={-1}
                                aria-hidden
                            />
                            <button
                                type="button"
                                onClick={handleCalendarClick}
                                onDoubleClick={resetDeadlineToDefault}
                                className={cn(
                                    "h-9 max-w-[180px] shrink-0 px-2.5 bg-slate-800/30 hover:bg-slate-700/30 border border-slate-700/30 text-slate-400 hover:text-slate-200 rounded-lg transition-all flex items-center justify-start gap-1.5",
                                    selectedDate && "text-blue-400 border-blue-500/30 bg-blue-500/5"
                                )}
                                title={formatDeadlineTitle(selectedDate)}
                            >
                                <Calendar className="h-3.5 w-3.5 shrink-0" />
                                <span className="text-[10px] font-mono truncate">{formatDeadlineLabel(selectedDate)}</span>
                            </button>

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className={cn(
                                            "h-9 w-9 shrink-0 bg-slate-800/30 hover:bg-slate-700/30 border border-slate-700/30 text-slate-400 hover:text-slate-200 rounded-lg transition-all flex items-center justify-center",
                                            recurrenceType && "text-purple-400 border-purple-500/30 bg-purple-500/5"
                                        )}
                                        title={recurrenceLabel || "Repeat Task"}
                                    >
                                        <Repeat className="h-3.5 w-3.5" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="bg-slate-900 border-slate-800 text-slate-300 min-w-[180px]">
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setRecurrenceType("");
                                            setRecurrenceLabel("");
                                            setShowCustomRecurrenceInline(false);
                                        }}
                                        className="focus:bg-slate-800 focus:text-slate-200 cursor-pointer text-xs"
                                    >
                                        None
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="bg-slate-800" />
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setRecurrenceType("DAILY");
                                            setRecurrenceLabel("Daily");
                                            setShowCustomRecurrenceInline(false);
                                        }}
                                        className="focus:bg-slate-800 focus:text-slate-200 cursor-pointer text-xs justify-between"
                                    >
                                        Daily
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setRecurrenceType("WEEKLY");
                                            setRecurrenceLabel("Weekly");
                                            setCustomDays([getSelectedWeekday()]);
                                            setShowCustomRecurrenceInline(false);
                                        }}
                                        className="focus:bg-slate-800 focus:text-slate-200 cursor-pointer text-xs"
                                    >
                                        Weekly
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setRecurrenceType("MONTHLY");
                                            setRecurrenceLabel("Monthly");
                                            setShowCustomRecurrenceInline(false);
                                        }}
                                        className="focus:bg-slate-800 focus:text-slate-200 cursor-pointer text-xs"
                                    >
                                        Monthly
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="bg-slate-800" />
                                    <DropdownMenuItem
                                        onSelect={(e) => {
                                            e.preventDefault();
                                            const initialDays = customDays.length > 0 ? customDays : [getSelectedWeekday()];
                                            setCustomDays(initialDays);
                                            setRecurrenceType("WEEKLY");
                                            setRecurrenceLabel(`Custom: ${formatCustomDaysLabel(initialDays)}`);
                                            setShowCustomRecurrenceInline((prev) => !prev);
                                        }}
                                        className="focus:bg-slate-800 focus:text-slate-200 cursor-pointer text-xs"
                                    >
                                        Custom...
                                    </DropdownMenuItem>
                                    {showCustomRecurrenceInline && (
                                        <div className="px-2 pb-2 pt-1 border-t border-slate-800 mt-1 space-y-2">
                                            <div className="text-[10px] text-slate-400 uppercase tracking-wide">Select days</div>
                                            <div className="grid grid-cols-7 gap-1">
                                                {weekdayOrder.map((dayIdx) => {
                                                    const isSelected = customDays.includes(dayIdx);
                                                    return (
                                                        <button
                                                            key={dayIdx}
                                                            type="button"
                                                            onClick={() => {
                                                                const next = customDays.includes(dayIdx)
                                                                    ? customDays.filter((d) => d !== dayIdx)
                                                                    : [...customDays, dayIdx];
                                                                const normalizedRaw = weekdayOrder.filter((d) => next.includes(d));
                                                                const normalized = normalizedRaw.length > 0 ? normalizedRaw : [dayIdx];
                                                                setCustomDays(normalized);
                                                                setRecurrenceType("WEEKLY");
                                                                setRecurrenceLabel(`Custom: ${formatCustomDaysLabel(normalized)}`);
                                                            }}
                                                            className={cn(
                                                                "h-7 w-7 rounded-md text-[10px] font-semibold transition-colors",
                                                                isSelected
                                                                    ? "bg-blue-600 text-white"
                                                                    : "bg-slate-800/60 text-slate-300 hover:bg-slate-700"
                                                            )}
                                                        >
                                                            {weekdayShort[dayIdx]}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="h-9 w-9 shrink-0 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-400 rounded-lg transition-all disabled:opacity-50 flex items-center justify-center"
                        >
                            {isLoading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
                            ) : (
                                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                            )}
                        </button>
                    </div>
                </div>
            </div>

            <Dialog open={isDateSheetOpen} onOpenChange={setIsDateSheetOpen}>
                <DialogContent className="bg-slate-900 border-slate-800 text-slate-200">
                    <DialogHeader>
                        <DialogTitle className="text-white">Set deadline</DialogTitle>
                        <DialogDescription className="text-slate-400">
                            Pick date and time for this task.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <label className="text-xs uppercase tracking-wide text-slate-400">Date</label>
                            <input
                                type="date"
                                value={dateDraft}
                                onChange={(e) => setDateDraft(e.target.value)}
                                className="h-9 w-full px-3 bg-slate-800/40 border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:border-slate-500"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs uppercase tracking-wide text-slate-400">Time</label>
                            <input
                                type="time"
                                value={timeDraft}
                                onChange={(e) => setTimeDraft(e.target.value)}
                                step={60}
                                className="h-9 w-full px-3 bg-slate-800/40 border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:border-slate-500"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <button
                            type="button"
                            onClick={() => setIsDateSheetOpen(false)}
                            className="h-9 px-3 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                resetDeadlineToDefault();
                                setIsDateSheetOpen(false);
                            }}
                            className="h-9 px-3 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800"
                        >
                            Reset
                        </button>
                        <button
                            type="button"
                            onClick={applyDateSheet}
                            disabled={!dateDraft || !timeDraft}
                            className="h-9 px-3 rounded-md bg-blue-600/20 border border-blue-500/30 text-blue-300 hover:bg-blue-600/30 disabled:opacity-50"
                        >
                            Apply
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div className="flex gap-4 px-2">
                <p className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">
                    Tip: Use <span className="text-slate-300">@time</span> and <span className="text-slate-300">vouch name</span>
                </p>
            </div>
            {deadlineError && (
                <p className="px-2 text-xs text-red-400">{deadlineError}</p>
            )}
        </form>
    );
}
