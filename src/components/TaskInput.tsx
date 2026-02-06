"use client";

import { useState, useRef, useEffect } from "react";
import { createTask } from "@/actions/tasks";
import { Loader2, Calendar, User, Check } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_FAILURE_COST_EUROS } from "@/lib/constants";





interface TaskInputProps {
    friends: any[];
}

export function TaskInput({ friends }: TaskInputProps) {
    const [title, setTitle] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [selectedVoucherId, setSelectedVoucherId] = useState<string>("");
    const [failureCost, setFailureCost] = useState(DEFAULT_FAILURE_COST_EUROS);




    // Recurrence State
    const [recurrenceType, setRecurrenceType] = useState<string>(""); // "" means none
    const [recurrenceLabel, setRecurrenceLabel] = useState<string>("");

    // Custom recurrence state (inline in dropdown)
    const [showCustomRecurrenceInline, setShowCustomRecurrenceInline] = useState(false);
    const [customDays, setCustomDays] = useState<number[]>([]); // 0-6


    const [showShake, setShowShake] = useState(false);

    const dateInputRef = useRef<HTMLInputElement>(null);

    // Default deadline to end of today
    useEffect(() => {
        const defaultDeadline = new Date();
        defaultDeadline.setHours(23, 59, 0, 0);
        setSelectedDate(defaultDeadline);
    }, []);

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

    // NLP Parsing
    useEffect(() => {
        // Parse time: @14 or @14:30
        const timeMatch = title.match(/@(\d{1,2})(?::(\d{2}))?/);
        if (timeMatch) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2] || "0");

            if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
                const newDate = new Date(selectedDate || new Date());
                newDate.setHours(hours, minutes, 0, 0);

                // If time already passed today, set for tomorrow
                if (newDate < new Date() && !timeMatch[2]) {
                    newDate.setDate(newDate.getDate() + 1);
                }
                setSelectedDate(newDate);
            }
        }

        // Parse voucher: vouch <name>
        const vouchMatch = title.match(/vouch\s+(\w+)/i);
        if (vouchMatch) {
            const name = vouchMatch[1].toLowerCase();
            const friend = friends.find(f =>
                f.username?.toLowerCase().includes(name) ||
                f.display_name?.toLowerCase().includes(name)
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

        setIsLoading(true);
        try {
            const formData = new FormData();
            formData.append("title", cleanTitle);
            formData.append("deadline", selectedDate?.toISOString() || "");
            formData.append("voucherId", selectedVoucherId);
            formData.append("failureCost", failureCost);

            if (recurrenceType) {
                formData.append("recurrenceType", recurrenceType);
                formData.append("userTimezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
                formData.append("recurrenceInterval", "1");

                if (recurrenceType === "WEEKLY") {
                    const daysToUse = customDays.length > 0 ? customDays : [getSelectedWeekday()];
                    formData.append("recurrenceDays", JSON.stringify(daysToUse));
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

                // setSelectedVoucherId(""); // Keep if user wants to create multiple for same person?

            }
        } catch (error) {
            console.error("Failed to create task", error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="relative space-y-3 mb-8">
            <div className="bg-slate-900/50 border border-slate-800/50 focus-within:border-slate-700/50 rounded-xl transition-all shadow-2xl overflow-hidden">
                <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="buy milk @14 vouch bob"
                    className="w-full bg-transparent border-none py-4 px-5 text-white placeholder:text-slate-400 focus:outline-none transition-all font-medium text-lg"
                    disabled={isLoading}
                />

                <div className="p-2 flex items-center gap-1.5 border-t border-slate-800/30 overflow-x-auto no-scrollbar">
                    {/* Cost Input */}
                    <div className="relative w-16 shrink-0">
                        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400 text-[9px] font-mono pointer-events-none z-10">€</span>
                        <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={failureCost}
                            onChange={(e) => setFailureCost(e.target.value)}
                            className="h-9 w-full pl-4 pr-1 bg-slate-800/30 hover:bg-slate-700/30 border border-slate-700/30 rounded-lg text-slate-300 text-[11px] font-mono focus:outline-none focus:border-slate-600 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-center"
                            placeholder={DEFAULT_FAILURE_COST_EUROS}
                        />
                    </div>

                    {/* Voucher Select */}
                    <div className={`flex-1 min-w-[100px] shrink ${showShake ? "animate-shake" : ""}`}>
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

                    {/* Date Picker Button */}
                    <input
                        type="datetime-local"
                        ref={dateInputRef}
                        className="hidden"
                        onChange={(e) => {
                            if (e.target.value) {
                                setSelectedDate(new Date(e.target.value));
                            }
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => dateInputRef.current?.showPicker()}
                        className={cn(
                            "h-9 w-9 shrink-0 bg-slate-800/30 hover:bg-slate-700/30 border border-slate-700/30 text-slate-400 hover:text-slate-200 rounded-lg transition-all flex items-center justify-center",
                            selectedDate && "text-blue-400 border-blue-500/30 bg-blue-500/5"
                        )}
                        title={selectedDate ? selectedDate.toLocaleString() : "Set Date"}
                    >
                        <Calendar className="h-3.5 w-3.5" />
                    </button>

                    {/* Repeat Toggle */}
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
                            <DropdownMenuItem onClick={() => { setRecurrenceType(""); setRecurrenceLabel(""); setShowCustomRecurrenceInline(false); }} className="focus:bg-slate-800 focus:text-slate-200 cursor-pointer text-xs">
                                None
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-slate-800" />
                            <DropdownMenuItem onClick={() => { setRecurrenceType("DAILY"); setRecurrenceLabel("Daily"); setShowCustomRecurrenceInline(false); }} className="focus:bg-slate-800 focus:text-slate-200 cursor-pointer text-xs justify-between">
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



                    {/* Active/Submit Button */}
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="h-9 w-9 shrink-0 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-400 rounded-lg transition-all disabled:opacity-50 flex items-center justify-center ml-auto"
                    >
                        {isLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
                        ) : (
                            <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        )}
                    </button>
                </div >
            </div >


            {/* Test/Hints */}
            < div className="flex gap-4 px-2" >
                <p className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">
                    Tip: Use <span className="text-slate-300">@time</span> and <span className="text-slate-300">vouch name</span>
                </p>
            </div >

        </form >

    );
}
