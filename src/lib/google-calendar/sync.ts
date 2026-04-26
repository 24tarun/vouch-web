
import { randomBytes, createCipheriv, createDecipheriv, createHash, randomUUID } from "crypto";
import { tasks as triggerTasks } from "@trigger.dev/sdk/v3";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, GoogleCalendarConnection, GoogleCalendarTaskLink, Task } from "@/lib/types";
import { isGoogleEventColorId } from "@/lib/task-title-event-color";
import { SYSTEM_ACTOR_PROFILE_ID } from "@/lib/system-actor";

const GOOGLE_API_BASE = "https://www.googleapis.com/calendar/v3";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar",
];

const ACTIVE_SYNC_TASK_STATUSES = new Set(["ACTIVE", "POSTPONED", "AWAITING_VOUCHER", "AWAITING_AI", "MARKED_COMPLETE"]);
const RETAINED_SYNC_TASK_STATUSES = new Set([
    ...ACTIVE_SYNC_TASK_STATUSES,
    "ACCEPTED",
    "AUTO_ACCEPTED",
    "AI_ACCEPTED",
    "DENIED",
    "MISSED",
    "RECTIFIED",
    "SETTLED",
]);

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
    colorId?: string;
    summary?: string;
    description?: string;
    updated?: string;
    start?: GoogleCalendarEventDate;
    end?: GoogleCalendarEventDate;
    extendedProperties?: {
        private?: Record<string, string>;
    };
}

interface GoogleConnectionContext {
    connection: GoogleCalendarConnection;
    accessToken: string;
}

interface GoogleCalendarOutboxPayload {
    google_event_id?: string;
    calendar_id?: string;
}

type GoogleSyncTaskSnapshot = Pick<
    Task,
    "id" | "user_id" | "title" | "description" | "deadline" | "status" | "updated_at" | "google_sync_for_task" | "google_event_start_at" | "google_event_end_at" | "google_event_color_id"
>;

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

function parseGoogleRevocationError(raw: string): { error: string | null; errorDescription: string | null } {
    const trimmed = raw.trim();
    if (!trimmed) {
        return { error: null, errorDescription: null };
    }

    try {
        const parsed = JSON.parse(trimmed) as { error?: unknown; error_description?: unknown };
        return {
            error: typeof parsed.error === "string" ? parsed.error : null,
            errorDescription: typeof parsed.error_description === "string" ? parsed.error_description : null,
        };
    } catch {
        const params = new URLSearchParams(trimmed);
        return {
            error: params.get("error"),
            errorDescription: params.get("error_description"),
        };
    }
}

export function shouldTreatGoogleRevocationFailureAsSuccess(status: number, raw: string): boolean {
    if (status !== 400) return false;

    const { error } = parseGoogleRevocationError(raw);
    return error?.toLowerCase() === "invalid_token";
}

export function mapGoogleAuthFailureToReconnectMessage(error: unknown): string | null {
    const status = typeof (error as { status?: unknown } | null)?.status === "number"
        ? (error as { status?: number }).status
        : null;
    const message = error instanceof Error ? error.message.toLowerCase() : "";

    if (status === 401) {
        return "Google Calendar connection expired. Please disconnect and reconnect Google Calendar.";
    }

    if (
        message.includes("invalid_grant") ||
        message.includes("invalid credentials") ||
        message.includes("expired or revoked") ||
        message.includes("google refresh token is missing")
    ) {
        return "Google Calendar connection expired. Please disconnect and reconnect Google Calendar.";
    }

    return null;
}

async function revokeGoogleTokenStrict(token: string): Promise<void> {
    const body = new URLSearchParams({ token });
    const response = await fetch(GOOGLE_OAUTH_REVOKE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
    });

    if (!response.ok) {
        const raw = await response.text();
        if (shouldTreatGoogleRevocationFailureAsSuccess(response.status, raw)) {
            console.warn(
                "[google-sync] token revocation returned invalid_token; treating as already revoked",
                { status: response.status }
            );
            return;
        }
        const detail = raw?.trim();
        throw new Error(
            `Google token revocation failed (${response.status})${detail ? `: ${detail}` : "."}`
        );
    }
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

