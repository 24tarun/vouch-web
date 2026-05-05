import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type Database } from "@/lib/types";
import { type SupabaseClient } from "@supabase/supabase-js";
import {
    invalidateActiveTasksCache,
    invalidatePendingVoucherRequestsCache,
} from "@/lib/cache-tags";
export { invalidateActiveTasksCache, invalidatePendingVoucherRequestsCache };
import {
    MANUAL_REMINDER_SOURCE,
    buildDefaultDeadlineReminderRows,
} from "@/lib/task-reminder-defaults";
import { MAX_SUBTASKS_PER_TASK, MAX_POMO_DURATION_MINUTES } from "@/lib/constants";
import { isValidPomoDurationMinutes } from "@/lib/pomodoro";
import { normalizeProofTimestampText } from "@/lib/proof-timestamp";
import { MAX_TASK_PROOF_VIDEO_DURATION_MS, type TaskProofIntent } from "@/lib/task-proof";
import { type TaskStatus } from "@/lib/xstate/task-machine";
import { enqueueGoogleCalendarOutbox } from "@/lib/google-calendar/sync";
import { stripEventColorTokens } from "@/lib/task-title-event-color";
import { stripProofRequiredTokens } from "@/lib/task-title-parser";

// ─── Constants ────────────────────────────────────────────────────────────────

export const INVALID_DEADLINE_ERROR = "Deadline is invalid.";
export const PAST_DEADLINE_ERROR = "Deadline must be in the future.";
export const ACTIVE_PARENT_TASK_STATUSES: TaskStatus[] = ["ACTIVE", "POSTPONED"];
export const SUBTASK_LIMIT_ERROR = `A task can have at most ${MAX_SUBTASKS_PER_TASK} subtasks.`;
export const SUBTASK_TITLE_MAX_LENGTH = 500;
export const INCOMPLETE_SUBTASKS_ERROR = "Complete all subtasks before marking this task complete.";
export const INCOMPLETE_POMO_REQUIREMENT_ERROR = "Log enough pomodoro time before marking this task complete.";
export const ACTIVE_POMO_RUNNING_ERROR = "Stop the running pomodoro for this task before marking it complete.";
export const INVALID_REMINDERS_ERROR = "Invalid reminders payload.";
export const PAST_REMINDER_ERROR = "All reminders must be in the future.";
export const REMINDER_AFTER_DEADLINE_ERROR = "Reminders must be before or at the deadline.";
export const EVENT_BOUNDARY_REQUIRED_ERROR = "Event tasks require both -startHHMM and -endHHMM.";
export const INVALID_EVENT_END_ERROR = "Event end time is invalid.";
export const INVALID_EVENT_START_ERROR = "Event start time is invalid.";
export const EVENT_END_NOT_AFTER_START_ERROR = "Event end time must be after start time.";
export const INVALID_REQUIRED_POMO_ERROR =
    `Required pomodoro minutes must be an integer between 1 and ${MAX_POMO_DURATION_MINUTES}.`;
export const INVALID_TASK_PROOF_ERROR = "Invalid proof payload.";
export const TASK_PROOF_VIDEO_TOO_LONG_ERROR = "Video proof must be 15 seconds or less.";
export const REQUIRED_PROOF_FOR_COMPLETION_ERROR = "Attach proof before marking this task complete.";
export const INVALID_REQUIRES_PROOF_ERROR = "Invalid requires-proof payload.";
export const TITLE_REQUIRED_ERROR = "Title cannot be empty.";
export const SUBTASK_TITLE_TOO_LONG_ERROR = `Subtask title cannot exceed ${SUBTASK_TITLE_MAX_LENGTH} characters.`;
export const DAILY_RECURRING_POSTPONE_SAME_DAY_ERROR = "Daily repeating tasks can only be postponed within the same day.";
export const RecurrenceRuleTable = "recurrence_rules";

export const createTaskSchema = z.object({
    title: z.string().trim().min(1, "Title is required").max(500, "Title too long"),
});

