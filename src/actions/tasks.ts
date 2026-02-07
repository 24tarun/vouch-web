"use server";

import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canTransition, type TaskStatus } from "@/lib/xstate/task-machine";
import { type Database } from "@/lib/types";
import { type SupabaseClient } from "@supabase/supabase-js";
import { sendNotification } from "@/lib/notifications";
import { DEFAULT_FAILURE_COST_CENTS } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { activeTasksTag, pendingVoucherRequestsTag } from "@/lib/cache-tags";

const INVALID_DEADLINE_ERROR = "Deadline is invalid.";
const PAST_DEADLINE_ERROR = "Deadline must be in the future.";
const VOUCHER_RESPONSE_WINDOW_HOURS = 48;

function invalidateActiveTasksCache(userId: string) {
    revalidateTag(activeTasksTag(userId), "max");
}

function invalidatePendingVoucherRequestsCache(voucherId: string) {
    revalidateTag(pendingVoucherRequestsTag(voucherId), "max");
}

function parseAndValidateFutureDeadline(rawDeadline: string): { deadline?: Date; error?: string } {
    const parsedDeadline = new Date(rawDeadline);
    if (Number.isNaN(parsedDeadline.getTime())) {
        return { error: INVALID_DEADLINE_ERROR };
    }

    if (parsedDeadline.getTime() <= Date.now()) {
        return { error: PAST_DEADLINE_ERROR };
    }

    return { deadline: parsedDeadline };
}

function getDefaultTaskDeadline(): Date {
    const now = new Date();
    const defaultDeadline = new Date(now);
    defaultDeadline.setHours(23, 59, 0, 0);

    if (defaultDeadline.getTime() <= now.getTime()) {
        defaultDeadline.setDate(defaultDeadline.getDate() + 1);
    }

    return defaultDeadline;
}

// Wrapper for simple task creation (inline)
export async function createTaskSimple(title: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return { error: "Not authenticated" };

    // Load user defaults.
    // @ts-ignore
    const { data: profileDefaults } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

    // Default configuration for simple tasks
    // Use default voucher if valid, otherwise fallback to first friend.
    // @ts-ignore
    const { data: friends } = await supabase
        .from("friendships")
        .select("friend_id")
        .eq("user_id", user.id);

    const friendIds = new Set(((friends as any[]) || []).map((f) => f.friend_id));
    const preferredVoucherId = (profileDefaults as any)?.default_voucher_id as string | null | undefined;
    const defaultVoucherId =
        preferredVoucherId && friendIds.has(preferredVoucherId)
            ? preferredVoucherId
            : (friends as any)?.[0]?.friend_id;

    const defaultFailureCostCents =
        ((profileDefaults as any)?.default_failure_cost_cents as number | undefined) ??
        DEFAULT_FAILURE_COST_CENTS;

    if (!defaultVoucherId) {
        throw new Error("You need at least one friend to create a task.");
    }

    // Default params: Deadline = End of today
    const deadline = getDefaultTaskDeadline();

    // @ts-ignore
    const { data: task, error } = await (supabase.from("tasks") as any)
        .insert({
            user_id: user.id,
            voucher_id: defaultVoucherId,
            title,
            description: null,
            failure_cost_cents: defaultFailureCostCents,
            deadline: deadline.toISOString(),
            status: "CREATED",
        })
        .select()
        .single();

    if (error) throw new Error(error.message);

    // Event
    // @ts-ignore
    await supabase.from("task_events").insert({
        task_id: (task as any).id,
        event_type: "CREATED",
        actor_id: user.id,
        from_status: "CREATED",
        to_status: "CREATED",
        metadata: { title, type: "simple" },
    });

    invalidateActiveTasksCache(user.id);
    revalidatePath("/dashboard");
    return { success: true, taskId: (task as any).id };
}

export const markTaskCompleted = markTaskComplete; // Alias for component compatibility

