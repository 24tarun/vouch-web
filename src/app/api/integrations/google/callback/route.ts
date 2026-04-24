import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
    GOOGLE_OAUTH_MOBILE_RETURN_COOKIE,
    GOOGLE_OAUTH_STATE_COOKIE,
    GOOGLE_OAUTH_USER_ID_COOKIE,
} from "@/lib/google-calendar/constants";
import {
    exchangeGoogleCodeForTokens,
    extractEmailFromIdToken,
    upsertGoogleConnectionTokens,
} from "@/lib/google-calendar/sync";

export async function GET(request: NextRequest) {
    const url = new URL(request.url);
    const origin = url.origin;
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
        return NextResponse.redirect(`${origin}/settings?googleCalendar=oauth_denied`);
    }

    if (!code || !state) {
        return NextResponse.redirect(`${origin}/settings?googleCalendar=missing_code`);
    }

    const cookieStore = await cookies();
    const expectedState = cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
    cookieStore.delete(GOOGLE_OAUTH_STATE_COOKIE);

    if (!expectedState || expectedState !== state) {
        return NextResponse.redirect(`${origin}/settings?googleCalendar=invalid_state`);
    }

    const mobileReturnUrl = cookieStore.get(GOOGLE_OAUTH_MOBILE_RETURN_COOKIE)?.value || null;
    cookieStore.delete(GOOGLE_OAUTH_MOBILE_RETURN_COOKIE);

    // Resolve the user — prefer the cookie set by /start (works for both web and mobile),
    // falling back to the live SSR session for any legacy callers that skipped /start.
    const cookieUserId = cookieStore.get(GOOGLE_OAUTH_USER_ID_COOKIE)?.value || null;
    cookieStore.delete(GOOGLE_OAUTH_USER_ID_COOKIE);

    let userId: string;
    if (cookieUserId) {
        userId = cookieUserId;
    } else {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.redirect(`${origin}/login?error=not_authenticated`);
        }
        userId = user.id;
    }

    try {
        // Use the admin client so we can write without needing a live user session
        const adminSupabase = createAdminClient();
        const tokens = await exchangeGoogleCodeForTokens(code);
        const accountEmail = extractEmailFromIdToken(tokens.id_token);
        await upsertGoogleConnectionTokens(adminSupabase, userId, tokens, accountEmail);

        if (mobileReturnUrl) {
            return NextResponse.redirect(`${mobileReturnUrl}?status=connected`);
        }
        return NextResponse.redirect(`${origin}/settings?googleCalendar=connected`);
    } catch (callbackError) {
        console.error("Google OAuth callback failed:", callbackError);
        if (mobileReturnUrl) {
            return NextResponse.redirect(`${mobileReturnUrl}?status=connect_failed`);
        }
        return NextResponse.redirect(`${origin}/settings?googleCalendar=connect_failed`);
    }
}
