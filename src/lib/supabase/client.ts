import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            },
            cookieOptions: {
                maxAge: 60 * 60 * 24 * 365,
                path: "/",
                sameSite: "lax",
                secure: process.env.NODE_ENV === "production",
            },
        }
    );
}
