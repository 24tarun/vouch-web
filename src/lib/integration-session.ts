import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

type Session = { access_token: string; refresh_token: string; expires_at?: number };

// shortcut: per-server-instance memory cache; each cold instance mints one extra session.
const sessionCache = new Map<string, Session>();
const REUSE_MARGIN_MS = 5 * 60 * 1000;

function anonClient() {
    return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}

/**
 * A real Supabase session for the API key's owner, minted server-side with the service role
 * (magic-link token verified immediately; no email is sent). Cached per key until near expiry.
 */
export async function getIntegrationSession(userId: string, cacheKey: string): Promise<{ session?: Session; error?: string }> {
    const cached = sessionCache.get(cacheKey);
    if (cached?.expires_at && cached.expires_at * 1000 - Date.now() > REUSE_MARGIN_MS) return { session: cached };

    const admin = createAdminClient();
    const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
    const email = userData?.user?.email;
    if (userError || !email) return { error: "Could not resolve the API key's account." };

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) return { error: "Could not start an API session." };

    const { data, error } = await anonClient().auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    if (error || !data.session || data.session.user.id !== userId) return { error: "Could not start an API session." };

    const session = { access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at };
    sessionCache.set(cacheKey, session);
    return { session };
}

/** Client signed in with an existing session (no cookies, no refresh). */
export async function createSessionClient(session: { access_token: string; refresh_token: string }) {
    const client = anonClient();
    const { error } = await client.auth.setSession(session);
    if (error) throw new Error("API session is no longer valid.");
    return client;
}