export const ALLOWED_PROOF_MIME_TYPES = new Set([
    "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
    "video/mp4", "video/quicktime", "video/webm",
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MarkTaskCompleteWithProofResult {
    success?: boolean;
    error?: string;
    proofUploadTarget?: {
        bucket: string;
        objectPath: string;
        uploadToken?: string;
    };
}

// ─── Timezone helpers ─────────────────────────────────────────────────────────

export function isValidTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
        return true;
    } catch {
        return false;
    }
}

export function getDatePartsInTimeZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);

    const map: Record<string, string> = {};
    for (const part of parts) {
        if (part.type !== "literal") {
            map[part.type] = part.value;
        }
    }

    return {
        year: Number(map.year),
        month: Number(map.month),
        day: Number(map.day),
    };
}

export function getOffsetIsoForTimeZone(date: Date, timeZone: string): string {
    const offsetPart = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "longOffset",
    })
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")?.value;

    if (!offsetPart || offsetPart === "GMT") {
        return "Z";
    }

    return offsetPart.replace("GMT", "");
}

export function getVoucherResponseDeadlineUtc(baseDate: Date = new Date(), userTimeZone?: string): Date {
    const timeZone = userTimeZone && isValidTimeZone(userTimeZone) ? userTimeZone : "UTC";

    const baseLocal = getDatePartsInTimeZone(baseDate, timeZone);
    const targetNoonUtc = new Date(Date.UTC(baseLocal.year, baseLocal.month - 1, baseLocal.day + 2, 12, 0, 0, 0));
    const targetLocal = getDatePartsInTimeZone(targetNoonUtc, timeZone);
    const offsetIso = getOffsetIsoForTimeZone(
        new Date(Date.UTC(targetLocal.year, targetLocal.month - 1, targetLocal.day, 12, 0, 0, 0)),
        timeZone
    );

    const month = String(targetLocal.month).padStart(2, "0");
    const day = String(targetLocal.day).padStart(2, "0");
    const tzSuffix = offsetIso === "Z" ? "Z" : offsetIso;
    const targetIso = `${targetLocal.year}-${month}-${day}T23:59:59.999${tzSuffix}`;

    return new Date(targetIso);
}

// ─── Cache invalidation ───────────────────────────────────────────────────────
// (invalidateActiveTasksCache and invalidatePendingVoucherRequestsCache are re-exported from @/lib/cache-tags above)

// ─── Google Calendar helpers ──────────────────────────────────────────────────

export async function enqueueGoogleCalendarUpsert(userId: string, taskId: string) {
    try {
        await enqueueGoogleCalendarOutbox(userId, taskId, "UPSERT");
    } catch (error) {
        console.error(`Failed to enqueue Google Calendar UPSERT for task ${taskId}:`, error);
    }
}

export async function enqueueGoogleCalendarDelete(
    userId: string,
    taskId: string,
    payload?: {
        google_event_id?: string;
        calendar_id?: string;
    }
) {
    try {
        await enqueueGoogleCalendarOutbox(userId, taskId, "DELETE", payload);
    } catch (error) {
        console.error(`Failed to enqueue Google Calendar DELETE for task ${taskId}:`, error);
    }
}

// ─── Title normalization ──────────────────────────────────────────────────────

