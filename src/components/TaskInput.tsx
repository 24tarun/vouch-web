"use client";

import { useState, useRef, useEffect } from "react";
import { createTask } from "@/actions/tasks";
import { Loader2, Calendar, User, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface TaskInputProps {
    friends: any[];
}

export function TaskInput({ friends }: TaskInputProps) {
    const [title, setTitle] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [selectedVoucherId, setSelectedVoucherId] = useState<string>("");
    const [failureCost, setFailureCost] = useState("0.10");
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

            const result = await createTask(formData);
            if (result?.error) {
                console.error("Failed to create task", result.error);
            } else {
                setTitle("");
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
            <div className="relative group">
                <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="buy milk @14 vouch bob"
                    className="w-full bg-slate-900/50 border border-slate-800/50 focus:border-slate-700/50 rounded-xl py-4 px-5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:bg-slate-900 transition-all font-medium text-lg shadow-2xl"
                    disabled={isLoading}
                />

                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-3">
                    {isLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
                    ) : (
                        <div className="flex items-center gap-2">
                            {/* Cost Button/Input */}
                            <div className="relative flex items-center">
                                <span className="absolute left-2.5 text-slate-500 text-[10px] font-mono pointer-events-none">€</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={failureCost}
                                    onChange={(e) => setFailureCost(e.target.value)}
                                    className="h-9 w-16 pl-5 pr-2 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 rounded-md text-slate-300 text-xs font-mono focus:outline-none focus:border-slate-600 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    placeholder="0.10"
                                />
                            </div>

                            {/* Active/Submit Button */}
                            <Button
                                type="submit"
                                variant="ghost"
                                size="sm"
                                disabled={isLoading}
                                className="h-9 px-3 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 text-slate-300 text-xs font-mono"
                            >
                                {isLoading ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    "Active"
                                )}
                            </Button>

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
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => dateInputRef.current?.showPicker()}
                                className="h-9 px-3 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 text-slate-300 text-xs font-mono"
                            >
                                <Calendar className="h-3.5 w-3.5 mr-2" />
                                {mounted && selectedDate ? selectedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Date"}
                            </Button>

                            {/* Voucher Select */}
                            <div className={showShake ? "animate-shake" : ""}>
                                <Select value={selectedVoucherId} onValueChange={setSelectedVoucherId}>
                                    <SelectTrigger className="h-9 min-w-[120px] bg-slate-800/50 border-slate-700/50 text-slate-300 text-xs font-mono focus:ring-0">
                                        <User className="h-3.5 w-3.5 mr-2" />
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
                        </div>
                    )}
                </div>
            </div>

            {/* Help text/Hints */}
            <div className="flex gap-4 px-2">
                <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                    Tip: Use <span className="text-slate-400">@time</span> and <span className="text-slate-400">vouch name</span>
                </p>
            </div>
        </form>
    );
}