function getAppBaseUrl(): string {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
    return appUrl || "http://localhost:3000";
}

function buildVouchTaskUrl(taskId: string): string {
    return `${getAppBaseUrl()}/tasks/${taskId}`;
}

function buildGoogleEventDescription(task: Pick<Task, "id" | "description">): string {
    const lines = [
        task.description?.trim() || "",
        `Open in Vouch: ${buildVouchTaskUrl(task.id)}`,
        `Vouch Task ID: ${task.id}`,
    ].filter((line) => line.length > 0);

    return lines.join("\n\n");
}

export function buildGoogleEventPayload(
    task: Pick<Task, "id" | "title" | "description" | "deadline" | "google_event_start_at" | "google_event_end_at" | "google_event_color_id">,
    defaultDurationMinutes: number = 60
): GoogleCalendarEvent {
    const deadlineAsEnd = new Date(task.deadline);
    const explicitStart = task.google_event_start_at ? new Date(task.google_event_start_at) : null;
    const explicitLegacyEnd = task.google_event_end_at ? new Date(task.google_event_end_at) : null;
    const colorId = isGoogleEventColorId(task.google_event_color_id) ? task.google_event_color_id : undefined;
    const hasValidExplicitStart = Boolean(
        explicitStart &&
        !Number.isNaN(explicitStart.getTime()) &&
        !Number.isNaN(deadlineAsEnd.getTime()) &&
        deadlineAsEnd.getTime() > explicitStart.getTime()
    );
    const start = hasValidExplicitStart
        ? (explicitStart as Date)
        : deadlineAsEnd;
    const end = hasValidExplicitStart
        ? deadlineAsEnd
        : Boolean(
            explicitLegacyEnd &&
            !Number.isNaN(explicitLegacyEnd.getTime()) &&
            explicitLegacyEnd.getTime() > start.getTime()
        )
            ? (explicitLegacyEnd as Date)
            : new Date(start.getTime() + defaultDurationMinutes * 60 * 1000);

    return {
        summary: task.title,
        description: buildGoogleEventDescription(task),
        start: {
            dateTime: start.toISOString(),
        },
        end: {
            dateTime: end.toISOString(),
        },
        colorId,
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
    task: Pick<Task, "id" | "title" | "description" | "deadline" | "google_event_start_at" | "google_event_end_at" | "google_event_color_id">,
    existingEventId?: string,
    defaultDurationMinutes: number = 60
): Promise<GoogleCalendarEvent> {
    const payload = buildGoogleEventPayload(task, defaultDurationMinutes);
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
    try {
        await googleFetch<null>(
            url,
            {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            },
            "Could not delete Google Calendar event."
        );
    } catch (error) {
        const status = (error as Error & { status?: number }).status;
        if (status === 404 || status === 410) {
            return;
        }
        throw error;
    }
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
        sync_app_to_google_enabled: false,
        sync_google_to_app_enabled: false,
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

    if (connection) {
        const tokenForRevocation =
            connection.encrypted_refresh_token
                ? decryptSecret(connection.encrypted_refresh_token)
                : connection.encrypted_access_token
                    ? decryptSecret(connection.encrypted_access_token)
                    : null;

        if (!tokenForRevocation) {
            throw new Error("Google token revocation failed: missing stored token.");
        }

        // Strict policy: revocation must succeed before any local integration data is purged.
        await revokeGoogleTokenStrict(tokenForRevocation);

    }

    const { error: outboxError } = await (supabase.from("google_calendar_sync_outbox") as any)
        .delete()
        .eq("user_id", userId as any);
    if (outboxError) {
        throw new Error(`Failed to purge Google Calendar outbox rows: ${outboxError.message}`);
    }

    const { error: linksError } = await (supabase.from("google_calendar_task_links") as any)
        .delete()
        .eq("user_id", userId as any);
    if (linksError) {
        throw new Error(`Failed to purge Google Calendar task links: ${linksError.message}`);
    }

    const { error: connectionError } = await (supabase.from("google_calendar_connections") as any)
        .delete()
        .eq("user_id", userId as any);
    if (connectionError) {
        throw new Error(`Failed to purge Google Calendar connection: ${connectionError.message}`);
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
            last_error: null,
        } as any)
        .eq("user_id", userId as any);

    if (error) {
        throw new Error(error.message);
    }
}

