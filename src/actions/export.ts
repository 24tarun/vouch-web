"use server";

import { createClient } from "@/lib/supabase/server";

export async function exportUserData(): Promise<{ data: Record<string, unknown> } | { error: string }> {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: "Not authenticated." };

    const uid = user.id;

    const [
        profileRes,
        tasksRes,
        subtasksRes,
        remindersRes,
        taskEventsRes,
        ledgerRes,
        recurrenceRulesRes,
        pomoRes,
        commitmentsRes,
        friendshipsRes,
    ] = await Promise.all([
        (supabase.from("profiles" as any) as any)
            .select("id, email, username, currency, default_pomo_duration_minutes, default_event_duration_minutes, default_failure_cost_cents, strict_pomo_enabled, deadline_one_hour_warning_enabled, deadline_final_warning_enabled, voucher_can_view_active_tasks, mobile_notifications_enabled, orca_friend_opt_in, lifetime_xp, created_at")
            .eq("id", uid)
            .single(),

        (supabase.from("tasks" as any) as any)
            .select("id, title, description, failure_cost_cents, deadline, status, postponed_at, marked_completed_at, voucher_response_deadline, recurrence_rule_id, iteration_number, start_at, is_strict, required_pomo_minutes, requires_proof, has_proof, resubmit_count, created_at, updated_at, voucher:profiles!tasks_voucher_id_fkey(username)")
            .eq("user_id", uid)
            .order("created_at", { ascending: false }),

        (supabase.from("task_subtasks" as any) as any)
            .select("id, parent_task_id, title, is_completed, completed_at, created_at")
            .eq("user_id", uid)
            .order("created_at", { ascending: true }),

        (supabase.from("task_reminders" as any) as any)
            .select("id, parent_task_id, reminder_at, source, notified_at, created_at")
            .eq("user_id", uid)
            .order("reminder_at", { ascending: true }),

        (supabase.from("task_events" as any) as any)
            .select("id, task_id, event_type, from_status, to_status, created_at")
            .eq("user_id", uid)
            .order("created_at", { ascending: true }),

        (supabase.from("ledger_entries" as any) as any)
            .select("id, task_id, period, amount_cents, entry_type, created_at")
            .eq("user_id", uid)
            .order("created_at", { ascending: true }),

        (supabase.from("recurrence_rules" as any) as any)
            .select("id, title, description, failure_cost_cents, required_pomo_minutes, requires_proof, rule_config, timezone, latest_iteration, created_at, updated_at, voucher:profiles!recurrence_rules_voucher_id_fkey(username)")
            .eq("user_id", uid)
            .order("created_at", { ascending: true }),

        (supabase.from("pomo_sessions" as any) as any)
            .select("id, task_id, duration_minutes, elapsed_seconds, is_strict, status, started_at, paused_at, completed_at, created_at")
            .eq("user_id", uid)
            .order("created_at", { ascending: false }),

        (supabase.from("commitments" as any) as any)
            .select("id, name, description, start_date, end_date, status, created_at, updated_at")
            .eq("user_id", uid)
            .order("created_at", { ascending: false }),

        (supabase.from("friendships" as any) as any)
            .select("id, created_at, friend:profiles!friendships_friend_id_fkey(username, email)")
            .eq("user_id", uid)
            .order("created_at", { ascending: true }),
    ]);

    if (profileRes.error) return { error: "Failed to fetch profile data." };

    // Attach subtasks and reminders to their tasks
    const subtasksByTask = groupBy(subtasksRes.data ?? [], "parent_task_id");
    const remindersByTask = groupBy(remindersRes.data ?? [], "parent_task_id");
    const tasks = (tasksRes.data ?? []).map((task: any) => ({
        ...task,
        subtasks: subtasksByTask[task.id] ?? [],
        reminders: remindersByTask[task.id] ?? [],
    }));

    const exportPayload: Record<string, unknown> = {
        exported_at: new Date().toISOString(),
        profile: profileRes.data,
        tasks,
        task_events: taskEventsRes.data ?? [],
        ledger_entries: ledgerRes.data ?? [],
        recurrence_rules: recurrenceRulesRes.data ?? [],
        pomo_sessions: pomoRes.data ?? [],
        commitments: commitmentsRes.data ?? [],
        friends: (friendshipsRes.data ?? []).map((f: any) => ({
            username: f.friend?.username ?? null,
            email: f.friend?.email ?? null,
            friends_since: f.created_at,
        })),
    };

    return { data: exportPayload };
}

function groupBy<T extends Record<string, unknown>>(items: T[], key: string): Record<string, T[]> {
    return items.reduce<Record<string, T[]>>((acc, item) => {
        const k = String(item[key]);
        if (!acc[k]) acc[k] = [];
        acc[k].push(item);
        return acc;
    }, {});
}
