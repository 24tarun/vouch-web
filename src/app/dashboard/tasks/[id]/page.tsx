import { notFound } from "next/navigation";
import { getTask, getTaskEvents } from "@/actions/tasks";
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

    const events = await getTaskEvents(id);

    return <TaskDetailClient task={task} events={events} />;
}
