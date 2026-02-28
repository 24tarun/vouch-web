
import { randomBytes, createCipheriv, createDecipheriv, createHash, randomUUID } from "crypto";
import { tasks as triggerTasks } from "@trigger.dev/sdk/v3";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Task, GoogleCalendarConnection, GoogleCalendarTaskLink } from "@/lib/types";

const GOOGLE_API_BASE = "https://www.googleapis.com/calendar/v3";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar",
];

const ACTIVE_SYNC_TASK_STATUSES = new Set(["CREATED", "POSTPONED", "AWAITING_VOUCHER", "MARKED_COMPLETED"]);
const SOFT_DELETEABLE_STATUSES = new Set(["CREATED", "POSTPONED"]);

export interface GoogleCalendarListItem {
    id: string;
    summary: string;
    primary?: boolean;
}

interface GoogleTokenExchangeResult {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token?: string;
}

interface GoogleCalendarEventDate {
    date?: string;
    dateTime?: string;
    timeZone?: string;
}

interface GoogleCalendarEvent {
    id?: string;
    etag?: string;
    status?: string;
    summary?: string;
    description?: string;
    updated?: string;
    start?: GoogleCalendarEventDate;
    end?: GoogleCalendarEventDate;
    extendedProperties?: {
        private?: Record<string, string>;
    };
}

interface GoogleEventDeltaResponse {
    items?: GoogleCalendarEvent[];
    nextPageToken?: string;
    nextSyncToken?: string;
}

interface GoogleWatchResponse {
    id: string;
    resourceId: string;
    expiration?: string;
}

interface GoogleConnectionContext {
    connection: GoogleCalendarConnection;
    accessToken: string;
}

function getRequiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function getEncryptionKey(): Buffer {
    const secret = getRequiredEnv("GOOGLE_TOKEN_ENCRYPTION_KEY");
    return createHash("sha256").update(secret).digest();
}

export function encryptSecret(raw: string): string {
    const key = getEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64")}.${tag.toString("base64")}.${ciphertext.toString("base64")}`;
}

export function decryptSecret(encrypted: string): string {
    const parts = encrypted.split(".");
    if (parts.length !== 3) {
        throw new Error("Encrypted secret has invalid format.");
    }

    const [ivRaw, tagRaw, ciphertextRaw] = parts;
    const iv = Buffer.from(ivRaw, "base64");
    const tag = Buffer.from(tagRaw, "base64");
    const ciphertext = Buffer.from(ciphertextRaw, "base64");
    const key = getEncryptionKey();

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
}

function base64UrlDecode(input: string): string {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return Buffer.from(padded, "base64").toString("utf8");
}

export function extractEmailFromIdToken(idToken: string | undefined): string | null {
    if (!idToken) return null;
    const parts = idToken.split(".");
    if (parts.length < 2) return null;

    try {
        const payload = JSON.parse(base64UrlDecode(parts[1])) as { email?: string };
        return typeof payload.email === "string" ? payload.email : null;
    } catch {
        return null;
    }
}

async function googleFetch<T>(
    input: string,
    init: RequestInit,
    fallbackError: string
): Promise<T> {
    const response = await fetch(input, init);
    const raw = await response.text();
    const parsed = raw ? JSON.parse(raw) : null;

    if (!response.ok) {
        const message = parsed?.error?.message || parsed?.error_description || fallbackError;
        const error = new Error(message) as Error & { status?: number };
        error.status = response.status;
        throw error;
    }

    return parsed as T;
}

