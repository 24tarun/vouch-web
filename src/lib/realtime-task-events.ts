import type { Task } from "@/lib/types";

const REALTIME_TASK_EVENT_NAME = "vouch:realtime-task-change";

export type RealtimeTaskEventType = "INSERT" | "UPDATE" | "DELETE";

export type RealtimeTaskRow = Pick<
    Task,
    | "id"
    | "user_id"
    | "voucher_id"
    | "title"
    | "description"
    | "failure_cost_cents"
    | "required_pomo_minutes"
    | "start_at"
    | "deadline"
    | "status"
    | "postponed_at"
    | "marked_completed_at"
    | "voucher_response_deadline"
    | "recurrence_rule_id"
    | "created_at"
    | "updated_at"
    | "proof_request_open"
    | "proof_requested_at"
    | "proof_requested_by"
>;

export interface RealtimeTaskChange {
    eventType: RealtimeTaskEventType;
    newRow: RealtimeTaskRow | null;
    oldRow: RealtimeTaskRow | null;
    receivedAt: number;
}

export function emitRealtimeTaskChange(change: RealtimeTaskChange): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
        new CustomEvent<RealtimeTaskChange>(REALTIME_TASK_EVENT_NAME, {
            detail: change,
        })
    );
}

export function subscribeRealtimeTaskChanges(
    handler: (change: RealtimeTaskChange) => void
): () => void {
    if (typeof window === "undefined") {
        return () => {
            // Server-side no-op.
        };
    }

    const listener = (event: Event) => {
        const customEvent = event as CustomEvent<RealtimeTaskChange>;
        if (!customEvent.detail) return;
        handler(customEvent.detail);
    };

    window.addEventListener(REALTIME_TASK_EVENT_NAME, listener as EventListener);

    return () => {
        window.removeEventListener(REALTIME_TASK_EVENT_NAME, listener as EventListener);
    };
}
