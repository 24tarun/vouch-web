import type { ReactNode } from "react";
import type { DayStatus } from "@/lib/commitment-status";
import type { CommitmentStatus } from "@/lib/types";
import type { TaskStatus } from "@/lib/xstate/task-machine";
import { STAT_METRIC_PRESETS } from "@/design-system/stat-metrics";
import { TaskDetailButtonsShowcaseSection } from "@/design-system/task_detail_buttons";
import {
    ACTIVITY_TIMELINE_META_TEXT_CLASS,
    ActivityEventBadge,
    RecurringIndicator,
    TaskStatusBadge,
    VoucherDeadlineBadge,
    VoucherPomoAccumulatedBadge,
    VoucherProofRequestBadge,
} from "@/design-system/badges";
import { LedgerEntryRow } from "@/components/ledger/LedgerEntryRow";
import { CommitmentStatusLabel } from "@/components/commitments/CommitmentStatusLabel";
import { CommitmentDayStrip } from "@/components/CommitmentDayStrip";

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
            { name: "Indigo 700", hex: "#4338ca", glow: "rgba(67,56,202,0.7)", role: "" },
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
            { name: "Emerald 400", hex: "#34d399", glow: "rgba(52,211,153,0.5)", role: "", usedIn: ["TaskStatusBadge (MARKED_COMPLETE, ACCEPTED, AUTO_ACCEPTED, ORCA_ACCEPTED)", "TaskRow (MARKED_COMPLETE, accepted statuses)", "CommitmentStatusLabel", "FloatingBoxTaskCreator", "ReputationBar", "task-detail-client", "DashboardHeaderActions", "login/page", "MobileOnboarding", "MobileLanding", "DesktopLanding"] },
            { name: "Lime Green", hex: "#bef264", glow: "rgba(190,242,100,0.6)", role: "", usedIn: ["CompactStatsItem (accepted statuses)", "stats/page (Accepted metric)", "voucher-dashboard-client (accepted history statuses)"] },
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
            { name: "Orange 400", hex: "#fb923c", glow: "rgba(251,146,60,0.6)", role: "", usedIn: ["TaskStatusBadge (RECTIFIED)"] },
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
            { name: "Pink 400", hex: "#f472b6", glow: "rgba(244,114,182,0.6)", role: "", usedIn: ["Proof badges and proof-action buttons", "VoucherProofRequestBadge", "Task detail proof sections", "TaskRow proof actions"] },
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

const ACTIVITY_STEPPER_STATUSES: TaskStatus[] = [
    "ACTIVE",
    "POSTPONED",
    "MARKED_COMPLETE",
    "AWAITING_VOUCHER",
    "AWAITING_ORCA",
    "ORCA_DENIED",
    "AWAITING_USER",
    "ESCALATED",
    "ACCEPTED",
    "AUTO_ACCEPTED",
    "ORCA_ACCEPTED",
    "DENIED",
    "MISSED",
    "RECTIFIED",
    "DELETED",
    "SETTLED",
];

const ACTIVITY_STEPPER_EVENTS: { eventType: string; elapsedSeconds?: number }[] = [
    { eventType: "ACTIVE" },
    { eventType: "CREATED" },
    { eventType: "MARK_COMPLETE" },
    { eventType: "UNDO_COMPLETE" },
    { eventType: "PROOF_UPLOAD_FAILED_REVERT" },
    { eventType: "PROOF_REMOVED" },
    { eventType: "PROOF_REQUESTED" },
    { eventType: "PROOF_UPLOADED" },
    { eventType: "VOUCHER_ACCEPT" },
    { eventType: "VOUCHER_DENY" },
    { eventType: "VOUCHER_DELETE" },
    { eventType: "RECTIFY" },
    { eventType: "OVERRIDE" },
    { eventType: "DEADLINE_MISSED" },
    { eventType: "VOUCHER_TIMEOUT" },
    { eventType: "POMO_COMPLETED", elapsedSeconds: 3720 },
    { eventType: "DEADLINE_WARNING_1H" },
    { eventType: "DEADLINE_WARNING_5M" },
    { eventType: "GOOGLE_EVENT_CANCELLED" },
    { eventType: "POSTPONE" },
    { eventType: "REPETITION_STOPPED" },
    { eventType: "AI_APPROVE" },
    { eventType: "AI_DENY" },
    { eventType: "ORCA_DENIED_AUTO_HOP" },
    { eventType: "ESCALATE" },
    { eventType: "AI_ESCALATE_TO_HUMAN" },
    { eventType: "ACCEPT_DENIAL" },
];

type ActivityStepperItem =
    | { kind: "status"; status: TaskStatus }
    | { kind: "event"; eventType: string; elapsedSeconds?: number };

const ACTIVITY_STEPPER_ITEMS: ActivityStepperItem[] = [
    ...ACTIVITY_STEPPER_STATUSES.map((status) => ({ kind: "status" as const, status })),
    ...ACTIVITY_STEPPER_EVENTS.map((event) => ({ kind: "event" as const, ...event })),
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

function addMinutes(base: Date, offset: number): Date {
    const next = new Date(base);
    next.setMinutes(next.getMinutes() + offset);
    return next;
}

function formatDateDdMmYyyy(value: Date | string): string {
    return new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    });
}

function formatTime24h(value: Date | string): string {
    return new Date(value).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}

function formatDateTimeDdMmYyyy24h(value: Date | string): string {
    return `${formatDateDdMmYyyy(value)} ${formatTime24h(value)}`;
}