export function buildGoogleOAuthUrl(state: string): string {
    const clientId = getRequiredEnv("GOOGLE_OAUTH_CLIENT_ID");
    const redirectUri = getRequiredEnv("GOOGLE_OAUTH_REDIRECT_URI");

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        scope: GOOGLE_SCOPES.join(" "),
        state,
    });

    return `${GOOGLE_OAUTH_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCodeForTokens(code: string): Promise<GoogleTokenExchangeResult> {
    const clientId = getRequiredEnv("GOOGLE_OAUTH_CLIENT_ID");
    const clientSecret = getRequiredEnv("GOOGLE_OAUTH_CLIENT_SECRET");
    const redirectUri = getRequiredEnv("GOOGLE_OAUTH_REDIRECT_URI");

    const body = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
    });

    return googleFetch<GoogleTokenExchangeResult>(
        GOOGLE_OAUTH_TOKEN_URL,
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        },
        "Google OAuth code exchange failed."
    );
}

async function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokenExchangeResult> {
    const clientId = getRequiredEnv("GOOGLE_OAUTH_CLIENT_ID");
    const clientSecret = getRequiredEnv("GOOGLE_OAUTH_CLIENT_SECRET");

    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
    });

    return googleFetch<GoogleTokenExchangeResult>(
        GOOGLE_OAUTH_TOKEN_URL,
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        },
        "Google access token refresh failed."
    );
}

export async function listGoogleCalendars(accessToken: string): Promise<GoogleCalendarListItem[]> {
    const result = await googleFetch<{ items?: GoogleCalendarListItem[] }>(
        `${GOOGLE_API_BASE}/users/me/calendarList`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
        "Could not load Google calendars."
    );

    return (result.items || []).map((calendar) => ({
        id: calendar.id,
        summary: calendar.summary || calendar.id,
        primary: Boolean(calendar.primary),
    }));
}
function getOutboxRetryDelaySeconds(attemptCount: number): number {
    return Math.min(3600, Math.max(30, Math.pow(2, attemptCount) * 30));
}

function parseIsoTimestamp(iso: string | null | undefined): number {
    if (!iso) return 0;
    const timestamp = new Date(iso).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function normalizeGoogleEventTitle(event: GoogleCalendarEvent): string {
    const title = event.summary?.trim();
    return title && title.length > 0 ? title : "Untitled event";
}

function mapGoogleEventToDeadline(event: GoogleCalendarEvent): string | null {
    const start = event.start;
    if (!start) return null;

    if (start.dateTime) {
        const parsed = new Date(start.dateTime);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }

    if (start.date) {
        const dateOnly = start.date.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
        const parsed = new Date(`${dateOnly}T23:59:59`);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }

    return null;
}

function buildGoogleEventPayload(task: Pick<Task, "id" | "title" | "description" | "deadline">): GoogleCalendarEvent {
    const start = new Date(task.deadline);
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    return {
        summary: task.title,
        description: [
            task.description || "",
            "",
            `Vouch Task ID: ${task.id}`,
        ].join("\n").trim(),
        start: {
            dateTime: start.toISOString(),
        },
        end: {
            dateTime: end.toISOString(),
        },
        extendedProperties: {
            private: {
                vouchManaged: "true",
                vouchTaskId: task.id,
                source: "APP",
            },
        },
    };
}

async function googleCreateOrUpdateEvent(
    accessToken: string,
    calendarId: string,
    task: Pick<Task, "id" | "title" | "description" | "deadline">,
    existingEventId?: string
): Promise<GoogleCalendarEvent> {
    const payload = buildGoogleEventPayload(task);
    const url = existingEventId
        ? `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existingEventId)}`
        : `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;

    return googleFetch<GoogleCalendarEvent>(
        url,
        {
            method: existingEventId ? "PATCH" : "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        },
        "Could not upsert Google calendar event."
    );
}

async function googleDeleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
    const url = `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
    const response = await fetch(url, {
        method: "DELETE",
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (response.status === 404 || response.status === 410 || response.ok) {
        return;
    }

    const raw = await response.text();
    let message = "Could not delete Google calendar event.";
    try {
        const parsed = raw ? JSON.parse(raw) : null;
        message = parsed?.error?.message || message;
    } catch {
        // Ignore parse errors and keep fallback message.
    }

    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
}

async function listGoogleEventDelta(
    accessToken: string,
    calendarId: string,
    syncToken: string
): Promise<GoogleEventDeltaResponse> {
    const params = new URLSearchParams({
        showDeleted: "true",
        maxResults: "2500",
        syncToken,
    });

    return googleFetch<GoogleEventDeltaResponse>(
        `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
        "Could not fetch Google Calendar delta events."
    );
}

