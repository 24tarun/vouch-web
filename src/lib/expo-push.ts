/**
 * Sends push notifications to all Expo push tokens registered for a user.
 * Each token represents one device (iPhone, iPad, etc.).
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface ExpoPushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  ttlSeconds?: number;
}

export interface ExpoPushSendResult {
  success: boolean;
  total: number;
  delivered: number;
  failed: number;
  skipped?: boolean;
  reason?: string;
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  ttl?: number;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export async function sendExpoPushToUser(
  userId: string,
  payload: ExpoPushPayload
): Promise<ExpoPushSendResult> {
  const ttlSeconds = Number.isFinite(payload.ttlSeconds) && (payload.ttlSeconds as number) > 0
    ? Math.floor(payload.ttlSeconds as number)
    : 30 * 60;

  const supabase = createAdminClient();

  const { data: tokenRows, error } = await supabase
    .from("expo_push_tokens")
    .select("token")
    .eq("user_id", userId);

  const tokenEntries = ((tokenRows as Array<{ token: string }> | null) ?? []);

  if (error || tokenEntries.length === 0) {
    return {
      success: true,
      total: 0,
      delivered: 0,
      failed: 0,
      skipped: true,
      reason: "no_tokens",
    };
  }

  const messages: ExpoMessage[] = tokenEntries.map((row) => ({
    to: row.token,
    title: payload.title,
    body: payload.body,
    data: payload.data,
    sound: payload.sound ?? "default",
    ttl: ttlSeconds,
  }));

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      console.error("Expo push API error:", response.status, await response.text());
      return {
        success: false,
        total: messages.length,
        delivered: 0,
        failed: messages.length,
        reason: `http_${response.status}`,
      };
    }

    const result = await response.json() as { data: ExpoPushTicket[] };
    const tickets = result.data ?? [];

    let delivered = 0;
    let failed = 0;
    const staleTokens: string[] = [];

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      if (ticket.status === "ok") {
        delivered++;
      } else {
        failed++;
        // DeviceNotRegistered means the token is no longer valid — clean it up
        if (ticket.details?.error === "DeviceNotRegistered") {
          staleTokens.push(tokenEntries[i].token);
        }
      }
    }

    // Clean up stale tokens in the background
    if (staleTokens.length > 0) {
      supabase
        .from("expo_push_tokens")
        .delete()
        .in("token", staleTokens)
        .then(() => {
          console.log(`Cleaned up ${staleTokens.length} stale Expo push token(s).`);
        });
    }

    return {
      success: failed === 0,
      total: messages.length,
      delivered,
      failed,
    };
  } catch (err) {
    console.error("Failed to send Expo push notifications:", err);
    return {
      success: false,
      total: messages.length,
      delivered: 0,
      failed: messages.length,
      reason: "network_or_runtime_error",
    };
  }
}
