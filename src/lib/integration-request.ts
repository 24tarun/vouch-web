import { NextRequest, NextResponse } from "next/server";
import { createIntegrationApiKeyAdminClient } from "@/lib/supabase/integration-api-keys-admin";
import { apiLimiter, checkRateLimit } from "@/lib/rate-limit";
import { parseIntegrationApiKey, verifyIntegrationApiKeySecret } from "@/lib/integration-api-key";

export function jsonNoStore(body: unknown, status = 200) {
    return NextResponse.json(body, {
        status,
        headers: {
            "Cache-Control": "private, no-store, no-cache, must-revalidate",
            "X-Content-Type-Options": "nosniff",
        },
    });
}

function getRequestIdentifier(request: NextRequest): string {
    return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function getBearerToken(request: NextRequest): string | null {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return null;
    const token = authorization.slice("Bearer ".length).trim();
    return token || null;
}

/**
 * Rate-limits by IP, then resolves the `Authorization: Bearer vouch_…` API key to its owner.
 * Returns either the user id or a ready-to-send error response.
 */
export async function authenticateIntegrationRequest(
    request: NextRequest,
    rateLimitScope: string
): Promise<{ userId: string; keyPrefix: string; response?: never } | { userId?: never; keyPrefix?: never; response: NextResponse }> {
    const { limited } = await checkRateLimit(apiLimiter, `${rateLimitScope}:${getRequestIdentifier(request)}`);
    if (limited) return { response: jsonNoStore({ error: "Too many requests." }, 429) };

    const parsedApiKey = parseIntegrationApiKey(getBearerToken(request) ?? "");
    if (!parsedApiKey) return { response: jsonNoStore({ error: "Invalid API key." }, 401) };

    const apiKeyAdmin = createIntegrationApiKeyAdminClient();
    const { data: apiKeyRow, error: apiKeyError } = await apiKeyAdmin
        .from("integration_api_keys")
        .select("user_id, secret_hash")
        .eq("key_prefix", parsedApiKey.keyPrefix)
        .maybeSingle();
    if (apiKeyError || !apiKeyRow || !verifyIntegrationApiKeySecret(parsedApiKey.secret, apiKeyRow.secret_hash)) {
        return { response: jsonNoStore({ error: "Invalid API key." }, 401) };
    }

    const { error: lastUsedError } = await apiKeyAdmin
        .from("integration_api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("user_id", apiKeyRow.user_id)
        .eq("key_prefix", parsedApiKey.keyPrefix);
    if (lastUsedError) console.error("Failed to update integration API key usage", lastUsedError);

    return { userId: apiKeyRow.user_id, keyPrefix: parsedApiKey.keyPrefix };
}
