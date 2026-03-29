import type { ReactNode } from "react";
import type { DayStatus } from "@/lib/commitment-status";
import type { CommitmentStatus } from "@/lib/types";
import type { TaskStatus } from "@/lib/xstate/task-machine";
import { formatTaskStatusLabel } from "@/components/tasks/TaskStatusBadge";
import {
    VoucherDeadlineBadge,
    VoucherPendingStatusBadge,
    VoucherPomoAccumulatedBadge,
    VoucherProofRequestBadge,
} from "@/components/voucher/VoucherBadges";
import { RecurringIndicator } from "@/components/tasks/RecurringIndicator";
import { LedgerEntryRow } from "@/components/ledger/LedgerEntryRow";
import { CommitmentStatusLabel } from "@/components/commitments/CommitmentStatusLabel";
import { CommitmentDayStrip } from "@/components/CommitmentDayStrip";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X, Camera, Clock, Trash2, Repeat, ChevronRight, MessageSquare, AlertTriangle, Zap } from "lucide-react";

const PALETTE = [
    { name: "Slate 950", hex: "#020617", role: "Page background" },
    { name: "Slate 900", hex: "#0f172a", role: "Card / surface" },
    { name: "Slate 800", hex: "#1e293b", role: "Borders, inputs" },
    { name: "Slate 700", hex: "#334155", role: "Subtle borders, dividers" },
    { name: "Slate 600", hex: "#475569", role: "Muted icons, disabled" },
    { name: "Slate 500", hex: "#64748b", role: "Muted text, labels" },
    { name: "Slate 400", hex: "#94a3b8", role: "Secondary text" },
    { name: "Slate 300", hex: "#cbd5e1", role: "Body text" },
    { name: "Slate 200", hex: "#e2e8f0", role: "Hover text" },
    { name: "Slate 100", hex: "#f1f5f9", role: "Primary buttons" },
    { name: "White", hex: "#ffffff", role: "Headings, emphasis" },
];

type AccentColor = { name: string; hex: string; glow: string; role: string; proposed?: boolean; usedIn?: string[] };

const ACCENT_GROUPS: { group: string; colors: AccentColor[] }[] = [
    {
        group: "Blues",
        colors: [
            { name: "Plasma Blue", hex: "#0066FF", glow: "rgba(0,102,255,0.8)", role: "", usedIn: ["TaskStatusBadge (ACTIVE, POSTPONED)"] },
            { name: "Indigo 700", hex: "#4338ca", glow: "rgba(67,56,202,0.7)", role: "", usedIn: ["TaskStatusBadge (MARKED_COMPLETE)"] },
        ],
    },
    {
        group: "Cyans",
        colors: [
            { name: "Cyan 400", hex: "#22d3ee", glow: "rgba(34,211,238,0.6)", role: "", usedIn: ["PomodoroTimer", "PomoButton", "CommitmentStatusLabel", "CommitmentCreatorClient", "task-detail-client", "voucher-dashboard-client", "stats/page", "MobileOnboarding", "MobileLanding", "DesktopLanding"] },
        ],
    },
    {
        group: "Greens",
        colors: [
            { name: "Emerald 400", hex: "#34d399", glow: "rgba(52,211,153,0.5)", role: "", usedIn: ["TaskRow (accepted statuses)", "CommitmentStatusLabel", "FloatingBoxTaskCreator", "ReputationBar", "task-detail-client", "DashboardHeaderActions", "login/page", "MobileOnboarding", "MobileLanding", "DesktopLanding"] },
            { name: "Money Green", hex: "#1F8A4C", glow: "rgba(31,138,76,0.72)", role: "", usedIn: ["LedgerEntryRow (currency amounts)", "ledger/page (money numericals)", "CommitmentCard (stake display)", "PreviousMonthsAccordion (totals)"] },
        ],
    },
    {
        group: "Yellows & Ambers",
        colors: [
            { name: "Amber 400", hex: "#fbbf24", glow: "rgba(251,191,36,0.4)", role: "", usedIn: ["TaskStatusBadge (AWAITING_VOUCHER, AWAITING_USER, AWAITING_ORCA, ESCALATED)"] },
        ],
    },
    {
        group: "Oranges",
        colors: [
            { name: "Orange 400", hex: "#fb923c", glow: "rgba(251,146,60,0.6)", role: "", usedIn: ["TaskStatusBadge (RECTIFIED)", "VoucherProofRequestBadge (proof request counter)"] },
            { name: "Orange 500", hex: "#f97316", glow: "rgba(249,115,22,0.6)", role: "", usedIn: ["TaskStatusBadge", "TaskRow", "CompactStatsItem", "task-detail-client", "voucher-dashboard-client", "CommitmentCreatorClient"] },
        ],
    },
    {
        group: "Reds",
        colors: [
            { name: "Red 500", hex: "#ef4444", glow: "rgba(239,68,68,0.6)", role: "", usedIn: ["TaskStatusBadge", "TaskRow", "VoucherBadges", "LedgerEntryRow", "CompactStatsItem", "CommitmentCard", "stats/page", "ledger/page", "task-detail-client", "voucher-dashboard-client", "SignOutMenuForm", "NavLinks", "CommitmentCreatorClient"] },
            { name: "Wine Red", hex: "#5B0A1E", glow: "rgba(91,10,30,0.8)", role: "", usedIn: ["TaskStatusBadge (SETTLED)", "TaskRow (SETTLED)"] },
        ],
    },
    {
        group: "Pinks & Magentas",
        colors: [
            { name: "Pink 500", hex: "#ec4899", glow: "rgba(236,72,153,0.6)", role: "", usedIn: ["ledger/page (projected donation)"] },
            { name: "Fuchsia 700", hex: "#a21caf", glow: "rgba(162,28,175,0.7)", role: "", proposed: true },
            { name: "Purple 400", hex: "#c084fc", glow: "rgba(192,132,252,0.6)", role: "", usedIn: ["task-detail-client", "stats/page", "CompactStatsItem", "VoucherBadges", "RecurringIndicator", "TaskInput", "FloatingBoxTaskCreator", "MobileLanding", "DesktopLanding"] },
        ],
    },
];

