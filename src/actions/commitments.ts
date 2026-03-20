"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotification } from "@/lib/notifications";
import {
    computeDerivedStatus,
    computeEarnedSoFar,
    computeTotalTarget,
    getDayStatuses,
    type DayStatus,
} from "@/lib/commitment-status";
import type {
    Commitment,
    CommitmentStatus,
    CommitmentTaskLink,
    RecurrenceRule,
    Task,
} from "@/lib/types";

type CommitmentTaskLite = Pick<Task, "id" | "title" | "status" | "deadline" | "failure_cost_cents" | "recurrence_rule_id">;
type RecurrenceRuleLite = Pick<
    RecurrenceRule,
    "id" | "title" | "failure_cost_cents" | "rule_config" | "created_at" | "last_generated_date"
>;

interface CommitmentDayStatus {
    date: string;
    status: DayStatus;
}

export interface CommitmentListItem extends Commitment {
    links: CommitmentTaskLink[];
    derived_status: CommitmentStatus;
    earned_so_far_cents: number;
    total_target_cents: number;
    day_statuses: CommitmentDayStatus[];
    days_total: number;
    days_remaining: number;
    starts_in_days: number;
}

export interface CommitmentDetailLink extends CommitmentTaskLink {
    task: CommitmentTaskLite | null;
    recurrence_rule: RecurrenceRuleLite | null;
    instances: CommitmentTaskLite[];
}

export interface CommitmentDetailPayload {
    commitment: Commitment;
    derived_status: CommitmentStatus;
    earned_so_far_cents: number;
    total_target_cents: number;
    day_statuses: CommitmentDayStatus[];
    links: CommitmentDetailLink[];
    tasks_due_today: CommitmentTaskLite[];
    days_total: number;
    days_remaining: number;
    starts_in_days: number;
}

interface CommitmentDateWindow {
    startDate: string;
    endDate: string;
}

interface CommitmentInput {
    name: string;
    start_date: string;
    end_date: string;
}

interface CommitmentUpdateInput {
    name?: string;
    start_date?: string;
    end_date?: string;
}

interface AddTaskLinkInput {
    task_id?: string;
    recurrence_rule_id?: string;
}

