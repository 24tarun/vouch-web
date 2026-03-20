"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { addTaskLink, activateCommitment, createCommitment } from "@/actions/commitments";
import { computeTotalTarget } from "@/lib/commitment-status";
import { formatCurrencyFromCents, type SupportedCurrency } from "@/lib/currency";
import { formatDateTimeDDMMYYYY } from "@/lib/date-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TaskPickerModal, type PickerRecurrenceRule, type PickerTask } from "@/components/TaskPickerModal";

interface CommitmentCreatorRecurrenceRule extends PickerRecurrenceRule {
    created_at: string;
    last_generated_date: string | null;
    rule_config: {
        frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | "WEEKDAYS" | "CUSTOM";
        interval: number;
        days_of_week?: number[];
        time_of_day: string;
    };
}

interface CommitmentCreatorClientProps {
    currency: SupportedCurrency;
    tasks: PickerTask[];
    recurrenceRules: CommitmentCreatorRecurrenceRule[];
}

function toDateOnlyString(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

export function CommitmentCreatorClient({
    currency,
    tasks,
    recurrenceRules,
}: CommitmentCreatorClientProps) {
    const router = useRouter();
    const today = useMemo(() => toDateOnlyString(new Date()), []);

    const availableTasks = tasks;
    const availableRecurrenceRules = recurrenceRules;
    const [name, setName] = useState("");
    const [startDate, setStartDate] = useState(today);
    const [durationInput, setDurationInput] = useState("7");
    const durationDays = Math.max(3, parseInt(durationInput, 10) || 3);
    const endDate = toDateOnlyString(addDays(new Date(`${startDate}T00:00:00.000Z`), durationDays - 1));
    const [linkedTaskIds, setLinkedTaskIds] = useState<string[]>([]);
    const [linkedRecurrenceRuleIds, setLinkedRecurrenceRuleIds] = useState<string[]>([]);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showIssues, setShowIssues] = useState(false);
    const [shaking, setShaking] = useState(false);

    const linkedTasks = useMemo(
        () => availableTasks.filter((task) => linkedTaskIds.includes(task.id)),
        [availableTasks, linkedTaskIds]
    );
    const linkedRules = useMemo(
        () => availableRecurrenceRules.filter((rule) => linkedRecurrenceRuleIds.includes(rule.id)),
        [availableRecurrenceRules, linkedRecurrenceRuleIds]
    );

    const liveTotalCents = useMemo(() => {
        const links = [
            ...linkedTaskIds.map((taskId, index) => ({
                id: `task-${index}`,
                commitment_id: "draft",
                task_id: taskId,
                recurrence_rule_id: null,
                created_at: new Date().toISOString(),
            })),
            ...linkedRecurrenceRuleIds.map((ruleId, index) => ({
                id: `rule-${index}`,
                commitment_id: "draft",
                task_id: null,
                recurrence_rule_id: ruleId,
                created_at: new Date().toISOString(),
            })),
        ];

        return computeTotalTarget(links, linkedRules, linkedTasks, startDate, endDate);
    }, [endDate, linkedRecurrenceRuleIds, linkedRules, linkedTaskIds, linkedTasks, startDate]);


    const handleLinkTask = (taskId: string) => {
        setLinkedTaskIds((prev) => (prev.includes(taskId) ? prev : [...prev, taskId]));
    };

    const handleLinkRule = (ruleId: string) => {
        setLinkedRecurrenceRuleIds((prev) => (prev.includes(ruleId) ? prev : [...prev, ruleId]));
    };

    const handleUnlinkTask = (taskId: string) => {
        setLinkedTaskIds((prev) => prev.filter((id) => id !== taskId));
    };

    const handleUnlinkRule = (ruleId: string) => {
        setLinkedRecurrenceRuleIds((prev) => prev.filter((id) => id !== ruleId));
    };

    const persistCommitment = async (activateNow: boolean) => {
        if (isSaving) return;
        setIsSaving(true);
        setError(null);

        const commitmentResult = await createCommitment({
            name,
            start_date: startDate,
            end_date: endDate,
        });

        if (!commitmentResult.success) {
            setError(commitmentResult.error);
            setIsSaving(false);
            return;
        }

        const commitmentId = commitmentResult.commitmentId;
        const linksToCreate = [
            ...linkedTaskIds.map((taskId) => ({ task_id: taskId })),
            ...linkedRecurrenceRuleIds.map((ruleId) => ({ recurrence_rule_id: ruleId })),
        ];

        const linkResults = await Promise.all(linksToCreate.map((link) => addTaskLink(commitmentId, link)));
        const firstLinkError = linkResults.find((result) => !result.success);
        if (firstLinkError && !firstLinkError.success) {
            setError(firstLinkError.error);
            setIsSaving(false);
            return;
        }

        if (activateNow) {
            const activateResult = await activateCommitment(commitmentId);
            if (!activateResult.success) {
                setError(activateResult.error);
                setIsSaving(false);
                return;
            }
        }

        toast.success(activateNow ? "Commitment activated." : "Commitment saved as draft.");
        router.push("/dashboard/commitments");
        router.refresh();
    };

    const linkedCount = linkedTaskIds.length + linkedRecurrenceRuleIds.length;

    const activateIssues = useMemo(() => {
        const issues: string[] = [];
        if (!name.trim()) issues.push("Name is required.");
        if (startDate < today) issues.push("Start date cannot be in the past.");
        if (durationDays < 3) issues.push("Duration must be at least 3 days.");
        if (linkedCount === 0) issues.push("Link at least one task or recurring series.");
        return issues;
    }, [name, startDate, endDate, today, linkedCount]);

    const canActivate = activateIssues.length === 0 && !isSaving;

    const triggerShake = () => {
        setShaking(true);
        setTimeout(() => setShaking(false), 500);
    };

    const handleAction = (activateNow: boolean) => {
        const draftIssues = activateNow
            ? activateIssues
            : !name.trim() ? ["Name is required."] : [];
        if (draftIssues.length > 0) {
            setShowIssues(true);
            triggerShake();
            return;
        }
        setShowIssues(false);
        void persistCommitment(activateNow);
    };

    return (
        <div className="mx-auto flex w-full max-w-4xl flex-col px-4 md:px-0 pb-20 mt-12">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold text-white">New Commitment</h1>
                <p className="mt-1 text-sm text-slate-400">Bundle tasks into a window and earn spend.</p>
            </div>

            {/* Stats row — ledger style */}
            <div className="mt-10 grid grid-cols-2 md:grid-cols-3 gap-8">
                <div className="space-y-0.5">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Pledging for</p>
                    <p className="text-4xl font-light text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.6)]">
                        {formatCurrencyFromCents(liveTotalCents, currency)}
                    </p>
                </div>
                <div className="space-y-0.5">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Duration</p>
                    <p className="text-4xl font-light text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]">
                        {durationDays}<span className="text-lg text-cyan-400/60 ml-1">day{durationDays === 1 ? "" : "s"}</span>
                    </p>
                </div>
                <div className="space-y-0.5">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Linked</p>
                    <p className="text-4xl font-light text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.6)]">
                        {linkedCount}<span className="text-lg text-blue-400/60 ml-1">task{linkedCount === 1 ? "" : "s"}</span>
                    </p>
                </div>
            </div>

            {/* Setup section */}
            <section className="mt-12 space-y-6 border-b border-slate-900 pb-8">
                <h2 className="text-xl font-semibold text-slate-500">Setup</h2>

                <div className="space-y-2">
                    <Label htmlFor="commitment-name" className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Name</Label>
                    <Input
                        id="commitment-name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Earn my headphones"
                        className="bg-slate-900/50 border-slate-800 text-slate-100 text-lg placeholder:text-slate-600"
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="start-date" className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Start date</Label>
                        <Input
                            id="start-date"
                            type="date"
                            min={today}
                            value={startDate}
                            onChange={(event) => setStartDate(event.target.value)}
                            className="bg-slate-900/50 border-slate-800 text-slate-100"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="duration" className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Duration (days)</Label>
                        <Input
                            id="duration"
                            type="number"
                            min={3}
                            value={durationInput}
                            onChange={(event) => setDurationInput(event.target.value)}
                            className="bg-slate-900/50 border-slate-800 text-slate-100"
                        />
                    </div>
                </div>
            </section>

            {/* Linked tasks section */}
            <section className="mt-8 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold text-slate-500">Linked tasks</h2>
                    <Button
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        className="bg-blue-600/30 border border-blue-500/40 text-blue-200 hover:bg-blue-600/40"
                    >
                        Link tasks
                    </Button>
                </div>

                {linkedTasks.length === 0 && linkedRules.length === 0 ? (
                    <p className="text-sm text-slate-600 italic">No tasks linked yet.</p>
                ) : (
                    <div className="flex flex-col">
                        {linkedRules.map((rule) => (
                            <div
                                key={rule.id}
                                className="group flex items-center justify-between gap-3 border-b border-slate-900 py-4 last:border-0"
                            >
                                <div className="min-w-0">
                                    <p className="text-lg font-medium text-white truncate">{rule.title}</p>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Recurring series · {formatCurrencyFromCents(rule.failure_cost_cents, currency)}/instance
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleUnlinkRule(rule.id)}
                                    className="shrink-0 text-xs text-red-400/70 hover:text-red-300 transition-colors"
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                        {linkedTasks.map((task) => (
                            <div
                                key={task.id}
                                className="group flex items-center justify-between gap-3 border-b border-slate-900 py-4 last:border-0"
                            >
                                <div className="min-w-0">
                                    <p className="text-lg font-medium text-white truncate">{task.title}</p>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Due {formatDateTimeDDMMYYYY(task.deadline)} · {formatCurrencyFromCents(task.failure_cost_cents, currency)}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleUnlinkTask(task.id)}
                                    className="shrink-0 text-xs text-red-400/70 hover:text-red-300 transition-colors"
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Actions row */}
            <div className="mt-10 flex items-center justify-between gap-4">
                <div className="min-w-0">
                    {showIssues && activateIssues.length > 0 && (
                        <div className="space-y-0.5">
                            {activateIssues.map((issue) => (
                                <p key={issue} className="text-xs text-red-400/80">{issue}</p>
                            ))}
                        </div>
                    )}
                    {error && <p className="text-sm text-red-400">{error}</p>}
                </div>
                <div className={`flex shrink-0 items-center gap-3 ${shaking ? "animate-shake" : ""}`}>
                    <Button asChild className="border border-red-500/40 bg-red-900/20 text-red-200 hover:bg-red-900/30">
                        <Link href="/dashboard/commitments">Cancel</Link>
                    </Button>
                    <Button
                        type="button"
                        onClick={() => handleAction(false)}
                        className="border border-orange-500/40 bg-orange-900/20 text-orange-200 hover:bg-orange-900/30"
                    >
                        {isSaving ? "Saving..." : "Save as Draft"}
                    </Button>
                    <Button
                        type="button"
                        onClick={() => handleAction(true)}
                        className="bg-blue-600/30 border border-blue-500/40 text-blue-100 hover:bg-blue-600/40"
                    >
                        Activate
                    </Button>
                </div>
            </div>

            <TaskPickerModal
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                tasks={availableTasks}
                recurrenceRules={availableRecurrenceRules}
                linkedTaskIds={linkedTaskIds}
                linkedRecurrenceRuleIds={linkedRecurrenceRuleIds}
                currency={currency}
                onSelectTask={handleLinkTask}
                onSelectRecurrenceRule={handleLinkRule}
            />
        </div>
    );
}