const TASK_STATUS_GROUPS: {
    group: string;
    description: string;
    statuses: TaskStatus[];
}[] = [
    {
        group: "Active",
        description: "Task is live and counting down to its deadline.",
        statuses: ["ACTIVE", "POSTPONED"],
    },
    {
        group: "Pending Review",
        description: "Owner marked complete, waiting for voucher or AI to respond.",
        statuses: ["MARKED_COMPLETE", "AWAITING_VOUCHER", "AWAITING_ORCA", "AWAITING_USER", "ESCALATED"],
    },
    {
        group: "Terminal",
        description: "Final states. Task lifecycle is over - accepted, denied, missed, rectified, settled, or deleted.",
        statuses: ["ACCEPTED", "AUTO_ACCEPTED", "ORCA_ACCEPTED", "DENIED", "MISSED", "RECTIFIED", "SETTLED", "DELETED"],
    },
];

const COMMITMENT_STATUSES: { status: CommitmentStatus; label: string }[] = [
    { status: "DRAFT", label: "Not yet activated" },
    { status: "ACTIVE", label: "In progress" },
    { status: "COMPLETED", label: "All tasks passed" },
    { status: "FAILED", label: "One or more tasks failed" },
];

const LEDGER_TYPES: {
    id: string;
    entryType: string;
    taskStatus?: string;
    amountCents: number;
    description: string;
}[] = [
    { id: "denied", entryType: "failure", taskStatus: "DENIED", amountCents: 500, description: "Charged when a voucher denies the task" },
    { id: "missed", entryType: "failure", taskStatus: "MISSED", amountCents: 500, description: "Charged when a task misses its deadline" },
    { id: "rectified", entryType: "rectified", amountCents: -500, description: "Reversal when voucher authorises a rectification" },
    { id: "timeout", entryType: "voucher_timeout_penalty", amountCents: 30, description: "Charged to voucher for not responding in time" },
    { id: "override", entryType: "override", amountCents: -500, description: "Owner override that cancels a failure charge" },
];