function normalizeDateOnly(value: string): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
    const parsed = new Date(`${trimmed}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    return trimmed;
}

function parseDateOnlyUtc(value: string): Date | null {
    const normalized = normalizeDateOnly(value);
    if (!normalized) return null;
    return new Date(`${normalized}T00:00:00.000Z`);
}

function dayDiffInclusive(startDate: string, endDate: string): number {
    const start = parseDateOnlyUtc(startDate);
    const end = parseDateOnlyUtc(endDate);
    if (!start || !end) return 0;
    const diffDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    return diffDays + 1;
}

function dayDiffFromToday(dateOnly: string): number {
    const today = new Date();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const target = parseDateOnlyUtc(dateOnly);
    if (!target) return 0;
    return Math.floor((target.getTime() - todayUtc.getTime()) / (24 * 60 * 60 * 1000));
}

function toDateOnlyFromTimestamp(timestamp: string): string | null {
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
}

function validateDateWindow(startDateOnly: string, endDateOnly: string): { ok: true } | { ok: false; error: string } {
    const start = parseDateOnlyUtc(startDateOnly);
    const end = parseDateOnlyUtc(endDateOnly);
    if (!start || !end) {
        return { ok: false, error: "Start and end dates must be valid YYYY-MM-DD values." };
    }
    const diffDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays < 3) {
        return { ok: false, error: "Commitment must span at least 4 days." };
    }
    return { ok: true };
}

function normalizeName(raw: string): string {
    return (raw || "").trim();
}

function serializeDayStatuses(dayStatusMap: Map<string, DayStatus>): CommitmentDayStatus[] {
    return Array.from(dayStatusMap.entries()).map(([date, status]) => ({ date, status }));
}

function revalidateCommitmentSurfaces(commitmentId?: string) {
    revalidatePath("/dashboard/commitments");
    revalidatePath("/dashboard/commitments/new");
    if (commitmentId) {
        revalidatePath(`/dashboard/commitments/${commitmentId}`);
    }
}

async function getAuthenticatedUserId() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    return { supabase, userId: user?.id ?? null };
}

async function getCommitmentForUser(
    supabase: Awaited<ReturnType<typeof createClient>>,
    commitmentId: string,
    userId: string
): Promise<Commitment | null> {
    const { data } = await (supabase.from("commitments") as any)
        .select("*")
        .eq("id", commitmentId as any)
        .eq("user_id", userId as any)
        .maybeSingle();
    return (data as Commitment | null) ?? null;
}

async function getLinksForCommitmentIds(
    supabase: Awaited<ReturnType<typeof createClient>>,
    commitmentIds: string[]
): Promise<CommitmentTaskLink[]> {
    if (commitmentIds.length === 0) return [];
    const { data } = await (supabase.from("commitment_task_links") as any)
        .select("*")
        .in("commitment_id", commitmentIds as any)
        .order("created_at", { ascending: true });
    return (data as CommitmentTaskLink[] | null) || [];
}

async function loadComputationResources(
    supabase: Awaited<ReturnType<typeof createClient>>,
    userId: string,
    links: CommitmentTaskLink[],
    commitmentWindows: CommitmentDateWindow[]
): Promise<{
    oneOffTaskById: Map<string, CommitmentTaskLite>;
    recurrenceRuleById: Map<string, RecurrenceRuleLite>;
    recurringInstances: CommitmentTaskLite[];
}> {
    const taskIds = [...new Set(links.map((link) => link.task_id).filter((id): id is string => Boolean(id)))];
    const recurrenceRuleIds = [
        ...new Set(links.map((link) => link.recurrence_rule_id).filter((id): id is string => Boolean(id))),
    ];

    const minStartDate = commitmentWindows.map((window) => window.startDate).sort()[0] || null;
    const maxEndDate = commitmentWindows.map((window) => window.endDate).sort().at(-1) || null;
    const minDeadlineIso = minStartDate ? `${minStartDate}T00:00:00.000Z` : null;
    const maxDeadlineIso = maxEndDate ? `${maxEndDate}T23:59:59.999Z` : null;

    const [oneOffTasksResult, recurrenceRulesResult, recurringInstancesResult] = await Promise.all([
        taskIds.length > 0
            ? (supabase.from("tasks") as any)
                .select("id, title, status, deadline, failure_cost_cents, recurrence_rule_id")
                .eq("user_id", userId as any)
                .in("id", taskIds as any)
                .neq("status", "DELETED" as any)
            : Promise.resolve({ data: [] }),
        recurrenceRuleIds.length > 0
            ? (supabase.from("recurrence_rules") as any)
                .select("id, title, failure_cost_cents, rule_config, created_at, last_generated_date")
                .eq("user_id", userId as any)
                .in("id", recurrenceRuleIds as any)
            : Promise.resolve({ data: [] }),
        recurrenceRuleIds.length > 0 && minDeadlineIso && maxDeadlineIso
            ? (supabase.from("tasks") as any)
                .select("id, title, status, deadline, failure_cost_cents, recurrence_rule_id")
                .eq("user_id", userId as any)
                .in("recurrence_rule_id", recurrenceRuleIds as any)
                .gte("deadline", minDeadlineIso as any)
                .lte("deadline", maxDeadlineIso as any)
                .neq("status", "DELETED" as any)
            : Promise.resolve({ data: [] }),
    ]);

    const oneOffTaskById = new Map<string, CommitmentTaskLite>();
    for (const row of ((oneOffTasksResult.data as CommitmentTaskLite[] | null) || [])) {
        oneOffTaskById.set(row.id, row);
    }

    const recurrenceRuleById = new Map<string, RecurrenceRuleLite>();
    for (const row of ((recurrenceRulesResult.data as RecurrenceRuleLite[] | null) || [])) {
        recurrenceRuleById.set(row.id, row);
    }

    const recurringInstances = ((recurringInstancesResult.data as CommitmentTaskLite[] | null) || []);

    return { oneOffTaskById, recurrenceRuleById, recurringInstances };
}

function gatherLinkedTasksForCommitment(
    commitment: Commitment,
    links: CommitmentTaskLink[],
    oneOffTaskById: Map<string, CommitmentTaskLite>,
    recurringInstances: CommitmentTaskLite[]
): CommitmentTaskLite[] {
    const tasks: CommitmentTaskLite[] = [];
    const recurrenceRuleIds = new Set<string>();

    for (const link of links) {
        if (link.task_id) {
            const oneOff = oneOffTaskById.get(link.task_id);
            if (oneOff) tasks.push(oneOff);
        } else if (link.recurrence_rule_id) {
            recurrenceRuleIds.add(link.recurrence_rule_id);
        }
    }

    for (const task of recurringInstances) {
        if (!task.recurrence_rule_id || !recurrenceRuleIds.has(task.recurrence_rule_id)) continue;
        const dateOnly = toDateOnlyFromTimestamp(task.deadline);
        if (!dateOnly) continue;
        if (dateOnly < commitment.start_date || dateOnly > commitment.end_date) continue;
        tasks.push(task);
    }

    return tasks;
}

function buildCommitmentMetrics(
    commitment: Commitment,
    links: CommitmentTaskLink[],
    linkedTasks: CommitmentTaskLite[],
    oneOffTaskById: Map<string, CommitmentTaskLite>,
    recurrenceRuleById: Map<string, RecurrenceRuleLite>
) {
    const derivedStatus = computeDerivedStatus(commitment, linkedTasks);
    const earnedSoFarCents = computeEarnedSoFar(linkedTasks, commitment.start_date, commitment.end_date);
    const totalTargetCents = computeTotalTarget(
        links,
        links
            .map((link) => (link.recurrence_rule_id ? recurrenceRuleById.get(link.recurrence_rule_id) : null))
            .filter((rule): rule is RecurrenceRuleLite => Boolean(rule)),
        links
            .map((link) => (link.task_id ? oneOffTaskById.get(link.task_id) : null))
            .filter((task): task is CommitmentTaskLite => Boolean(task))
            .map((task) => ({ id: task.id, failure_cost_cents: task.failure_cost_cents })),
        commitment.start_date,
        commitment.end_date
    );
    const dayStatuses = serializeDayStatuses(
        getDayStatuses(linkedTasks, commitment.start_date, commitment.end_date)
    );
    const daysTotal = Math.max(0, dayDiffInclusive(commitment.start_date, commitment.end_date));
    const daysUntilStart = dayDiffFromToday(commitment.start_date);
    const daysUntilEnd = dayDiffFromToday(commitment.end_date);
    const startsInDays = Math.max(0, daysUntilStart);
    const daysRemaining = Math.max(0, daysUntilEnd + 1);

    return {
        derivedStatus,
        earnedSoFarCents,
        totalTargetCents,
        dayStatuses,
        daysTotal,
        daysRemaining,
        startsInDays,
    };
}

export async function createCommitment(input: CommitmentInput) {
    const { supabase, userId } = await getAuthenticatedUserId();
    if (!userId) return { success: false as const, error: "Not authenticated" };

    const name = normalizeName(input.name);
    const startDate = normalizeDateOnly(input.start_date || "");
    const endDate = normalizeDateOnly(input.end_date || "");

    if (!name) return { success: false as const, error: "Commitment name is required." };
    if (!startDate || !endDate) {
        return { success: false as const, error: "Start and end dates are required." };
    }

    const windowValidation = validateDateWindow(startDate, endDate);
    if (!windowValidation.ok) {
        return { success: false as const, error: windowValidation.error };
    }

    const { data, error } = await (supabase.from("commitments") as any)
        .insert({
            user_id: userId,
            name,
            status: "DRAFT",
            start_date: startDate,
            end_date: endDate,
        })
        .select("id")
        .maybeSingle();

    if (error || !data?.id) {
        return { success: false as const, error: error?.message || "Failed to create commitment." };
    }

    revalidateCommitmentSurfaces(data.id);
    return { success: true as const, commitmentId: String(data.id) };
}

export async function updateCommitment(commitmentId: string, input: CommitmentUpdateInput) {
    const { supabase, userId } = await getAuthenticatedUserId();
    if (!userId) return { success: false as const, error: "Not authenticated" };

    const commitment = await getCommitmentForUser(supabase, commitmentId, userId);
    if (!commitment) return { success: false as const, error: "Commitment not found." };
    if (commitment.status !== "DRAFT") {
        return { success: false as const, error: "Only draft commitments can be edited." };
    }

    const update: Record<string, unknown> = {};
    if (typeof input.name === "string") {
        const name = normalizeName(input.name);
        if (!name) {
            return { success: false as const, error: "Commitment name cannot be empty." };
        }
        update.name = name;
    }

    const startDate = input.start_date ? normalizeDateOnly(input.start_date) : commitment.start_date;
    const endDate = input.end_date ? normalizeDateOnly(input.end_date) : commitment.end_date;
    if (!startDate || !endDate) {
        return { success: false as const, error: "Start and end dates must be valid YYYY-MM-DD values." };
    }
    const windowValidation = validateDateWindow(startDate, endDate);
    if (!windowValidation.ok) {
        return { success: false as const, error: windowValidation.error };
    }

    if (input.start_date) update.start_date = startDate;
    if (input.end_date) update.end_date = endDate;

    if (Object.keys(update).length === 0) {
        return { success: true as const };
    }

    const { error } = await (supabase.from("commitments") as any)
        .update(update as any)
        .eq("id", commitmentId as any)
        .eq("user_id", userId as any);

    if (error) return { success: false as const, error: error.message };

    revalidateCommitmentSurfaces(commitmentId);
    return { success: true as const };
}

export async function addTaskLink(commitmentId: string, input: AddTaskLinkInput) {
    const { supabase, userId } = await getAuthenticatedUserId();
    if (!userId) return { success: false as const, error: "Not authenticated" };

    const commitment = await getCommitmentForUser(supabase, commitmentId, userId);
    if (!commitment) return { success: false as const, error: "Commitment not found." };
    if (commitment.status !== "DRAFT") {
        return { success: false as const, error: "Only draft commitments can be modified." };
    }

    const taskId = typeof input.task_id === "string" ? input.task_id.trim() : "";
    const recurrenceRuleId =
        typeof input.recurrence_rule_id === "string" ? input.recurrence_rule_id.trim() : "";

    if ((taskId && recurrenceRuleId) || (!taskId && !recurrenceRuleId)) {
        return { success: false as const, error: "Provide exactly one of task_id or recurrence_rule_id." };
    }

    if (taskId) {
        const { data: existingTask } = await (supabase.from("tasks") as any)
            .select("id, deadline")
            .eq("id", taskId as any)
            .eq("user_id", userId as any)
            .maybeSingle();
        if (!existingTask) {
            return { success: false as const, error: "Task not found." };
        }
        const deadlineDateOnly = toDateOnlyFromTimestamp(String(existingTask.deadline || ""));
        if (!deadlineDateOnly || deadlineDateOnly < commitment.start_date || deadlineDateOnly > commitment.end_date) {
            return {
                success: false as const,
                error: "One-off task deadline must fall within the commitment window.",
            };
        }

        const { data: duplicateLink } = await (supabase.from("commitment_task_links") as any)
            .select("id")
            .eq("commitment_id", commitmentId as any)
            .eq("task_id", taskId as any)
            .maybeSingle();
        if (duplicateLink?.id) {
            return { success: false as const, error: "Task is already linked to this commitment." };
        }
    }

    if (recurrenceRuleId) {
        const { data: existingRule } = await (supabase.from("recurrence_rules") as any)
            .select("id")
            .eq("id", recurrenceRuleId as any)
            .eq("user_id", userId as any)
            .maybeSingle();
        if (!existingRule) {
            return { success: false as const, error: "Recurring series not found." };
        }

        const { data: duplicateLink } = await (supabase.from("commitment_task_links") as any)
            .select("id")
            .eq("commitment_id", commitmentId as any)
            .eq("recurrence_rule_id", recurrenceRuleId as any)
            .maybeSingle();
        if (duplicateLink?.id) {
            return { success: false as const, error: "Recurring series is already linked to this commitment." };
        }
    }

    const { error } = await (supabase.from("commitment_task_links") as any).insert({
        commitment_id: commitmentId,
        task_id: taskId || null,
        recurrence_rule_id: recurrenceRuleId || null,
    } as any);

    if (error) {
        return { success: false as const, error: error.message };
    }

    await (supabase.from("commitments") as any)
        .update({ updated_at: new Date().toISOString() } as any)
        .eq("id", commitmentId as any)
        .eq("user_id", userId as any);

    revalidateCommitmentSurfaces(commitmentId);
    return { success: true as const };
}

export async function removeTaskLink(linkId: string) {
    const { supabase, userId } = await getAuthenticatedUserId();
    if (!userId) return { success: false as const, error: "Not authenticated" };

    const { data: link } = await (supabase.from("commitment_task_links") as any)
        .select("id, commitment_id, commitments!inner(user_id, status)")
        .eq("id", linkId as any)
        .maybeSingle();

    if (!link || !link.commitments || String(link.commitments.user_id || "") !== userId) {
        return { success: false as const, error: "Link not found." };
    }

    if (String(link.commitments.status) !== "DRAFT") {
        return { success: false as const, error: "Only draft commitments can be modified." };
    }

    const { error } = await (supabase.from("commitment_task_links") as any)
        .delete()
        .eq("id", linkId as any);
    if (error) return { success: false as const, error: error.message };

    await (supabase.from("commitments") as any)
        .update({ updated_at: new Date().toISOString() } as any)
        .eq("id", link.commitment_id as any)
        .eq("user_id", userId as any);

    revalidateCommitmentSurfaces(String(link.commitment_id));
    return { success: true as const };
}

export async function activateCommitment(commitmentId: string) {
    const { supabase, userId } = await getAuthenticatedUserId();
    if (!userId) return { success: false as const, error: "Not authenticated" };

    const commitment = await getCommitmentForUser(supabase, commitmentId, userId);
    if (!commitment) return { success: false as const, error: "Commitment not found." };
    if (commitment.status !== "DRAFT") {
        return { success: false as const, error: "Only draft commitments can be activated." };
    }
    if (!normalizeName(commitment.name)) {
        return { success: false as const, error: "Commitment name is required." };
    }

    const today = new Date().toISOString().slice(0, 10);
    if (commitment.start_date < today) {
        return { success: false as const, error: "Commitment start date cannot be in the past." };
    }

    const { count } = await (supabase.from("commitment_task_links") as any)
        .select("id", { head: true, count: "exact" })
        .eq("commitment_id", commitmentId as any);
    if ((count || 0) < 1) {
        return { success: false as const, error: "Add at least one task before activating." };
    }

    const { error } = await (supabase.from("commitments") as any)
        .update({ status: "ACTIVE" } as any)
        .eq("id", commitmentId as any)
        .eq("user_id", userId as any)
        .eq("status", "DRAFT" as any);
    if (error) return { success: false as const, error: error.message };

    revalidateCommitmentSurfaces(commitmentId);
    return { success: true as const };
}

export async function abandonCommitment(commitmentId: string) {
    const { supabase, userId } = await getAuthenticatedUserId();
    if (!userId) return { success: false as const, error: "Not authenticated" };

    const commitment = await getCommitmentForUser(supabase, commitmentId, userId);
    if (!commitment) return { success: false as const, error: "Commitment not found." };
    if (commitment.status !== "DRAFT" && commitment.status !== "ACTIVE") {
        return { success: false as const, error: "Only draft or active commitments can be deleted." };
    }

    const { error } = await (supabase.from("commitments") as any)
        .delete()
        .eq("id", commitmentId as any)
        .eq("user_id", userId as any);
    if (error) return { success: false as const, error: error.message };

    revalidateCommitmentSurfaces(commitmentId);
    return { success: true as const };
}

export async function getCommitments(): Promise<CommitmentListItem[]> {
    const { supabase, userId } = await getAuthenticatedUserId();
    if (!userId) return [];

    const { data: commitmentsRows } = await (supabase.from("commitments") as any)
        .select("*")
        .eq("user_id", userId as any)
        .order("created_at", { ascending: false });

    const commitments = (commitmentsRows as Commitment[] | null) || [];
    if (commitments.length === 0) return [];

    const commitmentIds = commitments.map((commitment) => commitment.id);
    const links = await getLinksForCommitmentIds(supabase, commitmentIds);
    const linksByCommitmentId = new Map<string, CommitmentTaskLink[]>();
    for (const link of links) {
        const current = linksByCommitmentId.get(link.commitment_id) || [];
        current.push(link);
        linksByCommitmentId.set(link.commitment_id, current);
    }

    const resources = await loadComputationResources(
        supabase,
        userId,
        links,
        commitments.map((commitment) => ({ startDate: commitment.start_date, endDate: commitment.end_date }))
    );

    const results: CommitmentListItem[] = [];
    for (const commitment of commitments) {
        const commitmentLinks = linksByCommitmentId.get(commitment.id) || [];
        const linkedTasks = gatherLinkedTasksForCommitment(
            commitment,
            commitmentLinks,
            resources.oneOffTaskById,
            resources.recurringInstances
        );
        const metrics = buildCommitmentMetrics(
            commitment,
            commitmentLinks,
            linkedTasks,
            resources.oneOffTaskById,
            resources.recurrenceRuleById
        );

        if (commitment.status === "ACTIVE" && metrics.derivedStatus !== "ACTIVE") {
            await (supabase.from("commitments") as any)
                .update({ status: metrics.derivedStatus } as any)
                .eq("id", commitment.id as any)
                .eq("user_id", userId as any)
                .eq("status", "ACTIVE" as any);
            commitment.status = metrics.derivedStatus;
        }

        results.push({
            ...commitment,
            links: commitmentLinks,
            derived_status: metrics.derivedStatus,
            earned_so_far_cents: metrics.earnedSoFarCents,
            total_target_cents: metrics.totalTargetCents,
            day_statuses: metrics.dayStatuses,
            days_total: metrics.daysTotal,
            days_remaining: metrics.daysRemaining,
            starts_in_days: metrics.startsInDays,
        });
    }

    return results;
}

export async function getCommitmentDetail(commitmentId: string): Promise<CommitmentDetailPayload | null> {
    const { supabase, userId } = await getAuthenticatedUserId();
    if (!userId) return null;

    const commitment = await getCommitmentForUser(supabase, commitmentId, userId);
    if (!commitment) return null;

    const links = await getLinksForCommitmentIds(supabase, [commitment.id]);
    const resources = await loadComputationResources(
        supabase,
        userId,
        links,
        [{ startDate: commitment.start_date, endDate: commitment.end_date }]
    );

    const linkedTasks = gatherLinkedTasksForCommitment(
        commitment,
        links,
        resources.oneOffTaskById,
        resources.recurringInstances
    );
    const metrics = buildCommitmentMetrics(
        commitment,
        links,
        linkedTasks,
        resources.oneOffTaskById,
        resources.recurrenceRuleById
    );

    if (commitment.status !== "DRAFT" && commitment.status !== metrics.derivedStatus) {
        await (supabase.from("commitments") as any)
            .update({ status: metrics.derivedStatus } as any)
            .eq("id", commitment.id as any)
            .eq("user_id", userId as any);
        commitment.status = metrics.derivedStatus;
    }

    const todayDateOnly = new Date().toISOString().slice(0, 10);
    const tasksDueToday = linkedTasks.filter((task) => {
        const dateOnly = toDateOnlyFromTimestamp(task.deadline);
        return dateOnly === todayDateOnly;
    });

    const detailLinks: CommitmentDetailLink[] = links.map((link) => {
        if (link.task_id) {
            const task = resources.oneOffTaskById.get(link.task_id) || null;
            const instances = task ? [task] : [];
            return {
                ...link,
                task,
                recurrence_rule: null,
                instances,
            };
        }

        const recurrenceRule = link.recurrence_rule_id
            ? resources.recurrenceRuleById.get(link.recurrence_rule_id) || null
            : null;

        const instances = resources.recurringInstances.filter((task) => {
            if (!link.recurrence_rule_id) return false;
            if (task.recurrence_rule_id !== link.recurrence_rule_id) return false;
            const dateOnly = toDateOnlyFromTimestamp(task.deadline);
            if (!dateOnly) return false;
            return dateOnly >= commitment.start_date && dateOnly <= commitment.end_date;
        });

        return {
            ...link,
            task: null,
            recurrence_rule: recurrenceRule,
            instances,
        };
    });

    return {
        commitment,
        derived_status: metrics.derivedStatus,
        earned_so_far_cents: metrics.earnedSoFarCents,
        total_target_cents: metrics.totalTargetCents,
        day_statuses: metrics.dayStatuses,
        links: detailLinks,
        tasks_due_today: tasksDueToday,
        days_total: metrics.daysTotal,
        days_remaining: metrics.daysRemaining,
        starts_in_days: metrics.startsInDays,
    };
}

export async function notifyCommitmentFailureIfNeeded(taskId: string, recurrenceRuleId?: string | null) {
    if (!taskId && !recurrenceRuleId) return;

    const admin = createAdminClient();
    const linkRows: Array<{
        commitment_id: string;
        commitments: { id: string; user_id: string; name: string; status: CommitmentStatus } | null;
    }> = [];

    if (taskId) {
        const { data } = await (admin.from("commitment_task_links") as any)
            .select("commitment_id, commitments!inner(id, user_id, name, status)")
            .eq("task_id", taskId as any)
            .eq("commitments.status", "ACTIVE" as any);
        linkRows.push(...(((data as typeof linkRows) || [])));
    }

    if (recurrenceRuleId) {
        const { data } = await (admin.from("commitment_task_links") as any)
            .select("commitment_id, commitments!inner(id, user_id, name, status)")
            .eq("recurrence_rule_id", recurrenceRuleId as any)
            .eq("commitments.status", "ACTIVE" as any);
        linkRows.push(...(((data as typeof linkRows) || [])));
    }

    if (linkRows.length === 0) return;

    const uniqueCommitments = new Map<string, { id: string; user_id: string; name: string }>();
    for (const row of linkRows) {
        if (!row.commitments) continue;
        uniqueCommitments.set(row.commitment_id, {
            id: row.commitments.id,
            user_id: row.commitments.user_id,
            name: row.commitments.name,
        });
    }

    const ownerIds = [...new Set(Array.from(uniqueCommitments.values()).map((commitment) => commitment.user_id))];
    const { data: profiles } = await (admin.from("profiles") as any)
        .select("id, email, username")
        .in("id", ownerIds as any);
    const profileById = new Map<string, { email?: string | null; username?: string | null }>();
    for (const profile of ((profiles as Array<{ id: string; email?: string | null; username?: string | null }> | null) || [])) {
        profileById.set(profile.id, profile);
    }

    for (const commitment of uniqueCommitments.values()) {
        const profile = profileById.get(commitment.user_id);
        await sendNotification({
            to: profile?.email || undefined,
            userId: commitment.user_id,
            subject: `Commitment failed: ${commitment.name}`,
            title: "Commitment failed",
            text: `Your commitment "${commitment.name}" has failed. Rectify the failed task to revive it.`,
            html: `
                <h1>Commitment failed</h1>
                <p>Hi ${profile?.username || "there"},</p>
                <p>Your commitment <strong>${commitment.name}</strong> has failed.</p>
                <p>Rectify the failed task to revive the commitment.</p>
                <p><a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/commitments/${commitment.id}">Open commitment</a></p>
            `,
            url: `/dashboard/commitments/${commitment.id}`,
            tag: `commitment-failed-${commitment.id}`,
            data: { commitmentId: commitment.id, kind: "COMMITMENT_FAILED" },
        });
    }
}

export async function notifyCommitmentRevivedIfNeeded(taskId: string, recurrenceRuleId?: string | null) {
    if (!taskId && !recurrenceRuleId) return;

    const admin = createAdminClient();
    const linkedRows: Array<{
        commitment_id: string;
        commitments: {
            id: string;
            user_id: string;
            name: string;
            status: CommitmentStatus;
            start_date: string;
            end_date: string;
        } | null;
    }> = [];

    if (taskId) {
        const { data } = await (admin.from("commitment_task_links") as any)
            .select("commitment_id, commitments!inner(id, user_id, name, status, start_date, end_date)")
            .eq("task_id", taskId as any)
            .eq("commitments.status", "FAILED" as any);
        linkedRows.push(...(((data as typeof linkedRows) || [])));
    }

    if (recurrenceRuleId) {
        const { data } = await (admin.from("commitment_task_links") as any)
            .select("commitment_id, commitments!inner(id, user_id, name, status, start_date, end_date)")
            .eq("recurrence_rule_id", recurrenceRuleId as any)
            .eq("commitments.status", "FAILED" as any);
        linkedRows.push(...(((data as typeof linkedRows) || [])));
    }

    if (linkedRows.length === 0) return;

    const candidateCommitments = new Map<string, NonNullable<(typeof linkedRows)[number]["commitments"]>>();
    for (const row of linkedRows) {
        if (!row.commitments) continue;
        candidateCommitments.set(row.commitment_id, row.commitments);
    }
    if (candidateCommitments.size === 0) return;

    const ownerIds = [...new Set(Array.from(candidateCommitments.values()).map((commitment) => commitment.user_id))];
    const { data: profiles } = await (admin.from("profiles") as any)
        .select("id, email, username")
        .in("id", ownerIds as any);
    const profileById = new Map<string, { email?: string | null; username?: string | null }>();
    for (const profile of ((profiles as Array<{ id: string; email?: string | null; username?: string | null }> | null) || [])) {
        profileById.set(profile.id, profile);
    }

    for (const commitment of candidateCommitments.values()) {
        const { data: linksRows } = await (admin.from("commitment_task_links") as any)
            .select("*")
            .eq("commitment_id", commitment.id as any)
            .order("created_at", { ascending: true });
        const links = ((linksRows as CommitmentTaskLink[] | null) || []);
        if (links.length === 0) continue;

        const taskIds = [...new Set(links.map((link) => link.task_id).filter((id): id is string => Boolean(id)))];
        const recurrenceRuleIds = [
            ...new Set(links.map((link) => link.recurrence_rule_id).filter((id): id is string => Boolean(id))),
        ];

        const startIso = `${commitment.start_date}T00:00:00.000Z`;
        const endIso = `${commitment.end_date}T23:59:59.999Z`;

        const [oneOffTasksResult, recurringTasksResult] = await Promise.all([
            taskIds.length > 0
                ? (admin.from("tasks") as any)
                    .select("id, title, status, deadline, failure_cost_cents, recurrence_rule_id")
                    .eq("user_id", commitment.user_id as any)
                    .in("id", taskIds as any)
                    .neq("status", "DELETED" as any)
                : Promise.resolve({ data: [] }),
            recurrenceRuleIds.length > 0
                ? (admin.from("tasks") as any)
                    .select("id, title, status, deadline, failure_cost_cents, recurrence_rule_id")
                    .eq("user_id", commitment.user_id as any)
                    .in("recurrence_rule_id", recurrenceRuleIds as any)
                    .gte("deadline", startIso as any)
                    .lte("deadline", endIso as any)
                    .neq("status", "DELETED" as any)
                : Promise.resolve({ data: [] }),
        ]);

        const oneOffById = new Map<string, CommitmentTaskLite>();
        for (const task of ((oneOffTasksResult.data as CommitmentTaskLite[] | null) || [])) {
            oneOffById.set(task.id, task);
        }
        const recurringTasks = ((recurringTasksResult.data as CommitmentTaskLite[] | null) || []);

        const linkedTasks: CommitmentTaskLite[] = [];
        const recurrenceRuleIdSet = new Set<string>();
        for (const link of links) {
            if (link.task_id) {
                const oneOff = oneOffById.get(link.task_id);
                if (oneOff) linkedTasks.push(oneOff);
            } else if (link.recurrence_rule_id) {
                recurrenceRuleIdSet.add(link.recurrence_rule_id);
            }
        }
        for (const recurringTask of recurringTasks) {
            if (!recurringTask.recurrence_rule_id) continue;
            if (!recurrenceRuleIdSet.has(recurringTask.recurrence_rule_id)) continue;
            const dateOnly = toDateOnlyFromTimestamp(recurringTask.deadline);
            if (!dateOnly) continue;
            if (dateOnly < commitment.start_date || dateOnly > commitment.end_date) continue;
            linkedTasks.push(recurringTask);
        }

        const derivedStatus = computeDerivedStatus(
            {
                status: commitment.status,
                start_date: commitment.start_date,
                end_date: commitment.end_date,
            },
            linkedTasks
        );

        if (derivedStatus === "FAILED") continue;

        await (admin.from("commitments") as any)
            .update({ status: derivedStatus } as any)
            .eq("id", commitment.id as any);

        const isCompleted = derivedStatus === "COMPLETED";
        const notificationTitle = isCompleted ? "Commitment completed" : "Commitment revived";
        const notificationSubject = isCompleted
            ? `Commitment completed: ${commitment.name}`
            : `Commitment revived: ${commitment.name}`;
        const notificationText = isCompleted
            ? `Your commitment "${commitment.name}" is now completed after rectification.`
            : `Your commitment "${commitment.name}" is active again after rectification.`;
        const bodyLine = isCompleted
            ? "Your commitment has reached completion after rectification."
            : "Your commitment has been revived after rectification.";

        const profile = profileById.get(commitment.user_id);
        await sendNotification({
            to: profile?.email || undefined,
            userId: commitment.user_id,
            subject: notificationSubject,
            title: notificationTitle,
            text: notificationText,
            html: `
                <h1>${notificationTitle}</h1>
                <p>Hi ${profile?.username || "there"},</p>
                <p><strong>${commitment.name}</strong>: ${bodyLine}</p>
                <p><a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/commitments/${commitment.id}">Open commitment</a></p>
            `,
            url: `/dashboard/commitments/${commitment.id}`,
            tag: `commitment-revived-${commitment.id}`,
            data: { commitmentId: commitment.id, kind: "COMMITMENT_REVIVED" },
        });
    }
}