export function normalizeTaskTitleAndSyncKind(rawTitle: string): { normalizedTitle: string; googleSyncForTask: boolean; isStrict: boolean } {
    const hasEventToken = /(^|\s)-event(?=\s|$)/i.test(rawTitle);
    const hasBoundToken = /(^|\s)-bound(?=\s|$)/i.test(rawTitle);
    const normalizedTitle = stripProofRequiredTokens(stripEventColorTokens(rawTitle)
        .replace(/(^|\s)-event(?=\s|$)/gi, " ")
        .replace(/(^|\s)-bound(?=\s|$)/gi, " ")
        .replace(/(?:^|\s)-start\s*(?:\d{1,2}:\d{2}|\d{1,4})\b/gi, " ")
        .replace(/(?:^|\s)-end\s*(?:\d{1,2}:\d{2}|\d{1,4})\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim());

    return {
        normalizedTitle,
        googleSyncForTask: hasEventToken,
        isStrict: hasBoundToken,
    };
}

// ─── Deadline / date helpers ──────────────────────────────────────────────────

export function parseAndValidateFutureDeadline(rawDeadline: string): { deadline?: Date; error?: string } {
    const parsedDeadline = new Date(rawDeadline);
    if (Number.isNaN(parsedDeadline.getTime())) {
        return { error: INVALID_DEADLINE_ERROR };
    }

    if (parsedDeadline.getTime() <= Date.now()) {
        return { error: PAST_DEADLINE_ERROR };
    }

    return { deadline: parsedDeadline };
}

export function getDefaultTaskDeadline(): Date {
    const now = new Date();
    const defaultDeadline = new Date(now);
    defaultDeadline.setHours(23, 59, 0, 0);

    if (defaultDeadline.getTime() <= now.getTime()) {
        defaultDeadline.setDate(defaultDeadline.getDate() + 1);
    }

    return defaultDeadline;
}

// ─── Subtask normalization ────────────────────────────────────────────────────

export function normalizeSubtaskTitles(rawTitles: unknown): { titles: string[]; error?: string } {
    if (rawTitles == null || rawTitles === "") {
        return { titles: [] };
    }

    if (!Array.isArray(rawTitles)) {
        return { titles: [], error: "Subtasks payload must be an array of strings." };
    }

    const titles: string[] = [];
    for (const item of rawTitles) {
        if (typeof item !== "string") {
            return { titles: [], error: "Subtasks payload must be an array of strings." };
        }

        const normalized = item.trim();
        if (!normalized) continue;
        if (normalized.length > SUBTASK_TITLE_MAX_LENGTH) {
            return { titles: [], error: SUBTASK_TITLE_TOO_LONG_ERROR };
        }
        titles.push(normalized);
    }

    if (titles.length > MAX_SUBTASKS_PER_TASK) {
        return { titles: [], error: SUBTASK_LIMIT_ERROR };
    }

    return { titles };
}

export function normalizeSubtasksFromFormData(formValue: FormDataEntryValue | null): { titles: string[]; error?: string } {
    if (!formValue) return { titles: [] };
    if (typeof formValue !== "string") {
        return { titles: [], error: "Invalid subtasks payload." };
    }

    if (!formValue.trim()) {
        return { titles: [] };
    }

    try {
        const parsed = JSON.parse(formValue);
        return normalizeSubtaskTitles(parsed);
    } catch {
        return { titles: [], error: "Subtasks payload must be valid JSON." };
    }
}

// ─── Reminder normalization ───────────────────────────────────────────────────

export function validateReminderIsoList(rawValues: unknown, deadline: Date): { reminderDates: Date[]; error?: string } {
    if (rawValues == null || rawValues === "") {
        return { reminderDates: [] };
    }

    if (!Array.isArray(rawValues)) {
        return { reminderDates: [], error: INVALID_REMINDERS_ERROR };
    }

    const nowMs = Date.now();
    const deadlineMs = deadline.getTime();
    const deduped = new Map<number, Date>();

    for (const value of rawValues) {
        if (typeof value !== "string") {
            return { reminderDates: [], error: INVALID_REMINDERS_ERROR };
        }

        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return { reminderDates: [], error: INVALID_REMINDERS_ERROR };
        }

        const reminderMs = parsed.getTime();
        if (reminderMs <= nowMs) {
            return { reminderDates: [], error: PAST_REMINDER_ERROR };
        }

        if (reminderMs > deadlineMs) {
            return { reminderDates: [], error: REMINDER_AFTER_DEADLINE_ERROR };
        }

        deduped.set(reminderMs, parsed);
    }

    const reminderDates = Array.from(deduped.values()).sort((a, b) => a.getTime() - b.getTime());
    return { reminderDates };
}

