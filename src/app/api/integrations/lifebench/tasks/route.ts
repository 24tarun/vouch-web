import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createIntegrationApiKeyAdminClient } from "@/lib/supabase/integration-api-keys-admin";
import { apiLimiter, checkRateLimit } from "@/lib/rate-limit";
import { parseLifebenchTaskRange } from "@/lib/lifebench/task-range";
import {
    parseIntegrationApiKey,
    verifyIntegrationApiKeySecret,
} from "@/lib/integration-api-key";

const DATABASE_PAGE_SIZE = 1_000;
const MAX_TASKS_PER_RESPONSE = 10_000;

const TASK_FIELDS = `
    id,
    title,
    creation_input,
    description,
    status,
    start_at,
    deadline,
    original_deadline,
    marked_completed_at,
    postponed_at,
    created_at,
    updated_at,
    recurrence_rule_id,
    iteration_number,
    required_pomo_minutes,
    failure_cost_cents,
    requires_proof,
    has_proof,
    is_strict
`;

interface LifebenchTaskRow {
    id: string;
    title: string;
    creation_input: string | null;
    description: string | null;
    status: string;
    start_at: string | null;
    deadline: string;
    original_deadline: string | null;
    marked_completed_at: string | null;
    postponed_at: string | null;
    created_at: string;
    updated_at: string;
    recurrence_rule_id: string | null;
    iteration_number: number | null;
    required_pomo_minutes: number | null;
    failure_cost_cents: number;
    requires_proof: boolean;
    has_proof: boolean;
    is_strict: boolean;
}

function jsonNoStore(body: unknown, status = 200) {
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

export async function GET(request: NextRequest) {
    const { limited } = await checkRateLimit(
        apiLimiter,
        `lifebench:${getRequestIdentifier(request)}`
    );
    if (limited) {
        return jsonNoStore({ error: "Too many requests." }, 429);
    }

    const parsedRange = parseLifebenchTaskRange(request.nextUrl.searchParams);
    if (!parsedRange.range) {
        return jsonNoStore({ error: parsedRange.error }, 400);
    }
    const range = parsedRange.range;

    const supabase = createAdminClient();
    const apiKeyAdmin = createIntegrationApiKeyAdminClient();
    const parsedApiKey = parseIntegrationApiKey(getBearerToken(request) ?? "");
    if (!parsedApiKey) {
        return jsonNoStore({ error: "Invalid API key." }, 401);
    }

    const { data: apiKeyRow, error: apiKeyError } = await apiKeyAdmin
        .from("integration_api_keys")
        .select("user_id, secret_hash")
        .eq("key_prefix", parsedApiKey.keyPrefix)
        .maybeSingle();

    if (
        apiKeyError ||
        !apiKeyRow ||
        !verifyIntegrationApiKeySecret(parsedApiKey.secret, apiKeyRow.secret_hash)
    ) {
        return jsonNoStore({ error: "Invalid API key." }, 401);
    }

    const userId = apiKeyRow.user_id;
    const tasks: LifebenchTaskRow[] = [];

    for (let offset = 0; offset < MAX_TASKS_PER_RESPONSE; offset += DATABASE_PAGE_SIZE) {
        const { data, error } = await supabase
            .from("tasks")
            .select(TASK_FIELDS)
            .eq("user_id", userId)
            .gte("deadline", range.from)
            .lt("deadline", range.to)
            .order("deadline", { ascending: true })
            .order("id", { ascending: true })
            .range(offset, offset + DATABASE_PAGE_SIZE - 1);

        if (error) {
            console.error("Lifebench task export failed", error);
            return jsonNoStore({ error: "Could not load Vouch tasks." }, 500);
        }

        const page = (data ?? []) as LifebenchTaskRow[];
        tasks.push(...page);

        if (page.length < DATABASE_PAGE_SIZE) {
            const { error: lastUsedError } = await apiKeyAdmin
                .from("integration_api_keys")
                .update({ last_used_at: new Date().toISOString() })
                .eq("user_id", userId)
                .eq("key_prefix", parsedApiKey.keyPrefix);
            if (lastUsedError) {
                console.error("Failed to update integration API key usage", lastUsedError);
            }

            return jsonNoStore({
                schema_version: 1,
                range: {
                    field: "deadline",
                    from: range.from,
                    to: range.to,
                    end_exclusive: true,
                },
                count: tasks.length,
                tasks,
            });
        }
    }

    return jsonNoStore(
        {
            error: "The requested range contains too many tasks. Request a smaller range.",
        },
        422
    );
}
