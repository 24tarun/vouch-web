import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    });

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value)
                    );
                    supabaseResponse = NextResponse.next({
                        request,
                    });
                    cookiesToSet.forEach(({ name, value, options }) => {
                        const { maxAge: _unused, ...rest } = options;
                        supabaseResponse.cookies.set(name, value, {
                            ...rest,
                            maxAge: 60 * 60 * 24 * 365,
                            path: "/",
                            sameSite: "lax",
                            secure: process.env.NODE_ENV === "production",
                        });
                    });
                },
            },
            cookieOptions: {
                maxAge: 60 * 60 * 24 * 365,
                path: "/",
                sameSite: "lax",
                secure: process.env.NODE_ENV === "production",
            },
        }
    );

    const { data: claimsData } = await supabase.auth.getClaims();
    const user = claimsData?.claims ?? null;

    const PROTECTED_PREFIXES = ["/tasks", "/friends", "/commit", "/ledger", "/settings", "/voucher", "/calendar"];
    const isProtected = PROTECTED_PREFIXES.some((p) => request.nextUrl.pathname.startsWith(p));
    if (!user && isProtected) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        return NextResponse.redirect(url);
    }

    if (
        user &&
        (request.nextUrl.pathname === "/" || request.nextUrl.pathname === "/login")
    ) {
        const url = request.nextUrl.clone();
        url.pathname = "/tasks";
        return NextResponse.redirect(url);
    }

    return supabaseResponse;
}
