import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }

        let sessionId: string | undefined;
        try {
            const raw = await req.text();
            if (raw) {
                const body = JSON.parse(raw) as { sessionId?: string };
                sessionId = body.sessionId;
            }
        } catch {
            // Ignore malformed payload; we'll fallback to latest active session.
        }

        const activeSessionQuery = sessionId
            ? supabase
                .from("pomo_sessions")
                .select("*")
                .eq("id", sessionId)
                .eq("user_id", user.id)
                .eq("status", "ACTIVE")
                .maybeSingle()
            : supabase
                .from("pomo_sessions")
                .select("*")
                .eq("user_id", user.id)
                .eq("status", "ACTIVE")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();

        const { data: session, error: selectError } = await activeSessionQuery;
        if (selectError) {
            return NextResponse.json({ error: selectError.message }, { status: 500 });
        }

        if (!session) {
            return NextResponse.json({ success: true, noop: true });
        }

        const now = new Date();
        const startTime = new Date(session.started_at);
        const additionalElapsed = Math.max(0, Math.floor((now.getTime() - startTime.getTime()) / 1000));
        const finalElapsed = (session.elapsed_seconds || 0) + additionalElapsed;

        const { data: updatedSession, error: updateError } = await supabase
            .from("pomo_sessions")
            .update({
                status: "COMPLETED",
                elapsed_seconds: finalElapsed,
                completed_at: now.toISOString(),
            })
            .eq("id", session.id)
            .eq("user_id", user.id)
            .eq("status", "ACTIVE")
            .select("id")
            .maybeSingle();

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        // Another concurrent request already ended this session.
        if (!updatedSession) {
            return NextResponse.json({ success: true, noop: true });
        }

        if (session.task_id) {
            const { data: task } = await supabase
                .from("tasks")
                .select("status")
                .eq("id", session.task_id)
                .eq("user_id", user.id)
                .single();

            if (task?.status) {
                const { error: eventError } = await supabase.from("task_events").insert({
                    task_id: session.task_id,
                    event_type: "POMO_COMPLETED",
                    actor_id: user.id,
                    from_status: task.status,
                    to_status: task.status,
                    metadata: {
                        session_id: session.id,
                        duration_minutes: session.duration_minutes,
                        elapsed_seconds: finalElapsed,
                        source: "unload_auto_end",
                    },
                });

                if (eventError && eventError.code !== "23505") {
                    return NextResponse.json({ error: eventError.message }, { status: 500 });
                }
            }
        }

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