export async function getCachedActiveTasksForUser(userId: string) {
    if (!userId) return [];

    const loadActiveTasks = unstable_cache(
        async () => {
            const supabaseAdmin = createAdminClient();
            // @ts-ignore
            const { data, error } = await (supabaseAdmin.from("tasks") as any)
                .select("*")
                .eq("user_id", userId as any)
                .in("status", ["CREATED", "POSTPONED"])
                .order("created_at", { ascending: false });

            if (error) {
                console.error("Failed to load cached active tasks:", error.message);
                return [];
            }

            return (data as any[]) || [];
        },
        ["active-tasks", userId],
        {
            tags: [activeTasksTag(userId)],
            revalidate: 60,
        }
    );

    return loadActiveTasks();
}

export async function createTask(formData: FormData) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const failureCostEuros = parseFloat(formData.get("failureCost") as string);
    const deadline = formData.get("deadline") as string;
    const voucherId = formData.get("voucherId") as string;

    if (!title || !deadline || !voucherId || isNaN(failureCostEuros)) {
        return { error: "Missing required fields" };
    }

    const deadlineValidation = parseAndValidateFutureDeadline(deadline);
    if (!deadlineValidation.deadline) {
        return { error: deadlineValidation.error || INVALID_DEADLINE_ERROR };
    }
    const validatedDeadline = deadlineValidation.deadline;

    if (failureCostEuros < 0.01 || failureCostEuros > 100) {
        return { error: "Failure cost must be between €0.01 and €100" };
    }

    // Verify voucher is a friend
    // @ts-ignore
    const { data: friendship } = await supabase
        .from("friendships")
        .select("*")
        .eq("user_id", (user as any).id)
        .eq("friend_id", voucherId as any)
        .single();

    if (!friendship) {
        return { error: "You can only assign friends as vouchers" };
    }

    const recurrenceType = formData.get("recurrenceType") as string;
    const recurrenceInterval = parseInt(formData.get("recurrenceInterval") as string || "1");
    // Only parse days if present
    const recurrenceDaysStr = formData.get("recurrenceDays") as string;
    const recurrenceDays = recurrenceDaysStr ? JSON.parse(recurrenceDaysStr) : undefined;
    const userTimezone = formData.get("userTimezone") as string;

    // Check if it's a repetitive task
    let recurrenceRuleId: string | null = null;

    if (recurrenceType && userTimezone) {
        // Calculate time_of_day from initial deadline
        const initialDeadlineDate = validatedDeadline;
        // We need the time in strict HH:MM format. 
        // Best to use the local time component if we trust the input date was constructed correctly relative to UTC/Local.
        // However, converting to the USER'S timezone to extract HH:MM is safer if we have the timezone.

        // Helper to get HH:MM in specific timezone
        const timeFormatter = new Intl.DateTimeFormat("en-GB", {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: userTimezone
        });
        const timeOfDay = timeFormatter.format(initialDeadlineDate);

        const ruleConfig = {
            frequency: recurrenceType,
            interval: recurrenceInterval,
            days_of_week: recurrenceDays,
            time_of_day: timeOfDay
        };

        // Insert recurrence rule
        // @ts-ignore
        const { data: rule, error: ruleError } = await (supabase.from(RecurrenceRuleTable) as any)
            .insert({
                user_id: (user as any).id,
                voucher_id: voucherId,
                title,
                description: description || null,
                failure_cost_cents: Math.round(failureCostEuros * 100),
                rule_config: ruleConfig,
                timezone: userTimezone,
                active: true,
                // Set last_generated_date to the date part of the deadline in user's timezone
                // This prevents immediate regeneration of the task we are about to create manually
                last_generated_date: new Intl.DateTimeFormat("en-CA", {
                    timeZone: userTimezone,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }).format(initialDeadlineDate)
            })
            .select()
            .single();

        if (ruleError) {
            return { error: "Failed to create recurrence rule: " + ruleError.message };
        }
        recurrenceRuleId = (rule as any).id;
    }

    // @ts-ignore
    const { data: task, error } = await (supabase.from("tasks" as any) as any)
        .insert({
            user_id: (user as any).id,
            voucher_id: voucherId,
            title,
            description: description || null,
            failure_cost_cents: Math.round(failureCostEuros * 100),
            deadline: validatedDeadline.toISOString(),
            status: "CREATED",
            recurrence_rule_id: recurrenceRuleId
        })
        .select()
        .single();

    if (error) {
        return { error: error.message };
    }

    // Log the creation event
    // @ts-ignore
    await supabase.from("task_events").insert({
        task_id: (task as any).id,
        event_type: "CREATED",
        actor_id: (user as any).id,
        from_status: "CREATED",
        to_status: "CREATED",
        metadata: {
            title,
            deadline: validatedDeadline.toISOString(),
            failure_cost_cents: Math.round(failureCostEuros * 100),
            recurrence_rule_id: recurrenceRuleId
        },
    });

    invalidateActiveTasksCache((user as any).id);
    revalidatePath("/dashboard");
    return { success: true, taskId: (task as any).id };
}

