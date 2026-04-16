import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

const CLIENT_NAME = "vouch-web";
const INSTANCE_COOKIE = "vouch_web_client_instance_key";

function randomKey(): string {
  const rand = Math.random().toString(36).slice(2, 12);
  return `w-${Date.now().toString(36)}-${rand}`;
}

async function getOrCreateInstanceKey(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(INSTANCE_COOKIE)?.value?.trim();
  if (existing) return existing;
  const next = randomKey();
  cookieStore.set(INSTANCE_COOKIE, next, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return next;
}

export async function resolveWebUserClientInstanceId(userId: string): Promise<string | null> {
  if (!userId) return null;

  try {
    const supabase = await createClient();
    const instanceKey = await getOrCreateInstanceKey();
    const nowIso = new Date().toISOString();
    const headerStore = await headers();
    const userAgent = headerStore.get("user-agent");
    const metadata = { instance_key: instanceKey };

    const { data: existing, error: selectError } = await (supabase.from("user_client_instances") as any)
      .select("id")
      .eq("user_id", userId)
      .eq("platform", "web")
      .eq("client_name", CLIENT_NAME)
      .contains("metadata", metadata)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) return null;

    if (existing?.id) {
      await (supabase.from("user_client_instances") as any)
        .update({
          last_seen_at: nowIso,
          device_label: userAgent,
          metadata,
        })
        .eq("id", existing.id)
        .eq("user_id", userId);
      return existing.id as string;
    }

    const { data: created, error: createError } = await (supabase.from("user_client_instances") as any)
      .insert({
        user_id: userId,
        platform: "web",
        client_name: CLIENT_NAME,
        device_label: userAgent,
        app_version: null,
        metadata,
        last_seen_at: nowIso,
      })
      .select("id")
      .single();

    if (createError || !created?.id) return null;
    return created.id as string;
  } catch {
    return null;
  }
}
