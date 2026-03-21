import { resend } from "@/lib/resend";
import { sendPushToUser, type PushPayload } from "@/lib/web-push";

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
    pushPayload?: PushPayload;
}

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

    const results: {
        email: unknown;
        push: unknown;
    } = {
        email: null,
        push: null,
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
            results.push = await sendPushToUser(params.userId, pushPayload);
        } catch (error) {
            console.error("Failed to send push:", error);
        }
    }

    return results;
}
