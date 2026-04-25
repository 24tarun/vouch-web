"use server";

import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { GOOGLE_OAUTH_STATE_COOKIE } from "@/lib/google-calendar/constants";
import {
    buildGoogleOAuthUrl,
    disableGoogleCalendarAppToGoogleForUser,
    disableGoogleCalendarGoogleToAppForUser,
    disconnectGoogleCalendarForUser,
    enableGoogleCalendarAppToGoogleForUser,
    enableGoogleCalendarGoogleToAppForUser,
    listCalendarsForUserConnection,
    setGoogleCalendarDefaultEventDuration,
    setGoogleCalendarImportTaggedOnlyForUser,
    setGoogleCalendarSelection,
} from "@/lib/google-calendar/sync";

export interface GoogleCalendarIntegrationState {
    connected: boolean;
    syncAppToGoogleEnabled: boolean;
    syncGoogleToAppEnabled: boolean;
    importOnlyTaggedGoogleEvents: boolean;
    accountEmail: string | null;
    selectedCalendarId: string | null;
    selectedCalendarSummary: string | null;
    watchExpiresAt: string | null;
    lastSyncAt: string | null;
    lastError: string | null;
    defaultEventDurationMinutes: number;
    defaultEventColorId: string;
}

async function getAuthenticatedUserId(): Promise<string> {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        throw new Error("Not authenticated");
    }

    return user.id;
}

export async function startGoogleCalendarConnect() {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
        return { error: "Not authenticated" };
    }

    const state = randomUUID();
    const cookieStore = await cookies();
    cookieStore.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 10,
    });

    return { url: buildGoogleOAuthUrl(state) };
}

export async function getGoogleCalendarIntegrationState(): Promise<GoogleCalendarIntegrationState> {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return {
            connected: false,
            syncAppToGoogleEnabled: false,
            syncGoogleToAppEnabled: false,
            importOnlyTaggedGoogleEvents: false,
            accountEmail: null,
            selectedCalendarId: null,
            selectedCalendarSummary: null,
            watchExpiresAt: null,
            lastSyncAt: null,
            lastError: null,
            defaultEventDurationMinutes: 60,
            defaultEventColorId: "9",
        };
    }

    const { data } = await (supabase.from("google_calendar_connections") as any)
        .select("*")
        .eq("user_id", user.id as any)
        .maybeSingle();

    if (!data) {
        return {
            connected: false,
            syncAppToGoogleEnabled: false,
            syncGoogleToAppEnabled: false,
            importOnlyTaggedGoogleEvents: false,
            accountEmail: null,
            selectedCalendarId: null,
            selectedCalendarSummary: null,
            watchExpiresAt: null,
            lastSyncAt: null,
            lastError: null,
            defaultEventDurationMinutes: 60,
            defaultEventColorId: "9",
        };
    }

    return {
        connected: Boolean(data.encrypted_refresh_token),
        syncAppToGoogleEnabled: Boolean(data.sync_app_to_google_enabled),
        syncGoogleToAppEnabled: Boolean(data.sync_google_to_app_enabled),
        importOnlyTaggedGoogleEvents: Boolean(data.import_only_tagged_google_events),
        accountEmail: (data.google_account_email as string | null) || null,
        selectedCalendarId: (data.selected_calendar_id as string | null) || null,
        selectedCalendarSummary: (data.selected_calendar_summary as string | null) || null,
        watchExpiresAt: (data.watch_expires_at as string | null) || null,
        lastSyncAt: (data.last_sync_at as string | null) || null,
        lastError: (data.last_error as string | null) || null,
        defaultEventDurationMinutes: Number(data.default_event_duration_minutes) || 60,
        defaultEventColorId: (data.default_event_color_id as string | null) || "9",
    };
}

export async function listGoogleCalendarsForSettings() {
    const supabase = await createClient();
    const userId = await getAuthenticatedUserId();

    try {
        const calendars = await listCalendarsForUserConnection(supabase, userId);
        return { calendars };
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : "Could not load Google calendars.",
            calendars: [] as Array<{ id: string; summary: string; primary?: boolean }>,
        };
    }
}

export async function setGoogleCalendarCalendar(calendarId: string) {
    const supabase = await createClient();
    const userId = await getAuthenticatedUserId();

    const currentState = await getGoogleCalendarIntegrationState();
    const calendars = await listCalendarsForUserConnection(supabase, userId);
    const selected = calendars.find((calendar) => calendar.id === calendarId);
    if (!selected) {
        return { error: "Selected calendar is not available." };
    }

    await setGoogleCalendarSelection(supabase, userId, selected.id, selected.summary);
    if (currentState.syncGoogleToAppEnabled) {
        await enableGoogleCalendarGoogleToAppForUser(userId);
    }
    return { success: true };
}

export async function setGoogleCalendarAppToGoogleEnabled(enabled: boolean) {
    const userId = await getAuthenticatedUserId();

    try {
        if (enabled) {
            await enableGoogleCalendarAppToGoogleForUser(userId);
        } else {
            await disableGoogleCalendarAppToGoogleForUser(userId);
        }
        return { success: true };
    } catch (error) {
        return { error: error instanceof Error ? error.message : "Unable to update Vouch to Google sync state." };
    }
}

export async function setGoogleCalendarGoogleToAppEnabled(enabled: boolean) {
    const userId = await getAuthenticatedUserId();

    try {
        if (enabled) {
            await enableGoogleCalendarGoogleToAppForUser(userId);
        } else {
            await disableGoogleCalendarGoogleToAppForUser(userId);
        }
        return { success: true };
    } catch (error) {
        return { error: error instanceof Error ? error.message : "Unable to update Google to Vouch sync state." };
    }
}

export async function setGoogleCalendarSyncEnabled(enabled: boolean) {
    const userId = await getAuthenticatedUserId();

    try {
        if (enabled) {
            await enableGoogleCalendarGoogleToAppForUser(userId);
            await enableGoogleCalendarAppToGoogleForUser(userId);
        } else {
            await disableGoogleCalendarAppToGoogleForUser(userId);
            await disableGoogleCalendarGoogleToAppForUser(userId);
        }
        return { success: true };
    } catch (error) {
        return { error: error instanceof Error ? error.message : "Unable to update Google Calendar sync state." };
    }
}

export async function setGoogleCalendarImportTaggedOnly(enabled: boolean) {
    const supabase = await createClient();
    const userId = await getAuthenticatedUserId();

    try {
        await setGoogleCalendarImportTaggedOnlyForUser(supabase, userId, enabled);
        return { success: true };
    } catch (error) {
        return { error: error instanceof Error ? error.message : "Unable to update Google Calendar import filter." };
    }
}

export async function disconnectGoogleCalendar() {
    const userId = await getAuthenticatedUserId();

    try {
        await disconnectGoogleCalendarForUser(userId);
        return { success: true };
    } catch (error) {
        return { error: error instanceof Error ? error.message : "Unable to disconnect Google Calendar." };
    }
}

export async function setGoogleCalendarEventDuration(durationMinutes: number) {
    const supabase = await createClient();
    const userId = await getAuthenticatedUserId();

    try {
        await setGoogleCalendarDefaultEventDuration(supabase, userId, durationMinutes);
        return { success: true };
    } catch (error) {
        return { error: error instanceof Error ? error.message : "Unable to update default event duration." };
    }
}
