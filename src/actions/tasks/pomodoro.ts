"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MAX_POMO_DURATION_MINUTES } from "@/lib/constants";
import { isValidPomoDurationMinutes } from "@/lib/pomodoro";
import { sendNotification } from "@/lib/notifications";
import { resolveWebUserClientInstanceId } from "@/lib/user-client-instance";
import { describePomoConflict, type PomoConflictSummary } from "@/lib/pomodoro-owner";

const ACTIVE_POMO_SELECT = `
    *,
    task:tasks(id, title),
    owner:user_client_instances!pomo_sessions_owner_user_client_instance_id_fkey(
        id, platform, client_name, device_label
    )
`;

export async function startPomoSession(taskId: string, durationMinutes: number) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { error: "Not authenticated" };
    if (!isValidPomoDurationMinutes(durationMinutes)) {
        return {
            error: `Pomodoro duration must be an integer between 1 and ${MAX_POMO_DURATION_MINUTES} minutes.`,
        };
    }

    // @ts-ignore
    const { data: task } = await (supabase
        .from("tasks") as any)
        .select("id, user_id")
        .eq("id", taskId as any)
        .eq("user_id", user.id as any)
        .single();

    if (!task) {
        return { error: "You don't have permission to start a Pomodoro session for this task." };
    }

    const ownerUserClientInstanceId = await resolveWebUserClientInstanceId(user.id);
    if (!ownerUserClientInstanceId) {
        return { error: "Could not identify this browser. Refresh and try again." };
    }

    // @ts-ignore
    const { data: existing } = await (supabase
        .from("pomo_sessions") as any)
        .select(ACTIVE_POMO_SELECT)
        .eq("user_id", user.id)
        .in("status", ["ACTIVE", "PAUSED"])
        .maybeSingle();

    if (existing) {
        return { error: describePomoConflict(existing as PomoConflictSummary), conflict: existing };
    }

    // @ts-ignore
    const { data: session, error } = await (supabase
        .from("pomo_sessions") as any)
        .insert({
            user_id: user.id,
            task_id: taskId,
            duration_minutes: durationMinutes,
            status: "ACTIVE",
            started_at: new Date().toISOString(),
            elapsed_seconds: 0,
            owner_heartbeat_at: new Date().toISOString(),
            close_requested_at: null,
            owner_user_client_instance_id: ownerUserClientInstanceId,
        })
        .select()
        .single();

    if (error) return { error: error.message };

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);
    return { success: true, session };
}

export async function pausePomoSession(sessionId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };
    const ownerUserClientInstanceId = await resolveWebUserClientInstanceId(user.id);
    if (!ownerUserClientInstanceId) return { error: "Could not identify this browser." };

    // @ts-ignore
    const { data: session } = await (supabase
        .from("pomo_sessions") as any)
        .select("*")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .eq("owner_user_client_instance_id", ownerUserClientInstanceId)
        .single();

    if (!session) return { error: "Session not found" };
    if (session.status !== "ACTIVE") return { error: "Session is not active" };
    const now = new Date();
    const startTime = new Date(session.started_at);
    const additionalElapsed = Math.max(0, Math.floor((now.getTime() - startTime.getTime()) / 1000));
    const newElapsed = (session.elapsed_seconds || 0) + additionalElapsed;

    // @ts-ignore
    const { error } = await (supabase
        .from("pomo_sessions") as any)
        .update({
            status: "PAUSED",
            elapsed_seconds: newElapsed,
            paused_at: now.toISOString(),
            owner_heartbeat_at: now.toISOString(),
            close_requested_at: null,
        })
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .eq("owner_user_client_instance_id", ownerUserClientInstanceId)
        .eq("status", "ACTIVE");

    if (error) return { error: error.message };
    revalidatePath("/tasks");
    if (session.task_id) {
        revalidatePath(`/tasks/${session.task_id}`);
    }
    return { success: true };
}

export async function resumePomoSession(sessionId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };
    const ownerUserClientInstanceId = await resolveWebUserClientInstanceId(user.id);
    if (!ownerUserClientInstanceId) return { error: "Could not identify this browser." };

    // @ts-ignore
    const { data: session } = await (supabase
        .from("pomo_sessions") as any)
        .select("status")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .eq("owner_user_client_instance_id", ownerUserClientInstanceId)
        .single();

    if (!session) return { error: "Session not found" };
    if ((session as any).status !== "PAUSED") return { error: "Session is not paused" };

    // @ts-ignore
    const { data: resumed, error } = await (supabase
        .from("pomo_sessions") as any)
        .update({
            status: "ACTIVE",
            started_at: new Date().toISOString(),
            paused_at: null,
            owner_heartbeat_at: new Date().toISOString(),
            close_requested_at: null,
        })
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .eq("owner_user_client_instance_id", ownerUserClientInstanceId)
        .eq("status", "PAUSED")
        .select("task_id")
        .single();

    if (error) return { error: error.message };
    revalidatePath("/tasks");
    if ((resumed as any)?.task_id) {
        revalidatePath(`/tasks/${(resumed as any).task_id}`);
    }
    return { success: true };
}

