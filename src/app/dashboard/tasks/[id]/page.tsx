import { notFound } from "next/navigation";
import { getTask, getTaskEvents, getTaskPomoSummary } from "@/actions/tasks";
import TaskDetailClient from "./task-detail-client";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_POMO_DURATION_MINUTES } from "@/lib/constants";

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

    const [events, pomoSummary] = await Promise.all([
        getTaskEvents(id),
        getTaskPomoSummary(id),
    ]);

    // @ts-ignore
    const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user?.id as any)
        .maybeSingle();

    const defaultPomoDurationMinutes =
        ((profile as any)?.default_pomo_duration_minutes as number | undefined) ?? DEFAULT_POMO_DURATION_MINUTES;

    return (
        <TaskDetailClient
            task={task}
            events={events}
            pomoSummary={pomoSummary}
            defaultPomoDurationMinutes={defaultPomoDurationMinutes}
        />
    );
}
