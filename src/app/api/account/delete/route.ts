import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { apiLimiter, checkRateLimit } from "@/lib/rate-limit";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types";
import { deleteAccountByUserId } from "@/lib/account/delete-account";

function getBearerToken(req: NextRequest): string | null {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return null;
    if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
    const token = authHeader.slice(7).trim();
    return token.length > 0 ? token : null;
}

async function getAuthenticatedUserId(req: NextRequest): Promise<{ userId: string | null; error: string | null }> {
    const bearerToken = getBearerToken(req);
    if (bearerToken) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
        const supabase = createSupabaseClient<Database>(supabaseUrl, supabaseAnonKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });
        const {
            data: { user },
            error,
        } = await supabase.auth.getUser(bearerToken);
        if (error || !user) {
            return { userId: null, error: "Not authenticated" };
        }
        return { userId: user.id, error: null };
    }

    const supabase = await createServerClient();
    const {
        data: { user },
        error,
    } = await supabase.auth.getUser();
    if (error || !user) {
        return { userId: null, error: "Not authenticated" };
    }
    return { userId: user.id, error: null };
}

export async function POST(req: NextRequest) {
    try {
        const { userId, error: authError } = await getAuthenticatedUserId(req);
        if (authError || !userId) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }

        const { limited } = await checkRateLimit(apiLimiter, `account-delete:${userId}`);
        if (limited) {
            return NextResponse.json({ error: "Too many requests" }, { status: 429 });
        }

        const result = await deleteAccountByUserId(userId);
        if ("error" in result) {
            return NextResponse.json({ error: result.error }, { status: 400 });
        }

        return NextResponse.json({ success: true }, { status: 200 });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
