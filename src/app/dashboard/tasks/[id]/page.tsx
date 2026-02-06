import { notFound } from "next/navigation";
import { getTask, getTaskEvents, getTaskPomoSummary } from "@/actions/tasks";
import TaskDetailClient from "./task-detail-client";

interface TaskPageProps {
    params: Promise<{ id: string }>;
}

export default async function TaskPage({ params }: TaskPageProps) {
    const { id } = await params;
    const task = await getTask(id);

    if (!task) {
        notFound();
    }

    const [events, pomoSummary] = await Promise.all([
        getTaskEvents(id),
        getTaskPomoSummary(id),
    ]);

    return <TaskDetailClient task={task} events={events} pomoSummary={pomoSummary} />;
}