export async function endPomoSession(
    sessionId: string,
    source: "manual_stop" | "timer_completed" | "system" = "manual_stop"
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };
    const ownerUserClientInstanceId = await resolveWebUserClientInstanceId(user.id);
    if (!ownerUserClientInstanceId) return { error: "Could not identify this browser." };

    // @ts-ignore
    const { data: session } = await (supabase
        .from("pomo_sessions") as any)
        .select("*")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .eq("owner_user_client_instance_id", ownerUserClientInstanceId)
        .single();

    if (!session) return { error: "Session not found" };
    if (session.status === "COMPLETED" || session.status === "DELETED") {
        return { success: true };
    }

    let finalElapsed = session.elapsed_seconds || 0;
    if (session.status === "ACTIVE") {
        const now = new Date();
        const startTime = new Date(session.started_at);
        finalElapsed += Math.max(0, Math.floor((now.getTime() - startTime.getTime()) / 1000));
    }
    finalElapsed = Math.min(session.duration_minutes * 60, finalElapsed);

    const terminalStatus = "COMPLETED";
    const completedAt = new Date().toISOString();

    // @ts-ignore
    const { error } = await (supabase
        .from("pomo_sessions") as any)
        .update({
            status: terminalStatus,
            elapsed_seconds: finalElapsed,
            completed_at: completedAt,
            close_requested_at: null,
        })
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .eq("owner_user_client_instance_id", ownerUserClientInstanceId);

    if (error) return { error: error.message };

    if (session.task_id) {
        // @ts-ignore
        const { data: task } = await (supabase.from("tasks") as any)
            .select("id, title, status")
            .eq("id", session.task_id as any)
            .eq("user_id", user.id)
            .single();

        if (task?.status) {
            const { error: pomoEventError } = await (supabase.from("task_events") as any).insert({
                task_id: session.task_id,
                event_type: "POMO_COMPLETED",
                actor_id: user.id,
                actor_user_client_instance_id: ownerUserClientInstanceId,
                from_status: task.status,
                to_status: task.status,
                metadata: {
                    session_id: session.id,
                    duration_minutes: session.duration_minutes,
                    elapsed_seconds: finalElapsed,
                    source,
                },
            });
            if (pomoEventError && pomoEventError.code !== "23505") {
                console.error("Failed to log POMO_COMPLETED event:", pomoEventError);
            }

            await sendNotification({
                to: user.email || undefined,
                userId: user.id,
                subject: `Pomodoro complete: ${task.title}`,
                title: "Pomodoro completed",
                text: `Your pomodoro has ended and has been logged for ${task.title}.`,
                email: false,
                push: true,
                url: `/tasks/${task.id}`,
                tag: `pomo-completed-${session.id}`,
                data: {
                    taskId: task.id,
                    sessionId: session.id,
                    kind: "POMO_COMPLETED",
                },
            });
        }
    }

    revalidatePath("/tasks");
    if (session.task_id) {
        revalidatePath(`/tasks/${session.task_id}`);
    }
    return { success: true, counted: true };
}

export async function heartbeatPomoSession(sessionId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const ownerUserClientInstanceId = await resolveWebUserClientInstanceId(user.id);
    if (!ownerUserClientInstanceId) return { error: "Could not identify this browser." };

    const { error: sessionError } = await (supabase
        .from("pomo_sessions") as any)
        .update({ owner_heartbeat_at: new Date().toISOString(), close_requested_at: null })
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .eq("owner_user_client_instance_id", ownerUserClientInstanceId)
        .in("status", ["ACTIVE", "PAUSED"]);

    if (sessionError) return { error: sessionError.message };
    return { success: true };
}

export async function getActivePomoSession() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const serverNow = new Date().toISOString();
    if (!user) return { session: null, serverNow };
    const ownerUserClientInstanceId = await resolveWebUserClientInstanceId(user.id);
    if (!ownerUserClientInstanceId) {
        return { session: null, blockingSession: null, serverNow };
    }

    // @ts-ignore
    const { data: session } = await (supabase
        .from("pomo_sessions") as any)
        .select(ACTIVE_POMO_SELECT)
        .eq("user_id", user.id)
        .in("status", ["ACTIVE", "PAUSED"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    const isOwned = session?.owner_user_client_instance_id === ownerUserClientInstanceId;
    return {
        session: isOwned ? session : null,
        blockingSession: session && !isOwned ? session : null,
        serverNow,
    };
}
