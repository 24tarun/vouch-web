"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { TaskStatus } from "@/lib/xstate/task-machine";

interface TaskLike {
    id: string;
    status: TaskStatus;
}

interface TaskDetailPrefetcherProps {
    tasks: TaskLike[];
    prefetchMedia?: boolean;
}

const PREFETCH_STATUSES = new Set<TaskStatus>([
    "CREATED",
    "POSTPONED",
    "AWAITING_VOUCHER",
    "MARKED_COMPLETED",
]);
const MEDIA_PREFETCH_STATUSES = new Set<TaskStatus>(["AWAITING_VOUCHER", "MARKED_COMPLETED"]);

const prefetchedDetailTaskIds = new Set<string>();
const prefetchedMediaTaskIds = new Set<string>();
const prefetchingMediaTaskIds = new Set<string>();

export function TaskDetailPrefetcher({
    tasks,
    prefetchMedia = true,
}: TaskDetailPrefetcherProps) {
    const router = useRouter();

    const detailPrefetchIds = useMemo(() => {
        const ids = new Set<string>();
        for (const task of tasks) {
            if (!task?.id || !PREFETCH_STATUSES.has(task.status)) continue;
            ids.add(task.id);
        }
        return Array.from(ids);
    }, [tasks]);

    const mediaPrefetchIds = useMemo(() => {
        if (!prefetchMedia) return [];
        const ids = new Set<string>();
        for (const task of tasks) {
            if (!task?.id || !MEDIA_PREFETCH_STATUSES.has(task.status)) continue;
            ids.add(task.id);
        }
        return Array.from(ids);
    }, [prefetchMedia, tasks]);

    useEffect(() => {
        for (const taskId of detailPrefetchIds) {
            if (prefetchedDetailTaskIds.has(taskId)) continue;
            prefetchedDetailTaskIds.add(taskId);
            void router.prefetch(`/dashboard/tasks/${taskId}`);
        }
    }, [detailPrefetchIds, router]);

    useEffect(() => {
        if (!prefetchMedia) return;
        if (mediaPrefetchIds.length === 0) return;

        const controller = new AbortController();
        for (const taskId of mediaPrefetchIds) {
            if (prefetchedMediaTaskIds.has(taskId)) continue;
            if (prefetchingMediaTaskIds.has(taskId)) continue;
            prefetchingMediaTaskIds.add(taskId);

            void fetch(`/api/task-proofs/${taskId}`, {
                method: "GET",
                cache: "force-cache",
                credentials: "same-origin",
                signal: controller.signal,
            })
                .then((response) => {
                    if (response.ok) {
                        prefetchedMediaTaskIds.add(taskId);
                    } else {
                        prefetchedMediaTaskIds.delete(taskId);
                    }
                })
                .catch(() => {
                    // No proof / no access / expired proof are expected in some cases.
                    prefetchedMediaTaskIds.delete(taskId);
                })
                .finally(() => {
                    prefetchingMediaTaskIds.delete(taskId);
                });
        }

        return () => {
            controller.abort();
        };
    }, [mediaPrefetchIds, prefetchMedia]);

    return null;
}