export async function enableGoogleCalendarAppToGoogleForUser(userId: string): Promise<void> {
    const supabase = createAdminClient();
    const connection = await getConnectionByUserId(supabase, userId);

    if (!connection) {
        throw new Error("Google Calendar is not connected.");
    }

    if (!connection.selected_calendar_id) {
        throw new Error("Choose a Google calendar first.");
    }

    const { error } = await (supabase.from("google_calendar_connections") as any)
        .update({
            sync_app_to_google_enabled: true,
            last_error: null,
        } as any)
        .eq("user_id", userId as any);

    if (error) {
        throw new Error(error.message);
    }
}

export async function disableGoogleCalendarAppToGoogleForUser(userId: string): Promise<void> {
    const supabase = createAdminClient();
    const connection = await getConnectionByUserId(supabase, userId);

    if (!connection) return;

    const { error } = await (supabase.from("google_calendar_connections") as any)
        .update({
            sync_app_to_google_enabled: false,
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

    if (!connection || !connection.sync_app_to_google_enabled) {
        return;
    }

    const [taskResult, link] = await Promise.all([
        (supabase.from("tasks") as any)
            .select("id, user_id, google_sync_for_task")
            .eq("id", taskId as any)
            .eq("user_id", userId as any)
            .maybeSingle(),
        getLinkForTask(supabase, taskId),
    ]);
    const task = (taskResult.data as { google_sync_for_task?: boolean } | null) || null;

    const rawPayload = payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    const payloadEventId = typeof rawPayload.google_event_id === "string"
        ? rawPayload.google_event_id
        : undefined;
    const payloadCalendarId = typeof rawPayload.calendar_id === "string"
        ? rawPayload.calendar_id
        : undefined;

    const hasLink = Boolean(link?.google_event_id);
    const taskSyncEnabled = Boolean(task?.google_sync_for_task);
    const hasPayloadEvent = Boolean(payloadEventId);

    if (intent === "UPSERT" && !taskSyncEnabled) {
        return;
    }
    if (intent === "DELETE" && !taskSyncEnabled && !hasLink && !hasPayloadEvent) {
        return;
    }

    const nextPayload: GoogleCalendarOutboxPayload | null = (() => {
        if (intent === "DELETE") {
            const googleEventId = payloadEventId ?? link?.google_event_id ?? undefined;
            const calendarId = payloadCalendarId ?? link?.calendar_id ?? connection.selected_calendar_id ?? undefined;
            return googleEventId || calendarId
                ? {
                    google_event_id: googleEventId,
                    calendar_id: calendarId,
                }
                : null;
        }

        return payloadEventId || payloadCalendarId
            ? {
                google_event_id: payloadEventId,
                calendar_id: payloadCalendarId,
            }
            : null;
    })();

    const { data, error } = await (supabase.from("google_calendar_sync_outbox") as any)
        .insert({
            user_id: userId,
            task_id: (intent === "DELETE" && !task) ? null : taskId,
            intent,
            status: "PENDING",
            next_attempt_at: new Date().toISOString(),
            payload: nextPayload,
        } as any)
        .select("id")
        .single();

    if (error) {
        console.error("Failed to enqueue Google Calendar outbox job:", error);
        return;
    }

    const outboxId = (data as { id: number }).id;

    try {
        await triggerTasks.trigger("google-calendar-dispatch", {
            outboxId,
        });
    } catch (triggerError) {
        console.error("Could not trigger google-calendar-dispatch task:", triggerError);
        // Fallback for environments where Trigger dispatch is unavailable.
        try {
            await processGoogleCalendarOutboxItem(outboxId);
        } catch (fallbackError) {
            console.error("Could not process google-calendar-dispatch fallback:", fallbackError);
        }
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

function parseGoogleCalendarOutboxPayload(payload: unknown): GoogleCalendarOutboxPayload {
    if (!payload || typeof payload !== "object") {
        return {};
    }

    const row = payload as Record<string, unknown>;
    return {
        google_event_id: typeof row.google_event_id === "string" ? row.google_event_id : undefined,
        calendar_id: typeof row.calendar_id === "string" ? row.calendar_id : undefined,
    };
}

function buildGoogleEventKey(calendarId: string, eventId: string): string {
    return `${calendarId}::${eventId}`;
}

function isTaskEligibleForGoogleUpsert(task: GoogleSyncTaskSnapshot | null): task is GoogleSyncTaskSnapshot {
    if (!task) return false;
    if (!task.google_sync_for_task) return false;
    return RETAINED_SYNC_TASK_STATUSES.has(task.status);
}

async function getTaskSnapshotForGoogleSync(
    supabase: SupabaseClient<Database>,
    taskId: string,
    userId: string
): Promise<GoogleSyncTaskSnapshot | null> {
    const { data } = await (supabase.from("tasks") as any)
        .select("id, user_id, title, description, deadline, status, updated_at, google_sync_for_task, google_event_start_at, google_event_end_at, google_event_color_id")
        .eq("id", taskId as any)
        .eq("user_id", userId as any)
        .maybeSingle();

    return (data as GoogleSyncTaskSnapshot | null) || null;
}

async function listPendingDeleteEventKeys(
    supabase: SupabaseClient<Database>,
    userId: string,
    fallbackCalendarId: string | null
): Promise<Set<string>> {
    const { data: rows } = await (supabase.from("google_calendar_sync_outbox") as any)
        .select("payload")
        .eq("user_id", userId as any)
        .eq("intent", "DELETE" as any)
        .in("status", ["PENDING", "PROCESSING", "FAILED"] as any);

    const keys = new Set<string>();
    for (const row of (rows as Array<{ payload: unknown }> | null) || []) {
        const payload = parseGoogleCalendarOutboxPayload(row.payload);
        const eventId = payload.google_event_id;
        const calendarId = payload.calendar_id || fallbackCalendarId;
        if (!eventId || !calendarId) continue;
        keys.add(buildGoogleEventKey(calendarId, eventId));
    }
    return keys;
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
    const { data: claimed } = await (supabase.from("google_calendar_sync_outbox") as any)
        .update({
            status: "PROCESSING",
            attempt_count: attemptCount,
        } as any)
        .eq("id", outboxId as any)
        .in("status", ["PENDING", "FAILED"] as any)
        .select("id")
        .maybeSingle();
    if (!claimed) return;

    try {
        const userId = (outbox as any).user_id as string;
        const taskId = (outbox as any).task_id as string | null;
        const intent = (outbox as any).intent as "UPSERT" | "DELETE";
        const outboxPayload = parseGoogleCalendarOutboxPayload((outbox as any).payload);

        if (!taskId) {
            if (intent === "DELETE" && outboxPayload.google_event_id) {
                const connection = await getConnectionByUserId(supabase, userId);
                if (connection && connection.sync_app_to_google_enabled) {
                    const calendarId = outboxPayload.calendar_id || connection.selected_calendar_id || null;
                    if (calendarId) {
                        const fresh = await ensureFreshGoogleAccessToken(supabase, connection);
                        await googleDeleteEvent(fresh.accessToken, calendarId, outboxPayload.google_event_id);
                    }
                }
            }
            await markOutboxDone(supabase, outboxId);
            return;
        }

        const connection = await getConnectionByUserId(supabase, userId);
        if (!connection || !connection.sync_app_to_google_enabled) {
            await markOutboxDone(supabase, outboxId);
            return;
        }

        const fresh = await ensureFreshGoogleAccessToken(supabase, connection);
        const link = await getLinkForTask(supabase, taskId);
        const task = await getTaskSnapshotForGoogleSync(supabase, taskId, userId);

        const calendarId =
            link?.calendar_id ||
            outboxPayload.calendar_id ||
            connection.selected_calendar_id ||
            null;
        const googleEventId =
            link?.google_event_id ||
            outboxPayload.google_event_id ||
            null;
        const shouldFinalize =
            intent === "DELETE" ||
            !task ||
            !isTaskEligibleForGoogleUpsert(task);
        const shouldDeleteRemoteEvent =
            Boolean(googleEventId && calendarId) &&
            (intent === "DELETE" || !task || !isTaskEligibleForGoogleUpsert(task));

        if (shouldFinalize) {
            if (shouldDeleteRemoteEvent && googleEventId && calendarId) {
                await googleDeleteEvent(fresh.accessToken, calendarId, googleEventId);
            }

            await (supabase.from("google_calendar_task_links") as any)
                .delete()
                .eq("task_id", taskId as any);

            await markOutboxDone(supabase, outboxId);
            return;
        }

        if (!calendarId) {
            throw new Error("Google calendar is not selected.");
        }

        const taskBeforeUpsert = await getTaskSnapshotForGoogleSync(supabase, taskId, userId);
        if (!isTaskEligibleForGoogleUpsert(taskBeforeUpsert)) {
            await (supabase.from("google_calendar_task_links") as any)
                .delete()
                .eq("task_id", taskId as any);
            await markOutboxDone(supabase, outboxId);
            return;
        }

        const event = await googleCreateOrUpdateEvent(
            fresh.accessToken,
            calendarId,
            taskBeforeUpsert,
            googleEventId || undefined,
            Number(connection.default_event_duration_minutes) || 60
        );

        if (!event.id) {
            throw new Error("Google event id missing after upsert.");
        }

        const taskAfterUpsert = await getTaskSnapshotForGoogleSync(supabase, taskId, userId);
        if (!isTaskEligibleForGoogleUpsert(taskAfterUpsert)) {
            console.info(
                `[google-sync] task became ineligible after UPSERT; cleaning up Google event`,
                { userId, taskId, calendarId, googleEventId: event.id }
            );
            try {
                await googleDeleteEvent(fresh.accessToken, calendarId, event.id);
            } catch (cleanupError) {
                await (supabase.from("google_calendar_sync_outbox") as any)
                    .update({
                        intent: "DELETE",
                        task_id: null,
                        payload: {
                            google_event_id: event.id,
                            calendar_id: calendarId,
                        },
                    } as any)
                    .eq("id", outboxId as any);
                throw cleanupError;
            }

            await (supabase.from("google_calendar_task_links") as any)
                .delete()
                .eq("task_id", taskId as any);
            await markOutboxDone(supabase, outboxId);
            return;
        }

        await (supabase.from("google_calendar_task_links") as any)
            .upsert(
                {
                    task_id: taskId,
                    user_id: userId,
                    calendar_id: calendarId,
                    google_event_id: event.id,
                    last_google_etag: event.etag || null,
                    last_google_updated_at: event.updated || null,
                    last_app_updated_at: taskAfterUpsert.updated_at,
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

export async function listCalendarsForUserConnection(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<GoogleCalendarListItem[]> {
    const connection = await getConnectionByUserId(supabase, userId);
    if (!connection) {
        throw new Error("Google Calendar is not connected.");
    }

    try {
        const fresh = await ensureFreshGoogleAccessToken(supabase, connection);
        return listGoogleCalendars(fresh.accessToken);
    } catch (error) {
        const reconnectMessage = mapGoogleAuthFailureToReconnectMessage(error);
        if (reconnectMessage) {
            throw new Error(reconnectMessage);
        }

        throw error;
    }
}

export async function setGoogleCalendarDefaultEventDuration(
    supabase: SupabaseClient<Database>,
    userId: string,
    durationMinutes: number
): Promise<void> {
    const clamped = Math.min(1440, Math.max(5, Math.round(durationMinutes)));
    const { error } = await (supabase.from("google_calendar_connections") as any)
        .update({ default_event_duration_minutes: clamped } as any)
        .eq("user_id", userId as any);
    if (error) throw new Error(error.message);
}
