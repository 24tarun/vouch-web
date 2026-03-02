import { createClient } from "@/lib/supabase/server";
import { getFriends } from "@/actions/friends";
import {
    DEFAULT_EVENT_DURATION_MINUTES,
    DEFAULT_FAILURE_COST_CENTS,
} from "@/lib/constants";
import { normalizeCurrency } from "@/lib/currency";
import type { Task } from "@/lib/types";
import CalendarClient from "@/app/dashboard/calendar/calendar-client";

const CALENDAR_VISIBLE_STATUSES: Task["status"][] = [
    "CREATED",
    "POSTPONED",
    "AWAITING_VOUCHER",
    "MARKED_COMPLETED",
    "COMPLETED",
    "FAILED",
];

export default async function CalendarPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    const userId = user?.id || "";

    const [friends, rawProfileDefaults, tasksResult] = await Promise.all([
        getFriends(),
        supabase
            .from("profiles")
            .select("currency, default_failure_cost_cents, default_voucher_id, default_event_duration_minutes")
            .eq("id", userId)
            .maybeSingle()
            .then((result) => result.data),
        supabase
            .from("tasks")
            .select("*")
            .eq("user_id", userId)
            .in("status", CALENDAR_VISIBLE_STATUSES)
            .order("deadline", { ascending: true }),
    ]);

    const profileDefaults = rawProfileDefaults as {
        currency: string | null;
        default_failure_cost_cents: number | null;
        default_voucher_id: string | null;
        default_event_duration_minutes: number | null;
    } | null;

    const defaultFailureCostEuros = (
        ((profileDefaults?.default_failure_cost_cents ?? DEFAULT_FAILURE_COST_CENTS) / 100)
    ).toFixed(2);
    const defaultEventDurationMinutes =
        Number.isInteger(profileDefaults?.default_event_duration_minutes) &&
        (profileDefaults?.default_event_duration_minutes ?? 0) > 0
            ? (profileDefaults?.default_event_duration_minutes as number)
            : DEFAULT_EVENT_DURATION_MINUTES;
    const defaultVoucherId = (profileDefaults?.default_voucher_id ?? userId) || null;
    const currency = normalizeCurrency(profileDefaults?.currency);
    const tasks = (tasksResult.data as Task[] | null) || [];

    return (
        <CalendarClient
            initialTasks={tasks}
            friends={friends}
            userId={userId}
            defaultFailureCostEuros={defaultFailureCostEuros}
            defaultCurrency={currency}
            defaultVoucherId={defaultVoucherId}
            defaultEventDurationMinutes={defaultEventDurationMinutes}
        />
    );
}
