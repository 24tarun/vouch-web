/**
 * Calendar reads and block writes for one user. Callers authenticate first:
 * server actions (session) and the integration API (API key) share this code.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { listUpcomingOccurrences, type RecurrenceScheduleRule } from "@/lib/recurrence-schedule";
import { validateBlockRange } from "@/lib/calendar/grid";
import {
    ghostKey,
    isEventTask,
    type BlockTarget,
    type CalendarBlock,
    type CalendarGhost,
    type CalendarTask,
    type CalendarWeekData,
} from "@/lib/calendar/types";

const MAX_RANGE_MS = 15 * 24 * 60 * 60 * 1000;
const PICKER_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;
const TASK_COLUMNS =
    "id, title, status, deadline, postponed_at, is_strict, start_at, google_sync_for_task, google_event_start_at, recurrence_rule_id";
const BLOCK_COLUMNS = "id, task_id, recurrence_rule_id, occurrence_deadline, start_at, end_at";
const RULE_COLUMNS =
    "id, title, rule_config, timezone, last_generated_date, paused_at, created_at, google_sync_for_rule, time_bound_for_rule, window_start_offset_minutes, google_event_duration_minutes";

type TaskRow = Omit<CalendarTask, "daily_rule_timezone">;

function parseIso(value: unknown): number {
    if (typeof value !== "string" || !value.trim()) return NaN;
    return Date.parse(value);
}

function normalizeBlock(row: CalendarBlock): CalendarBlock {
    return {
        ...row,
        start_at: new Date(row.start_at).toISOString(),
        end_at: new Date(row.end_at).toISOString(),
        occurrence_deadline: row.occurrence_deadline ? new Date(row.occurrence_deadline).toISOString() : null,
    };
}

export async function loadCalendarRange(db: SupabaseClient, userId: string, rangeStartIso: string, rangeEndIso: string): Promise<{ data?: CalendarWeekData; error?: string }> {

    const rangeStartMs = parseIso(rangeStartIso);
    const rangeEndMs = parseIso(rangeEndIso);
    if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs) || rangeEndMs <= rangeStartMs || rangeEndMs - rangeStartMs > MAX_RANGE_MS) {
        return { error: "Invalid calendar range." };
    }
    const rangeStart = new Date(rangeStartMs).toISOString();
    const rangeEnd = new Date(rangeEndMs).toISOString();
    const ghostRangeEnd = new Date(rangeEndMs + PICKER_LOOKAHEAD_MS).toISOString();
    const nowIso = new Date().toISOString();

    const [profileResult, tasksResult, blocksResult, pickerResult, rulesResult, generatedResult] = await Promise.all([
        db.from("profiles").select("show_past_tasks").eq("id", userId).maybeSingle(),
        db.from("tasks").select(TASK_COLUMNS)
            .eq("user_id", userId)
            .neq("status", "DELETED")
            .gte("deadline", rangeStart)
            .lt("deadline", rangeEnd)
            .order("deadline", { ascending: true })
            .limit(1000),
        db.from("task_time_blocks").select(BLOCK_COLUMNS)
            .eq("user_id", userId)
            .lt("start_at", rangeEnd)
            .gt("end_at", rangeStart)
            .limit(2000),
        db.from("tasks").select(TASK_COLUMNS)
            .eq("user_id", userId)
            .in("status", ["ACTIVE", "POSTPONED"])
            .gt("deadline", nowIso)
            .eq("google_sync_for_task", false)
            .eq("is_strict", false)
            .order("deadline", { ascending: true })
            .limit(300),
        db.from("recurrence_rules").select(RULE_COLUMNS).eq("user_id", userId).is("paused_at", null),
        db.from("tasks").select("recurrence_rule_id, deadline")
            .eq("user_id", userId)
            .not("recurrence_rule_id", "is", null)
            .gte("deadline", new Date(rangeStartMs - 24 * 60 * 60 * 1000).toISOString())
            .lt("deadline", ghostRangeEnd),
    ]);

    const firstError = [tasksResult, blocksResult, pickerResult, rulesResult, generatedResult].find((result) => result.error)?.error;
    if (firstError) return { error: firstError.message || "Could not load calendar." };

    const blocks = ((blocksResult.data as CalendarBlock[] | null) || []).map(normalizeBlock);
    const taskRows = new Map<string, TaskRow>();
    for (const row of (tasksResult.data as TaskRow[] | null) || []) taskRows.set(row.id, row);

    // Blocks can sit in this week while their task is due next week.
    const missingTaskIds = [...new Set(blocks.map((block) => block.task_id).filter((id): id is string => Boolean(id) && !taskRows.has(id as string)))];
    if (missingTaskIds.length > 0) {
        const { data: extraTasks } = await db.from("tasks").select(TASK_COLUMNS).eq("user_id", userId).in("id", missingTaskIds);
        for (const row of (extraTasks as TaskRow[] | null) || []) taskRows.set(row.id, row);
    }

    const rules = (rulesResult.data as RecurrenceScheduleRule[] | null) || [];
    const allRuleIds = new Set<string>();
    for (const row of [...taskRows.values(), ...((pickerResult.data as TaskRow[] | null) || [])]) {
        if (row.recurrence_rule_id) allRuleIds.add(row.recurrence_rule_id);
    }
    const dailyTimezoneByRule = new Map<string, string>();
    const knownRuleIds = new Set(rules.map((rule) => rule.id));
    for (const rule of rules) {
        if (String(rule.rule_config?.frequency).toUpperCase() === "DAILY") dailyTimezoneByRule.set(rule.id, rule.timezone || "UTC");
    }
    const unknownRuleIds = [...allRuleIds].filter((id) => !knownRuleIds.has(id));
    if (unknownRuleIds.length > 0) {
        // Paused rules still constrain postponing of their existing tasks.
        const { data: pausedRules } = await db.from("recurrence_rules").select("id, rule_config, timezone").eq("user_id", userId).in("id", unknownRuleIds);
        for (const rule of (pausedRules as Array<{ id: string; rule_config: { frequency?: string }; timezone: string | null }> | null) || []) {
            if (String(rule.rule_config?.frequency).toUpperCase() === "DAILY") dailyTimezoneByRule.set(rule.id, rule.timezone || "UTC");
        }
    }
    const withRuleInfo = (row: TaskRow): CalendarTask => ({
        ...row,
        deadline: new Date(row.deadline).toISOString(),
        daily_rule_timezone: row.recurrence_rule_id ? dailyTimezoneByRule.get(row.recurrence_rule_id) ?? null : null,
    });

    const generatedKeys = new Set(
        ((generatedResult.data as Array<{ recurrence_rule_id: string; deadline: string }> | null) || [])
            .map((row) => ghostKey(row.recurrence_rule_id, row.deadline))
    );
    const ghosts: CalendarGhost[] = [];
    const now = new Date();
    for (const rule of rules) {
        for (const occurrence of listUpcomingOccurrences(rule, rangeStartMs, rangeEndMs + PICKER_LOOKAHEAD_MS, now)) {
            const key = ghostKey(occurrence.ruleId, occurrence.deadlineIso);
            if (generatedKeys.has(key)) continue;
            ghosts.push({
                key,
                ruleId: occurrence.ruleId,
                title: occurrence.title,
                deadlineIso: occurrence.deadlineIso,
                spanStartIso: occurrence.spanStartIso,
                isEvent: occurrence.isEvent,
                isStrict: occurrence.isStrict,
            });
        }
    }

    return {
        data: {
            tasks: [...taskRows.values()].map(withRuleInfo),
            ghosts,
            blocks,
            pickerTasks: ((pickerResult.data as TaskRow[] | null) || []).map(withRuleInfo),
            showPastTasks: (profileResult.data as { show_past_tasks?: boolean | null } | null)?.show_past_tasks ?? true,
        },
    };
}

async function resolveTargetDeadline(
    db: SupabaseClient,
    userId: string,
    target: BlockTarget
): Promise<{ deadlineMs?: number; error?: string }> {
    if (target.kind === "task") {
        const { data: task } = await db.from("tasks")
            .select("id, status, deadline, google_sync_for_task, is_strict")
            .eq("id", target.taskId)
            .eq("user_id", userId)
            .maybeSingle();
        if (!task) return { error: "Task not found." };
        if (task.status !== "ACTIVE" && task.status !== "POSTPONED") return { error: "Blocks can only be planned for active tasks." };
        if (isEventTask(task)) return { error: "Events cannot have time blocks." };
        return { deadlineMs: Date.parse(task.deadline) };
    }

    const occurrenceMs = parseIso(target.occurrenceDeadlineIso);
    if (!Number.isFinite(occurrenceMs)) return { error: "Invalid occurrence." };
    const { data: rule } = await db.from("recurrence_rules").select(RULE_COLUMNS)
        .eq("id", target.ruleId)
        .eq("user_id", userId)
        .maybeSingle();
    if (!rule) return { error: "Repeating task not found." };
    const occurrence = listUpcomingOccurrences(rule as RecurrenceScheduleRule, occurrenceMs, occurrenceMs + 1)
        .find((entry) => Date.parse(entry.deadlineIso) === occurrenceMs);
    if (!occurrence) return { error: "That occurrence is no longer upcoming. Refresh the calendar." };
    if (occurrence.isEvent) return { error: "Events cannot have time blocks." };
    return { deadlineMs: occurrenceMs };
}

export async function createBlockForUser(
    db: SupabaseClient,
    userId: string,
    target: BlockTarget,
    startIso: string,
    endIso: string
): Promise<{ block?: CalendarBlock; error?: string }> {

    const resolved = await resolveTargetDeadline(db, userId, target);
    if (resolved.error || resolved.deadlineMs === undefined) return { error: resolved.error || "Task not found." };

    const startMs = parseIso(startIso);
    const endMs = parseIso(endIso);
    const rangeError = validateBlockRange(startMs, endMs, resolved.deadlineMs);
    if (rangeError) return { error: rangeError };

    const { data, error } = await db.from("task_time_blocks").insert({
        user_id: userId,
        task_id: target.kind === "task" ? target.taskId : null,
        recurrence_rule_id: target.kind === "ghost" ? target.ruleId : null,
        occurrence_deadline: target.kind === "ghost" ? new Date(resolved.deadlineMs).toISOString() : null,
        start_at: new Date(startMs).toISOString(),
        end_at: new Date(endMs).toISOString(),
    }).select(BLOCK_COLUMNS).single();
    if (error) return { error: error.message || "Could not create block." };
    return { block: normalizeBlock(data as CalendarBlock) };
}

export async function updateBlockForUser(
    db: SupabaseClient,
    userId: string,
    blockId: string,
    startIso: string,
    endIso: string
): Promise<{ block?: CalendarBlock; error?: string }> {

    const { data: existing } = await db.from("task_time_blocks").select(BLOCK_COLUMNS)
        .eq("id", blockId)
        .eq("user_id", userId)
        .maybeSingle();
    if (!existing) return { error: "Block not found." };

    const target: BlockTarget = existing.task_id
        ? { kind: "task", taskId: existing.task_id }
        : { kind: "ghost", ruleId: existing.recurrence_rule_id, occurrenceDeadlineIso: existing.occurrence_deadline };
    const resolved = await resolveTargetDeadline(db, userId, target);
    if (resolved.error || resolved.deadlineMs === undefined) return { error: resolved.error || "Task not found." };

    const startMs = parseIso(startIso);
    const endMs = parseIso(endIso);
    const rangeError = validateBlockRange(startMs, endMs, resolved.deadlineMs);
    if (rangeError) return { error: rangeError };

    const { data, error } = await db.from("task_time_blocks")
        .update({ start_at: new Date(startMs).toISOString(), end_at: new Date(endMs).toISOString() })
        .eq("id", blockId)
        .eq("user_id", userId)
        .select(BLOCK_COLUMNS)
        .single();
    if (error) return { error: error.message || "Could not move block." };
    return { block: normalizeBlock(data as CalendarBlock) };
}

export async function deleteBlockForUser(db: SupabaseClient, userId: string, blockId: string): Promise<{ success?: true; error?: string }> {
    const { data, error } = await db.from("task_time_blocks")
        .delete()
        .eq("id", blockId)
        .eq("user_id", userId)
        .select("id");
    if (error) return { error: error.message || "Could not delete block." };
    if (!data || data.length === 0) return { error: "Block not found." };
    return { success: true };
}