const DAY_STATUS_LABELS: { status: DayStatus | "selected" | "current"; label: string }[] = [
    { status: "selected", label: "Selected" },
    { status: "current", label: "Current" },
    { status: "passed", label: "Passed" },
    { status: "failed", label: "Failed" },
    { status: "pending", label: "Pending" },
    { status: "future", label: "Future" },
];

const STAT_GLOWS: { label: string; textClass: string; glow: string }[] = [
    { label: "Active", textClass: "text-blue-400", glow: "0 0 8px rgba(96,165,250,0.6)" },
    { label: "Time Focused", textClass: "text-cyan-400", glow: "0 0 8px rgba(34,211,238,0.6)" },
    { label: "Pending Vouch", textClass: "text-purple-400", glow: "0 0 8px rgba(192,132,252,0.6)" },
    { label: "Accepted", textClass: "text-lime-300", glow: "0 0 8px rgba(190,242,100,0.6)" },
    { label: "Failed", textClass: "text-red-500", glow: "0 0 8px rgba(239,68,68,0.6)" },
    { label: "Projected", textClass: "text-pink-500", glow: "0 0 8px rgba(236,72,153,0.6)" },
    { label: "Rectify Passes", textClass: "text-orange-400", glow: "0 0 8px rgba(251,146,60,0.6)" },
    { label: "Kept", textClass: "text-green-400", glow: "0 0 8px rgba(74,222,128,0.6)" },
];

function SectionTitle({ children }: { children: ReactNode }) {
    return <h2 className="text-2xl font-semibold text-white border-b border-slate-800 pb-3">{children}</h2>;
}

function SectionDescription({ children }: { children: ReactNode }) {
    return <p className="text-sm text-slate-500 leading-relaxed">{children}</p>;
}

function toDateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function addDays(base: Date, offset: number): Date {
    const next = new Date(base);
    next.setUTCDate(next.getUTCDate() + offset);
    return next;
}

function sectionItemLabel(section: number, item: number): string {
    return `${section}.${item}`;
}

const STATUS_BADGE_BASE_CLASS =
    "min-h-[clamp(20px,2.2vw,24px)] px-[clamp(10px,1.8vw,14px)] py-[clamp(2px,0.35vw,4px)] text-[10px] leading-none font-medium tracking-normal";

function getDesignStatusBadgeClass(status: TaskStatus): string {
    if (status === "ACTIVE") return "bg-[#0066FF]/10 text-blue-300 border-[#0066FF]/30";
    if (status === "POSTPONED") return "bg-[#0066FF]/10 text-blue-300 border-[#0066FF]/30";
    if (status === "MARKED_COMPLETE") return "bg-[#4338ca]/10 text-[#a5b4fc] border-[#4338ca]/30";
    if (status.startsWith("AWAITING") || status === "ESCALATED") return "bg-amber-400/10 text-amber-400 border-amber-400/30";
    if (status === "ACCEPTED" || status === "AUTO_ACCEPTED" || status === "ORCA_ACCEPTED") return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
    if (status === "DENIED" || status === "MISSED") return "bg-red-500/10 text-red-500 border-red-500/30";
    if (status === "RECTIFIED") return "bg-[#fb923c]/10 text-[#fb923c] border-[#fb923c]/30";
    if (status === "SETTLED") return "bg-[#5B0A1E]/20 text-[#F2C7D0] border-[#5B0A1E]/50";
    if (status === "DELETED") return "bg-slate-500/10 text-slate-400 border-slate-500/20";
    return "bg-slate-500/10 text-slate-400 border-slate-500/20";
}

