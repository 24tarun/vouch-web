"use client";

import { useState, useRef, useEffect } from "react";
import { createTask } from "@/actions/tasks";
import { Loader2, Calendar, User, Check } from "lucide-react";
import { useRouter } from "next/navigation";
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
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
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

    // Custom Recurrence State
    const [showCustomRecurrence, setShowCustomRecurrence] = useState(false);
    const [customFreq, setCustomFreq] = useState("DAILY");
    const [customInterval, setCustomInterval] = useState("1");
    const [customDays, setCustomDays] = useState<number[]>([]); // 0-6


    const [showShake, setShowShake] = useState(false);
    const [mounted, setMounted] = useState(false);

    const dateInputRef = useRef<HTMLInputElement>(null);
    const router = useRouter();

    useEffect(() => {
        setMounted(true);
    }, []);

    // Default deadline to end of today
    useEffect(() => {
        const defaultDeadline = new Date();
        defaultDeadline.setHours(23, 59, 0, 0);
        setSelectedDate(defaultDeadline);
    }, []);

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

                // Defaults for the preset types
                if (recurrenceType === "DAILY") {
                    formData.append("recurrenceInterval", "1");
                }
                // Custom handling (if type is one of the standards but customized)
                if (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(recurrenceType) && recurrenceLabel.startsWith("Every")) {
                    formData.append("recurrenceInterval", customInterval);
                    if (recurrenceType === "WEEKLY" && customDays.length > 0) {
                        formData.append("recurrenceDays", JSON.stringify(customDays));
                    }
                }

                // For "WEEKDAYS", frequency is WEEKDAYS.
                // For now, simple presets.
            }


            const result = await createTask(formData);
            if (result?.error) {
                console.error("Failed to create task", result.error);
            } else {

                setTitle("");
                setRecurrenceType("");
                setRecurrenceLabel("");

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
                            {/* ... existing menu items ... */}
                            <DropdownMenuItem onClick={() => { setRecurrenceType(""); setRecurrenceLabel(""); }} className="focus:bg-slate-800 focus:text-slate-200 cursor-pointer text-xs">
                                None
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-slate-800" />
                            <DropdownMenuItem onClick={() => { setRecurrenceType("DAILY"); setRecurrenceLabel("Daily"); }} className="focus:bg-slate-800 focus:text-slate-200 cursor-pointer text-xs justify-between">
                                Daily
                            </DropdownMenuItem>
                            {/* ... implicit other items ... */}
                            {/* We are replacing the whole trigger section actually to adding a new button? No, just appending button after Repeating toggle */}
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

            {/* Custom Recurrence Dialog */}
            < Dialog open={showCustomRecurrence} onOpenChange={setShowCustomRecurrence} >
                <DialogContent className="bg-[#1a1c1e] border-slate-800 text-slate-200 sm:max-w-[360px] p-6 rounded-3xl">
                    <div className="space-y-6">
                        {/* Due Date Dropdown/Button */}
                        <div className="relative">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => dateInputRef.current?.showPicker()}
                                className="w-full h-12 bg-transparent border-2 border-blue-500/50 hover:bg-blue-500/10 text-slate-200 rounded-2xl justify-between px-5 text-lg font-medium"
                            >
                                {mounted && selectedDate ? selectedDate.toLocaleDateString("en-US", { month: 'short', day: 'numeric', year: 'numeric' }) : "Due Date"}
                                <span className="text-slate-500 text-xs">▼</span>
                            </Button>
                        </div>

                        {/* Interval Row */}
                        <div className="flex items-center gap-2">
                            <div className="flex-1 flex items-center bg-[#242629] rounded-2xl px-4 h-12 border border-slate-800">
                                <span className="text-slate-400 text-lg mr-auto">Every</span>
                                <input
                                    type="number"
                                    min="1"
                                    value={customInterval}
                                    onChange={(e) => setCustomInterval(e.target.value)}
                                    className="w-12 bg-transparent text-blue-500 text-xl font-medium text-center focus:outline-none"
                                />
                            </div>
                            <div className="flex-1">
                                <Select value={customFreq} onValueChange={setCustomFreq}>
                                    <SelectTrigger className="w-full bg-[#242629] border-slate-800 h-12 rounded-2xl text-lg font-medium ring-0 focus:ring-0">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#242629] border-slate-800 text-slate-200">
                                        <SelectItem value="DAILY">Day</SelectItem>
                                        <SelectItem value="WEEKLY">Week</SelectItem>
                                        <SelectItem value="MONTHLY">Month</SelectItem>
                                        <SelectItem value="YEARLY">Year</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Day Selector */}
                        <div className="flex justify-between items-center px-1">
                            {["M", "T", "W", "T", "F", "S", "S"].map((day, idx) => {
                                // Adjusted index for Mon-Sun: 1, 2, 3, 4, 5, 6, 0
                                const dayIdx = idx === 6 ? 0 : idx + 1;
                                const isSelected = customDays.includes(dayIdx);
                                return (
                                    <button
                                        key={idx}
                                        type="button"
                                        onClick={() => {
                                            setCustomDays(prev =>
                                                prev.includes(dayIdx)
                                                    ? prev.filter(d => d !== dayIdx)
                                                    : [...prev, dayIdx].sort()
                                            );
                                        }}
                                        className={cn(
                                            "w-10 h-10 rounded-full text-lg font-medium transition-all flex items-center justify-center",
                                            isSelected
                                                ? "bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]"
                                                : "text-slate-400 hover:text-slate-200"
                                        )}
                                    >
                                        {day}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-3 pt-2">
                            <Button
                                className="flex-1 h-14 bg-blue-600 hover:bg-blue-500 text-white text-xl font-bold rounded-2xl shadow-lg active:scale-[0.98] transition-all"
                                onClick={() => {
                                    setRecurrenceType(customFreq);
                                    const unit = customFreq.toLowerCase().replace("ly", "") + (parseInt(customInterval) > 1 ? "s" : "");
                                    setRecurrenceLabel(`Every ${customInterval} ${unit}`);
                                    setShowCustomRecurrence(false);
                                }}
                            >
                                OK
                            </Button>
                            <Button
                                variant="outline"
                                className="flex-1 h-14 bg-transparent border-slate-700 text-slate-200 text-xl font-medium rounded-2xl hover:bg-slate-800 transition-all"
                                onClick={() => setShowCustomRecurrence(false)}
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog >
        </form >

    );
}