export function normalizeRemindersFromFormData(
    formValue: FormDataEntryValue | null,
    deadline: Date
): { reminderDates: Date[]; error?: string } {
    if (!formValue) return { reminderDates: [] };
    if (typeof formValue !== "string") {
        return { reminderDates: [], error: INVALID_REMINDERS_ERROR };
    }

    if (!formValue.trim()) {
        return { reminderDates: [] };
    }

    try {
        const parsed = JSON.parse(formValue);
        return validateReminderIsoList(parsed, deadline);
    } catch {
        return { reminderDates: [], error: INVALID_REMINDERS_ERROR };
    }
}

export function buildManualReminderOffsetsFromDeadline(deadline: Date, reminderDates: Date[]): number[] {
    const deadlineMs = deadline.getTime();
    if (Number.isNaN(deadlineMs)) return [];

    const offsets = new Set<number>();
    for (const reminderDate of reminderDates) {
        const reminderMs = reminderDate.getTime();
        if (Number.isNaN(reminderMs)) continue;

        const offsetMs = reminderMs - deadlineMs;
        if (!Number.isFinite(offsetMs)) continue;
        if (offsetMs > 0) continue;

        offsets.add(offsetMs);
    }

    return Array.from(offsets.values()).sort((a, b) => a - b);
}

// ─── Form data parsers ────────────────────────────────────────────────────────

export function parseRequiredPomoMinutesFromFormData(
    formValue: FormDataEntryValue | null
): { requiredPomoMinutes: number | null; error?: string } {
    if (formValue == null || formValue === "") {
        return { requiredPomoMinutes: null };
    }

    if (typeof formValue !== "string") {
        return { requiredPomoMinutes: null, error: INVALID_REQUIRED_POMO_ERROR };
    }

    const trimmed = formValue.trim();
    if (!trimmed) {
        return { requiredPomoMinutes: null };
    }

    if (!/^\d+$/.test(trimmed)) {
        return { requiredPomoMinutes: null, error: INVALID_REQUIRED_POMO_ERROR };
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (!isValidPomoDurationMinutes(parsed)) {
        return { requiredPomoMinutes: null, error: INVALID_REQUIRED_POMO_ERROR };
    }

    return { requiredPomoMinutes: parsed };
}

export function parseRequiresProofFromFormData(
    formValue: FormDataEntryValue | null,
    fallback: boolean
): { requiresProof: boolean; error?: string } {
    if (formValue == null || formValue === "") {
        return { requiresProof: fallback };
    }

    if (typeof formValue !== "string") {
        return { requiresProof: fallback, error: INVALID_REQUIRES_PROOF_ERROR };
    }

    const normalized = formValue.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
        return { requiresProof: true };
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
        return { requiresProof: false };
    }

    return { requiresProof: fallback, error: INVALID_REQUIRES_PROOF_ERROR };
}

export function validateProofIntent(rawProofIntent?: TaskProofIntent | null): { proofIntent?: TaskProofIntent; error?: string } {
    if (!rawProofIntent) return {};

    const mediaKind = rawProofIntent.mediaKind;
    if (mediaKind !== "image" && mediaKind !== "video") {
        return { error: INVALID_TASK_PROOF_ERROR };
    }

    if (!rawProofIntent.mimeType || typeof rawProofIntent.mimeType !== "string") {
        return { error: INVALID_TASK_PROOF_ERROR };
    }

    if (!ALLOWED_PROOF_MIME_TYPES.has(rawProofIntent.mimeType)) {
        return { error: INVALID_TASK_PROOF_ERROR };
    }

    const sizeBytes = Number(rawProofIntent.sizeBytes || 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        return { error: INVALID_TASK_PROOF_ERROR };
    }

    const durationMs = rawProofIntent.durationMs ?? null;
    if (mediaKind === "video") {
        if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) {
            return { error: INVALID_TASK_PROOF_ERROR };
        }
        if (durationMs > MAX_TASK_PROOF_VIDEO_DURATION_MS) {
            return { error: TASK_PROOF_VIDEO_TOO_LONG_ERROR };
        }
    }

    return {
        proofIntent: {
            mediaKind,
            mimeType: rawProofIntent.mimeType,
            sizeBytes,
            durationMs: mediaKind === "video" ? Number(durationMs) : null,
            overlayTimestampText: normalizeProofTimestampText(rawProofIntent.overlayTimestampText),
        },
    };
}

