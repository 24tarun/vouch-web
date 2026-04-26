import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import webPush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")?.trim();
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")?.trim();
const vapidSubject = Deno.env.get("VAPID_SUBJECT")?.trim();

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Missing Supabase environment variables for proof-request-push.");
}

const adminSupabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const vapidReady = !!(vapidPublicKey && vapidPrivateKey && vapidSubject);
if (vapidReady) {
  webPush.setVapidDetails(vapidSubject!, vapidPublicKey!, vapidPrivateKey!);
}

async function resolveUserId(authHeader: string | null): Promise<string | null> {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return null;
  const { data: { user }, error } = await adminSupabase.auth.getUser(token);
  if (error || !user) return null;
  return user.id;
}

interface ExpoTicket {
  status: "ok" | "error";
  details?: { error?: string };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const actorId = await resolveUserId(request.headers.get("Authorization"));
  if (!actorId) return json({ error: "Not authenticated." }, 401);

  let body: { event?: string; taskId?: string; recipientUserId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  const { taskId, recipientUserId } = body;
  if (!taskId || !recipientUserId) {
    return json({ error: "Missing taskId or recipientUserId." }, 400);
  }

  // Verify caller is the task's voucher and recipient is the task owner
  const { data: task, error: taskError } = await adminSupabase
    .from("tasks")
    .select("id, title, user_id, voucher_id")
    .eq("id", taskId)
    .maybeSingle();

  if (taskError || !task) return json({ error: "Task not found." }, 404);
  if (task.user_id !== recipientUserId) return json({ error: "Recipient mismatch." }, 403);
  if (task.voucher_id !== actorId) return json({ error: "Only the voucher can request proof." }, 403);

  const { data: actorProfile } = await adminSupabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", actorId)
    .maybeSingle();

  const actorName =
    (actorProfile as { display_name?: string; username?: string } | null)?.display_name ||
    (actorProfile as { display_name?: string; username?: string } | null)?.username ||
    "Your voucher";

  const notificationTitle = "Proof requested";
  const notificationBody = `${actorName} has asked for proof for "${task.title}".`;
  const notificationData = { task_id: taskId, kind: "PROOF_REQUESTED" };
  const TTL = 30 * 60;

  const results: {
    expo: Record<string, unknown> | null;
    webPush: Record<string, unknown> | null;
  } = { expo: null, webPush: null };

  // --- Expo Push ---
  const { data: tokenRows } = await adminSupabase
    .from("expo_push_tokens")
    .select("token")
    .eq("user_id", recipientUserId);

  const tokens = ((tokenRows as Array<{ token: string }> | null) ?? []).map((r) => r.token);

  if (tokens.length === 0) {
    results.expo = { success: true, skipped: true, reason: "no_tokens" };
  } else {
    const messages = tokens.map((token) => ({
      to: token,
      title: notificationTitle,
      body: notificationBody,
      data: notificationData,
      sound: "default",
      ttl: TTL,
    }));

    try {
      const expoResponse = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(messages),
      });

      if (!expoResponse.ok) {
        results.expo = {
          success: false,
          total: tokens.length,
          delivered: 0,
          failed: tokens.length,
          reason: `http_${expoResponse.status}`,
        };
      } else {
        const expoResult = (await expoResponse.json()) as { data: ExpoTicket[] };
        const tickets = expoResult.data ?? [];
        let delivered = 0;
        let failed = 0;
        const staleTokens: string[] = [];

        for (let i = 0; i < tickets.length; i++) {
          if (tickets[i].status === "ok") {
            delivered++;
          } else {
            failed++;
            if (tickets[i].details?.error === "DeviceNotRegistered") {
              staleTokens.push(tokens[i]);
            }
          }
        }

        if (staleTokens.length > 0) {
          adminSupabase.from("expo_push_tokens").delete().in("token", staleTokens).then(() => {});
        }

        results.expo = { success: failed === 0, total: tokens.length, delivered, failed };
      }
    } catch (err) {
      results.expo = { success: false, error: String(err) };
    }
  }

  // --- Web Push ---
  if (!vapidReady) {
    results.webPush = { success: false, skipped: true, reason: "vapid_not_configured" };
  } else {
    const { data: recipientProfile } = await adminSupabase
      .from("profiles")
      .select("mobile_notifications_enabled")
      .eq("id", recipientUserId)
      .maybeSingle();

    const notificationsEnabled =
      (recipientProfile as { mobile_notifications_enabled?: boolean } | null)
        ?.mobile_notifications_enabled ?? false;

    if (!notificationsEnabled) {
      results.webPush = { success: true, skipped: true, reason: "disabled_by_user" };
    } else {
      const { data: subRows } = await adminSupabase
        .from("web_push_subscriptions")
        .select("id, subscription")
        .eq("user_id", recipientUserId);

      const subscriptions = (subRows as Array<{ id: string; subscription: unknown }> | null) ?? [];

      if (subscriptions.length === 0) {
        results.webPush = { success: true, skipped: true, reason: "no_subscriptions" };
      } else {
        const payload = JSON.stringify({
          title: notificationTitle,
          body: notificationBody,
          data: notificationData,
          tag: `proof-request-${taskId}`,
        });

        let delivered = 0;
        let failed = 0;
        const staleIds: string[] = [];

        await Promise.allSettled(
          subscriptions.map(async (entry) => {
            try {
              await webPush.sendNotification(entry.subscription as Parameters<typeof webPush.sendNotification>[0], payload, { TTL });
              delivered++;
            } catch (err: unknown) {
              failed++;
              const status =
                (err as { statusCode?: number })?.statusCode ??
                (err as { status?: number })?.status;
              if (status === 404 || status === 410) {
                staleIds.push(entry.id);
              } else {
                console.error("[proof-request-push] web push delivery failed:", err);
              }
            }
          }),
        );

        if (staleIds.length > 0) {
          adminSupabase
            .from("web_push_subscriptions")
            .delete()
            .in("id", staleIds)
            .then(() => {});
        }

        results.webPush = {
          success: failed === 0,
          total: subscriptions.length,
          delivered,
          failed,
        };
      }
    }
  }

  const overallSuccess =
    (results.expo?.success === true) || (results.webPush?.success === true);

  return json({ success: overallSuccess, expo: results.expo, webPush: results.webPush });
});