// Just a constant for the table name if I don't import it
const RecurrenceRuleTable = "recurrence_rules";

export async function cancelRepetition(taskId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return { error: "Not authenticated" };

    // Get task to find recurrence_rule_id
    // @ts-ignore
    const { data: task } = await supabase.from("tasks")
        .select("recurrence_rule_id")
        .eq("id", taskId)
        .eq("user_id", user.id)
        .single();

    if (!task || !(task as any).recurrence_rule_id) {
        return { error: "Task is not repetitive" };
    }

    // Disable the rule
    const ruleId = (task as any).recurrence_rule_id;

    // @ts-ignore
    const { error } = await (supabase.from(RecurrenceRuleTable) as any)
        .update({ active: false })
        .eq("id", ruleId)
        .eq("user_id", user.id);

    if (error) return { error: error.message };

    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/tasks/${taskId}`);
    return { success: true };
}


export async function markTaskComplete(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const { data: task } = await (supabase.from("tasks") as any)
        .select("*")
        .eq("id", (taskId as any))
        .eq("user_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    if (!canTransition((task as any).status as TaskStatus, "MARK_COMPLETE")) {
        return { error: `Cannot mark complete from ${(task as any).status} status` };
    }

    if (new Date() >= new Date((task as any).deadline)) {
        return { error: "Deadline has passed" };
    }

    const voucherResponseDeadline = new Date(Date.now() + VOUCHER_RESPONSE_WINDOW_HOURS * 60 * 60 * 1000);
    const nowIso = new Date().toISOString();

    // @ts-ignore
    const { data: updatedRows, error } = await (supabase.from("tasks") as any)
        .update({
            status: "AWAITING_VOUCHER",
            marked_completed_at: nowIso,
            voucher_response_deadline: voucherResponseDeadline.toISOString(),
            updated_at: nowIso,
        } as any)
        .eq("id", (taskId as any))
        .eq("user_id", (user as any).id)
        .in("status", ["CREATED", "POSTPONED"] as any)
        .gt("deadline", nowIso)
        .select("id");

    if (error) {
        return { error: error.message };
    }

    if (!updatedRows || updatedRows.length === 0) {
        return { error: "Task can no longer be marked complete. Please refresh." };
    }

    await (supabase.from("task_events") as any).insert({
        task_id: (taskId as any),
        event_type: "MARK_COMPLETE",
        actor_id: (user as any).id,
        from_status: (task as any).status,
        to_status: "AWAITING_VOUCHER",
    });

    invalidateActiveTasksCache((user as any).id);
    invalidatePendingVoucherRequestsCache((task as any).voucher_id);
    // Mirror accept/deny behavior so voucher list cache is invalidated on new request.
    revalidatePath("/dashboard/voucher");
    revalidatePath(`/dashboard/tasks/${taskId}`);
    return { success: true };
}

export async function postponeTask(taskId: string, newDeadline?: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const { data: task } = await (supabase.from("tasks") as any)
        .select("*")
        .eq("id", (taskId as any))
        .eq("user_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    const currentDeadline = new Date((task as any).deadline);
    let newDeadlineDate = newDeadline ? new Date(newDeadline) : new Date(currentDeadline.getTime() + 60 * 60 * 1000);

    if (new Date() >= new Date((task as any).deadline)) {
        return { error: "Deadline has passed" };
    }
    if (!canTransition((task as any).status as TaskStatus, "POSTPONE")) {
        return { error: `Cannot postpone task in ${(task as any).status} status` };
    }
    if ((task as any).postponed_at) {
        return { error: "Task has already been postponed once" };
    }

    if (["AWAITING_VOUCHER", "MARKED_COMPLETED", "COMPLETED", "FAILED", "RECTIFIED", "SETTLED", "DELETED"].includes((task as any).status)) {
        return { error: `Cannot postpone task in ${(task as any).status} status` };
    }

    // @ts-ignore
    const { error } = await (supabase.from("tasks") as any)
        .update({
            status: "POSTPONED",
            deadline: newDeadlineDate.toISOString(),
            postponed_at: new Date().toISOString(),
        } as any)
        .eq("id", (taskId as any));

    if (error) {
        return { error: error.message };
    }

    await (supabase.from("task_events") as any).insert({
        task_id: taskId as any,
        event_type: "POSTPONE",
        actor_id: (user as any).id,
        from_status: (task as any).status,
        to_status: "POSTPONED",
        metadata: { new_deadline: newDeadlineDate.toISOString() },
    });

    invalidateActiveTasksCache((user as any).id);
    revalidatePath(`/dashboard/tasks/${taskId}`);
    return { success: true };
}

export async function forceMajeureTask(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const { data: task } = await (supabase.from("tasks") as any)
        .select("*")
        .eq("id", (taskId as any))
        .eq("user_id", (user as any).id)
        .single();

    if (!task) {
        return { error: "Task not found" };
    }

    if ((task as any).status !== "FAILED") {
        return { error: "Force Majeure can only be used on tasks that have failed or been denied." };
    }

    // Check force majeure usage (max 1 per month)
    const now = new Date();
    const currentPeriod = now.toISOString().slice(0, 7);

    const { count } = await supabase
        .from("force_majeure" as any)
        .select("*", { count: 'exact', head: true })
        .eq("user_id", user.id)
        .eq("period", currentPeriod);

    if ((count || 0) >= 1) {
        return { error: "You have already used your force majeure for this month" };
    }

    // Update status to SETTLED
    const { error } = await (supabase.from("tasks") as any)
        .update({ status: "SETTLED", updated_at: now.toISOString() } as any)
        .eq("id", (taskId as any));

    if (error) {
        return { error: error.message };
    }

    // Create force majeure record
    await (supabase.from("force_majeure" as any) as any).insert({
        user_id: user.id,
        task_id: taskId as any,
        period: currentPeriod,
    });

    // Create negative ledger entry to cancel out the failure
    await (supabase.from("ledger_entries" as any) as any).insert({
        user_id: user.id,
        task_id: taskId as any,
        period: currentPeriod,
        amount_cents: -(task as any).failure_cost_cents,
        entry_type: "force_majeure",
    });

    // Log event
    await (supabase.from("task_events") as any).insert({
        task_id: taskId as any,
        event_type: "FORCE_MAJEURE",
        actor_id: user.id,
        from_status: (task as any).status,
        to_status: "SETTLED",
    });

    revalidatePath(`/dashboard/tasks/${taskId}`);
    revalidatePath("/dashboard");
    return { success: true };
}

export async function getTask(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    // @ts-ignore
    const { data: task } = await (supabase.from("tasks") as any)
        .select(`
      *,
      user:profiles!tasks_user_id_fkey(*),
      voucher:profiles!tasks_voucher_id_fkey(*),
      recurrence_rule:recurrence_rules(*)
    `)
        .eq("id", (taskId as any))
        .single();

    if (task) {
        const isOwner = (task as any).user_id === user.id;
        const isVoucher = (task as any).voucher_id === user.id;

        if (isOwner || isVoucher) {
            const now = new Date();
            const deadline = new Date((task as any).deadline);
            const shouldAutoFail = now >= deadline && ["CREATED", "POSTPONED"].includes((task as any).status);

            if (shouldAutoFail) {
                const currentPeriod = now.toISOString().slice(0, 7);

                await (supabase.from("tasks") as any)
                    .update({ status: "FAILED", updated_at: now.toISOString() } as any)
                    .eq("id", (taskId as any));

                await (supabase.from("ledger_entries") as any).insert({
                    user_id: (task as any).user_id,
                    task_id: (task as any).id,
                    period: currentPeriod,
                    amount_cents: (task as any).failure_cost_cents,
                    entry_type: "failure",
                });

                await (supabase.from("task_events") as any).insert({
                    task_id: (task as any).id,
                    event_type: "DEADLINE_MISSED",
                    actor_id: null,
                    from_status: (task as any).status,
                    to_status: "FAILED",
                    metadata: { reason: "Deadline passed without completion" },
                });

                (task as any).status = "FAILED";
                (task as any).updated_at = now.toISOString();

                invalidateActiveTasksCache((task as any).user_id);
                revalidatePath(`/dashboard/tasks/${taskId}`);
            }
        }

        if (isOwner || isVoucher) {
            return task;
        }
    }

    return null;
}

export async function getTaskEvents(taskId: string) {
    const supabase = await createClient();

    // @ts-ignore
    const { data: events } = await (supabase.from("task_events") as any)
        .select("*")
        .eq("task_id", (taskId as any))
        .order("created_at", { ascending: true });

    return (events as any) || [];
}

export async function getTaskPomoSummary(taskId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    // Verify access to task first
    // @ts-ignore
    const { data: task } = await (supabase.from("tasks") as any)
        .select("id, user_id, voucher_id")
        .eq("id", taskId as any)
        .single();

    if (!task) return null;

    const canView = task.user_id === user.id || task.voucher_id === user.id;
    if (!canView) return null;

    // @ts-ignore
    const { data: sessions } = await (supabase.from("pomo_sessions") as any)
        .select("elapsed_seconds, status, completed_at")
        .eq("task_id", taskId as any)
        .eq("user_id", task.user_id as any)
        .neq("status", "DELETED")
        .order("created_at", { ascending: false });

    const rows = (sessions as any[]) || [];
    const totalSeconds = rows.reduce((sum, s) => sum + (s.elapsed_seconds || 0), 0);
    const completedSessions = rows.filter((s) => s.status === "COMPLETED").length;
    const lastCompletedAt = rows.find((s) => s.status === "COMPLETED" && s.completed_at)?.completed_at || null;

    return {
        totalSeconds,
        sessionCount: rows.length,
        completedSessions,
        lastCompletedAt,
    };
}

// ==========================================
// POMODORO ACTIONS
// ==========================================

export async function startPomoSession(taskId: string, durationMinutes: number) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { error: "Not authenticated" };

    // Check for existing active session
    // @ts-ignore
    const { data: existing } = await (supabase
        .from("pomo_sessions") as any)
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "ACTIVE")
        .single();

    if (existing) {
        return { error: "You already have an active session. Please stop it first." };
    }

    // Create new session
    // @ts-ignore
    const { data: session, error } = await (supabase
        .from("pomo_sessions") as any)
        .insert({
            user_id: user.id,
            task_id: taskId,
            duration_minutes: durationMinutes,
            status: "ACTIVE",
            started_at: new Date().toISOString(),
            elapsed_seconds: 0,
        })
        .select()
        .single();

    if (error) return { error: error.message };

    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/tasks/${taskId}`);
    return { success: true, session };
}

