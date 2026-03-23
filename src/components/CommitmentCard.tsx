"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    abandonCommitment,
    activateCommitment,
    updateCommitment,
    type CommitmentListItem,
} from "@/actions/commitments";
import { CompactStatsItem, type CompactStatsTask } from "@/components/CompactStatsItem";
import { CommitmentDayStrip } from "@/components/CommitmentDayStrip";
import { Button } from "@/components/ui/button";
import { formatCurrencyFromCents, getCurrencySymbol, type SupportedCurrency } from "@/lib/currency";

interface CommitmentCardProps {
    commitment: CommitmentListItem;
    currency: SupportedCurrency;
    onOptimisticAbandon?: (commitmentId: string) => void;
    onAbandonRollback?: (commitment: CommitmentListItem) => void;
}

function statusStyle(status: string): { className: string; glow: string } {
    if (status === "ACTIVE")
        return { className: "text-cyan-400", glow: "0 0 6px rgba(34,211,238,0.5)" };
    if (status === "COMPLETED")
        return { className: "text-emerald-400", glow: "0 0 6px rgba(52,211,153,0.5)" };
    if (status === "FAILED")
        return { className: "text-red-400", glow: "0 0 6px rgba(248,113,113,0.5)" };
    return { className: "text-slate-500", glow: "none" };
}

