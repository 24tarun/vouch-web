import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { resolveWebUserClientInstanceId } from "@/lib/user-client-instance";

const requestSchema = z.object({
    action: z.literal("close_requested"),
    sessionId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    let payload: unknown;
    try {
        payload = JSON.parse(await req.text());
    } catch {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const ownerUserClientInstanceId = await resolveWebUserClientInstanceId(user.id);
    if (!ownerUserClientInstanceId) {
        return NextResponse.json({ error: "Could not identify this browser" }, { status: 409 });
    }

    const nowIso = new Date().toISOString();
    const { error } = await supabase
        .from("pomo_sessions")
        .update({ owner_heartbeat_at: nowIso, close_requested_at: nowIso } as never)
        .eq("id", parsed.data.sessionId)
        .eq("user_id", user.id)
        .eq("owner_user_client_instance_id", ownerUserClientInstanceId)
        .in("status", ["ACTIVE", "PAUSED"]);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}
