import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { type Database } from "../types";

import { SupabaseClient } from "@supabase/supabase-js";
import { getIntegrationContext } from "@/lib/integration-context";
import { createSessionClient } from "@/lib/integration-session";

export async function createClient(): Promise<SupabaseClient<Database>> {
    const integration = getIntegrationContext();
    if (integration) {
        integration.client ??= createSessionClient(integration.session) as Promise<SupabaseClient<Database>>;
        return integration.client;
    }

    const cookieStore = await cookies();

    return createServerClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) => {
                            const { maxAge: _unused, ...rest } = options;
                            cookieStore.set(name, value, {
                                ...rest,
                                maxAge: 60 * 60 * 24 * 365,
                                path: "/",
                                sameSite: "lax",
                                secure: process.env.NODE_ENV === "production",
                            });
                        });
                    } catch {
                    }
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
}