export async function pausePomoSession(sessionId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    // Get current session to calculate elapsed
    // @ts-ignore
    const { data: session } = await (supabase
        .from("pomo_sessions") as any)
        .select("*")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .single();

    if (!session) return { error: "Session not found" };
    if (session.status !== "ACTIVE") return { error: "Session is not active" };

    const now = new Date();
    const startTime = new Date(session.started_at);
    const additionalElapsed = Math.floor((now.getTime() - startTime.getTime()) / 1000);
    const newElapsed = (session.elapsed_seconds || 0) + additionalElapsed;

    // @ts-ignore
    const { error } = await (supabase
        .from("pomo_sessions") as any)
        .update({
            status: "PAUSED",
            elapsed_seconds: newElapsed,
            paused_at: now.toISOString(),
        })
        .eq("id", sessionId);

    if (error) return { error: error.message };
    revalidatePath("/dashboard");
    if (session.task_id) {
        revalidatePath(`/dashboard/tasks/${session.task_id}`);
    }
    return { success: true };
}

export async function resumePomoSession(sessionId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    // @ts-ignore
    const { data: resumed, error } = await (supabase
        .from("pomo_sessions") as any)
        .update({
            status: "ACTIVE",
            started_at: new Date().toISOString(),
            paused_at: null,
        })
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .select("task_id")
        .single();

    if (error) return { error: error.message };
    revalidatePath("/dashboard");
    if ((resumed as any)?.task_id) {
        revalidatePath(`/dashboard/tasks/${(resumed as any).task_id}`);
    }
    return { success: true };
}

