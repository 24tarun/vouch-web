import { notFound } from "next/navigation";
import { getTask, getTaskEvents, getTaskPomoSummary } from "@/actions/tasks";
import { getPotentialRpGain } from "@/actions/reputation";
import TaskDetailClient from "./task-detail-client";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_POMO_DURATION_MINUTES } from "@/lib/constants";
import { normalizeCurrency } from "@/lib/currency";
import { normalizePomoDurationMinutes } from "@/lib/pomodoro";

interface TaskPageProps {
    params: Promise<{ id: string }>;
}

export default async function TaskPage({ params }: TaskPageProps) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    const { id } = await params;
    const task = await getTask(id);

    if (!task) {
        notFound();
    }

    const isActiveOwnerTask =
        task.user_id === user?.id &&
        (task.status === "ACTIVE" || task.status === "POSTPONED");

    const [events, pomoSummary, potentialRp] = await Promise.all([
        getTaskEvents(id),
        getTaskPomoSummary(id),
        isActiveOwnerTask ? getPotentialRpGain(id, user!.id) : Promise.resolve(null),
    ]);

    // @ts-ignore
    const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user?.id as any)
        .maybeSingle();

    const defaultPomoDurationMinutes = normalizePomoDurationMinutes(
        (profile as any)?.default_pomo_duration_minutes,
        DEFAULT_POMO_DURATION_MINUTES
    );
    const viewerCurrency = normalizeCurrency((profile as any)?.currency);

    return (
        <TaskDetailClient
            task={task}
            events={events}
            pomoSummary={pomoSummary}
            defaultPomoDurationMinutes={defaultPomoDurationMinutes}
            viewerId={user?.id || ""}
            viewerCurrency={viewerCurrency}
            potentialRp={potentialRp}
        />
    );
}
