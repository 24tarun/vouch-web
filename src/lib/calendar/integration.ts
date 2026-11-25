import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEventTask, isOpenTaskStatus, type BlockTarget, type CalendarWeekData } from "@/lib/calendar/types";

export function integrationDb(): SupabaseClient {
    return createAdminClient() as unknown as SupabaseClient;
}

const iso = z.iso.datetime({ offset: true });

export const blockTimesSchema = z.object({ start_at: iso, end_at: iso });

export const createBlockSchema = z.union([
    blockTimesSchema.extend({ task_id: z.uuid() }),
    blockTimesSchema.extend({ rule_id: z.uuid(), occurrence_deadline: iso }),
]);

export function toBlockTarget(body: z.infer<typeof createBlockSchema>): BlockTarget {
    return "task_id" in body
        ? { kind: "task", taskId: body.task_id }
        : { kind: "ghost", ruleId: body.rule_id, occurrenceDeadlineIso: body.occurrence_deadline };
}

export function serializeCalendar(data: CalendarWeekData, range: { from: string; to: string }, timezone: string | null) {
    const tasksById = new Map([...data.tasks, ...data.pickerTasks].map((task) => [task.id, task]));
    const ghostsByKey = new Map(data.ghosts.map((ghost) => [ghost.key, ghost]));
    const fromMs = Date.parse(range.from);
    const toMs = Date.parse(range.to);
    const now = Date.now();

    return {
        schema_version: 1,
        range,
        timezone,
        deadlines: data.tasks
            .filter((task) => Date.parse(task.deadline) >= fromMs && Date.parse(task.deadline) < toMs)
            .map((task) => ({
                task_id: task.id,
                title: task.title,
                status: task.status,
                deadline: task.deadline,
                open: isOpenTaskStatus(task.status),
                is_event: isEventTask(task),
                repeating: Boolean(task.recurrence_rule_id),
            })),
        upcoming_repeats: data.ghosts
            .filter((ghost) => Date.parse(ghost.deadlineIso) >= fromMs && Date.parse(ghost.deadlineIso) < toMs)
            .map((ghost) => ({ rule_id: ghost.ruleId, title: ghost.title, deadline: ghost.deadlineIso, is_event: ghost.isEvent })),
        blocks: data.blocks.map((block) => {
            const task = block.task_id ? tasksById.get(block.task_id) : undefined;
            const ghost = block.recurrence_rule_id && block.occurrence_deadline
                ? ghostsByKey.get(`${block.recurrence_rule_id}|${block.occurrence_deadline}`)
                : undefined;
            return {
                id: block.id,
                title: task?.title ?? ghost?.title ?? null,
                status: task?.status ?? (ghost ? "UPCOMING_REPEAT" : null),
                start_at: block.start_at,
                end_at: block.end_at,
                task_id: block.task_id,
                rule_id: block.recurrence_rule_id,
                occurrence_deadline: block.occurrence_deadline,
            };
        }),
        plannable: [
            ...data.pickerTasks
                .filter((task) => !isEventTask(task) && Date.parse(task.deadline) > now)
                .map((task) => ({ task_id: task.id, title: task.title, deadline: task.deadline })),
            ...data.ghosts
                .filter((ghost) => !ghost.isEvent)
                .map((ghost) => ({ rule_id: ghost.ruleId, occurrence_deadline: ghost.deadlineIso, title: ghost.title, deadline: ghost.deadlineIso })),
        ].sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline)),
    };
}
