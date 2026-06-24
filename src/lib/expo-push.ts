/**
 * Sends push notifications to all Expo push tokens registered for a user.
 * Each token represents one device (iPhone, iPad, etc.).
 */

import { createAdminClient } from "@/lib/supabase/admin";

type NotificationSoundKey = "default" | "tone_01" | "tone_02" | "tone_03";

const NOTIFICATION_SOUND_CONFIGS: Record<NotificationSoundKey, {
  soundFileName: "default" | `${string}.wav`;
  androidChannelId: string;
}> = {
  default: {
    soundFileName: "default",
    androidChannelId: "reminder-default-v1",
  },
  tone_01: {
    soundFileName: "notification_tone_01.wav",
    androidChannelId: "reminder-tone-01-v1",
  },
  tone_02: {
    soundFileName: "notification_tone_02.wav",
    androidChannelId: "reminder-tone-02-v1",
  },
  tone_03: {
    soundFileName: "notification_tone_03.wav",
    androidChannelId: "reminder-tone-03-v1",
  },
};

export interface ExpoPushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: string | null;
  channelId?: string | null;
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
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: string | null;
  channelId?: string | null;
  ttl?: number;
  _contentAvailable?: boolean;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

function resolveTtlSeconds(ttlSeconds: number | undefined): number {
  return Number.isFinite(ttlSeconds) && (ttlSeconds as number) > 0
    ? Math.floor(ttlSeconds as number)
    : 30 * 60;
}

function normalizeNotificationSoundKey(value: unknown): NotificationSoundKey {
  return typeof value === "string" && value in NOTIFICATION_SOUND_CONFIGS
    ? value as NotificationSoundKey
    : "default";
}

async function getNotificationSoundKeyForUserAsync(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<NotificationSoundKey> {
  const { data, error } = await supabase
    .from("profiles")
    .select("notification_sound_key")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[expo-push] failed to resolve notification sound key:", error.message);
    return "default";
  }

  return normalizeNotificationSoundKey((data as { notification_sound_key?: unknown } | null)?.notification_sound_key);
}

async function loadDeliveryTokenEntries(userId: string) {
  const supabase = createAdminClient();

  const { data: tokenRows, error } = await supabase
    .from("expo_push_tokens")
    .select("token, user_client_instance_id")
    .eq("user_id", userId);

  const tokenEntries = ((tokenRows as Array<{ token: string; user_client_instance_id: string | null }> | null) ?? []);
  const scopedTokenEntries = tokenEntries.filter((row) => row.user_client_instance_id);
  const deliveryTokenEntries = scopedTokenEntries.length > 0 ? scopedTokenEntries : tokenEntries;

  if (error || deliveryTokenEntries.length === 0) {
    return {
      supabase,
      deliveryTokenEntries: [],
      error,
    };
  }

  return {
    supabase,
    deliveryTokenEntries,
    error: null,
  };
}

async function sendExpoMessages(
  messages: ExpoMessage[],
  deliveryTokenEntries: Array<{ token: string; user_client_instance_id: string | null }>,
  supabase: ReturnType<typeof createAdminClient>
): Promise<ExpoPushSendResult> {
  if (deliveryTokenEntries.length === 0 || messages.length === 0) {
    return {
      success: true,
      total: 0,
      delivered: 0,
      failed: 0,
      skipped: true,
      reason: "no_tokens",
    };
  }

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
          staleTokens.push(deliveryTokenEntries[i].token);
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

export async function sendExpoPushToUser(
  userId: string,
  payload: ExpoPushPayload
): Promise<ExpoPushSendResult> {
  const ttlSeconds = resolveTtlSeconds(payload.ttlSeconds);

  const { supabase, deliveryTokenEntries, error } = await loadDeliveryTokenEntries(userId);

  if (error || deliveryTokenEntries.length === 0) {
    return {
      success: true,
      total: 0,
      delivered: 0,
      failed: 0,
      skipped: true,
      reason: "no_tokens",
    };
  }

  const notificationSoundKey = await getNotificationSoundKeyForUserAsync(supabase, userId);
  const notificationSoundConfig = NOTIFICATION_SOUND_CONFIGS[notificationSoundKey];
  const sound = payload.sound ?? notificationSoundConfig.soundFileName;
  const channelId = payload.channelId ?? notificationSoundConfig.androidChannelId;

  const messages: ExpoMessage[] = deliveryTokenEntries.map((row) => ({
    to: row.token,
    title: payload.title,
    body: payload.body,
    data: payload.data,
    sound,
    channelId,
    ttl: ttlSeconds,
  }));

  return sendExpoMessages(messages, deliveryTokenEntries, supabase);
}

export async function sendExpoDataPushToUser(
  userId: string,
  payload: { data: Record<string, unknown>; ttlSeconds?: number }
): Promise<ExpoPushSendResult> {
  const ttlSeconds = payload.ttlSeconds == null ? 60 : resolveTtlSeconds(payload.ttlSeconds);

  const { supabase, deliveryTokenEntries, error } = await loadDeliveryTokenEntries(userId);

  if (error || deliveryTokenEntries.length === 0) {
    return {
      success: true,
      total: 0,
      delivered: 0,
      failed: 0,
      skipped: true,
      reason: "no_tokens",
    };
  }

  const messages: ExpoMessage[] = deliveryTokenEntries.map((row) => ({
    to: row.token,
    data: payload.data,
    ttl: ttlSeconds,
    _contentAvailable: true,
  }));

  return sendExpoMessages(messages, deliveryTokenEntries, supabase);
}
