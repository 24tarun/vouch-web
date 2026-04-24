import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
    enableGoogleCalendarAppToGoogleForUser,
    disableGoogleCalendarAppToGoogleForUser,
    enableGoogleCalendarGoogleToAppForUser,
    disableGoogleCalendarGoogleToAppForUser,
    listCalendarsForUserConnection,
    setGoogleCalendarSelection,
    setGoogleCalendarDeadlineSourcePreference,
    setGoogleCalendarDefaultEventDuration,
    disconnectGoogleCalendarForUser,
    setGoogleCalendarImportTaggedOnlyForUser,
    enqueueGoogleCalendarOutbox,
} from "@/lib/google-calendar/sync";

type MobileSyncAction =
    | { type: "toggleAppToGoogle"; enabled: boolean }
    | { type: "toggleGoogleToApp"; enabled: boolean }
    | { type: "setCalendar"; calendarId: string }
    | { type: "setDeadlineSource"; preference: "start" | "end" }
    | { type: "enqueueTask"; taskId: string }
    | { type: "setEventDuration"; durationMinutes: number }
    | { type: "setImportTaggedOnly"; enabled: boolean }
    | { type: "disconnect" }
    | { type: "listCalendars" };

async function resolveUserFromBearer(request: NextRequest): Promise<string | null> {
    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return null;

    const adminSupabase = createAdminClient();
    const { data: { user }, error } = await adminSupabase.auth.getUser(token);
    if (error || !user) return null;
    return user.id;
}

export async function POST(request: NextRequest) {
    const userId = await resolveUserFromBearer(request);
    if (!userId) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Use admin client throughout — Bearer auth means no cookie session exists
    const supabase = createAdminClient();

    let body: MobileSyncAction;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    try {
        switch (body.type) {
            case "toggleAppToGoogle": {
                if (body.enabled) {
                    await enableGoogleCalendarAppToGoogleForUser(userId);
                } else {
                    await disableGoogleCalendarAppToGoogleForUser(userId);
                }
                return NextResponse.json({ success: true });
            }

            case "toggleGoogleToApp": {
                if (body.enabled) {
                    await enableGoogleCalendarGoogleToAppForUser(userId);
                } else {
                    await disableGoogleCalendarGoogleToAppForUser(userId);
                }
                return NextResponse.json({ success: true });
            }

            case "setCalendar": {
                const calendars = await listCalendarsForUserConnection(supabase, userId);
                const selected = calendars.find((c) => c.id === body.calendarId);
                if (!selected) {
                    return NextResponse.json({ error: "Calendar not found" }, { status: 400 });
                }
                await setGoogleCalendarSelection(supabase, userId, selected.id, selected.summary);
                return NextResponse.json({ success: true });
            }

            case "setDeadlineSource": {
                if (body.preference !== "start" && body.preference !== "end") {
                    return NextResponse.json({ error: "Invalid preference" }, { status: 400 });
                }
                await setGoogleCalendarDeadlineSourcePreference(supabase, userId, body.preference);
                return NextResponse.json({ success: true });
            }

            case "setEventDuration": {
                const mins = Number(body.durationMinutes);
                if (!Number.isInteger(mins) || mins < 5 || mins > 1440) {
                    return NextResponse.json({ error: "Duration must be 5–1440 minutes" }, { status: 400 });
                }
                await setGoogleCalendarDefaultEventDuration(supabase, userId, mins);
                return NextResponse.json({ success: true });
            }

            case "setImportTaggedOnly": {
                await setGoogleCalendarImportTaggedOnlyForUser(supabase, userId, body.enabled);
                return NextResponse.json({ success: true });
            }

            case "disconnect": {
                await disconnectGoogleCalendarForUser(userId);
                return NextResponse.json({ success: true });
            }

            case "listCalendars": {
                const calendars = await listCalendarsForUserConnection(supabase, userId);
                return NextResponse.json({ calendars });
            }

            case "enqueueTask": {
                if (!body.taskId || typeof body.taskId !== "string") {
                    return NextResponse.json({ error: "taskId required" }, { status: 400 });
                }
                const { data: taskRow } = await (supabase.from("tasks") as any)
                    .select("id, user_id, google_sync_for_task")
                    .eq("id", body.taskId)
                    .eq("user_id", userId)
                    .maybeSingle();
                if (!taskRow) {
                    return NextResponse.json({ error: "Task not found" }, { status: 404 });
                }
                if (!taskRow.google_sync_for_task) {
                    return NextResponse.json({ success: true });
                }
                await enqueueGoogleCalendarOutbox(userId, body.taskId, "UPSERT");
                return NextResponse.json({ success: true });
            }

            default:
                return NextResponse.json({ error: "Unknown action" }, { status: 400 });
        }
    } catch (err) {
        console.error("[mobile-sync] action failed:", body, err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Action failed" },
            { status: 500 }
        );
    }
}
