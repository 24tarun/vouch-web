"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCurrencyFromCents, type SupportedCurrency } from "@/lib/currency";
import { formatDateTimeDDMMYYYY } from "@/lib/date-format";

export interface PickerTask {
    id: string;
    title: string;
    deadline: string;
    failure_cost_cents: number;
}

export interface PickerRecurrenceRule {
    id: string;
    title: string;
    failure_cost_cents: number;
}

interface TaskPickerModalProps {
    open: boolean;
    onOpenChange: (nextOpen: boolean) => void;
    tasks: PickerTask[];
    recurrenceRules: PickerRecurrenceRule[];
    linkedTaskIds: string[];
    linkedRecurrenceRuleIds: string[];
    currency: SupportedCurrency;
    onSelectTask: (taskId: string) => void;
    onSelectRecurrenceRule: (recurrenceRuleId: string) => void;
    onUnlinkTask: (taskId: string) => void;
    onUnlinkRecurrenceRule: (recurrenceRuleId: string) => void;
}

function toSearchTarget(value: string): string {
    return value.trim().toLowerCase();
}

export function TaskPickerModal({
    open,
    onOpenChange,
    tasks,
    recurrenceRules,
    linkedTaskIds,
    linkedRecurrenceRuleIds,
    currency,
    onSelectTask,
    onSelectRecurrenceRule,
    onUnlinkTask,
    onUnlinkRecurrenceRule,
}: TaskPickerModalProps) {
    const [query, setQuery] = useState("");
    const normalizedQuery = toSearchTarget(query);
    const linkedTaskIdSet = useMemo(() => new Set(linkedTaskIds), [linkedTaskIds]);
    const linkedRuleIdSet = useMemo(() => new Set(linkedRecurrenceRuleIds), [linkedRecurrenceRuleIds]);

    const filteredTasks = useMemo(() => {
        if (!normalizedQuery) return tasks;
        return tasks.filter((task) => toSearchTarget(task.title).includes(normalizedQuery));
    }, [tasks, normalizedQuery]);

    const filteredRules = useMemo(() => {
        if (!normalizedQuery) return recurrenceRules;
        return recurrenceRules.filter((rule) => toSearchTarget(rule.title).includes(normalizedQuery));
    }, [recurrenceRules, normalizedQuery]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl bg-slate-950 border-slate-800 text-slate-200">
                <DialogHeader>
                    <DialogTitle className="text-white">Add linked tasks</DialogTitle>
                    <DialogDescription className="text-slate-400">
                        Pick one-off tasks or recurring series to include in this commitment.
                    </DialogDescription>
                </DialogHeader>

                <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search tasks or recurring series"
                    className="bg-slate-900/50 border-slate-800 text-slate-100 placeholder:text-slate-600"
                />

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    {/* Recurring series column */}
                    <div>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">Recurring series</p>
                        <div className="max-h-72 overflow-y-auto">
                            {filteredRules.length === 0 ? (
                                <p className="text-sm text-slate-600 italic">No recurring series found.</p>
                            ) : (
                                <div className="flex flex-col">
                                    {filteredRules.map((rule) => {
                                        const linked = linkedRuleIdSet.has(rule.id);
                                        return (
                                            <div
                                                key={rule.id}
                                                className="flex items-center justify-between gap-3 border-b border-slate-900 py-3 last:border-0 transition-colors hover:bg-slate-900/30"
                                            >
                                                <div className="min-w-0">
                                                    <p className="text-sm text-slate-100 truncate">{rule.title}</p>
                                                    <p className="text-xs text-slate-500">
                                                        {formatCurrencyFromCents(rule.failure_cost_cents, currency)}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (linked) {
                                                            onUnlinkRecurrenceRule(rule.id);
                                                            return;
                                                        }
                                                        onSelectRecurrenceRule(rule.id);
                                                    }}
                                                    className={`shrink-0 text-[10px] uppercase tracking-wider font-bold transition-colors ${
                                                        linked
                                                            ? "text-red-400/80 hover:text-red-300"
                                                            : "text-slate-500 hover:text-slate-300"
                                                    }`}
                                                >
                                                    {linked ? "Unlink" : "Add"}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* One-off tasks column */}
                    <div>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">One-off tasks</p>
                        <div className="max-h-72 overflow-y-auto">
                            {filteredTasks.length === 0 ? (
                                <p className="text-sm text-slate-600 italic">No tasks found.</p>
                            ) : (
                                <div className="flex flex-col">
                                    {filteredTasks.map((task) => {
                                        const linked = linkedTaskIdSet.has(task.id);
                                        return (
                                            <div
                                                key={task.id}
                                                className="flex items-center justify-between gap-3 border-b border-slate-900 py-3 last:border-0 transition-colors hover:bg-slate-900/30"
                                            >
                                                <div className="min-w-0">
                                                    <p className="text-sm text-slate-100 truncate">{task.title}</p>
                                                    <p className="text-xs text-slate-500">
                                                        {formatDateTimeDDMMYYYY(task.deadline)} · {formatCurrencyFromCents(task.failure_cost_cents, currency)}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (linked) {
                                                            onUnlinkTask(task.id);
                                                            return;
                                                        }
                                                        onSelectTask(task.id);
                                                    }}
                                                    className={`shrink-0 text-[10px] uppercase tracking-wider font-bold transition-colors ${
                                                        linked
                                                            ? "text-red-400/80 hover:text-red-300"
                                                            : "text-slate-500 hover:text-slate-300"
                                                    }`}
                                                >
                                                    {linked ? "Unlink" : "Add"}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