export default function DesignPage() {
    const today = new Date();
    const stripStart = toDateOnly(addDays(today, -4));
    const stripEnd = toDateOnly(addDays(today, 2));
    const selectedDate = toDateOnly(addDays(today, -2));
    const stripDayStatuses: { date: string; status: DayStatus }[] = [
        { date: toDateOnly(addDays(today, -4)), status: "passed" },
        { date: toDateOnly(addDays(today, -3)), status: "pending" },
        { date: toDateOnly(addDays(today, -2)), status: "failed" },
        { date: toDateOnly(addDays(today, -1)), status: "passed" },
    ];
    const section4StatusCount = TASK_STATUS_GROUPS.reduce((sum, group) => sum + group.statuses.length, 0);

    return (
        <div className="max-w-5xl mx-auto space-y-20 pb-32 px-6 md:px-0 pt-16">
            <div className="space-y-2">
                <h1 className="text-4xl font-bold text-white tracking-tight">Design System</h1>
                <p className="text-sm text-slate-500 max-w-lg">
                    The complete visual language for Vouch. Colour palette, accent tokens, glow effects,
                    status systems, badge components, ledger rows, commitment components, and typography.
                </p>
            </div>

            <section className="space-y-6">
                <SectionTitle>1. Slate Palette</SectionTitle>
                <SectionDescription>
                    The foundation of all surfaces, text, and borders. Dark-first scale from 950 (page background) to white (headings).
                </SectionDescription>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {PALETTE.map((s, index) => (
                        <div key={s.name} className="flex items-center gap-4 py-3 px-4">
                            <span className="text-[10px] font-mono text-slate-500 shrink-0">
                                {sectionItemLabel(1, index + 1)}
                            </span>
                            <div className="h-12 w-12 rounded-lg shrink-0" style={{ backgroundColor: s.hex }} />
                            <div className="min-w-0">
                                <p className="text-sm font-mono" style={{ color: s.hex }}>{s.name}</p>
                                <p className="text-[11px] text-slate-500 font-mono">{s.hex}</p>
                                <p className="text-[10px] text-slate-600 mt-0.5">{s.role}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="space-y-6">
                <SectionTitle>2. Accent Colours</SectionTitle>
                <SectionDescription>
                    All accent colours grouped by hue family. Active colours are in use today;
                    proposed colours (marked with a tag) are candidates for future features.
                </SectionDescription>

                <div className="space-y-10">
                    {ACCENT_GROUPS.map((group, groupIndex) => (
                        <div key={group.group} className="space-y-3">
                            <h3 className="text-base font-semibold text-slate-200">{group.group}</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {group.colors.map((a, colorIndex) => {
                                    const priorGroupsCount = ACCENT_GROUPS
                                        .slice(0, groupIndex)
                                        .reduce((sum, currentGroup) => sum + currentGroup.colors.length, 0);
                                    const itemIndex = priorGroupsCount + colorIndex + 1;
                                    return (
                                    <div key={a.name} className="flex items-center gap-4 py-3 px-4">
                                        <span className="text-[10px] font-mono text-slate-500 shrink-0">
                                            {sectionItemLabel(2, itemIndex)}
                                        </span>
                                        <div className="h-12 w-12 rounded-lg shrink-0" style={{ backgroundColor: a.hex, boxShadow: `0 0 14px ${a.glow}` }} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-mono" style={{ color: a.hex }}>{a.name}</p>
                                                {a.proposed && (
                                                    <span className="text-[8px] uppercase tracking-widest text-slate-600 border border-slate-800 rounded-full px-1 py-0.5">proposed</span>
                                                )}
                                            </div>
                                            <p className="text-[11px] text-slate-500 font-mono">{a.hex}</p>
                                            {a.role && <p className="text-[10px] text-slate-600 mt-0.5">{a.role}</p>}
                                            {a.usedIn && a.usedIn.length > 0 && (
                                                <p className="text-[9px] text-slate-500 font-mono mt-1">
                                                    Used in: {a.usedIn.join(", ")}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="space-y-6">
                <SectionTitle>3. Stat Metric Glows</SectionTitle>
                <SectionDescription>
                    Large numbers on the stats and ledger pages use a matching drop-shadow glow to reinforce their meaning at a glance.
                </SectionDescription>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 pt-2">
                    {STAT_GLOWS.map((g, index) => (
                        <div key={g.label} className="space-y-2">
                            <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                                <span className="mr-2 font-mono normal-case">{sectionItemLabel(3, index + 1)}</span>
                                {g.label}
                            </p>
                            <p className={`text-4xl font-light ${g.textClass}`} style={{ filter: `drop-shadow(${g.glow})` }}>
                                42
                            </p>
                        </div>
                    ))}
                </div>
            </section>

            <section className="space-y-6">
                <SectionTitle>4. Status Badges</SectionTitle>
                <SectionDescription>
                    Combined status badge library. All statuses are rendered as curved pill badges from live components.
                </SectionDescription>

                <div className="space-y-10">
                    {TASK_STATUS_GROUPS.map((group, groupIndex) => (
                        <div key={group.group} className="space-y-4">
                            <div>
                                <h3 className="text-base font-semibold text-slate-200">{group.group}</h3>
                                <p className="text-xs text-slate-500 mt-0.5">{group.description}</p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {group.statuses.map((status, index) => {
                                    const priorGroupsCount = TASK_STATUS_GROUPS
                                        .slice(0, groupIndex)
                                        .reduce((sum, currentGroup) => sum + currentGroup.statuses.length, 0);
                                    const itemIndex = priorGroupsCount + index + 1;
                                    return (
                                    <div key={status} className="flex items-center gap-3 py-3 px-4">
                                        <span className="text-[10px] font-mono text-slate-500 shrink-0">
                                            {sectionItemLabel(4, itemIndex)}
                                        </span>
                                        <Badge
                                            variant="outline"
                                            className={cn(STATUS_BADGE_BASE_CLASS, getDesignStatusBadgeClass(status))}
                                        >
                                            {formatTaskStatusLabel(status)}
                                        </Badge>
                                    </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    <div className="space-y-4">
                        <div>
                            <h3 className="text-base font-semibold text-slate-200">Workflow Badges</h3>
                            <p className="text-xs text-slate-500 mt-0.5">Voucher and task-side badges reused from live surfaces.</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                            {[
                                <VoucherPendingStatusBadge key="active" pendingDisplayType="ACTIVE" />,
                                <VoucherPendingStatusBadge key="awaiting-voucher" pendingDisplayType="AWAITING_VOUCHER" />,
                                <VoucherDeadlineBadge key="deadline-urgent" deadlineLabel="27/03/26, 23:59" hasValidDeadline hoursLeft={0} />,
                                <VoucherDeadlineBadge key="deadline-standard" deadlineLabel="28/03/26, 02:15" hasValidDeadline hoursLeft={3} />,
                                <VoucherDeadlineBadge key="deadline-none" deadlineLabel="No deadline" hasValidDeadline={false} hoursLeft={Number.POSITIVE_INFINITY} />,
                                <VoucherProofRequestBadge key="proof-request" proofRequestCount={1} />,
                                <VoucherPomoAccumulatedBadge key="pomo-accum" totalSeconds={3600} />,
                                <RecurringIndicator key="recurring" />,
                            ].map((badge, index) => (
                                <div key={`workflow-${index + 1}`} className="flex items-center gap-3 py-3 px-4">
                                    <span className="text-[10px] font-mono text-slate-500 shrink-0">
                                        {sectionItemLabel(4, section4StatusCount + index + 1)}
                                    </span>
                                    {badge}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <section className="space-y-6">
                <SectionTitle>5. Ledger Entry Types</SectionTitle>
                <SectionDescription>
                    Uses the same ledger row component as the live ledger screens.
                </SectionDescription>
                <div className="flex flex-col pt-2">
                    {LEDGER_TYPES.map((entry, index) => (
                        <div key={entry.id}>
                            <p className="text-[10px] font-mono text-slate-500 px-4 pb-1">
                                {sectionItemLabel(5, index + 1)}
                            </p>
                            <LedgerEntryRow
                                title="Sample task title"
                                entryType={entry.entryType}
                                taskStatus={entry.taskStatus}
                                createdAt={new Date().toISOString()}
                                amountCents={entry.amountCents}
                                currency="EUR"
                            />
                            <p className="text-[10px] text-slate-600 px-4 pb-4">{entry.description}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section className="space-y-6">
                <SectionTitle>6. Commitment Statuses</SectionTitle>
                <SectionDescription>
                    Uses the same commitment status label component as commitment cards.
                </SectionDescription>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pt-2">
                    {COMMITMENT_STATUSES.map((c, index) => (
                        <div key={c.status} className="space-y-2 py-3 px-4">
                            <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(6, index + 1)}</p>
                            <CommitmentStatusLabel status={c.status} className="text-2xl font-light" />
                            <p className="text-[10px] text-slate-600">{c.label}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section className="space-y-6">
                <SectionTitle>7. Commitment Day Strip</SectionTitle>
                <SectionDescription>
                    Uses the real CommitmentDayStrip component with sample day-status data.
                </SectionDescription>
                <div className="pt-2">
                    <CommitmentDayStrip
                        startDate={stripStart}
                        endDate={stripEnd}
                        dayStatuses={stripDayStatuses}
                        selectedDate={selectedDate}
                    />
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {DAY_STATUS_LABELS.map((item, index) => (
                        <span key={item.status} className="text-[10px] uppercase tracking-wider text-slate-500">
                            {sectionItemLabel(7, index + 1)} {item.label}
                        </span>
                    ))}
                </div>
            </section>

            <section className="space-y-6">
                <SectionTitle>8. Typography</SectionTitle>
                <SectionDescription>
                    Text styles used across the app. System font stack for UI, monospace for data and metrics.
                </SectionDescription>
                <div className="space-y-6 pt-2">
                    {[
                        { sample: "Page Title", className: "text-3xl font-bold text-white", spec: "text-3xl / bold / white" },
                        { sample: "Section Heading", className: "text-xl font-semibold text-white", spec: "text-xl / semibold / white" },
                        { sample: "Body text for descriptions and content", className: "text-sm text-slate-300", spec: "text-sm / slate-300" },
                        { sample: "Secondary information and hints", className: "text-xs text-slate-400", spec: "text-xs / slate-400" },
                        { sample: "STAT LABEL", className: "text-[10px] uppercase tracking-wider font-bold text-slate-500", spec: "text-[10px] / uppercase / tracking-wider / bold / slate-500" },
                        { sample: "Muted timestamps and metadata", className: "text-xs text-slate-600", spec: "text-xs / slate-600" },
                        { sample: "14:30 26/03/2026", className: "text-sm font-mono text-slate-300", spec: "text-sm / font-mono / slate-300 (data)" },
                        { sample: "+42", className: "text-sm font-mono text-emerald-400", spec: "text-sm / font-mono / emerald-400 (positive metric)" },
                        { sample: "-5", className: "text-sm font-mono text-red-500", spec: "text-sm / font-mono / red-500 (negative metric)" },
                    ].map((t, i) => (
                        <div key={i} className="flex items-baseline justify-between gap-6 py-2 border-b border-slate-900/50 last:border-0">
                            <p className={t.className}>{t.sample}</p>
                            <p className="text-[10px] text-slate-600 font-mono shrink-0 text-right">
                                {sectionItemLabel(8, i + 1)} {t.spec}
                            </p>
                        </div>
                    ))}
                </div>
            </section>

            <section className="space-y-6">
                <SectionTitle>9. Button Library</SectionTitle>
                <SectionDescription>
                    All button styles used across the app. Grouped by context: primary actions, semantic actions, icon buttons, and special variants.
                </SectionDescription>

                <div className="space-y-10">
                    <div className="space-y-4">
                        <div>
                            <h3 className="text-base font-semibold text-slate-200">Primary Actions</h3>
                            <p className="text-xs text-slate-500 mt-0.5">Full-width task detail action buttons for main workflows.</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 1)} Mark Complete</p>
                                <Button className="w-full h-12 px-5 text-[13px] justify-center border border-emerald-500/35 bg-emerald-500/8 text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200">
                                    Mark Complete
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 2)} Postpone</p>
                                <Button variant="outline" className="w-full h-12 px-5 text-[13px] justify-center border border-amber-500/35 bg-amber-500/8 text-amber-300 hover:bg-amber-500/15 hover:border-amber-500/45 hover:text-amber-200">
                                    Postpone once?
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 3)} Stop Repeating</p>
                                <Button variant="ghost" className="w-full h-12 px-5 text-[13px] justify-center border border-red-900/40 bg-red-950/15 text-red-400/80 hover:bg-red-900/25 hover:text-red-300">
                                    <Repeat className="mr-1.5 h-3.5 w-3.5" />
                                    Stop Repeating
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 4)} Use Override</p>
                                <Button variant="ghost" className="w-full h-12 px-5 text-[13px] justify-center border border-slate-700 bg-slate-800/30 text-slate-300 hover:text-white hover:bg-slate-700/50">
                                    Use Override
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 5)} Delete Task</p>
                                <Button variant="ghost" className="w-full h-12 p-0 border border-red-900/40 bg-red-950/15 text-red-400/80 hover:bg-red-900/25 hover:text-red-300 justify-center">
                                    <Trash2 className="h-5 w-5" />
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 6)} Toggle Section (open)</p>
                                <Button variant="ghost" className="w-full h-12 px-3 text-[13px] justify-between border border-[#4338ca]/50 bg-[#4338ca]/10 text-[#a5b4fc]">
                                    <span className="text-[13px] leading-none">Subtasks</span>
                                    <span className="text-[13px] leading-none opacity-80">2/4</span>
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 7)} Toggle Section (closed)</p>
                                <Button variant="ghost" className="w-full h-12 px-3 text-[13px] justify-between border border-[#4338ca]/50 bg-[#4338ca]/10 text-[#a5b4fc]">
                                    <span className="text-[13px] leading-none">Reminders</span>
                                    <span className="text-[13px] leading-none opacity-80">1</span>
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 8)} Disabled State</p>
                                <Button disabled className="w-full h-12 px-5 text-[13px] justify-center border border-slate-800 bg-transparent text-slate-500 cursor-not-allowed">
                                    Mark Complete
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <h3 className="text-base font-semibold text-slate-200">Semantic Action Buttons</h3>
                            <p className="text-xs text-slate-500 mt-0.5">Inline buttons for pending review states, proof management, and escalation.</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 9)} Add Proof (indigo 700)</p>
                                <Button variant="outline" className="h-9 px-4 text-[12px] bg-transparent border-[#4338ca]/30 text-[#a5b4fc] hover:bg-[#4338ca]/10 hover:border-[#4338ca]/50 hover:text-[#c7d2fe]">
                                    <Camera className="mr-1.5 h-3.5 w-3.5" />
                                    Add Proof
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 10)} Undo Complete (indigo 700)</p>
                                <Button variant="outline" className="h-9 px-4 text-[12px] bg-transparent border-[#4338ca]/30 text-[#a5b4fc] hover:bg-[#4338ca]/10 hover:border-[#4338ca]/50 hover:text-[#c7d2fe]">
                                    Undo Complete
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 11)} Resubmit Proof (orange 400)</p>
                                <Button variant="ghost" className="h-9 px-4 text-[12px] border border-[#fb923c]/30 bg-[#fb923c]/10 text-[#fb923c] hover:bg-[#fb923c]/20 hover:text-[#fb923c]">
                                    <Camera className="mr-1.5 h-3.5 w-3.5" />
                                    Resubmit Proof
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 12)} Escalate to Friend (orange 400)</p>
                                <Button variant="ghost" className="h-9 px-4 text-[12px] border border-[#fb923c]/30 bg-[#fb923c]/10 text-[#fb923c] hover:bg-[#fb923c]/20 hover:text-[#fb923c]">
                                    <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
                                    Escalate to Friend
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 13)} Remove Proof (red small)</p>
                                <Button variant="ghost" className="h-7 px-2 text-[11px] text-red-400/70 hover:text-red-300 bg-transparent hover:bg-red-950/30 border border-red-900/30">
                                    Remove
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 14)} Add Reminder (indigo 700)</p>
                                <Button variant="outline" className="h-8 text-[11px] bg-transparent border-[#4338ca]/20 text-[#a5b4fc]/60 hover:text-[#a5b4fc] hover:border-[#4338ca]/40">
                                    Add
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <h3 className="text-base font-semibold text-slate-200">Voucher Action Buttons</h3>
                            <p className="text-xs text-slate-500 mt-0.5">Icon buttons used by vouchers to accept, deny, request proof, or rectify.</p>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                            <div className="space-y-1.5 py-3 px-4 flex flex-col items-center">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 15)} Accept</p>
                                <Button size="sm" className="h-9 w-9 p-0 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200 border border-emerald-500/30">
                                    <Check className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4 flex flex-col items-center">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 16)} Deny</p>
                                <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/30">
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4 flex flex-col items-center">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 17)} Request Proof</p>
                                <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-amber-300 hover:text-amber-200 hover:bg-amber-500/10 border border-amber-500/30">
                                    <Camera className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4 flex flex-col items-center">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 18)} Rectify</p>
                                <Button size="sm" variant="ghost" className="h-8 text-xs bg-orange-500/5 text-orange-400 hover:bg-orange-500/10 hover:text-orange-300 border border-orange-500/10">
                                    Rectify
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <h3 className="text-base font-semibold text-slate-200">Navigation &amp; Link Buttons</h3>
                            <p className="text-xs text-slate-500 mt-0.5">Buttons used for navigation, commitment actions, and page-level CTAs.</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 19)} Primary CTA (blue)</p>
                                <Button className="bg-blue-600/30 border border-blue-500/40 text-blue-200 hover:bg-blue-600/40">
                                    Create Commitment
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 20)} Activate (blue solid)</p>
                                <Button className="border border-blue-500/50 bg-blue-600/30 text-blue-100 hover:bg-blue-600/40">
                                    Activate
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 21)} Cancel / Abandon (red)</p>
                                <Button className="border border-red-500/40 bg-red-900/20 text-red-200 hover:bg-red-900/30">
                                    Cancel
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 22)} Load More (outline slate)</p>
                                <Button variant="outline" className="border-slate-800 bg-slate-900/50 text-slate-300 hover:text-white">
                                    Load more
                                </Button>
                            </div>
                            <div className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 23)} Collapsible Toggle</p>
                                <Button variant="ghost" className="flex items-center gap-2 text-slate-400 hover:text-white px-0 hover:bg-transparent">
                                    <ChevronRight className="h-4 w-4 transition-transform" />
                                    <span className="text-xs uppercase tracking-wider font-bold">Completed (3)</span>
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <h3 className="text-base font-semibold text-slate-200">Icon Buttons</h3>
                            <p className="text-xs text-slate-500 mt-0.5">Ghost icon buttons used in headers and toolbars.</p>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 pt-2">
                            <div className="space-y-1.5 py-3 px-4 flex flex-col items-center">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 24)}</p>
                                <Button variant="ghost" size="icon" className="text-slate-500 hover:text-slate-200">
                                    <MessageSquare className="h-5 w-5" />
                                </Button>
                                <p className="text-[9px] text-slate-600">Default</p>
                            </div>
                            <div className="space-y-1.5 py-3 px-4 flex flex-col items-center">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 25)}</p>
                                <Button variant="ghost" size="icon" className="text-yellow-400 hover:text-yellow-300">
                                    <Zap className="h-5 w-5" />
                                </Button>
                                <p className="text-[9px] text-slate-600">Active</p>
                            </div>
                            <div className="space-y-1.5 py-3 px-4 flex flex-col items-center">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 26)}</p>
                                <Button variant="ghost" size="icon" className="text-emerald-400 hover:text-emerald-300">
                                    <Check className="h-5 w-5" />
                                </Button>
                                <p className="text-[9px] text-slate-600">Success</p>
                            </div>
                            <div className="space-y-1.5 py-3 px-4 flex flex-col items-center">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 27)}</p>
                                <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-300 hover:bg-red-500/10">
                                    <Trash2 className="h-5 w-5" />
                                </Button>
                                <p className="text-[9px] text-slate-600">Destructive</p>
                            </div>
                            <div className="space-y-1.5 py-3 px-4 flex flex-col items-center">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 28)}</p>
                                <Button variant="ghost" size="icon-sm" className="text-slate-500 hover:text-slate-200">
                                    <Clock className="h-4 w-4" />
                                </Button>
                                <p className="text-[9px] text-slate-600">Small</p>
                            </div>
                            <div className="space-y-1.5 py-3 px-4 flex flex-col items-center">
                                <p className="text-[10px] font-mono text-slate-500">{sectionItemLabel(9, 29)}</p>
                                <Button variant="ghost" size="icon-xs" className="text-slate-500 hover:text-slate-200">
                                    <X className="h-3 w-3" />
                                </Button>
                                <p className="text-[9px] text-slate-600">XS</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <p className="text-[10px] text-slate-700 text-center uppercase tracking-[0.2em] pt-12">
                Vouch Design System
            </p>
        </div>
    );
}
