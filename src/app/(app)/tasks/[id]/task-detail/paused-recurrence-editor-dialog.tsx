"use client";

import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
    updatePausedRecurrenceSettings,
    type PausedRecurrenceSettings,
} from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    getCurrencySymbol,
    getFailureCostBounds,
    isValidFailureCostCents,
    type SupportedCurrency,
} from "@/lib/currency";
import { AI_PROFILE_ID } from "@/lib/ai-voucher/constants";
import type { RecurrenceRule } from "@/lib/types";
import { cn } from "@/lib/utils";

export type RecurrenceEditorField = "deadline" | "failureCost" | "voucher" | "requiresProof";

interface FriendOption {
    id: string;
    username: string | null;
    email: string;
}

interface Props {
    field: RecurrenceEditorField;
    taskId: string;
    recurrenceRule: RecurrenceRule;
    viewerId: string;
    currency: SupportedCurrency;
    friends: FriendOption[];
    friendsLoading: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: (settings: PausedRecurrenceSettings) => void;
}

const FIELD_TITLE: Record<RecurrenceEditorField, string> = {
    deadline: "Future deadline",
    failureCost: "Future failure cost",
    voucher: "Future voucher",
    requiresProof: "Proof for future repetitions",
};

function formatFailureCostInput(cents: number): string {
    const major = cents / 100;
    return Number.isInteger(major) ? String(major) : major.toFixed(2);
}

export function PausedRecurrenceEditorDialog({
    field,
    taskId,
    recurrenceRule,
    viewerId,
    currency,
    friends,
    friendsLoading,
    onOpenChange,
    onSaved,
}: Props) {
    const [timeOfDay, setTimeOfDay] = useState(recurrenceRule.rule_config.time_of_day);
    const [failureCost, setFailureCost] = useState(() => formatFailureCostInput(recurrenceRule.failure_cost_cents));
    const [voucherId, setVoucherId] = useState(recurrenceRule.voucher_id || viewerId);
    const [requiresProof, setRequiresProof] = useState(Boolean(recurrenceRule.requires_proof));
    const [saving, setSaving] = useState(false);
    const currencySymbol = getCurrencySymbol(currency);
    const aiVoucherSelected = voucherId === AI_PROFILE_ID;

    const sortedFriends = useMemo(
        () => [...friends].sort((a, b) =>
            (a.username || a.email).localeCompare(b.username || b.email)
        ),
        [friends]
    );

    async function save() {
        if (saving) return;

        let patch:
            | { timeOfDay: string }
            | { failureCostCents: number }
            | { voucherId: string }
            | { requiresProof: boolean };

        if (field === "deadline") {
            if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay)) {
                toast.error("Choose a valid deadline time.");
                return;
            }
            patch = { timeOfDay };
        } else if (field === "failureCost") {
            const major = Number(failureCost.trim());
            const cents = Math.round(major * 100);
            const bounds = getFailureCostBounds(currency);
            if (!Number.isFinite(major) || !isValidFailureCostCents(cents, bounds)) {
                toast.error(
                    `Failure cost must be between ${currencySymbol}${bounds.minMajor} and ${currencySymbol}${bounds.maxMajor}, in ${currencySymbol}${bounds.step} increments.`
                );
                return;
            }
            patch = { failureCostCents: cents };
        } else if (field === "voucher") {
            patch = { voucherId };
        } else {
            patch = { requiresProof: aiVoucherSelected ? true : requiresProof };
        }

        setSaving(true);
        const result = await updatePausedRecurrenceSettings(taskId, patch);
        setSaving(false);

        if (!result.success || !result.settings) {
            toast.error(result.error || "Could not update future repetitions.");
            return;
        }

        onSaved(result.settings);
    }

    return (
        <Dialog open onOpenChange={onOpenChange}>
            <DialogContent className="border-slate-800 bg-slate-950 text-slate-200 sm:max-w-md">
                <DialogHeader>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-purple-400">
                        Paused repetition
                    </p>
                    <DialogTitle>{FIELD_TITLE[field]}</DialogTitle>
                    <DialogDescription className="text-slate-500">
                        This changes future repetitions only. Existing iterations keep their original values.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 pt-2">
                    {field === "deadline" && (
                        <Input
                            type="time"
                            value={timeOfDay}
                            onChange={(event) => setTimeOfDay(event.target.value)}
                            className="h-12 border-slate-700 bg-slate-900 font-mono text-slate-100"
                            aria-label="Deadline time for future repetitions"
                        />
                    )}

                    {field === "failureCost" && (
                        <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                                {currencySymbol}
                            </span>
                            <Input
                                type="number"
                                inputMode="decimal"
                                value={failureCost}
                                min={getFailureCostBounds(currency).minMajor}
                                max={getFailureCostBounds(currency).maxMajor}
                                step={getFailureCostBounds(currency).step}
                                onChange={(event) => setFailureCost(event.target.value)}
                                className="h-12 border-slate-700 bg-slate-900 pl-8 font-mono text-slate-100"
                                aria-label="Failure cost for future repetitions"
                            />
                        </div>
                    )}

                    {field === "voucher" && (
                        <div className="space-y-2">
                            <Select value={voucherId} onValueChange={setVoucherId} disabled={friendsLoading}>
                                <SelectTrigger className="h-12 w-full border-slate-700 bg-slate-900 text-slate-100">
                                    <SelectValue placeholder={friendsLoading ? "Loading vouchers…" : "Choose a voucher"} />
                                </SelectTrigger>
                                <SelectContent className="border-slate-700 bg-slate-900 text-slate-100">
                                    <SelectItem value={viewerId}>Self</SelectItem>
                                    {sortedFriends.map((friend) => (
                                        <SelectItem key={friend.id} value={friend.id}>
                                            {friend.id === AI_PROFILE_ID ? "AI" : (friend.username || friend.email)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {aiVoucherSelected && (
                                <p className="text-xs text-purple-400">AI-vouched repetitions always require proof.</p>
                            )}
                        </div>
                    )}

                    {field === "requiresProof" && (
                        <div className="grid grid-cols-2 gap-3">
                            {[true, false].map((value) => {
                                const disabled = aiVoucherSelected && !value;
                                const selected = (aiVoucherSelected ? true : requiresProof) === value;
                                return (
                                    <button
                                        key={String(value)}
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => setRequiresProof(value)}
                                        className={cn(
                                            "flex h-12 items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition-colors",
                                            selected
                                                ? "border-purple-400 bg-purple-400/10 text-purple-200"
                                                : "border-slate-800 bg-slate-900 text-slate-500 hover:border-slate-700",
                                            disabled && "cursor-not-allowed opacity-40"
                                        )}
                                    >
                                        {selected && <Check className="h-4 w-4" />}
                                        {value ? "True" : "False"}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    <Button
                        type="button"
                        onClick={() => void save()}
                        disabled={saving}
                        className="h-11 w-full bg-purple-400 font-semibold text-slate-950 hover:bg-purple-300"
                    >
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {saving ? "Saving…" : "Save for future repetitions"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