export async function endPomoSession(
    sessionId: string,
    source: "manual_stop" | "timer_completed" | "system" = "manual_stop"
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    // Calculate final elapsed if it was active
    // @ts-ignore
    const { data: session } = await (supabase
        .from("pomo_sessions") as any)
        .select("*")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .single();

    if (!session) return { error: "Session not found" };

    let finalElapsed = session.elapsed_seconds || 0;
    if (session.status === "ACTIVE") {
        const now = new Date();
        const startTime = new Date(session.started_at);
        finalElapsed += Math.floor((now.getTime() - startTime.getTime()) / 1000);
    }

    // @ts-ignore
    const { error } = await (supabase
        .from("pomo_sessions") as any)
        .update({
            status: "COMPLETED",
            elapsed_seconds: finalElapsed,
            completed_at: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .eq("user_id", user.id);

    if (error) return { error: error.message };

    // Log completion in task activity feed
    if (session.task_id) {
        // @ts-ignore
        const { data: task } = await (supabase.from("tasks") as any)
            .select("id, title, status")
            .eq("id", session.task_id as any)
            .eq("user_id", user.id)
            .single();

        if (task?.status) {
            await (supabase.from("task_events") as any).insert({
                task_id: session.task_id,
                event_type: "POMO_COMPLETED",
                actor_id: user.id,
                from_status: task.status,
                to_status: task.status,
                metadata: {
                    session_id: session.id,
                    duration_minutes: session.duration_minutes,
                    elapsed_seconds: finalElapsed,
                    source,
                },
            });

            if (source === "timer_completed") {
                await sendNotification({
                    to: user.email || undefined,
                    userId: user.id,
                    subject: `Pomodoro complete: ${task.title}`,
                    title: "Pomodoro completed",
                    text: `Your pomodoro has ended and has been logged for ${task.title}.`,
                    email: false,
                    push: true,
                    url: `/dashboard/tasks/${task.id}`,
                    tag: `pomo-completed-${session.id}`,
                    data: {
                        taskId: task.id,
                        sessionId: session.id,
                        kind: "POMO_COMPLETED",
                    },
                });
            }
        }
    }

    revalidatePath("/dashboard");
    if (session.task_id) {
        revalidatePath(`/dashboard/tasks/${session.task_id}`);
    }
    return { success: true };
}

export async function deletePomoSession(sessionId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    // @ts-ignore
    const { error } = await (supabase
        .from("pomo_sessions") as any)
        .update({
            status: "DELETED",
            completed_at: new Date().toISOString(), // Mark when it was deleted
        })
        .eq("id", sessionId)
        .eq("user_id", user.id);

    if (error) return { error: error.message };
    revalidatePath("/dashboard");
    return { success: true };
}

export async function getActivePomoSession() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return null;

    // @ts-ignore
    const { data: session } = await (supabase
        .from("pomo_sessions") as any)
        .select(`
            *,
            task:tasks(id, title)
        `)
        .eq("user_id", user.id)
        .in("status", ["ACTIVE", "PAUSED"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

    return session;
}
