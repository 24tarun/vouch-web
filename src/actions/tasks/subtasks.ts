"use server";

import { createClient } from "@/lib/supabase/server";
import { MANUAL_REMINDER_SOURCE } from "@/lib/task-reminder-defaults";
import { MAX_SUBTASKS_PER_TASK } from "@/lib/constants";
import type { TaskStatus } from "@/lib/xstate/task-machine";
import {
    getOwnedParentTask,
    revalidateTaskSurfaces,
    ACTIVE_PARENT_TASK_STATUSES,
    SUBTASK_TITLE_MAX_LENGTH,
    SUBTASK_TITLE_TOO_LONG_ERROR,
    SUBTASK_LIMIT_ERROR,
    INVALID_REMINDERS_ERROR,
    INVALID_DEADLINE_ERROR,
    REMINDER_AFTER_DEADLINE_ERROR,
} from "./helpers";

export async function addTaskSubtask(parentTaskId: string, title: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
        return { error: "Subtask title cannot be empty." };
    }
    if (normalizedTitle.length > SUBTASK_TITLE_MAX_LENGTH) {
        return { error: SUBTASK_TITLE_TOO_LONG_ERROR };
    }

    const parentTask = await getOwnedParentTask(supabase, parentTaskId, user.id);
    if (!parentTask) {
        return { error: "Task not found" };
    }

    if (!ACTIVE_PARENT_TASK_STATUSES.includes(parentTask.status)) {
        return { error: `Cannot edit subtasks in ${parentTask.status} status` };
    }

    const { count: subtaskCount } = await (supabase.from("task_subtasks") as any)
        .select("id", { count: "exact", head: true })
        .eq("parent_task_id", parentTaskId as any)
        .eq("user_id", user.id as any);

    if ((subtaskCount || 0) >= MAX_SUBTASKS_PER_TASK) {
        return { error: SUBTASK_LIMIT_ERROR };
    }

    // @ts-ignore
    const { data: subtask, error } = await (supabase.from("task_subtasks") as any)
        .insert({
            parent_task_id: parentTaskId,
            user_id: user.id,
            title: normalizedTitle,
            is_completed: false,
            completed_at: null,
        })
        .select("*")
        .single();

    if (error) {
        return { error: error.message };
    }

    revalidateTaskSurfaces(parentTaskId, user.id);
    return { success: true, subtask };
}

export async function replaceTaskReminders(taskId: string, remindersIso: string[]) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const { data: task } = await (supabase.from("tasks") as any)
        .select("id, status, deadline")
        .eq("id", taskId as any)
        .eq("user_id", user.id as any)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    if (!ACTIVE_PARENT_TASK_STATUSES.includes((task as any).status as TaskStatus)) {
        return { error: `Cannot edit reminders in ${(task as any).status} status` };
    }

    if (!Array.isArray(remindersIso)) {
        return { error: INVALID_REMINDERS_ERROR };
    }

    const deadlineDate = new Date((task as any).deadline);
    if (Number.isNaN(deadlineDate.getTime())) {
        return { error: INVALID_DEADLINE_ERROR };
    }

    const dedupedByTimestamp = new Map<number, Date>();
    for (const value of remindersIso) {
        if (typeof value !== "string") {
            return { error: INVALID_REMINDERS_ERROR };
        }

        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return { error: INVALID_REMINDERS_ERROR };
        }

        if (parsed.getTime() > deadlineDate.getTime()) {
            return { error: REMINDER_AFTER_DEADLINE_ERROR };
        }

        dedupedByTimestamp.set(parsed.getTime(), parsed);
    }

    const { data: existingReminders, error: existingError } = await (supabase.from("task_reminders") as any)
        .select("id, reminder_at, source, created_at")
        .eq("parent_task_id", taskId as any)
        .eq("user_id", user.id as any);

    if (existingError) {
        return { error: existingError.message };
    }

    const nowMs = Date.now();
    const nextFutureReminders = Array.from(dedupedByTimestamp.values())
        .filter((date) => date.getTime() > nowMs)
        .sort((a, b) => a.getTime() - b.getTime());
    const nextFutureIsoSet = new Set(nextFutureReminders.map((date) => date.toISOString()));
    const existingSourceByReminderIso = new Map<string, string>();
    const existingCreatedAtByReminderIso = new Map<string, string>();
    for (const row of ((existingReminders as Array<{ reminder_at: string; source?: string | null; created_at: string }> | null) || [])) {
        const reminderDate = new Date(row.reminder_at);
        if (Number.isNaN(reminderDate.getTime())) continue;
        const reminderIso = reminderDate.toISOString();
        existingSourceByReminderIso.set(reminderIso, row.source || MANUAL_REMINDER_SOURCE);
        existingCreatedAtByReminderIso.set(reminderIso, row.created_at);
    }

    if (nextFutureReminders.length > 0) {
        const nowIso = new Date().toISOString();
        const upsertRows = nextFutureReminders.map((reminderDate) => ({
            reminder_at: reminderDate.toISOString(),
            source: existingSourceByReminderIso.get(reminderDate.toISOString()) || MANUAL_REMINDER_SOURCE,
            parent_task_id: taskId,
            user_id: user.id,
            notified_at: null,
            created_at: existingCreatedAtByReminderIso.get(reminderDate.toISOString()) || nowIso,
            updated_at: nowIso,
        }));

        const { error: upsertError } = await (supabase.from("task_reminders") as any).upsert(
            upsertRows,
            { onConflict: "parent_task_id,reminder_at" }
        );

        if (upsertError) {
            return { error: upsertError.message };
        }
    }

    const toDeleteIds = ((existingReminders as Array<{ id: string; reminder_at: string }> | null) || [])
        .filter((row) => {
            const reminderDate = new Date(row.reminder_at);
            if (Number.isNaN(reminderDate.getTime())) return false;
            if (reminderDate.getTime() <= nowMs) return false;
            return !nextFutureIsoSet.has(reminderDate.toISOString());
        })
        .map((row) => row.id);

    if (toDeleteIds.length > 0) {
        const { error: deleteError } = await (supabase.from("task_reminders") as any)
            .delete()
            .in("id", toDeleteIds as any)
            .eq("user_id", user.id as any);

        if (deleteError) {
            return { error: deleteError.message };
        }
    }

    revalidateTaskSurfaces(taskId, user.id);
    return {
        success: true,
        reminders: nextFutureReminders.map((reminderDate) => reminderDate.toISOString()),
    };
}

