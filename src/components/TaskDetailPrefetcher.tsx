"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { TaskStatus } from "@/lib/xstate/task-machine";
import { shouldSkipAutoWarmup, warmProofImage } from "@/lib/proof-media-warmup";

interface TaskLike {
    id: string;
    status: TaskStatus;
    updated_at?: string;
    completion_proof?: {
        media_kind?: "image" | "video";
        upload_state?: "PENDING" | "UPLOADED" | "FAILED";
        updated_at?: string;
    } | null;
}

interface TaskDetailPrefetcherProps {
    tasks: TaskLike[];
    prefetchMedia?: boolean;
}

const PREFETCH_STATUSES = new Set<TaskStatus>([
    "ACTIVE",
    "POSTPONED",
    "MARKED_COMPLETE",
    "AWAITING_VOUCHER",
    "AWAITING_AI",
    "AWAITING_USER",
]);
const MEDIA_PREFETCH_STATUSES = new Set<TaskStatus>(["AWAITING_VOUCHER", "AWAITING_AI", "MARKED_COMPLETE"]);

const prefetchedDetailTaskIds = new Set<string>();

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

    const mediaWarmTargets = useMemo(() => {
        if (!prefetchMedia) return [];

        const targets: Array<{ taskId: string; version: string; url: string }> = [];
        for (const task of tasks) {
            if (!task?.id || !MEDIA_PREFETCH_STATUSES.has(task.status)) continue;
            const proof = task.completion_proof;
            if (!proof || proof.upload_state !== "UPLOADED" || proof.media_kind !== "image") continue;
            const version = proof.updated_at || task.updated_at || "0";
            targets.push({
                taskId: task.id,
                version,
                url: `/api/task-proofs/${task.id}?v=${encodeURIComponent(version)}`,
            });
        }
        return targets;
    }, [prefetchMedia, tasks]);

    const runMediaWarmup = useCallback((signal?: AbortSignal) => {
        if (!prefetchMedia) return;
        if (mediaWarmTargets.length === 0) return;
        if (shouldSkipAutoWarmup()) return;

        for (const target of mediaWarmTargets) {
            void warmProofImage(target.taskId, target.version, target.url, signal);
        }
    }, [mediaWarmTargets, prefetchMedia]);

    useEffect(() => {
        for (const taskId of detailPrefetchIds) {
            if (prefetchedDetailTaskIds.has(taskId)) continue;
            prefetchedDetailTaskIds.add(taskId);
            void router.prefetch(`/tasks/${taskId}`);
        }
    }, [detailPrefetchIds, router]);

    useEffect(() => {
        const controller = new AbortController();
        runMediaWarmup(controller.signal);

        return () => {
            controller.abort();
        };
    }, [runMediaWarmup]);

    useEffect(() => {
        if (!prefetchMedia) return;

        const onVisibilityChange = () => {
            if (document.visibilityState !== "visible") return;
            runMediaWarmup();
        };

        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [prefetchMedia, runMediaWarmup]);

    return null;
}
