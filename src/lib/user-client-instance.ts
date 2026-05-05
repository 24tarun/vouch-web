import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

const CLIENT_NAME = "vouch-web";
const INSTANCE_COOKIE = "vouch_web_client_instance_key";
type UserClientInstanceIdRow = { id: string };

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

    const { data: existing, error: selectError } = await (supabase.from("user_client_instances" as any) as any)
      .select("id")
      .eq("user_id", userId)
      .eq("platform", "web")
      .eq("client_name", CLIENT_NAME)
      .contains("metadata", metadata)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) return null;
    const existingRow = (existing as UserClientInstanceIdRow | null);

    if (existingRow?.id) {
      await (supabase.from("user_client_instances" as any) as any)
        .update({
          last_seen_at: nowIso,
          device_label: userAgent,
          metadata,
        })
        .eq("id", existingRow.id)
        .eq("user_id", userId);
      return existingRow.id;
    }

    const { data: created, error: createError } = await (supabase.from("user_client_instances" as any) as any)
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

    const createdRow = (created as UserClientInstanceIdRow | null);
    if (createError || !createdRow?.id) return null;
    return createdRow.id;
  } catch {
    return null;
  }
}

export async function resolveWebUserClientInstanceStatus(
  userId: string
): Promise<{ id: string | null; isNew: boolean }> {
  if (!userId) return { id: null, isNew: false };

  try {
    const supabase = await createClient();
    const instanceKey = await getOrCreateInstanceKey();
    const nowIso = new Date().toISOString();
    const headerStore = await headers();
    const userAgent = headerStore.get("user-agent");
    const metadata = { instance_key: instanceKey };

    const { data: existing, error: selectError } = await (supabase.from("user_client_instances" as any) as any)
      .select("id")
      .eq("user_id", userId)
      .eq("platform", "web")
      .eq("client_name", CLIENT_NAME)
      .contains("metadata", metadata)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) return { id: null, isNew: false };
    const existingRow = (existing as UserClientInstanceIdRow | null);

    if (existingRow?.id) {
      await (supabase.from("user_client_instances" as any) as any)
        .update({
          last_seen_at: nowIso,
          device_label: userAgent,
          metadata,
        })
        .eq("id", existingRow.id)
        .eq("user_id", userId);
      return { id: existingRow.id, isNew: false };
    }

    const { data: created, error: createError } = await (supabase.from("user_client_instances" as any) as any)
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

    const createdRow = (created as UserClientInstanceIdRow | null);
    if (createError || !createdRow?.id) return { id: null, isNew: false };
    return { id: createdRow.id, isNew: true };
  } catch {
    return { id: null, isNew: false };
  }
}