// ─── DB insertion helpers ─────────────────────────────────────────────────────

export async function insertTaskSubtasks(
    supabase: SupabaseClient<Database>,
    userId: string,
    parentTaskId: string,
    titles: string[]
): Promise<{ error?: string }> {
    if (titles.length === 0) return {};

    // @ts-ignore
    const { error } = await (supabase.from("task_subtasks") as any).insert(
        titles.map((title) => ({
            parent_task_id: parentTaskId,
            user_id: userId,
            title,
            is_completed: false,
            completed_at: null,
        }))
    );

    if (error) {
        return { error: error.message };
    }

    return {};
}

export async function insertTaskReminders(
    supabase: SupabaseClient<Database>,
    userId: string,
    parentTaskId: string,
    reminderDates: Date[]
): Promise<{ error?: string }> {
    return insertTaskReminderRows(
        supabase,
        reminderDates.map((reminderDate) => ({
            parent_task_id: parentTaskId,
            user_id: userId,
            reminder_at: reminderDate.toISOString(),
            source: MANUAL_REMINDER_SOURCE,
            notified_at: null,
        }))
    );
}

export async function insertTaskReminderRows(
    supabase: SupabaseClient<Database>,
    rows: Database["public"]["Tables"]["task_reminders"]["Insert"][],
    options?: { ignoreDuplicates?: boolean }
): Promise<{ error?: string }> {
    if (rows.length === 0) return {};
    const nowIso = new Date().toISOString();
    const normalizedRows = rows.map((row) => ({
        ...row,
        created_at: row.created_at ?? nowIso,
        updated_at: row.updated_at ?? nowIso,
    }));

    if (options?.ignoreDuplicates) {
        const { error } = await (supabase.from("task_reminders") as any).upsert(
            normalizedRows,
            {
                onConflict: "parent_task_id,reminder_at",
                ignoreDuplicates: true,
            }
        );
        if (error) {
            return { error: error.message };
        }
        return {};
    }

    const { error } = await (supabase.from("task_reminders") as any).insert(normalizedRows);
    if (error) {
        return { error: error.message };
    }
    return {};
}

// ─── Revalidation helpers ─────────────────────────────────────────────────────

export function revalidateTaskSurfaces(taskId: string, userId: string) {
    invalidateActiveTasksCache(userId);
    revalidatePath("/tasks");
    revalidatePath("/stats");
    revalidatePath(`/tasks/${taskId}`);
}

export function revalidateTaskAndSocialSurfaces(taskId: string, ownerUserId: string, voucherUserId?: string | null) {
    invalidateActiveTasksCache(ownerUserId);
    if (voucherUserId) {
        invalidatePendingVoucherRequestsCache(voucherUserId);
    }
    revalidatePath("/tasks");
    revalidatePath("/stats");
    revalidatePath("/friends");
    revalidatePath(`/tasks/${taskId}`);
}

// ─── Ownership query helpers ──────────────────────────────────────────────────

export async function getOwnedParentTask(
    supabase: SupabaseClient<Database>,
    parentTaskId: string,
    userId: string
) {
    // @ts-ignore
    const { data: task } = await (supabase.from("tasks") as any)
        .select("id, user_id, status")
        .eq("id", parentTaskId as any)
        .eq("user_id", userId as any)
        .single();

    return task as { id: string; user_id: string; status: TaskStatus } | null;
}

// ─── Reminder realignment ─────────────────────────────────────────────────────

