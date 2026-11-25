import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getTask } from "@/actions/tasks/query";
import { createTask } from "@/actions/tasks/create";
import { postponeTask } from "@/actions/tasks/manage";
import { markTaskComplete } from "@/actions/tasks/complete";
import { addTaskSubtask, replaceTaskReminders, toggleTaskSubtask } from "@/actions/tasks/subtasks";
import { createBlockForUser, deleteBlockForUser, loadCalendarRange, updateBlockForUser } from "@/lib/calendar/service";
import { serializeCalendar } from "@/lib/calendar/integration";
import type { BlockTarget } from "@/lib/calendar/types";
import { INTEGRATION_ACTIONS, decodeActionArgs } from "@/lib/integration-actions";

/** Runs inside the integration context: createClient() is signed in as the key's owner. */
export interface McpTool {
    name: string;
    description: string;
    input: z.ZodType;
    run(args: never, userId: string): Promise<unknown>;
}

const iso = z.iso.datetime({ offset: true }).describe("ISO 8601 with timezone, e.g. 2026-11-24T21:00:00+01:00");
const DAY_MS = 24 * 60 * 60 * 1000;
const TASK_LIST_COLUMNS = "id, title, status, deadline, failure_cost_cents, requires_proof, recurrence_rule_id, postponed_at, voucher_id";
const OPEN_STATUSES = ["ACTIVE", "POSTPONED"];

async function db(): Promise<SupabaseClient> {
    return (await createClient()) as unknown as SupabaseClient;
}

async function profile(userId: string) {
    const { data } = await (await db()).from("profiles")
        .select("timezone, default_voucher_id, default_failure_cost_cents, default_requires_proof_for_all_tasks")
        .eq("id", userId).maybeSingle();
    return (data ?? {}) as {
        timezone?: string | null;
        default_voucher_id?: string | null;
        default_failure_cost_cents?: number | null;
        default_requires_proof_for_all_tasks?: boolean | null;
    };
}

function tool<S extends z.ZodType>(name: string, description: string, input: S, run: (args: z.infer<S>, userId: string) => Promise<unknown>): McpTool {
    return { name, description, input, run: run as McpTool["run"] };
}