export function CommitmentCard({
    commitment,
    currency,
    onOptimisticAbandon,
    onAbandonRollback,
}: CommitmentCardProps) {
    const router = useRouter();
    const storageKey = `commitment_expanded_${commitment.id}`;
    const [isExpanded, setIsExpanded] = useState(false);
    const [pendingAction, setPendingAction] = useState<"activate" | "abandon" | null>(null);
    const [draftDescription, setDraftDescription] = useState(commitment.description?.trim() ?? "");
    const [isSavingDescription, setIsSavingDescription] = useState(false);
    const descriptionRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (sessionStorage.getItem(storageKey) === "1") setIsExpanded(true);
    }, [storageKey]);

    useEffect(() => {
        setDraftDescription(commitment.description?.trim() ?? "");
    }, [commitment.description]);

    useEffect(() => {
        const el = descriptionRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
    }, [draftDescription, isExpanded]);

    const status = commitment.derived_status || commitment.status;
    const { className: statusClass, glow: statusGlow } = statusStyle(status);
    const description = commitment.description?.trim() || "";
    const daysAccomplished = commitment.day_statuses.filter((d) => d.status === "passed").length;

    const earnedLabel = formatCurrencyFromCents(commitment.earned_so_far_cents, currency);
    const goalLabel = formatCurrencyFromCents(commitment.total_target_cents, currency);
    const goalLabelNoSymbol = goalLabel.replace(getCurrencySymbol(currency), "");

    const taskRows = useMemo<CompactStatsTask[]>(() => {
        return [...commitment.task_instances]
            .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
            .map((task) => ({
                id: task.id,
                title: task.title,
                status: task.status,
                deadline: task.deadline,
                updated_at: task.deadline,
                recurrence_rule_id: task.recurrence_rule_id ?? null,
                marked_completed_at: null,
                voucher_timeout_auto_accepted: false,
                proof_request_open: false,
                voucher: null,
                pomo_total_seconds: 0,
            }));
    }, [commitment.task_instances]);

    const handleToggle = () => {
        setIsExpanded((prev) => {
            const next = !prev;
            sessionStorage.setItem(storageKey, next ? "1" : "0");
            return next;
        });
    };

    const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        // Keep card toggle behavior for normal taps/clicks, but never toggle when
        // the interaction is with editable/interactive controls.
        if (target.closest("textarea, input, select, button, a, label, [role='button'], [role='link']")) {
            return;
        }
        handleToggle();
    };

    const handleDescriptionBlur = async () => {
        const trimmed = draftDescription.trim();
        if (trimmed === (commitment.description?.trim() ?? "")) return;
        if (isSavingDescription) return;
        setIsSavingDescription(true);
        const result = await updateCommitment(commitment.id, { description: trimmed });
        if (!result.success) {
            toast.error(result.error ?? "Failed to save description.");
            setDraftDescription(commitment.description?.trim() ?? "");
        } else {
            toast.success("Description updated.");
            router.refresh();
        }
        setIsSavingDescription(false);
    };

    const handleActivate = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (pendingAction) return;
        setPendingAction("activate");
        const result = await activateCommitment(commitment.id);
        if (!result.success) {
            toast.error(result.error);
        } else {
            toast.success("Commitment activated.");
            router.refresh();
        }
        setPendingAction(null);
    };

    const handleAbandon = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (pendingAction) return;
        const warningText =
            status === "ACTIVE"
                ? `You've already accomplished ${daysAccomplished} day(s). Do you really want to abandon this commitment?`
                : "Are you sure you want to delete this commitment draft?";
        if (!window.confirm(warningText)) return;
        setPendingAction("abandon");
        onOptimisticAbandon?.(commitment.id);
        const result = await abandonCommitment(commitment.id);
        if (!result.success) {
            onAbandonRollback?.(commitment);
            toast.error(result.error ?? "Failed to abandon commitment.");
        } else {
            toast.success(status === "DRAFT" ? "Commitment deleted." : "Commitment abandoned.");
            router.refresh();
        }
        setPendingAction(null);
    };

    return (
        <div
            className="group -mx-4 mb-2 px-4 py-8 transition-colors bg-slate-800/15 hover:bg-slate-800/30 cursor-pointer"
            onClick={handleCardClick}
        >
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px_230px] md:items-stretch">
                {/* Left: name + status + description */}
                <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                        <p className="truncate text-[1.7rem] font-semibold leading-none text-white transition-colors group-hover:text-blue-400">
                            {commitment.name}
                        </p>
                        <span
                            className={`shrink-0 font-mono text-[10px] font-bold uppercase tracking-widest ${statusClass}`}
                            style={{ textShadow: statusGlow }}
                        >
                            {status}
                        </span>
                    </div>
                    {isExpanded ? (
                        <textarea
                            ref={descriptionRef}
                            rows={1}
                            className="mt-4 w-full resize-none overflow-hidden bg-transparent text-base leading-relaxed text-slate-300 outline-none cursor-text select-text placeholder:italic placeholder:text-slate-500 focus:ring-1 focus:ring-slate-600/60 rounded px-1 -ml-1"
                            value={draftDescription}
                            onChange={(e) => setDraftDescription(e.target.value)}
                            onBlur={handleDescriptionBlur}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="No description provided."
                        />
                    ) : (
                        <p className="mt-4 text-base leading-relaxed text-slate-300 line-clamp-3">
                            {description || <span className="text-slate-500 italic">No description provided.</span>}
                        </p>
                    )}
                </div>

                {/* Days accomplished */}
                <div className="flex flex-col items-end border-t border-slate-800 pt-3 md:border-t-0 md:border-l md:pl-5 md:pt-0">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                        days accomplished
                    </p>
                    <div className="mt-4 inline-flex items-center leading-none">
                        <span className="translate-y-[-10px] text-[2.7rem] font-light text-[#00ffd5] drop-shadow-[0_0_8px_rgba(0,255,213,0.65)]">
                            {daysAccomplished}
                        </span>
                        <span className="mx-[-4px] text-[3.6rem] font-thin text-red-500/70">/</span>
                        <span className="translate-y-[10px] text-[2.00rem] font-light text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.7)]">
                            {commitment.days_total}
                        </span>
                    </div>
                </div>

                {/* Amount justified */}
                <div className="flex flex-col items-end border-t border-slate-800 pt-3 md:border-t-0 md:border-l md:pl-5 md:pt-0">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                        amount justified
                    </p>
                    <div className="mt-4 inline-flex items-center leading-none">
                        <span className="translate-y-[-10px] text-[2.7rem] font-light text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.6)]">
                            {earnedLabel}
                        </span>
                        <span className="mx-[-4px] text-[3.6rem] font-thin text-red-500/70">/</span>
                        <span className="translate-y-[10px] text-[2.00rem] font-light text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.7)]">
                            {goalLabelNoSymbol}
                        </span>
                    </div>
                </div>
            </div>

            {/* Expanded section */}
            {isExpanded && (
                <div className="mt-6 pt-6 border-t border-slate-800/60">
                    {/* Activate button (DRAFT only) */}
                    {status === "DRAFT" && (
                        <div className="flex flex-wrap gap-2 mb-6">
                            <Button
                                type="button"
                                onClick={handleActivate}
                                disabled={pendingAction !== null}
                                className="border border-blue-500/50 bg-blue-600/30 text-blue-100 hover:bg-blue-600/40"
                            >
                                Activate
                            </Button>
                        </div>
                    )}

                    {/* Day strip */}
                    <CommitmentDayStrip
                        startDate={commitment.start_date}
                        endDate={commitment.end_date}
                        dayStatuses={commitment.day_statuses}
                    />

                    {/* Task list */}
                    <div className="mt-6">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">
                            Tasks for today linked to this commitment
                        </p>
                        {taskRows.length === 0 ? (
                            <p className="mt-3 text-sm text-slate-500">No tasks linked yet.</p>
                        ) : (
                            <div className="flex flex-col border-t border-slate-900/50">
                                {taskRows.map((task) => (
                                    <CompactStatsItem key={task.id} task={task} onRowClick={handleToggle} />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Abandon button — bottom left */}
                    {(status === "DRAFT" || status === "ACTIVE") && (
                        <div className="mt-6 flex">
                            <Button
                                type="button"
                                onClick={handleAbandon}
                                disabled={pendingAction !== null}
                                className="border border-red-500/40 bg-red-900/20 text-red-200 hover:bg-red-900/30"
                            >
                                {status === "DRAFT" ? "Delete draft" : "Abandon"}
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
