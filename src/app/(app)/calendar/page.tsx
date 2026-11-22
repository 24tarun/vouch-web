import { createClient } from "@/lib/supabase/server";
import { CalendarClient } from "@/components/calendar/CalendarClient";

export default async function CalendarPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    // Week data loads client-side: week boundaries depend on the viewer's timezone.
    return <CalendarClient userId={user?.id ?? ""} />;
}
