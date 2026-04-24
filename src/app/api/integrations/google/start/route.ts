import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
    GOOGLE_OAUTH_MOBILE_RETURN_COOKIE,
    GOOGLE_OAUTH_STATE_COOKIE,
    GOOGLE_OAUTH_USER_ID_COOKIE,
} from "@/lib/google-calendar/constants";
import { buildGoogleOAuthUrl } from "@/lib/google-calendar/sync";

const MOBILE_RETURN_ALLOWLIST = ["vouch://"];

function isSafeReturnUrl(url: string): boolean {
    return MOBILE_RETURN_ALLOWLIST.some((prefix) => url.startsWith(prefix));
}

// GET /api/integrations/google/start?mobile=1&return=vouch://settings/calendar[&token=<access_token>]
//
// Web flow:   no `token` param — authenticates via Supabase cookie session (normal SSR auth).
// Mobile flow: passes `token=<supabase_jwt>` — no cookie session exists in the WebBrowser
//              context, so we validate the JWT with the admin client and store the resolved
//              user_id in a short-lived httpOnly cookie for the callback to read.
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const isMobile = searchParams.get("mobile") === "1";
    const returnUrl = searchParams.get("return") ?? "";
    const mobileToken = searchParams.get("token") ?? "";

    if (isMobile && returnUrl && !isSafeReturnUrl(returnUrl)) {
        return NextResponse.json({ error: "Invalid return URL" }, { status: 400 });
    }

    let userId: string;

    if (isMobile && mobileToken) {
        // Mobile: validate the bearer JWT with the admin client
        const adminSupabase = createAdminClient();
        const { data: { user }, error } = await adminSupabase.auth.getUser(mobileToken);
        if (error || !user) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }
        userId = user.id;
    } else {
        // Web: use the cookie-based SSR session
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }
        userId = user.id;
    }

    const state = randomUUID();
    const cookieStore = await cookies();
    const cookieOpts = {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 10, // 10 minutes
    };

    cookieStore.set(GOOGLE_OAUTH_STATE_COOKIE, state, cookieOpts);

    // Always store the user_id so the callback doesn't need a live session
    cookieStore.set(GOOGLE_OAUTH_USER_ID_COOKIE, userId, cookieOpts);

    if (isMobile && returnUrl) {
        cookieStore.set(GOOGLE_OAUTH_MOBILE_RETURN_COOKIE, returnUrl, cookieOpts);
    }

    const oauthUrl = buildGoogleOAuthUrl(state);
    return NextResponse.redirect(oauthUrl);
}
