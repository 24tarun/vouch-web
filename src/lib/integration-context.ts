import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";

export interface IntegrationContext {
    userId: string;
    instanceKey: string;
    session: { access_token: string; refresh_token: string };
    client?: Promise<SupabaseClient<Database>>;
}

const storage = new AsyncLocalStorage<IntegrationContext>();

export function getIntegrationContext(): IntegrationContext | undefined {
    return storage.getStore();
}

export function runWithIntegrationContext<T>(context: IntegrationContext, fn: () => Promise<T>): Promise<T> {
    return storage.run(context, fn);
}
