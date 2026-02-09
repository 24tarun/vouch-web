export const TASK_PROOFS_BUCKET = "task-proofs";
export const MAX_TASK_PROOF_BYTES = 5 * 1024 * 1024;
export const MAX_TASK_PROOF_VIDEO_DURATION_MS = 15_000;

export type TaskProofMediaKind = "image" | "video";
export type TaskProofUploadState = "PENDING" | "UPLOADED" | "FAILED";

export interface TaskProofIntent {
    mediaKind: TaskProofMediaKind;
    mimeType: string;
    sizeBytes: number;
    durationMs?: number | null;
}

export interface TaskProofUploadTarget {
    bucket: string;
    objectPath: string;
}

export interface TaskProofMetadata extends TaskProofIntent {
    bucket: string;
    objectPath: string;
}

function normalizeExt(value: string): string {
    const ext = value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!ext) return "bin";
    return ext.slice(0, 12);
}

export function inferExtensionFromMime(mimeType: string): string {
    const normalized = (mimeType || "").toLowerCase();
    if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
    if (normalized.includes("png")) return "png";
    if (normalized.includes("webp")) return "webp";
    if (normalized.includes("mp4")) return "mp4";
    if (normalized.includes("quicktime")) return "mov";
    if (normalized.includes("webm")) return "webm";
    return "bin";
}

export function buildTaskProofObjectPath(params: {
    ownerId: string;
    taskId: string;
    mimeType: string;
    providedExt?: string | null;
}): string {
    const ext = normalizeExt(params.providedExt || inferExtensionFromMime(params.mimeType));
    return `${params.ownerId}/${params.taskId}/${crypto.randomUUID()}.${ext}`;
}
