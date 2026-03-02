import type { Task } from "@/lib/types";
import type { RealtimeTaskRow } from "@/lib/realtime-task-events";

function toTimestamp(value: string | null | undefined): number | null {
    if (!value) return null;
    const ts = new Date(value).getTime();
    return Number.isNaN(ts) ? null : ts;
}

export function isIncomingNewer(
    localUpdatedAt: string | null | undefined,
    incomingUpdatedAt: string | null | undefined
): boolean {
    const incomingTs = toTimestamp(incomingUpdatedAt);
    if (incomingTs === null) return false;

    const localTs = toTimestamp(localUpdatedAt);
    if (localTs === null) return true;

    return incomingTs >= localTs;
}

export function patchTaskScalars<T extends Task>(localTask: T, incomingRow: RealtimeTaskRow): T {
    return {
        ...localTask,
        id: incomingRow.id,
        user_id: incomingRow.user_id,
        voucher_id: incomingRow.voucher_id,
        title: incomingRow.title,
        description: incomingRow.description,
        failure_cost_cents: incomingRow.failure_cost_cents,
        required_pomo_minutes: incomingRow.required_pomo_minutes,
        start_at: incomingRow.start_at,
        deadline: incomingRow.deadline,
        status: incomingRow.status,
        postponed_at: incomingRow.postponed_at,
        marked_completed_at: incomingRow.marked_completed_at,
        voucher_response_deadline: incomingRow.voucher_response_deadline,
        recurrence_rule_id: incomingRow.recurrence_rule_id,
        created_at: incomingRow.created_at,
        updated_at: incomingRow.updated_at,
        proof_request_open: incomingRow.proof_request_open,
        proof_requested_at: incomingRow.proof_requested_at,
        proof_requested_by: incomingRow.proof_requested_by,
    };
}
