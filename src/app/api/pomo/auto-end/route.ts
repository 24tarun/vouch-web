import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendNotification } from "@/lib/notifications";

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

        let session: any = null;
        let selectError: any = null;

        if (sessionId) {
            const res = await (supabase
                .from("pomo_sessions") as any)
                .select("*")
                .eq("id", sessionId)
                .eq("user_id", user.id)
                .eq("status", "ACTIVE")
                .maybeSingle();
            session = res.data;
            selectError = res.error;
        } else {
            const res = await (supabase
                .from("pomo_sessions") as any)
                .select("*")
                .eq("user_id", user.id)
                .eq("status", "ACTIVE")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
            session = res.data;
            selectError = res.error;
        }

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
        const isStrictSession = Boolean(session.is_strict);

        const { data: updatedSession, error: updateError } = await ((supabase
            .from("pomo_sessions") as any)
            .update({
                status: isStrictSession ? "DELETED" : "COMPLETED",
                elapsed_seconds: finalElapsed,
                completed_at: now.toISOString(),
            })
            .eq("id", session.id)
            .eq("user_id", user.id)
            .eq("status", "ACTIVE")
            .select("id")
            .maybeSingle());

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        // Another concurrent request already ended this session.
        if (!updatedSession) {
            return NextResponse.json({ success: true, noop: true });
        }
        if (isStrictSession) {
            return NextResponse.json({ success: true });
        }

        if (session.task_id) {
            const { data: task } = await (supabase
                .from("tasks") as any)
                .select("id, title, status")
                .eq("id", session.task_id)
                .eq("user_id", user.id)
                .maybeSingle();

            if (task?.status) {
                const { error: eventError } = await (supabase.from("task_events") as any).insert({
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

                await sendNotification({
                    userId: user.id,
                    subject: `Pomodoro auto-ended: ${task.title}`,
                    title: "Pomodoro auto-ended",
                    text: `Your Pomodoro ended automatically and was logged for ${task.title}.`,
                    email: false,
                    push: true,
                    pushPayload: {
                        title: "Pomodoro auto-ended",
                        body: `Logged for ${task.title}.`,
                        url: `/dashboard/tasks/${task.id}`,
                        tag: `pomo-auto-end-${session.id}`,
                        sound: "pomo-auto-end",
                        data: {
                            taskId: task.id,
                            sessionId: session.id,
                            kind: "POMO_AUTO_ENDED",
                        },
                    },
                });
            }
        }

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
