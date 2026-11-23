import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";

/**
 * Set while an API-key request runs a server action: `createClient()` then returns a client
 * signed in as the key's owner instead of reading browser cookies.
 */
export interface IntegrationContext {
    userId: string;
    /** Stable per API key, so agent activity is one client instance in task events. */
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
