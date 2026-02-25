import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function sanitizeNextPath(rawNext: string | null): string {
    if (!rawNext) return "/dashboard";
    if (!rawNext.startsWith("/")) return "/dashboard";
    if (rawNext.startsWith("//")) return "/dashboard";
    if (rawNext.startsWith("/\\")) return "/dashboard";
    return rawNext;
}

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get("code");
    const tokenHash = searchParams.get("token_hash");
    const otpTypeRaw = searchParams.get("type");
    const next = sanitizeNextPath(searchParams.get("next"));
    const allowedOtpTypes = new Set<EmailOtpType>([
        "signup",
        "recovery",
        "invite",
        "magiclink",
        "email",
        "email_change",
    ]);

    if (code) {
        const supabase = await createClient();
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
            return NextResponse.redirect(`${origin}${next}`);
        }
        console.error("Auth callback error:", error);
        return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
    }

    if (tokenHash && otpTypeRaw && allowedOtpTypes.has(otpTypeRaw as EmailOtpType)) {
        const supabase = await createClient();
        const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpTypeRaw as EmailOtpType,
        });

        if (!error) {
            return NextResponse.redirect(`${origin}${next}`);
        }

        console.error("Auth OTP verify error:", error);
        return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
    }

    // No supported auth credentials provided
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
}
