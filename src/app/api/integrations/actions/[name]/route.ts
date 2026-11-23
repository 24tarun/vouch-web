import { NextRequest } from "next/server";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { authenticateIntegrationRequest, jsonNoStore } from "@/lib/integration-request";
import { getIntegrationSession } from "@/lib/integration-session";
import { runWithIntegrationContext } from "@/lib/integration-context";
import { INTEGRATION_ACTIONS, decodeActionArgs } from "@/lib/integration-actions";

/**
 * POST /api/integrations/actions/:name  { "args": [...] }
 * Runs the app's own server action as the API key's owner, with the same checks as the UI.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ name: string }> }) {
    const auth = await authenticateIntegrationRequest(request, "actions");
    if (auth.response) return auth.response;

    const { name } = await ctx.params;
    const action = Object.hasOwn(INTEGRATION_ACTIONS, name) ? INTEGRATION_ACTIONS[name] : undefined;
    if (!action) return jsonNoStore({ error: `Unknown action "${name}". GET /api/integrations/actions lists them.` }, 404);

    const body = await request.json().catch(() => ({}));
    const args = body && typeof body === "object" && "args" in body ? body.args : [];
    if (!Array.isArray(args)) return jsonNoStore({ error: "args must be an array of the action's arguments." }, 400);

    const { session, error } = await getIntegrationSession(auth.userId, auth.keyPrefix);
    if (!session) return jsonNoStore({ error }, 500);

    try {
        const result = await runWithIntegrationContext(
            { userId: auth.userId, instanceKey: `api-${auth.keyPrefix}`, session },
            () => action(...decodeActionArgs(args))
        );
        return jsonNoStore({ result: result ?? null });
    } catch (thrown) {
        if (isRedirectError(thrown)) return jsonNoStore({ result: null, redirected: true });
        console.error(`Integration action ${name} failed`, thrown);
        return jsonNoStore({ error: thrown instanceof Error ? thrown.message : "Action failed." }, 500);
    }
}
