import type { SupabaseClient } from "@supabase/supabase-js";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { CalendarClient } from "@/components/calendar/CalendarClient";
import { addLocalDays, startOfWeekMonday } from "@/lib/calendar/grid";
import { loadCalendarRange } from "@/lib/calendar/service";
import type { CalendarWeekData } from "@/lib/calendar/types";

export default async function CalendarPage() {
    const supabase = (await createClient()) as unknown as SupabaseClient;
    const { data: claimsData } = await supabase.auth.getClaims();
    const userId = claimsData?.claims.sub;
    if (!userId) return <CalendarClient userId="" />;

    const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle();
    let initial: { weekStartIso: string; data: CalendarWeekData } | undefined;
    try {
        const timezone = (profile as { timezone?: string | null } | null)?.timezone || "UTC";
        const localMonday = startOfWeekMonday(toZonedTime(new Date(), timezone));
        const weekStart = fromZonedTime(localMonday, timezone);
        const weekEnd = fromZonedTime(addLocalDays(localMonday, 7), timezone);
        const result = await loadCalendarRange(supabase, userId, weekStart.toISOString(), weekEnd.toISOString());
        if (result.data) initial = { weekStartIso: weekStart.toISOString(), data: result.data };
    } catch {
    }

    return <CalendarClient userId={userId} initial={initial} />;
}
