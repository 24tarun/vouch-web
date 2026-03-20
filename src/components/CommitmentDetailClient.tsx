"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    abandonCommitment,
    activateCommitment,
    updateCommitment,
    type CommitmentDetailPayload,
} from "@/actions/commitments";
import { CommitmentSegmentBar } from "@/components/CommitmentSegmentBar";
import { CompactStatsItem, type CompactStatsTask } from "@/components/CompactStatsItem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fireCommitmentConfetti } from "@/lib/confetti";
import { formatCurrencyFromCents, type SupportedCurrency } from "@/lib/currency";
import { formatDateOnlyDDMMYYYY } from "@/lib/date-format";
import {
    subscribeRealtimeCommitmentChanges,
    subscribeRealtimeTaskChanges,
} from "@/lib/realtime-task-events";

interface CommitmentDetailClientProps {
    detail: CommitmentDetailPayload;
    currency: SupportedCurrency;
}

export function CommitmentDetailClient({ detail, currency }: CommitmentDetailClientProps) {
    const router = useRouter();
    const [, startTransition] = useTransition();
    const [optimisticDetail, setOptimisticDetail] = useState(detail);
    const status = optimisticDetail.derived_status || optimisticDetail.commitment.status;
    const [draftName, setDraftName] = useState(detail.commitment.name);
    const previousStatusRef = useRef(status);
    const [selectedDate, setSelectedDate] = useState<string | null>(detail.day_statuses[0]?.date || null);
    const [isSavingName, setIsSavingName] = useState(false);
    const [pendingAction, setPendingAction] = useState<"activate" | "abandon" | null>(null);

    useEffect(() => {
        setOptimisticDetail(detail);
        setDraftName(detail.commitment.name);
    }, [detail]);

    useEffect(() => {
        if (!selectedDate) return;
        const stillExists = optimisticDetail.day_statuses.some((day) => day.date === selectedDate);
        if (!stillExists) {
            setSelectedDate(optimisticDetail.day_statuses[0]?.date || null);
        }
    }, [optimisticDetail.day_statuses, selectedDate]);

    useEffect(() => {
        if (previousStatusRef.current !== "COMPLETED" && status === "COMPLETED") {
            fireCommitmentConfetti();
        }
        previousStatusRef.current = status;
    }, [status]);

    useEffect(() => {
        const refresh = () => {
            startTransition(() => {
                router.refresh();
            });
        };
        const unsubTask = subscribeRealtimeTaskChanges(() => refresh());
        const unsubCommitment = subscribeRealtimeCommitmentChanges(() => refresh());
        return () => {
            unsubTask();
            unsubCommitment();
        };
    }, [router, startTransition]);

    const tasksByDate = useMemo(() => {
        const map = new Map<string, Array<{ id: string; title: string; status: string; deadline: string }>>();
        for (const link of optimisticDetail.links) {
            for (const instance of link.instances) {
                const dateOnly = new Date(instance.deadline).toISOString().slice(0, 10);
                const current = map.get(dateOnly) || [];
                current.push({
                    id: instance.id,
                    title: instance.title,
                    status: instance.status,
                    deadline: instance.deadline,
                });
                map.set(dateOnly, current);
            }
        }
        return map;
    }, [optimisticDetail.links]);

    const selectedDateTasks = selectedDate ? tasksByDate.get(selectedDate) || [] : [];
    const selectedDateRows = useMemo<CompactStatsTask[]>(() => {
        return [...selectedDateTasks]
            .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
            .map((task) => ({
                id: task.id,
                title: task.title,
                status: task.status,
                deadline: task.deadline,
                updated_at: task.deadline,
                marked_completed_at: null,
                voucher_timeout_auto_accepted: false,
                proof_request_open: false,
                voucher: null,
                pomo_total_seconds: 0,
            }));
    }, [selectedDateTasks]);

    const refreshInBackground = () => {
        startTransition(() => {
            router.refresh();
        });
    };

    const handleSaveName = async () => {
        if (status !== "DRAFT") return;
        if (isSavingName) return;
        setIsSavingName(true);
        const previousName = optimisticDetail.commitment.name;
        const nextName = draftName.trim();
        setOptimisticDetail((previous) => ({
            ...previous,
            commitment: {
                ...previous.commitment,
                name: nextName,
            },
        }));

        const result = await updateCommitment(optimisticDetail.commitment.id, { name: nextName });
        if (!result.success) {
            toast.error(result.error);
            setOptimisticDetail((previous) => ({
                ...previous,
                commitment: {
                    ...previous.commitment,
                    name: previousName,
                },
            }));
            setDraftName(previousName);
        } else {
            toast.success("Commitment name updated.");
            refreshInBackground();
        }
        setIsSavingName(false);
    };

    const handleActivate = async () => {
        if (pendingAction) return;
        setPendingAction("activate");
        const previousStatus = optimisticDetail.commitment.status;
        const previousDerivedStatus = optimisticDetail.derived_status;
        setOptimisticDetail((previous) => ({
            ...previous,
            commitment: {
                ...previous.commitment,
                status: "ACTIVE",
            },
            derived_status: "ACTIVE",
        }));

        const result = await activateCommitment(optimisticDetail.commitment.id);
        if (!result.success) {
            toast.error(result.error);
            setOptimisticDetail((previous) => ({
                ...previous,
                commitment: {
                    ...previous.commitment,
                    status: previousStatus,
                },
                derived_status: previousDerivedStatus,
            }));
        } else {
            toast.success("Commitment activated.");
            refreshInBackground();
        }
        setPendingAction(null);
    };

    const handleAbandon = async () => {
        if (pendingAction) return;
        const warningText =
            status === "ACTIVE"
                ? `You've already passed ${Math.max(0, optimisticDetail.days_total - optimisticDetail.days_remaining)} day(s). Do you really want to abandon this commitment?`
                : "Are you sure you want to delete this commitment draft?";
        if (!window.confirm(warningText)) return;

        setPendingAction("abandon");
        const result = await abandonCommitment(optimisticDetail.commitment.id);
        if (!result.success) {
            toast.error(result.error);
            setPendingAction(null);
            return;
        }

        toast.success(status === "DRAFT" ? "Commitment deleted." : "Commitment abandoned.");
        router.push("/dashboard/commitments");
        router.refresh();
    };

    return (
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 md:px-0">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
                <div>
                    <Button asChild variant="ghost" className="h-8 px-2 text-slate-300 hover:text-white">
                        <Link href="/dashboard/commitments">Back</Link>
                    </Button>
                </div>

                <div className="min-w-0">
                    {status === "DRAFT" ? (
                        <div className="mx-auto flex max-w-xl items-end justify-center gap-2">
                            <div className="w-full max-w-sm space-y-1">
                                <Label htmlFor="commitment-name" className="text-xs text-slate-400">Name</Label>
                                <Input
                                    id="commitment-name"
                                    value={draftName}
                                    onChange={(event) => setDraftName(event.target.value)}
                                    className="w-full bg-slate-900 border-slate-700 text-slate-100"
                                />
                            </div>
                            <Button
                                type="button"
                                onClick={handleSaveName}
                                disabled={isSavingName || draftName.trim().length === 0}
                                className="border border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700"
                            >
                                Save
                            </Button>
                        </div>
                    ) : (
                        <h1 className="text-center text-3xl font-bold text-white">{optimisticDetail.commitment.name}</h1>
                    )}
                </div>

                <div className="flex flex-col items-end gap-2">
                    {(status === "DRAFT" || status === "ACTIVE") && (
                        <Button
                            type="button"
                            onClick={handleAbandon}
                            disabled={pendingAction !== null}
                            className="border border-red-500/40 bg-red-900/20 text-red-200 hover:bg-red-900/30"
                        >
                            {status === "DRAFT" ? "Delete draft" : "Abandon"}
                        </Button>
                    )}
                </div>
            </div>

            <div className="space-y-4">
                <div className="flex items-end justify-between gap-4">
                    <div className="space-y-0.5">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Earned</p>
                        <p className="text-4xl font-light text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.6)]">
                            {formatCurrencyFromCents(optimisticDetail.earned_so_far_cents, currency)}
                        </p>
                    </div>
                    <div className="space-y-0.5 text-right">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Goal</p>
                        <p className="text-xl font-light text-slate-400">
                            {formatCurrencyFromCents(optimisticDetail.total_target_cents, currency)}
                        </p>
                    </div>
                </div>

                {status === "ACTIVE" && optimisticDetail.starts_in_days > 0 ? (
                    <div className="text-sm text-slate-300">
                        Starts in {optimisticDetail.starts_in_days} day{optimisticDetail.starts_in_days === 1 ? "" : "s"}.
                    </div>
                ) : (
                    <div>
                    <CommitmentSegmentBar
                        startDate={optimisticDetail.commitment.start_date}
                        endDate={optimisticDetail.commitment.end_date}
                        dayStatuses={optimisticDetail.day_statuses}
                        selectedDate={selectedDate}
                        onSelectDate={setSelectedDate}
                        heightClassName="h-5"
                    />
                    {selectedDate && (
                        <div className="mt-4 space-y-2">
                            <p className="text-xs uppercase tracking-wider text-slate-400">
                                Tasks on {formatDateOnlyDDMMYYYY(selectedDate)}
                            </p>
                            {selectedDateRows.length === 0 ? (
                                <p className="text-sm text-slate-500">No tasks due on this date.</p>
                            ) : (
                                <div className="flex flex-col border-t border-slate-900/50">
                                    {selectedDateRows.map((task) => (
                                        <CompactStatsItem key={task.id} task={task} />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
                {status === "DRAFT" && (
                    <Button
                        type="button"
                        onClick={handleActivate}
                        disabled={pendingAction !== null}
                        className="border border-blue-500/50 bg-blue-600/30 text-blue-100 hover:bg-blue-600/40"
                    >
                        Activate
                    </Button>
                )}
            </div>
        </div>
    );
}
