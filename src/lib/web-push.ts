import webPush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PushPayload {
    title: string;
    body: string;
    url?: string;
    tag?: string;
    data?: Record<string, unknown>;
    sound?: string;
}

export interface PushSendResult {
    success: boolean;
    total: number;
    delivered: number;
    failed: number;
    cleaned: number;
    skipped?: boolean;
    reason?: string;
}

let vapidConfigured = false;
function configureVapid(): { ok: boolean; reason?: string } {
    if (vapidConfigured) {
        return { ok: true };
    }

    const subject = process.env.VAPID_SUBJECT;
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (!subject || !publicKey || !privateKey) {
        return {
            ok: false,
            reason: "Missing VAPID_SUBJECT / NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.",
        };
    }

    webPush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
    return { ok: true };
}

function extractStatusCode(error: unknown): number | null {
    if (!error || typeof error !== "object") return null;
    const maybeStatus = (error as { statusCode?: number; status?: number }).statusCode
        ?? (error as { statusCode?: number; status?: number }).status;
    return typeof maybeStatus === "number" ? maybeStatus : null;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<PushSendResult> {
    const vapid = configureVapid();
    if (!vapid.ok) {
        console.warn("[web-push] Skipping push:", vapid.reason);
        return {
            success: false,
            total: 0,
            delivered: 0,
            failed: 0,
            cleaned: 0,
            skipped: true,
            reason: vapid.reason,
        };
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
        .from("web_push_subscriptions")
        .select("id, subscription")
        .eq("user_id", userId);

    if (error) {
        console.error("[web-push] Failed to load subscriptions:", error);
        return {
            success: false,
            total: 0,
            delivered: 0,
            failed: 0,
            cleaned: 0,
            reason: error.message,
        };
    }

    const subscriptions = (data as Array<{ id: string; subscription: unknown }>) || [];
    if (subscriptions.length === 0) {
        return {
            success: true,
            total: 0,
            delivered: 0,
            failed: 0,
            cleaned: 0,
            skipped: true,
            reason: "no_subscriptions",
        };
    }

    const message = JSON.stringify(payload);
    const staleIds: string[] = [];
    let delivered = 0;
    let failed = 0;

    const settled = await Promise.allSettled(
        subscriptions.map(async (entry) => {
            try {
                await webPush.sendNotification(entry.subscription, message);
                delivered += 1;
            } catch (pushError) {
                failed += 1;
                const statusCode = extractStatusCode(pushError);
                if (statusCode === 404 || statusCode === 410) {
                    staleIds.push(entry.id);
                } else {
                    console.error("[web-push] delivery failed:", pushError);
                }
            }
        })
    );

    // Avoid unused warning for settled when running stricter lint variants.
    void settled;

    let cleaned = 0;
    if (staleIds.length > 0) {
        const { error: cleanupError } = await supabase
            .from("web_push_subscriptions")
            .delete()
            .in("id", staleIds);

        if (cleanupError) {
            console.error("[web-push] Failed to clean stale subscriptions:", cleanupError);
        } else {
            cleaned = staleIds.length;
        }
    }

    const result: PushSendResult = {
        success: failed === 0,
        total: subscriptions.length,
        delivered,
        failed,
        cleaned,
    };

    console.log(
        `[web-push] user=${userId} total=${result.total} delivered=${result.delivered} failed=${result.failed} cleaned=${result.cleaned}`
    );

    return result;
}