function sectionItemLabel(section: number, item: number): string {
    return `${section}.${item}`;
}

export function DesignSystemShowcase() {
    const today = new Date();
    const stripStart = toDateOnly(addDays(today, -4));
    const stripEnd = toDateOnly(addDays(today, 2));
    const selectedDate = toDateOnly(addDays(today, -2));
    const activityTimelineStart = new Date(today);
    activityTimelineStart.setHours(0, 0, 0, 0);
    const stripDayStatuses: { date: string; status: DayStatus }[] = [
        { date: toDateOnly(addDays(today, -4)), status: "passed" },
        { date: toDateOnly(addDays(today, -3)), status: "pending" },
        { date: toDateOnly(addDays(today, -2)), status: "failed" },
        { date: toDateOnly(addDays(today, -1)), status: "passed" },
    ];
    const section4StatusCount = TASK_STATUS_GROUPS.reduce((sum, group) => sum + group.statuses.length, 0);
    const activityTimelineTimestamps = ACTIVITY_STEPPER_ITEMS.map((_, index) =>
        formatDateTimeDdMmYyyy24h(addMinutes(activityTimelineStart, index * 37))
    );

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
                    {STAT_METRIC_PRESETS.map((metric, index) => (
                        <div key={metric.id} className="space-y-2">
                            <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                                <span className="mr-2 font-mono normal-case">{sectionItemLabel(3, index + 1)}</span>
                                {metric.label}
                            </p>
                            <p className={`text-4xl font-light ${metric.textClass}`} style={{ filter: `drop-shadow(${metric.glow})` }}>
                                42
                            </p>
                            <p className="text-[10px] font-mono text-slate-600 uppercase tracking-wide">
                                {metric.accentName}
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
                                        <TaskStatusBadge status={status} className="font-medium tracking-normal" />
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
                                <TaskStatusBadge key="active" status="ACTIVE" className="font-medium tracking-normal" />,
                                <TaskStatusBadge key="awaiting-voucher" status="AWAITING_VOUCHER" className="font-medium tracking-normal" />,
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

            <TaskDetailButtonsShowcaseSection sectionNumber={9} sectionItemLabel={sectionItemLabel} />

            <section className="space-y-6">
                <SectionTitle>10. Activity Stepper</SectionTitle>
                <SectionDescription>
                    Complete sample timeline covering every task status and every activity event tag. This is intentionally exhaustive and not chronological.
                </SectionDescription>

                <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4 md:p-6">
                    <div className="mx-auto flex w-full max-w-2xl items-center gap-3 mb-6">
                        <div className="h-px flex-1 bg-cyan-400/80 shadow-[0_0_6px_rgba(0,217,255,0.35)]" />
                        <span className="text-[10px] uppercase tracking-wider font-bold text-cyan-400">activity stepper</span>
                        <div className="h-px flex-1 bg-cyan-400/80 shadow-[0_0_6px_rgba(0,217,255,0.35)]" />
                    </div>

                    <div className="relative mx-auto w-full max-w-3xl">
                        <div className="pointer-events-none absolute left-1/2 top-2 bottom-2 w-px -translate-x-1/2 bg-gradient-to-b from-cyan-500/35 via-slate-800 to-transparent" />
                        {ACTIVITY_STEPPER_ITEMS.map((item, index) => {
                            const isRightSide = index % 2 === 0;
                            const isProofEvent = item.kind === "event" && item.eventType.startsWith("PROOF_");
                            const dotClass =
                                item.kind === "status"
                                    ? "bg-slate-500 shadow-[0_0_6px_rgba(100,116,139,0.45)]"
                                    : isProofEvent
                                        ? "bg-pink-400 shadow-[0_0_6px_rgba(244,114,182,0.45)]"
                                    : "bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.45)]";

                            return (
                                <div key={item.kind === "status" ? `status-${item.status}` : `event-${item.eventType}-${index}`} className="relative pb-4 last:pb-0">
                                    <div className={`absolute left-1/2 top-1.5 h-2.5 w-2.5 -translate-x-1/2 rounded-full ${dotClass}`} />
                                    <div
                                        className={`absolute top-[9px] h-px w-10 ${isRightSide
                                            ? "left-1/2 ml-1.5 bg-gradient-to-r from-cyan-500/45 to-transparent"
                                            : "right-1/2 mr-1.5 bg-gradient-to-l from-cyan-500/45 to-transparent"}`}
                                    />
                                    <div className={`space-y-1.5 ${isRightSide
                                        ? "ml-[calc(50%+2.75rem)] max-w-[calc(50%-2.75rem)] text-left"
                                        : "mr-[calc(50%+2.75rem)] max-w-[calc(50%-2.75rem)] text-right"}`}>
                                        <div className={`flex ${isRightSide ? "justify-start" : "justify-end"}`}>
                                            {item.kind === "status" ? (
                                                <TaskStatusBadge status={item.status} className="font-medium tracking-normal" />
                                            ) : (
                                                <ActivityEventBadge
                                                    eventType={item.eventType}
                                                    elapsedSeconds={item.elapsedSeconds}
                                                />
                                            )}
                                        </div>
                                        <p className={`${ACTIVITY_TIMELINE_META_TEXT_CLASS} ${isRightSide ? "text-left" : "text-right"}`}>
                                            {activityTimelineTimestamps[index]}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            <p className="text-[10px] text-slate-700 text-center uppercase tracking-[0.2em] pt-12">
                Vouch Design System
            </p>
        </div>
    );
}

