import { useMemo } from "react";
import type { TaskEvent } from "@/lib/types";
import type { TaskStatus } from "@/lib/xstate/task-machine";
import {
    buildVisibleEvents,
    formatDateTimeDdMmYyyy24h,
    formatEventTimestamp,
    formatFocusTime,
    getActivityStepTone,
    getPomoElapsedSeconds,
    isTaskStatus,
} from "@/app/(app)/tasks/[id]/task-detail/utils/task-detail-helpers";

export interface ActivityStep {
    id: string;
    tag:
        | { kind: "status"; status: TaskStatus }
        | { kind: "event"; eventType: string; elapsedSeconds?: number };
    detail: string | null;
    timestamp: string;
    tone: "success" | "danger" | "warning" | "info" | "proof" | "neutral";
}

const isAiDecisionEvent = (event: TaskEvent) => event.event_type === "AI_APPROVE" || event.event_type === "AI_DENY";

export function useTaskDetailActivitySteps(events: TaskEvent[], aiVouches: Array<{ reason?: string | null }>): ActivityStep[] {
    const visibleEvents = useMemo(() => buildVisibleEvents(events), [events]);

    return useMemo<ActivityStep[]>(() => {
        return visibleEvents.flatMap((event, index) => {
            const hasTransition = event.from_status !== event.to_status;
            const toStatus = event.to_status;
            const elapsedSeconds = event.event_type === "POMO_COMPLETED"
                ? getPomoElapsedSeconds(event)
                : undefined;
            const tag: ActivityStep["tag"] =
                event.event_type === "MARK_COMPLETE"
                    ? { kind: "status", status: "MARKED_COMPLETE" }
                    : event.event_type === "UNDO_COMPLETE"
                    ? { kind: "event", eventType: event.event_type, elapsedSeconds }
                    : hasTransition && isTaskStatus(toStatus)
                    ? { kind: "status", status: toStatus }
                    : { kind: "event", eventType: event.event_type, elapsedSeconds };

            const detailParts: string[] = [];
            if (event.event_type === "POSTPONE") {
                const newDeadlineRaw = event.metadata?.new_deadline;
                const newDeadlineIso = typeof newDeadlineRaw === "string" ? newDeadlineRaw : null;
                if (newDeadlineIso) {
                    detailParts.push(`new deadline: ${formatDateTimeDdMmYyyy24h(newDeadlineIso)}`);
                }
            }

            if (event.event_type === "POMO_COMPLETED") {
                detailParts.push(`focus duration: ${formatFocusTime(getPomoElapsedSeconds(event))}`);
            }

            if (isAiDecisionEvent(event)) {
                const aiDecisionIndex = visibleEvents.slice(0, index + 1).filter(isAiDecisionEvent).length - 1;
                const vouch = aiVouches[aiDecisionIndex];
                if (vouch?.reason) {
                    detailParts.push(`"${vouch.reason}"`);
                }
            }

            const detail = detailParts.length > 0 ? detailParts.join(" | ") : null;

            const baseStep: ActivityStep = {
                id: event.id,
                tag,
                detail,
                timestamp: formatEventTimestamp(event),
                tone: getActivityStepTone(event),
            };

            if (event.event_type === "UNDO_COMPLETE" && hasTransition && isTaskStatus(toStatus)) {
                return [
                    baseStep,
                    {
                        id: `${event.id}:restored-status`,
                        tag: { kind: "status", status: toStatus },
                        detail: null,
                        timestamp: formatEventTimestamp(event),
                        tone: "neutral",
                    },
                ];
            }

            if (event.event_type === "MARK_COMPLETE" && isTaskStatus(toStatus) && toStatus !== "MARKED_COMPLETE") {
                return [
                    baseStep,
                    {
                        id: `${event.id}:awaiting-status`,
                        tag: { kind: "status", status: toStatus },
                        detail: null,
                        timestamp: formatEventTimestamp(event),
                        tone: getActivityStepTone(event),
                    },
                ];
            }

            return [baseStep];
        });
    }, [visibleEvents, aiVouches]);
}
