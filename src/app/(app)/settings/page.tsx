import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SettingsClient from "./settings-client";
import { getFriends } from "@/actions/friends";
import { getGoogleCalendarIntegrationState } from "@/actions/google-calendar";
import { BuildStamp } from "@/components/BuildStamp";
import { getIntegrationApiKeySummary } from "@/actions/integration-api-keys";

type SettingsStats = {
    activeTasks: number;
    focusedHours: number;
    focusedMinutes: number;
    pendingVouches: number;
    accepted: number;
    missed: number;
    surrendered: number;
    denied: number;
};

export default async function SettingsPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect("/login");
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

    if (!profile) {
        // This should theoretically not happen if signIn enforces it, 
        // but if it does, force a logout or redirect
        await supabase.auth.signOut();
        redirect("/login?error=profile_missing");
    }

    const [friends, googleCalendarIntegration, apiKeySummary, tasksResult, pomoSessionsResult] = await Promise.all([
        getFriends(),
        getGoogleCalendarIntegrationState(),
        getIntegrationApiKeySummary(),
        supabase
            .from("tasks")
            .select("id, status")
            .eq("user_id", user.id),
        supabase
            .from("pomo_sessions")
            .select("task_id, elapsed_seconds")
            .eq("user_id", user.id)
            .neq("status", "DELETED"),
    ]);
    const { data: charities } = await supabase
        .from("charities")
        .select("id, key, name, is_active, created_at, updated_at")
        .order("name", { ascending: true });

    const tasks = (tasksResult.data as Array<{ id: string; status: string }> | null) ?? [];
    const statusByTaskId = new Map(tasks.map((task) => [task.id, task.status]));
    const focusedSeconds = ((pomoSessionsResult.data as Array<{ task_id: string; elapsed_seconds: number }> | null) ?? [])
        .filter((session) => !["DENIED", "MISSED", "SURRENDERED", "DELETED"].includes(statusByTaskId.get(session.task_id) ?? ""))
        .reduce((total, session) => total + (session.elapsed_seconds || 0), 0);
    const stats: SettingsStats = {
        activeTasks: tasks.filter((task) => ["ACTIVE", "POSTPONED"].includes(task.status)).length,
        focusedHours: Math.floor(focusedSeconds / 3600),
        focusedMinutes: Math.floor((focusedSeconds % 3600) / 60),
        pendingVouches: tasks.filter((task) => ["AWAITING_VOUCHER", "AWAITING_AI", "MARKED_COMPLETE"].includes(task.status)).length,
        accepted: tasks.filter((task) => ["ACCEPTED", "AUTO_ACCEPTED", "AI_ACCEPTED"].includes(task.status)).length,
        missed: tasks.filter((task) => task.status === "MISSED").length,
        surrendered: tasks.filter((task) => task.status === "SURRENDERED").length,
        denied: tasks.filter((task) => task.status === "DENIED").length,
    };

    return (
        <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
            <div className="flex-1">
                <SettingsClient
                    profile={profile}
                    friends={friends}
                    googleCalendarIntegration={googleCalendarIntegration}
                    apiKeySummary={apiKeySummary}
                    charities={(charities as Array<{ id: string; key: string; name: string; is_active: boolean; created_at: string; updated_at: string }> | null) ?? []}
                    stats={stats}
                />
            </div>
            <div className="pt-6 pb-safe">
                <BuildStamp className="text-center text-[10px] leading-4 tracking-[0.03em] text-slate-400" />
            </div>
        </div>
    );
}