export async function realignTaskRemindersAfterPostpone(
    supabase: SupabaseClient<Database>,
    taskId: string,
    userId: string,
    oldDeadline: Date,
    newDeadline: Date
): Promise<{ error?: string }> {
    const { data: existingReminders, error: existingRemindersError } = await (supabase.from("task_reminders") as any)
        .select("id, reminder_at, source, created_at, notified_at")
        .eq("parent_task_id", taskId as any)
        .eq("user_id", userId as any);

    if (existingRemindersError) {
        return { error: existingRemindersError.message };
    }

    const { data: reminderDefaultsProfile, error: reminderDefaultsError } = await (supabase.from("profiles") as any)
        .select("deadline_one_hour_warning_enabled, deadline_final_warning_enabled")
        .eq("id", userId as any)
        .maybeSingle();

    if (reminderDefaultsError) {
        return { error: reminderDefaultsError.message };
    }

    const now = new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const deadlineDeltaMs = newDeadline.getTime() - oldDeadline.getTime();
    const rowsByReminderIso = new Map<string, Database["public"]["Tables"]["task_reminders"]["Insert"]>();

    for (const row of ((existingReminders as Array<{
        reminder_at: string;
        source?: string | null;
        created_at: string;
    }> | null) || [])) {
        const reminderMs = new Date(row.reminder_at).getTime();
        if (Number.isNaN(reminderMs) || reminderMs <= nowMs) {
            continue;
        }

        const source = row.source || MANUAL_REMINDER_SOURCE;
        if (source !== MANUAL_REMINDER_SOURCE) {
            continue;
        }

        const shiftedReminderMs = reminderMs + deadlineDeltaMs;
        if (shiftedReminderMs <= nowMs) {
            continue;
        }

        const shiftedReminderIso = new Date(shiftedReminderMs).toISOString();
        if (rowsByReminderIso.has(shiftedReminderIso)) {
            continue;
        }

        rowsByReminderIso.set(shiftedReminderIso, {
            parent_task_id: taskId,
            user_id: userId,
            reminder_at: shiftedReminderIso,
            source: MANUAL_REMINDER_SOURCE,
            notified_at: null,
            created_at: row.created_at || nowIso,
            updated_at: nowIso,
        });
    }

    const defaultReminderRows = buildDefaultDeadlineReminderRows({
        parentTaskId: taskId,
        userId,
        deadline: newDeadline,
        deadlineOneHourWarningEnabled:
            ((reminderDefaultsProfile as any)?.deadline_one_hour_warning_enabled as boolean | undefined) ?? true,
        deadlineFinalWarningEnabled:
            ((reminderDefaultsProfile as any)?.deadline_final_warning_enabled as boolean | undefined) ?? true,
        now,
    });

    for (const row of defaultReminderRows) {
        const reminderMs = new Date(row.reminder_at).getTime();
        if (Number.isNaN(reminderMs) || reminderMs <= nowMs) {
            continue;
        }

        const reminderIso = new Date(reminderMs).toISOString();
        if (rowsByReminderIso.has(reminderIso)) {
            continue;
        }

        rowsByReminderIso.set(reminderIso, {
            ...row,
            notified_at: null,
            created_at: row.created_at ?? nowIso,
            updated_at: nowIso,
        });
    }

    const nextFutureRows = Array.from(rowsByReminderIso.values());
    if (nextFutureRows.length > 0) {
        const { error: upsertError } = await (supabase.from("task_reminders") as any).upsert(
            nextFutureRows,
            { onConflict: "parent_task_id,reminder_at" }
        );

        if (upsertError) {
            return { error: upsertError.message };
        }
    }

    const nextFutureReminderIsoSet = new Set(
        nextFutureRows.map((row) => new Date(row.reminder_at as string).toISOString())
    );
    const reminderIdsToDelete = ((existingReminders as Array<{ id: string; reminder_at: string }> | null) || [])
        .filter((row) => {
            const reminderMs = new Date(row.reminder_at).getTime();
            if (Number.isNaN(reminderMs) || reminderMs <= nowMs) {
                return false;
            }
            return !nextFutureReminderIsoSet.has(new Date(reminderMs).toISOString());
        })
        .map((row) => row.id);

    if (reminderIdsToDelete.length > 0) {
        const { error: deleteError } = await (supabase.from("task_reminders") as any)
            .delete()
            .in("id", reminderIdsToDelete as any)
            .eq("user_id", userId as any);

        if (deleteError) {
            return { error: deleteError.message };
        }
    }

    return {};
}
