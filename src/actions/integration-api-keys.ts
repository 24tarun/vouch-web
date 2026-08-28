"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createIntegrationApiKeyAdminClient } from "@/lib/supabase/integration-api-keys-admin";
import { generateIntegrationApiKey } from "@/lib/integration-api-key";

export interface IntegrationApiKeySummary {
    keyPrefix: string;
    createdAt: string;
    lastUsedAt: string | null;
}

export type IntegrationApiKeyMutationResult =
    | {
        error: null;
        apiKey: string;
        summary: IntegrationApiKeySummary;
    }
    | {
        error: string;
        apiKey: null;
        summary: null;
    };

interface IntegrationApiKeyRow {
    key_prefix: string;
    created_at: string;
    last_used_at: string | null;
}

function toSummary(row: IntegrationApiKeyRow): IntegrationApiKeySummary {
    return {
        keyPrefix: row.key_prefix,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
    };
}

async function getAuthenticatedUserId(): Promise<string | null> {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
}

export async function getIntegrationApiKeySummary(): Promise<IntegrationApiKeySummary | null> {
    const userId = await getAuthenticatedUserId();
    if (!userId) return null;

    const admin = createIntegrationApiKeyAdminClient();
    const { data, error } = await admin
        .from("integration_api_keys")
        .select("key_prefix, created_at, last_used_at")
        .eq("user_id", userId)
        .maybeSingle();

    if (error) {
        console.error("Failed to load integration API key summary", error);
        return null;
    }

    return data ? toSummary(data) : null;
}

export async function createIntegrationApiKey(): Promise<IntegrationApiKeyMutationResult> {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
        return { error: "Not authenticated", apiKey: null, summary: null };
    }

    const material = generateIntegrationApiKey();
    const admin = createIntegrationApiKeyAdminClient();
    const { data, error } = await admin
        .from("integration_api_keys")
        .insert({
            user_id: userId,
            key_prefix: material.keyPrefix,
            secret_hash: material.secretHash,
        })
        .select("key_prefix, created_at, last_used_at")
        .single();

    if (error || !data) {
        if (error?.code === "23505") {
            return { error: "An API key already exists.", apiKey: null, summary: null };
        }
        console.error("Failed to create integration API key", error);
        return { error: "Could not create API key.", apiKey: null, summary: null };
    }

    revalidatePath("/settings");
    return { error: null, apiKey: material.apiKey, summary: toSummary(data) };
}

export async function rotateIntegrationApiKey(): Promise<IntegrationApiKeyMutationResult> {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
        return { error: "Not authenticated", apiKey: null, summary: null };
    }

    const material = generateIntegrationApiKey();
    const createdAt = new Date().toISOString();
    const admin = createIntegrationApiKeyAdminClient();
    const { data, error } = await admin
        .from("integration_api_keys")
        .update({
            key_prefix: material.keyPrefix,
            secret_hash: material.secretHash,
            created_at: createdAt,
            last_used_at: null,
        })
        .eq("user_id", userId)
        .select("key_prefix, created_at, last_used_at")
        .maybeSingle();

    if (error || !data) {
        console.error("Failed to rotate integration API key", error);
        return { error: "Could not rotate API key.", apiKey: null, summary: null };
    }

    revalidatePath("/settings");
    return { error: null, apiKey: material.apiKey, summary: toSummary(data) };
}

export async function deleteIntegrationApiKey(): Promise<{ error: string | null }> {
    const userId = await getAuthenticatedUserId();
    if (!userId) return { error: "Not authenticated" };

    const admin = createIntegrationApiKeyAdminClient();
    const { error } = await admin
        .from("integration_api_keys")
        .delete()
        .eq("user_id", userId);

    if (error) {
        console.error("Failed to delete integration API key", error);
        return { error: "Could not delete API key." };
    }

    revalidatePath("/settings");
    return { error: null };
}