export async function toggleTaskSubtask(parentTaskId: string, subtaskId: string, completed: boolean) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const parentTask = await getOwnedParentTask(supabase, parentTaskId, user.id);
    if (!parentTask) {
        return { error: "Task not found" };
    }

    if (!ACTIVE_PARENT_TASK_STATUSES.includes(parentTask.status)) {
        return { error: `Cannot edit subtasks in ${parentTask.status} status` };
    }

    const nowIso = new Date().toISOString();

    // @ts-ignore
    const { data: updatedSubtask, error } = await (supabase.from("task_subtasks") as any)
        .update({
            is_completed: completed,
            completed_at: completed ? nowIso : null,
        })
        .eq("id", subtaskId as any)
        .eq("parent_task_id", parentTaskId as any)
        .eq("user_id", user.id as any)
        .select("*")
        .single();

    if (error) {
        return { error: error.message };
    }

    if (!updatedSubtask) {
        return { error: "Subtask not found" };
    }

    revalidateTaskSurfaces(parentTaskId, user.id);
    return { success: true, subtask: updatedSubtask };
}

export async function renameTaskSubtask(parentTaskId: string, subtaskId: string, newTitle: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const normalizedTitle = newTitle.trim();
    if (!normalizedTitle) {
        return { error: "Subtask title cannot be empty." };
    }
    if (normalizedTitle.length > SUBTASK_TITLE_MAX_LENGTH) {
        return { error: SUBTASK_TITLE_TOO_LONG_ERROR };
    }

    const parentTask = await getOwnedParentTask(supabase, parentTaskId, user.id);
    if (!parentTask) {
        return { error: "Task not found" };
    }

    if (!ACTIVE_PARENT_TASK_STATUSES.includes(parentTask.status)) {
        return { error: `Cannot edit subtasks in ${parentTask.status} status` };
    }

    // @ts-ignore
    const { data: updatedSubtask, error } = await (supabase.from("task_subtasks") as any)
        .update({
            title: normalizedTitle,
            updated_at: new Date().toISOString(),
        })
        .eq("id", subtaskId as any)
        .eq("parent_task_id", parentTaskId as any)
        .eq("user_id", user.id as any)
        .select("*")
        .single();

    if (error) {
        return { error: error.message };
    }

    if (!updatedSubtask) {
        return { error: "Subtask not found" };
    }

    revalidateTaskSurfaces(parentTaskId, user.id);
    return { success: true, subtask: updatedSubtask };
}

export async function deleteTaskSubtask(parentTaskId: string, subtaskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const parentTask = await getOwnedParentTask(supabase, parentTaskId, user.id);
    if (!parentTask) {
        return { error: "Task not found" };
    }

    if (!ACTIVE_PARENT_TASK_STATUSES.includes(parentTask.status)) {
        return { error: `Cannot edit subtasks in ${parentTask.status} status` };
    }

    const { data: deletedRows, error } = await (supabase.from("task_subtasks") as any)
        .delete()
        .eq("id", subtaskId as any)
        .eq("parent_task_id", parentTaskId as any)
        .eq("user_id", user.id as any)
        .select("id");

    if (error) {
        return { error: error.message };
    }

    if (!deletedRows || deletedRows.length === 0) {
        return { error: "Subtask not found" };
    }

    revalidateTaskSurfaces(parentTaskId, user.id);
    return { success: true };
}
