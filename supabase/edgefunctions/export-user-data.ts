import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { Resend } from "npm:resend@4.1.2";

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
const resendApiKey = Deno.env.get("RESEND_API_KEY")?.trim();

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Missing Supabase environment variables.");
}
if (!resendApiKey) {
  throw new Error("Missing RESEND_API_KEY.");
}

const adminSupabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const resend = new Resend(resendApiKey);

const COOLDOWN_HOURS = 24;
const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;

async function resolveUserId(authHeader: string | null): Promise<string | null> {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return null;
  const { data: { user }, error } = await adminSupabase.auth.getUser(token);
  if (error || !user) return null;
  return user.id;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const userId = await resolveUserId(request.headers.get("Authorization"));
  if (!userId) return json({ error: "Not authenticated." }, 401);

  // Rate limit: check last export
  const { data: lastExport } = await adminSupabase
    .from("data_exports")
    .select("created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastExport) {
    const lastExportTime = new Date(lastExport.created_at).getTime();
    const elapsed = Date.now() - lastExportTime;
    if (elapsed < COOLDOWN_MS) {
      const remainingHours = Math.ceil((COOLDOWN_MS - elapsed) / (60 * 60 * 1000));
      return json({
        error: `Export available again in ${remainingHours} hour${remainingHours === 1 ? "" : "s"}.`,
        rateLimited: true,
      }, 429);
    }
  }

  // Fetch user email
  const { data: profile, error: profileError } = await adminSupabase
    .from("profiles")
    .select("email, username, currency, created_at")
    .eq("id", userId)
    .single();

  if (profileError || !profile?.email) {
    return json({ error: "Could not resolve user email." }, 400);
  }

  // Fetch all user data
  const [
    tasksRes,
    subtasksRes,
    remindersRes,
    taskEventsRes,
    ledgerRes,
    recurrenceRulesRes,
    pomoRes,
    commitmentsRes,
    friendshipsRes,
  ] = await Promise.all([
    adminSupabase
      .from("tasks")
      .select("id, title, description, failure_cost_cents, deadline, status, postponed_at, marked_completed_at, recurrence_rule_id, iteration_number, start_at, is_strict, required_pomo_minutes, requires_proof, has_proof, resubmit_count, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    adminSupabase
      .from("task_subtasks")
      .select("id, parent_task_id, title, is_completed, completed_at, created_at")
      .eq("user_id", userId),
    adminSupabase
      .from("task_reminders")
      .select("id, parent_task_id, reminder_at, source, notified_at, created_at")
      .eq("user_id", userId),
    adminSupabase
      .from("task_events")
      .select("id, task_id, event_type, from_status, to_status, created_at, task:tasks!inner(user_id)")
      .eq("tasks.user_id", userId)
      .order("created_at", { ascending: true }),
    adminSupabase
      .from("ledger_entries")
      .select("id, task_id, period, amount_cents, entry_type, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    adminSupabase
      .from("recurrence_rules")
      .select("id, title, description, failure_cost_cents, required_pomo_minutes, requires_proof, rule_config, timezone, latest_iteration, created_at, updated_at")
      .eq("user_id", userId),
    adminSupabase
      .from("pomo_sessions")
      .select("id, task_id, duration_minutes, elapsed_seconds, is_strict, status, started_at, completed_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    adminSupabase
      .from("commitments")
      .select("id, name, description, start_date, end_date, status, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    adminSupabase
      .from("friendships")
      .select("id, created_at, friend:profiles!friendships_friend_id_fkey(username, email)")
      .eq("user_id", userId),
  ]);

  const queryError =
    tasksRes.error?.message ||
    subtasksRes.error?.message ||
    remindersRes.error?.message ||
    taskEventsRes.error?.message ||
    ledgerRes.error?.message ||
    recurrenceRulesRes.error?.message ||
    pomoRes.error?.message ||
    commitmentsRes.error?.message ||
    friendshipsRes.error?.message;

  if (queryError) {
    return json({ error: `Data fetch failed: ${queryError}` }, 500);
  }

  // Assemble payload
  const subtasksByTask: Record<string, unknown[]> = {};
  const remindersByTask: Record<string, unknown[]> = {};
  for (const s of (subtasksRes.data ?? []) as any[]) {
    if (!subtasksByTask[s.parent_task_id]) subtasksByTask[s.parent_task_id] = [];
    subtasksByTask[s.parent_task_id].push(s);
  }
  for (const r of (remindersRes.data ?? []) as any[]) {
    if (!remindersByTask[r.parent_task_id]) remindersByTask[r.parent_task_id] = [];
    remindersByTask[r.parent_task_id].push(r);
  }

  const exportPayload = {
    exported_at: new Date().toISOString(),
    profile: {
      id: userId,
      email: profile.email,
      username: profile.username,
      currency: profile.currency,
      created_at: profile.created_at,
    },
    tasks: ((tasksRes.data ?? []) as any[]).map((t: any) => ({
      ...t,
      subtasks: subtasksByTask[t.id] ?? [],
      reminders: remindersByTask[t.id] ?? [],
    })),
    task_events: ((taskEventsRes.data ?? []) as any[]).map(({ task: _task, ...e }: any) => e),
    ledger_entries: ledgerRes.data ?? [],
    recurrence_rules: recurrenceRulesRes.data ?? [],
    pomo_sessions: pomoRes.data ?? [],
    commitments: commitmentsRes.data ?? [],
    friends: ((friendshipsRes.data ?? []) as any[]).map((f: any) => ({
      username: f.friend?.username ?? null,
      email: f.friend?.email ?? null,
      friends_since: f.created_at,
    })),
  };

  const jsonString = JSON.stringify(exportPayload, null, 2);
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `vouch-export-${dateStr}.json`;

  // Send email with attachment
  try {
    const result = await resend.emails.send({
      from: "Vouch <noreply@vouch.tarunh.com>",
      to: profile.email,
      subject: "Your Vouch data export",
      html: `<p>Hi ${profile.username ?? "there"},</p><p>Your data export is attached as a JSON file.</p><p>— Vouch</p>`,
      attachments: [{
        filename,
        content: btoa(unescape(encodeURIComponent(jsonString))),
      }],
    });

    if (result.error) {
      return json({ error: `Email failed: ${result.error.message ?? "Unknown Resend error"}` }, 500);
    }
  } catch (emailError: any) {
    return json({ error: `Failed to send email: ${emailError?.message ?? "Unknown error"}` }, 500);
  }

  await adminSupabase.from("data_exports").insert({ user_id: userId });

  return json({ success: true });
});
