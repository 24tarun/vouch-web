import { NextRequest } from "next/server";
import { z } from "zod";
import { authenticateIntegrationRequest, jsonNoStore } from "@/lib/integration-request";
import { deleteBlockForUser, updateBlockForUser } from "@/lib/calendar/service";
import { blockTimesSchema, integrationDb } from "@/lib/calendar/integration";

const idSchema = z.uuid();

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const auth = await authenticateIntegrationRequest(request, "calendar");
    if (auth.response) return auth.response;
    const { id } = await ctx.params;
    if (!idSchema.safeParse(id).success) return jsonNoStore({ error: "Block not found." }, 404);

    const parsed = blockTimesSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonNoStore({ error: "Body needs start_at and end_at (ISO with timezone)." }, 400);
    const result = await updateBlockForUser(integrationDb(), auth.userId, id, parsed.data.start_at, parsed.data.end_at);
    if (!result.block) return jsonNoStore({ error: result.error || "Could not update block." }, result.error === "Block not found." ? 404 : 422);
    return jsonNoStore({ block: result.block });
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const auth = await authenticateIntegrationRequest(request, "calendar");
    if (auth.response) return auth.response;
    const { id } = await ctx.params;
    if (!idSchema.safeParse(id).success) return jsonNoStore({ error: "Block not found." }, 404);

    const result = await deleteBlockForUser(integrationDb(), auth.userId, id);
    if (!result.success) return jsonNoStore({ error: result.error || "Could not delete block." }, result.error === "Block not found." ? 404 : 422);
    return jsonNoStore({ deleted: true });
}
