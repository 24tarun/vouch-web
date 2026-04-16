import { AI_PROFILE_ID } from "@/lib/ai-voucher/constants";
import type { TaskStatus } from "@/lib/xstate/task-machine";

export const PROOF_UPLOAD_ENTRY_STATUSES = [
    "AWAITING_VOUCHER",
    "AWAITING_AI",
    "AWAITING_USER",
    "MARKED_COMPLETE",
] as const;

export const PROOF_FINALIZE_OR_REVERT_STATUSES = [
    "AWAITING_VOUCHER",
    "AWAITING_AI",
    "MARKED_COMPLETE",
] as const;

export function getAwaitingProofReviewStatus(voucherId: string): "AWAITING_VOUCHER" | "AWAITING_AI" {
    return voucherId === AI_PROFILE_ID ? "AWAITING_AI" : "AWAITING_VOUCHER";
}

export function canInitAwaitingProofUpload(status: TaskStatus): boolean {
    return (PROOF_UPLOAD_ENTRY_STATUSES as readonly string[]).includes(status);
}

export function canFinalizeOrRevertProof(status: TaskStatus): boolean {
    return (PROOF_FINALIZE_OR_REVERT_STATUSES as readonly string[]).includes(status);
}