export const MCP_TOOLS: McpTool[] = [
    tool("list_tasks", "List your tasks, soonest deadline first. Defaults to open (active/postponed) tasks.",
        z.object({
            status: z.enum(["open", "all"]).default("open"),
            from: iso.optional().describe("Only tasks due at or after this time"),
            to: iso.optional().describe("Only tasks due before this time"),
            search: z.string().optional().describe("Case-insensitive title match"),
            limit: z.number().int().min(1).max(200).default(50),
        }),
        async ({ status, from, to, search, limit }, userId) => {
            let query = (await db()).from("tasks").select(TASK_LIST_COLUMNS).eq("user_id", userId).neq("status", "DELETED");
            if (status === "open") query = query.in("status", OPEN_STATUSES);
            if (from) query = query.gte("deadline", from);
            if (to) query = query.lt("deadline", to);
            if (search) query = query.ilike("title", `%${search.replace(/[%_]/g, "\\$&")}%`);
            const { data, error } = await query.order("deadline", { ascending: true }).limit(limit);
            if (error) return { error: error.message };
            return { tasks: data };
        }),

    tool("get_task", "Full details of one task: subtasks, reminders, voucher, proof state.",
        z.object({ task_id: z.uuid() }),
        async ({ task_id }) => (await getTask(task_id)) ?? { error: "Task not found." }),

    tool("create_task",
        "Create a task. Unset options use the account defaults (voucher, failure cost, proof). Optionally repeating.",
        z.object({
            title: z.string().min(1),
            deadline: iso,
            description: z.string().optional(),
            voucher: z.enum(["default", "self"]).default("default").describe("'self' = you vouch for yourself"),
            failure_cost: z.number().min(0).optional().describe("In your currency's major unit, e.g. 1 = €1"),
            requires_proof: z.boolean().optional(),
            subtasks: z.array(z.string().min(1)).optional(),
            repeat: z.object({
                frequency: z.enum(["DAILY", "WEEKDAYS", "WEEKLY", "MONTHLY", "YEARLY"]),
                interval: z.number().int().min(1).default(1),
                days_of_week: z.array(z.number().int().min(0).max(6)).optional().describe("WEEKLY only; 0 = Sunday"),
            }).optional().describe("Repeats at the deadline's time of day, anchored on the deadline's date"),
        }),
        async (input, userId) => {
            const defaults = await profile(userId);
            const voucherId = input.voucher === "self" ? userId : (defaults.default_voucher_id || userId);
            const fields: Record<string, string> = {
                title: input.title,
                rawTitle: input.title,
                deadline: input.deadline,
                voucherId,
                failureCost: String(input.failure_cost ?? (defaults.default_failure_cost_cents ?? 100) / 100),
                requiresProof: String(input.requires_proof ?? Boolean(defaults.default_requires_proof_for_all_tasks)),
            };
            if (input.description) fields.description = input.description;
            if (input.subtasks?.length) fields.subtasks = JSON.stringify(input.subtasks);
            if (input.repeat) {
                fields.recurrenceType = input.repeat.frequency;
                fields.recurrenceInterval = String(input.repeat.interval);
                if (input.repeat.days_of_week) fields.recurrenceDays = JSON.stringify(input.repeat.days_of_week);
                fields.userTimezone = defaults.timezone || "UTC";
            }
            const [formData] = decodeActionArgs([{ $formData: fields }]);
            return createTask(formData as FormData);
        }),

    tool("postpone_task", "Move a task's deadline later. Each task can be postponed only once.",
        z.object({ task_id: z.uuid(), new_deadline: iso }),
        async ({ task_id, new_deadline }) => postponeTask(task_id, new_deadline)),

    tool("complete_task", "Mark a task complete. It then goes to its voucher (self-vouched tasks are accepted immediately).",
        z.object({ task_id: z.uuid() }),
        async ({ task_id }, userId) => markTaskComplete(task_id, (await profile(userId)).timezone || undefined)),

    tool("add_subtask", "Add a subtask to a task.",
        z.object({ task_id: z.uuid(), title: z.string().min(1) }),
        async ({ task_id, title }) => addTaskSubtask(task_id, title)),

    tool("set_subtask_done", "Tick or untick a subtask (ids come from get_task).",
        z.object({ task_id: z.uuid(), subtask_id: z.uuid(), completed: z.boolean() }),
        async ({ task_id, subtask_id, completed }) => toggleTaskSubtask(task_id, subtask_id, completed)),

    tool("set_reminders", "Replace a task's custom reminders with these times (before the deadline).",
        z.object({ task_id: z.uuid(), reminders: z.array(iso) }),
        async ({ task_id, reminders }) => replaceTaskReminders(task_id, reminders)),

    tool("get_calendar",
        "Calendar for a range (default next 7 days, max 15): deadlines, planned time blocks, upcoming repeats, and 'plannable' targets for new blocks. Times are UTC; 'timezone' is the user's zone.",
        z.object({ from: iso.optional(), to: iso.optional() }),
        async ({ from, to }, userId) => {
            const fromMs = from ? Date.parse(from) : Date.now();
            const range = { from: new Date(fromMs).toISOString(), to: new Date(to ? Date.parse(to) : fromMs + 7 * DAY_MS).toISOString() };
            const result = await loadCalendarRange(await db(), userId, range.from, range.to);
            if (!result.data) return { error: result.error };
            return serializeCalendar(result.data, range, (await profile(userId)).timezone ?? null);
        }),

    tool("create_time_block",
        "Plan time for a task. Pass task_id, or rule_id + occurrence_deadline for a repeat not created yet (copy from get_calendar 'plannable'). Times on 15-minute steps, ending by the deadline.",
        // MCP requires an object input schema, so the HTTP union schema is flattened here.
        z.object({
            task_id: z.uuid().optional(),
            rule_id: z.uuid().optional(),
            occurrence_deadline: iso.optional(),
            start_at: iso,
            end_at: iso,
        }).refine(
            (input) => input.task_id ? !input.rule_id && !input.occurrence_deadline : Boolean(input.rule_id && input.occurrence_deadline),
            { message: "Pass task_id, or rule_id + occurrence_deadline." }
        ),
        async (input, userId) => {
            const target: BlockTarget = input.task_id
                ? { kind: "task", taskId: input.task_id }
                : { kind: "ghost", ruleId: input.rule_id!, occurrenceDeadlineIso: input.occurrence_deadline! };
            return createBlockForUser(await db(), userId, target, input.start_at, input.end_at);
        }),

    tool("move_time_block", "Move or resize a time block.",
        z.object({ block_id: z.uuid(), start_at: iso, end_at: iso }),
        async ({ block_id, start_at, end_at }, userId) => updateBlockForUser(await db(), userId, block_id, start_at, end_at)),

    tool("delete_time_block", "Delete a time block.",
        z.object({ block_id: z.uuid() }),
        async ({ block_id }, userId) => deleteBlockForUser(await db(), userId, block_id)),

    tool("list_actions", "Every other app action callable with call_action, with parameter names.",
        z.object({}),
        async () => Object.entries(INTEGRATION_ACTIONS)
            .map(([name, fn]) => `${name}(${/\(([^)]*)\)/.exec(fn.toString())?.[1] ?? ""})`)
            .sort()),

    tool("call_action",
        "Run any app action by name with positional args (see list_actions). Form arguments take { \"$formData\": { field: value } }. Prefer the dedicated tools when one fits.",
        z.object({ name: z.string(), args: z.array(z.unknown()).default([]) }),
        async ({ name, args }) => {
            const action = Object.hasOwn(INTEGRATION_ACTIONS, name) ? INTEGRATION_ACTIONS[name] : undefined;
            if (!action) return { error: `Unknown action "${name}".` };
            return action(...decodeActionArgs(args));
        }),
];
