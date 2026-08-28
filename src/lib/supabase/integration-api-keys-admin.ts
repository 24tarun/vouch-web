import { createClient } from "@supabase/supabase-js";

type IntegrationApiKeyRow = {
    user_id: string;
    key_prefix: string;
    secret_hash: string;
    created_at: string;
    last_used_at: string | null;
};

interface IntegrationApiKeyDatabase {
    public: {
        Tables: {
            integration_api_keys: {
                Row: IntegrationApiKeyRow;
                Insert: Omit<IntegrationApiKeyRow, "created_at" | "last_used_at"> &
                    Partial<Pick<IntegrationApiKeyRow, "created_at" | "last_used_at">>;
                Update: Partial<Omit<IntegrationApiKeyRow, "user_id">>;
                Relationships: [];
            };
        };
        Views: {
            [_ in never]: never;
        };
        Functions: {
            [_ in never]: never;
        };
    };
}

export function createIntegrationApiKeyAdminClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error("Missing Supabase URL or Service Role Key");
    }

    return createClient<IntegrationApiKeyDatabase>(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}
