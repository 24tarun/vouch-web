import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseLifebenchTaskRange } from "@/lib/lifebench/task-range";
import { authenticateIntegrationRequest, jsonNoStore } from "@/lib/integration-request";

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

export async function GET(request: NextRequest) {
    const parsedRange = parseLifebenchTaskRange(request.nextUrl.searchParams);
    if (!parsedRange.range) {
        return jsonNoStore({ error: parsedRange.error }, 400);
    }
    const range = parsedRange.range;

    const auth = await authenticateIntegrationRequest(request, "lifebench");
    if (auth.response) return auth.response;
    const userId = auth.userId;
    const supabase = createAdminClient();
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
