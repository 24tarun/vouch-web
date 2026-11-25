import { NextRequest } from "next/server";
import { authenticateIntegrationRequest, jsonNoStore } from "@/lib/integration-request";
import { createBlockForUser } from "@/lib/calendar/service";
import { createBlockSchema, integrationDb, toBlockTarget } from "@/lib/calendar/integration";

export async function POST(request: NextRequest) {
    const auth = await authenticateIntegrationRequest(request, "calendar");
    if (auth.response) return auth.response;

    const parsed = createBlockSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return jsonNoStore({ error: "Body needs start_at, end_at (ISO with timezone) and either task_id, or rule_id + occurrence_deadline." }, 400);
    }
    const result = await createBlockForUser(integrationDb(), auth.userId, toBlockTarget(parsed.data), parsed.data.start_at, parsed.data.end_at);
    if (!result.block) return jsonNoStore({ error: result.error || "Could not create block." }, 422);
    return jsonNoStore({ block: result.block }, 201);
}
