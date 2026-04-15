import { resend } from "@/lib/resend";
import { sendPushToUser, type PushPayload } from "@/lib/web-push";
import { sendExpoPushToUser, type ExpoPushSendResult } from "@/lib/expo-push";
import type { PushSendResult } from "@/lib/web-push";

export type PushChannel = "web" | "expo";

export interface NotificationSendResult {
    email: unknown;
    push: {
        web: PushSendResult | null;
        expo: ExpoPushSendResult | null;
        webError?: string;
        expoError?: string;
    };
}

export interface NotificationParams {
    to?: string;
    userId?: string;
    subject?: string;
    html?: string;
    text?: string;
    title?: string;
    data?: Record<string, unknown>;
    url?: string;
    tag?: string;
    email?: boolean;
    push?: boolean;
    pushChannels?: PushChannel[];
    ttlSeconds?: number;
    pushPayload?: PushPayload;
}

const DEFAULT_NOTIFICATION_TTL_SECONDS = 30 * 60;

function stripHtml(input: string): string {
    return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function resolvePushPayload(params: NotificationParams): PushPayload {
    if (params.pushPayload) {
        return params.pushPayload;
    }

    const fallbackBody =
        params.text ||
        (params.html ? stripHtml(params.html).slice(0, 160) : "Open TAS to view details.");

    return {
        title: params.title || params.subject || "",
        body: fallbackBody,
        url: params.url,
        tag: params.tag,
        data: params.data,
    };
}

/**
 * Unified Notification Bridge.
 * Sends email and push in tandem unless channel flags disable one side.
 */
export async function sendNotification(params: NotificationParams) {
    const shouldSendEmail = params.email !== false;
    const shouldSendPush = params.push !== false;

    const channels = new Set<PushChannel>(
        params.pushChannels && params.pushChannels.length > 0
            ? params.pushChannels
            : ["web", "expo"]
    );

    const results: NotificationSendResult = {
        email: null,
        push: {
            web: null,
            expo: null,
        },
    };

    if (shouldSendEmail) {
        if (resend && params.to && params.html) {
            try {
                results.email = await resend.emails.send({
                    from: "TAS <noreply@remails.tarunh.com>",
                    to: params.to,
                    subject: params.subject ?? "",
                    html: params.html,
                    text: params.text,
                });
            } catch (error) {
                console.error("Failed to send email:", error);
            }
        } else if (!resend) {
            console.warn("Resend client not initialized, skipping email.");
        }
    }

    if (shouldSendPush && params.userId) {
        try {
            const pushPayload = resolvePushPayload(params);
            const ttlSeconds = Number.isFinite(params.ttlSeconds) && (params.ttlSeconds as number) > 0
                ? Math.floor(params.ttlSeconds as number)
                : DEFAULT_NOTIFICATION_TTL_SECONDS;
            const [webPushResult, expoPushResult] = await Promise.allSettled([
                channels.has("web")
                    ? sendPushToUser(params.userId, {
                        ...pushPayload,
                        ttlSeconds,
                    })
                    : Promise.resolve({
                        success: true,
                        total: 0,
                        delivered: 0,
                        failed: 0,
                        skipped: true,
                        reason: "channel_disabled",
                    } as PushSendResult),
                channels.has("expo")
                    ? sendExpoPushToUser(params.userId, {
                        title: pushPayload.title,
                        body: pushPayload.body ?? "",
                        data: pushPayload.data,
                        ttlSeconds,
                    })
                    : Promise.resolve({
                        success: true,
                        total: 0,
                        delivered: 0,
                        failed: 0,
                        skipped: true,
                        reason: "channel_disabled",
                    } as ExpoPushSendResult),
            ]);

            if (webPushResult.status === "fulfilled") {
                results.push.web = webPushResult.value;
            } else {
                results.push.webError = String(webPushResult.reason ?? "unknown_web_push_error");
                console.error("[notifications] web push failed:", webPushResult.reason);
            }

            if (expoPushResult.status === "fulfilled") {
                results.push.expo = expoPushResult.value;
            } else {
                results.push.expoError = String(expoPushResult.reason ?? "unknown_expo_push_error");
                console.error("[notifications] expo push failed:", expoPushResult.reason);
            }
        } catch (error) {
            console.error("Failed to send push:", error);
        }
    }

    return results;
}