async function initializeGoogleSyncToken(accessToken: string, calendarId: string): Promise<string | null> {
    const params = new URLSearchParams({
        showDeleted: "true",
        maxResults: "2500",
        updatedMin: new Date().toISOString(),
    });

    const response = await googleFetch<GoogleEventDeltaResponse>(
        `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
        "Could not initialize Google sync token."
    );

    return response.nextSyncToken || null;
}

async function createGoogleCalendarWatch(
    accessToken: string,
    calendarId: string,
    channelId: string
): Promise<GoogleWatchResponse> {
    const webhookUrl = getRequiredEnv("GOOGLE_CALENDAR_WEBHOOK_URL");
    const channelToken = getRequiredEnv("GOOGLE_WEBHOOK_CHANNEL_TOKEN_SECRET");

    return googleFetch<GoogleWatchResponse>(
        `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/watch`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                id: channelId,
                type: "web_hook",
                address: webhookUrl,
                token: channelToken,
            }),
        },
        "Could not start Google Calendar watch channel."
    );
}

async function stopGoogleCalendarWatch(
    accessToken: string,
    channelId: string,
    resourceId: string
): Promise<void> {
    await fetch("https://www.googleapis.com/calendar/v3/channels/stop", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            id: channelId,
            resourceId,
        }),
    });
}

async function getConnectionByUserId(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<GoogleCalendarConnection | null> {
    const { data } = await (supabase.from("google_calendar_connections") as any)
        .select("*")
        .eq("user_id", userId as any)
        .maybeSingle();

    return (data as GoogleCalendarConnection | null) || null;
}

async function ensureValidDefaultVoucherId(
    supabase: SupabaseClient<Database>,
    userId: string,
    defaultVoucherId: string | null
): Promise<string> {
    if (!defaultVoucherId || defaultVoucherId === userId) {
        return userId;
    }

    const { data: friendship } = await (supabase.from("friendships") as any)
        .select("id")
        .eq("user_id", userId as any)
        .eq("friend_id", defaultVoucherId as any)
        .maybeSingle();

    return friendship ? defaultVoucherId : userId;
}

export async function ensureFreshGoogleAccessToken(
    supabase: SupabaseClient<Database>,
    connection: GoogleCalendarConnection
): Promise<GoogleConnectionContext> {
    if (!connection.encrypted_refresh_token) {
        throw new Error("Google refresh token is missing. Please reconnect Google Calendar.");
    }

    const now = Date.now();
    const expiresAtMs = parseIsoTimestamp(connection.token_expires_at);
    const hasFreshAccessToken =
        connection.encrypted_access_token &&
        expiresAtMs > now + 60 * 1000;

    if (hasFreshAccessToken) {
        return {
            connection,
            accessToken: decryptSecret(connection.encrypted_access_token as string),
        };
    }

    const refreshToken = decryptSecret(connection.encrypted_refresh_token);
    const refreshed = await refreshGoogleAccessToken(refreshToken);
    const nextAccessToken = refreshed.access_token;
    const nextRefreshToken = refreshed.refresh_token || refreshToken;

    const updatedRow = {
        encrypted_access_token: encryptSecret(nextAccessToken),
        encrypted_refresh_token: encryptSecret(nextRefreshToken),
        token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        last_error: null,
    };

    const { data, error } = await (supabase.from("google_calendar_connections") as any)
        .update(updatedRow as any)
        .eq("user_id", connection.user_id as any)
        .select("*")
        .single();

    if (error) {
        throw new Error(error.message);
    }

    return {
        connection: data as GoogleCalendarConnection,
        accessToken: nextAccessToken,
    };
}
export async function upsertGoogleConnectionTokens(
    supabase: SupabaseClient<Database>,
    userId: string,
    tokens: GoogleTokenExchangeResult,
    accountEmail: string | null
): Promise<void> {
    const existing = await getConnectionByUserId(supabase, userId);
    const encryptedRefreshToken =
        tokens.refresh_token
            ? encryptSecret(tokens.refresh_token)
            : (existing?.encrypted_refresh_token || null);

    const row = {
        user_id: userId,
        sync_enabled: false,
        google_account_email: accountEmail,
        encrypted_access_token: encryptSecret(tokens.access_token),
        encrypted_refresh_token: encryptedRefreshToken,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        last_error: null,
    };

    const { error } = await (supabase.from("google_calendar_connections") as any)
        .upsert(row as any, { onConflict: "user_id" });

    if (error) {
        throw new Error(error.message);
    }
}

export async function disconnectGoogleCalendarForUser(userId: string): Promise<void> {
    const supabase = createAdminClient();
    const connection = await getConnectionByUserId(supabase, userId);

    if (!connection) return;

    try {
        if (connection.watch_channel_id && connection.watch_resource_id && connection.encrypted_refresh_token) {
            const fresh = await ensureFreshGoogleAccessToken(supabase, connection);
            await stopGoogleCalendarWatch(fresh.accessToken, connection.watch_channel_id, connection.watch_resource_id);
        }
    } catch (error) {
        console.error("Could not stop Google watch during disconnect:", error);
    }

    const { error } = await (supabase.from("google_calendar_connections") as any)
        .delete()
        .eq("user_id", userId as any);

    if (error) {
        throw new Error(error.message);
    }
}

export async function setGoogleCalendarSelection(
    supabase: SupabaseClient<Database>,
    userId: string,
    calendarId: string,
    summary: string
): Promise<void> {
    const { error } = await (supabase.from("google_calendar_connections") as any)
        .update({
            selected_calendar_id: calendarId,
            selected_calendar_summary: summary,
            sync_token: null,
            last_error: null,
        } as any)
        .eq("user_id", userId as any);

    if (error) {
        throw new Error(error.message);
    }
}

export async function enableGoogleCalendarSyncForUser(userId: string): Promise<void> {
    const supabase = createAdminClient();
    const connection = await getConnectionByUserId(supabase, userId);

    if (!connection) {
        throw new Error("Google Calendar is not connected.");
    }

    if (!connection.selected_calendar_id) {
        throw new Error("Choose a Google calendar first.");
    }

    const fresh = await ensureFreshGoogleAccessToken(supabase, connection);
    let syncToken = connection.sync_token;
    if (!syncToken) {
        syncToken = await initializeGoogleSyncToken(fresh.accessToken, connection.selected_calendar_id);
    }

    if (connection.watch_channel_id && connection.watch_resource_id) {
        try {
            await stopGoogleCalendarWatch(fresh.accessToken, connection.watch_channel_id, connection.watch_resource_id);
        } catch (error) {
            console.error("Could not stop previous watch channel:", error);
        }
    }

    const watch = await createGoogleCalendarWatch(
        fresh.accessToken,
        connection.selected_calendar_id,
        randomUUID()
    );

    const { error } = await (supabase.from("google_calendar_connections") as any)
        .update({
            sync_enabled: true,
            watch_channel_id: watch.id,
            watch_resource_id: watch.resourceId,
            watch_expires_at: watch.expiration ? new Date(Number(watch.expiration)).toISOString() : null,
            sync_token: syncToken,
            last_error: null,
        } as any)
        .eq("user_id", userId as any);

    if (error) {
        throw new Error(error.message);
    }

    // Run one immediate delta pass so connection health is visible right away
    // and we don't wait for the first webhook/cron cycle.
    await processGoogleCalendarDeltaForUser(userId);
}

export async function disableGoogleCalendarSyncForUser(userId: string): Promise<void> {
    const supabase = createAdminClient();
    const connection = await getConnectionByUserId(supabase, userId);

    if (!connection) return;

    try {
        if (connection.watch_channel_id && connection.watch_resource_id) {
            const fresh = await ensureFreshGoogleAccessToken(supabase, connection);
            await stopGoogleCalendarWatch(fresh.accessToken, connection.watch_channel_id, connection.watch_resource_id);
        }
    } catch (error) {
        console.error("Could not stop watch channel during disable:", error);
    }

    const { error } = await (supabase.from("google_calendar_connections") as any)
        .update({
            sync_enabled: false,
            watch_channel_id: null,
            watch_resource_id: null,
            watch_expires_at: null,
            last_error: null,
        } as any)
        .eq("user_id", userId as any);

    if (error) {
        throw new Error(error.message);
    }
}

export async function enqueueGoogleCalendarOutbox(
    userId: string,
    taskId: string,
    intent: "UPSERT" | "DELETE",
    payload?: Record<string, unknown>
): Promise<void> {
    const supabase = createAdminClient();
    const connection = await getConnectionByUserId(supabase, userId);

    if (!connection || !connection.sync_enabled || !connection.selected_calendar_id) {
        return;
    }

    const { data, error } = await (supabase.from("google_calendar_sync_outbox") as any)
        .insert({
            user_id: userId,
            task_id: taskId,
            intent,
            status: "PENDING",
            next_attempt_at: new Date().toISOString(),
            payload: payload ?? null,
        } as any)
        .select("id")
        .single();

    if (error) {
        console.error("Failed to enqueue Google Calendar outbox job:", error);
        return;
    }

    try {
        await triggerTasks.trigger("google-calendar-dispatch", {
            outboxId: (data as { id: number }).id,
        });
    } catch (triggerError) {
        console.error("Could not trigger google-calendar-dispatch task:", triggerError);
    }
}

async function markOutboxDone(supabase: SupabaseClient<Database>, outboxId: number) {
    await (supabase.from("google_calendar_sync_outbox") as any)
        .update({
            status: "DONE",
            last_error: null,
            next_attempt_at: new Date().toISOString(),
        } as any)
        .eq("id", outboxId as any);
}

async function markOutboxFailed(
    supabase: SupabaseClient<Database>,
    outboxId: number,
    attemptCount: number,
    errorMessage: string
) {
    const delaySeconds = getOutboxRetryDelaySeconds(attemptCount);
    const nextAttempt = new Date(Date.now() + delaySeconds * 1000).toISOString();

    await (supabase.from("google_calendar_sync_outbox") as any)
        .update({
            status: "FAILED",
            next_attempt_at: nextAttempt,
            last_error: errorMessage,
        } as any)
        .eq("id", outboxId as any);
}

async function getLinkForTask(
    supabase: SupabaseClient<Database>,
    taskId: string
): Promise<GoogleCalendarTaskLink | null> {
    const { data } = await (supabase.from("google_calendar_task_links") as any)
        .select("*")
        .eq("task_id", taskId as any)
        .maybeSingle();

    return (data as GoogleCalendarTaskLink | null) || null;
}
export async function processGoogleCalendarOutboxItem(outboxId: number): Promise<void> {
    const supabase = createAdminClient();

    const { data: outbox, error: outboxError } = await (supabase.from("google_calendar_sync_outbox") as any)
        .select("*")
        .eq("id", outboxId as any)
        .maybeSingle();

    if (outboxError || !outbox) {
        return;
    }

    if ((outbox as any).status === "DONE") {
        return;
    }

    const attemptCount = Number((outbox as any).attempt_count || 0) + 1;
    await (supabase.from("google_calendar_sync_outbox") as any)
        .update({
            status: "PROCESSING",
            attempt_count: attemptCount,
        } as any)
        .eq("id", outboxId as any);

    try {
        const userId = (outbox as any).user_id as string;
        const taskId = (outbox as any).task_id as string | null;
        const intent = (outbox as any).intent as "UPSERT" | "DELETE";

        if (!taskId) {
            await markOutboxDone(supabase, outboxId);
            return;
        }

        const connection = await getConnectionByUserId(supabase, userId);
        if (!connection || !connection.sync_enabled || !connection.selected_calendar_id) {
            await markOutboxDone(supabase, outboxId);
            return;
        }

        const fresh = await ensureFreshGoogleAccessToken(supabase, connection);
        const link = await getLinkForTask(supabase, taskId);

        const { data: task } = await (supabase.from("tasks") as any)
            .select("id, user_id, title, description, deadline, status, updated_at")
            .eq("id", taskId as any)
            .maybeSingle();

        const isDelete =
            intent === "DELETE" ||
            !task ||
            !ACTIVE_SYNC_TASK_STATUSES.has((task as any).status);

        if (isDelete) {
            if (link?.google_event_id) {
                await googleDeleteEvent(fresh.accessToken, connection.selected_calendar_id, link.google_event_id);
            }

            await (supabase.from("google_calendar_task_links") as any)
                .delete()
                .eq("task_id", taskId as any);

            await markOutboxDone(supabase, outboxId);
            return;
        }

        const event = await googleCreateOrUpdateEvent(
            fresh.accessToken,
            connection.selected_calendar_id,
            task as Pick<Task, "id" | "title" | "description" | "deadline">,
            link?.google_event_id
        );

        if (!event.id) {
            throw new Error("Google event id missing after upsert.");
        }

        await (supabase.from("google_calendar_task_links") as any)
            .upsert(
                {
                    task_id: taskId,
                    user_id: userId,
                    calendar_id: connection.selected_calendar_id,
                    google_event_id: event.id,
                    last_google_etag: event.etag || null,
                    last_google_updated_at: event.updated || null,
                    last_app_updated_at: (task as any).updated_at,
                    last_origin: "APP",
                },
                {
                    onConflict: "task_id",
                }
            );

        await markOutboxDone(supabase, outboxId);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Google outbox dispatch failed.";
        await markOutboxFailed(supabase, outboxId, attemptCount, message);
    }
}

export async function retryPendingGoogleCalendarOutbox(limit: number = 100): Promise<void> {
    const supabase = createAdminClient();
    const nowIso = new Date().toISOString();

    const { data: rows } = await (supabase.from("google_calendar_sync_outbox") as any)
        .select("id")
        .in("status", ["PENDING", "FAILED"] as any)
        .lte("next_attempt_at", nowIso)
        .order("next_attempt_at", { ascending: true })
        .limit(limit);

    for (const row of (rows as Array<{ id: number }> | null) || []) {
        await processGoogleCalendarOutboxItem(row.id);
    }
}

export async function triggerGoogleCalendarSyncConnection(userId: string, reason: string): Promise<boolean> {
    try {
        await triggerTasks.trigger("google-calendar-sync-connection", { userId, reason });
        return true;
    } catch (error) {
        console.error("Failed to trigger google-calendar-sync-connection:", error);
        return false;
    }
}
export async function processGoogleCalendarDeltaForUser(userId: string): Promise<void> {
    const supabase = createAdminClient();
    const connection = await getConnectionByUserId(supabase, userId);

    if (!connection || !connection.sync_enabled || !connection.selected_calendar_id || !connection.sync_token) {
        return;
    }

    try {
        const fresh = await ensureFreshGoogleAccessToken(supabase, connection);
        const delta = await listGoogleEventDelta(
            fresh.accessToken,
            connection.selected_calendar_id,
            connection.sync_token
        );

        const { data: profile } = await (supabase.from("profiles") as any)
            .select("default_voucher_id, default_failure_cost_cents")
            .eq("id", userId as any)
            .maybeSingle();

        const defaultFailureCostCents = Number((profile as any)?.default_failure_cost_cents || 50);
        const voucherId = await ensureValidDefaultVoucherId(
            supabase,
            userId,
            ((profile as any)?.default_voucher_id as string | null) || null
        );

        for (const event of delta.items || []) {
            if (!event.id) continue;

            const { data: link } = await (supabase.from("google_calendar_task_links") as any)
                .select("*")
                .eq("user_id", userId as any)
                .eq("calendar_id", connection.selected_calendar_id as any)
                .eq("google_event_id", event.id as any)
                .maybeSingle();

            const existingLink = (link as GoogleCalendarTaskLink | null) || null;

            if (event.status === "cancelled") {
                if (existingLink?.task_id) {
                    const { data: task } = await (supabase.from("tasks") as any)
                        .select("id, status")
                        .eq("id", existingLink.task_id as any)
                        .eq("user_id", userId as any)
                        .maybeSingle();

                    if (task && SOFT_DELETEABLE_STATUSES.has((task as any).status)) {
                        await (supabase.from("tasks") as any)
                            .update({
                                status: "DELETED",
                                updated_at: new Date().toISOString(),
                            } as any)
                            .eq("id", existingLink.task_id as any)
                            .eq("user_id", userId as any);
                    }

                    await (supabase.from("google_calendar_task_links") as any)
                        .delete()
                        .eq("task_id", existingLink.task_id as any);
                }
                continue;
            }

            const deadlineIso = mapGoogleEventToDeadline(event);
            if (!deadlineIso) {
                continue;
            }

            const googleUpdatedTs = parseIsoTimestamp(event.updated);

            if (existingLink?.task_id) {
                const { data: task } = await (supabase.from("tasks") as any)
                    .select("id, user_id, status, title, description, deadline, updated_at")
                    .eq("id", existingLink.task_id as any)
                    .eq("user_id", userId as any)
                    .maybeSingle();

                if (!task) {
                    await (supabase.from("google_calendar_task_links") as any)
                        .delete()
                        .eq("task_id", existingLink.task_id as any);
                    continue;
                }

                const taskUpdatedTs = parseIsoTimestamp((task as any).updated_at as string);
                if (taskUpdatedTs > googleUpdatedTs && existingLink.last_origin === "APP") {
                    continue;
                }

                if (!SOFT_DELETEABLE_STATUSES.has((task as any).status) && !ACTIVE_SYNC_TASK_STATUSES.has((task as any).status)) {
                    continue;
                }

                await (supabase.from("tasks") as any)
                    .update({
                        title: normalizeGoogleEventTitle(event),
                        description: event.description || null,
                        deadline: deadlineIso,
                        status: SOFT_DELETEABLE_STATUSES.has((task as any).status) ? (task as any).status : "CREATED",
                        updated_at: new Date().toISOString(),
                    } as any)
                    .eq("id", existingLink.task_id as any)
                    .eq("user_id", userId as any);

                await (supabase.from("google_calendar_task_links") as any)
                    .update({
                        last_google_etag: event.etag || null,
                        last_google_updated_at: event.updated || null,
                        last_origin: "GOOGLE",
                    } as any)
                    .eq("task_id", existingLink.task_id as any);

                continue;
            }

            const nowIso = new Date().toISOString();
            const { data: insertedTask, error: insertTaskError } = await (supabase.from("tasks") as any)
                .insert({
                    user_id: userId,
                    voucher_id: voucherId,
                    title: normalizeGoogleEventTitle(event),
                    description: event.description || null,
                    failure_cost_cents: defaultFailureCostCents,
                    deadline: deadlineIso,
                    status: "CREATED",
                    postponed_at: null,
                    marked_completed_at: null,
                    voucher_response_deadline: null,
                    recurrence_rule_id: null,
                    required_pomo_minutes: null,
                    proof_request_open: false,
                    proof_requested_at: null,
                    proof_requested_by: null,
                    created_at: nowIso,
                    updated_at: nowIso,
                } as any)
                .select("id, status")
                .single();

            if (insertTaskError || !insertedTask?.id) {
                console.error("Failed to import Google event into task:", insertTaskError);
                continue;
            }

            await (supabase.from("task_events") as any).insert({
                task_id: insertedTask.id,
                event_type: "CREATED",
                actor_id: null,
                from_status: "CREATED",
                to_status: "CREATED",
                metadata: {
                    source: "google_calendar",
                    google_event_id: event.id,
                },
            });

            await (supabase.from("google_calendar_task_links") as any).insert({
                task_id: insertedTask.id,
                user_id: userId,
                calendar_id: connection.selected_calendar_id,
                google_event_id: event.id,
                last_google_etag: event.etag || null,
                last_google_updated_at: event.updated || null,
                last_app_updated_at: nowIso,
                last_origin: "GOOGLE",
            } as any);
        }

        await (supabase.from("google_calendar_connections") as any)
            .update({
                sync_token: delta.nextSyncToken || connection.sync_token,
                last_sync_at: new Date().toISOString(),
                last_error: null,
            } as any)
            .eq("user_id", userId as any);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Google Calendar delta sync failed.";
        await (supabase.from("google_calendar_connections") as any)
            .update({
                last_error: message,
            } as any)
            .eq("user_id", userId as any);

        const status = (error as Error & { status?: number }).status;
        if (status === 410) {
            const connectionRefetch = await getConnectionByUserId(supabase, userId);
            if (connectionRefetch?.selected_calendar_id) {
                const fresh = await ensureFreshGoogleAccessToken(supabase, connectionRefetch);
                const nextSyncToken = await initializeGoogleSyncToken(fresh.accessToken, connectionRefetch.selected_calendar_id);
                await (supabase.from("google_calendar_connections") as any)
                    .update({
                        sync_token: nextSyncToken,
                        last_error: null,
                    } as any)
                    .eq("user_id", userId as any);
            }
        }
    }
}
export async function renewExpiringGoogleCalendarWatches(): Promise<void> {
    const supabase = createAdminClient();
    const thresholdIso = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

    const { data: rows } = await (supabase.from("google_calendar_connections") as any)
        .select("*")
        .eq("sync_enabled", true as any)
        .not("selected_calendar_id", "is", null as any)
        .or(`watch_expires_at.is.null,watch_expires_at.lte.${thresholdIso}`);

    for (const row of (rows as GoogleCalendarConnection[] | null) || []) {
        try {
            const fresh = await ensureFreshGoogleAccessToken(supabase, row);
            if (row.watch_channel_id && row.watch_resource_id) {
                try {
                    await stopGoogleCalendarWatch(fresh.accessToken, row.watch_channel_id, row.watch_resource_id);
                } catch (error) {
                    console.error("Failed to stop existing watch during renew:", error);
                }
            }

            const watch = await createGoogleCalendarWatch(
                fresh.accessToken,
                row.selected_calendar_id as string,
                randomUUID()
            );

            await (supabase.from("google_calendar_connections") as any)
                .update({
                    watch_channel_id: watch.id,
                    watch_resource_id: watch.resourceId,
                    watch_expires_at: watch.expiration ? new Date(Number(watch.expiration)).toISOString() : null,
                    last_error: null,
                } as any)
                .eq("user_id", row.user_id as any);
        } catch (error) {
            console.error(`Failed renewing Google watch for user ${row.user_id}:`, error);
            await (supabase.from("google_calendar_connections") as any)
                .update({
                    last_error: error instanceof Error ? error.message : "Watch renew failed.",
                } as any)
                .eq("user_id", row.user_id as any);
        }
    }
}

export async function reconcileStaleGoogleCalendarConnections(): Promise<void> {
    const supabase = createAdminClient();
    const staleBeforeIso = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    const { data: rows } = await (supabase.from("google_calendar_connections") as any)
        .select("user_id")
        .eq("sync_enabled", true as any)
        .not("selected_calendar_id", "is", null as any)
        .not("sync_token", "is", null as any)
        .or(`last_webhook_at.is.null,last_webhook_at.lt.${staleBeforeIso}`)
        .limit(200);

    for (const row of (rows as Array<{ user_id: string }> | null) || []) {
        await processGoogleCalendarDeltaForUser(row.user_id);
    }
}

export async function findUserIdByWatchChannel(channelId: string, resourceId: string | null): Promise<string | null> {
    const supabase = createAdminClient();
    const query = (supabase.from("google_calendar_connections") as any)
        .select("user_id, watch_resource_id")
        .eq("watch_channel_id", channelId as any)
        .eq("sync_enabled", true as any)
        .maybeSingle();

    const { data } = await query;
    if (!data) return null;

    if (resourceId && data.watch_resource_id && data.watch_resource_id !== resourceId) {
        return null;
    }

    return data.user_id as string;
}

export async function touchGoogleWebhookReceipt(userId: string): Promise<void> {
    const supabase = createAdminClient();
    await (supabase.from("google_calendar_connections") as any)
        .update({
            last_webhook_at: new Date().toISOString(),
            last_error: null,
        } as any)
        .eq("user_id", userId as any);
}

export async function listCalendarsForUserConnection(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<GoogleCalendarListItem[]> {
    const connection = await getConnectionByUserId(supabase, userId);
    if (!connection) {
        throw new Error("Google Calendar is not connected.");
    }

    const fresh = await ensureFreshGoogleAccessToken(supabase, connection);
    return listGoogleCalendars(fresh.accessToken);
}
