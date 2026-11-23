import { NextRequest } from "next/server";
import { authenticateIntegrationRequest, jsonNoStore } from "@/lib/integration-request";
import { INTEGRATION_ACTIONS } from "@/lib/integration-actions";

/** GET /api/integrations/actions — names and parameter lists of every callable action. */
export async function GET(request: NextRequest) {
    const auth = await authenticateIntegrationRequest(request, "actions");
    if (auth.response) return auth.response;
    const actions = Object.entries(INTEGRATION_ACTIONS)
        .map(([name, fn]) => ({ name, params: /\(([^)]*)\)/.exec(fn.toString())?.[1]?.split(",").map((p) => p.trim().split(/[\s=:]/)[0]).filter(Boolean) ?? [] }))
        .sort((a, b) => a.name.localeCompare(b.name));
    return jsonNoStore({ actions });
}
