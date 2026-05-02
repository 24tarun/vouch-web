import { useCallback, type ChangeEvent, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { toast } from "sonner";
import {
    finalizeTaskProofUpload,
    initAwaitingVoucherProofUpload,
    markTaskCompleteWithProofIntent,
    removeAwaitingVoucherProof,
    revertTaskCompletionAfterProofFailure,
    undoTaskComplete,
} from "@/actions/tasks";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";
import { fireCompletionConfetti } from "@/lib/confetti";
import {
    getProofIntentFromPreparedProof,
    prepareTaskProof,
    type PreparedTaskProof,
} from "@/lib/task-proof-client";
import { getVoucherResponseDeadlineLocal } from "@/lib/voucher-deadline";
import { purgeLocalProofMedia } from "@/lib/proof-media-warmup";
import { runOptimisticMutation } from "@/lib/ui/runOptimisticMutation";
import type { TaskWithRelations } from "@/lib/types";
import { getRestoredStatusFromRevertResult } from "@/app/(app)/tasks/[id]/task-detail/utils/task-detail-helpers";

export interface TaskProofDraft {
    proof: PreparedTaskProof;
    previewUrl: string;
}

interface ProofUploadTarget {
    bucket: string;
    objectPath: string;
    uploadToken?: string;
}

type ProofPickerMode = "draft" | "awaiting-upload";

interface UseTaskDetailProofArgs {
    taskState: TaskWithRelations;
    isOwner: boolean;
    isActiveParentTask: boolean;
    isSelfVouched: boolean;
    isAiVouched: boolean;
    requiresProofForCompletion: boolean;
    isBeforeStart: boolean;
    beforeStartMessage: string;
    incompleteSubtasksCount: number;
    hasIncompletePomoRequirement: boolean;
    remainingRequiredPomoSeconds: number;
    hasRunningPomoForTask: boolean;
    userTimeZone: string;
    potentialRp: number | null;
    storedProof: TaskWithRelations["completion_proof"] | null;
    proofDraft: TaskProofDraft | null;
    setProofDraft: Dispatch<SetStateAction<TaskProofDraft | null>>;
    setProofUploadError: Dispatch<SetStateAction<string | null>>;
    setTaskState: Dispatch<SetStateAction<TaskWithRelations>>;
    setActionPending: (action: string, pending: boolean) => void;
    isActionPending: (action: string) => boolean;
    refreshInBackground: () => void;
    setShowWebcamModal: Dispatch<SetStateAction<boolean>>;
    proofInputRef: MutableRefObject<HTMLInputElement | null>;
    proofPickerModeRef: MutableRefObject<ProofPickerMode>;
}

async function uploadViaTarget(uploadTarget: ProofUploadTarget, draft: TaskProofDraft) {
    const supabase = createBrowserSupabaseClient();
    return uploadTarget.uploadToken
        ? supabase.storage
            .from(uploadTarget.bucket)
            .uploadToSignedUrl(uploadTarget.objectPath, uploadTarget.uploadToken, draft.proof.file, {
                contentType: draft.proof.mimeType,
                upsert: true,
            })
        : supabase.storage
            .from(uploadTarget.bucket)
            .upload(uploadTarget.objectPath, draft.proof.file, {
                upsert: true,
                contentType: draft.proof.mimeType,
                cacheControl: "120",
            });
}

export function useTaskDetailProof({
    taskState,
    isOwner,
    isActiveParentTask,
    isSelfVouched,
    isAiVouched,
    requiresProofForCompletion,
    isBeforeStart,
    beforeStartMessage,
    incompleteSubtasksCount,
    hasIncompletePomoRequirement,
    remainingRequiredPomoSeconds,
    hasRunningPomoForTask,
    userTimeZone,
    potentialRp,
    storedProof,
    proofDraft,
    setProofDraft,
    setProofUploadError,
    setTaskState,
    setActionPending,
    isActionPending,
    refreshInBackground,
    setShowWebcamModal,
    proofInputRef,
    proofPickerModeRef,
}: UseTaskDetailProofArgs) {
    const processPickedProofFile = useCallback(async (selectedFile: File) => {
        try {
            const prepared = await prepareTaskProof(selectedFile);
            const previewUrl = URL.createObjectURL(prepared.file);
            setProofDraft({ proof: prepared, previewUrl });
            setProofUploadError(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Could not process proof file.";
            toast.error(message);
        }
    }, [setProofDraft, setProofUploadError]);

    const uploadAwaitingProofInBackground = useCallback(async (taskId: string, draft: TaskProofDraft) => {
        const init = await initAwaitingVoucherProofUpload(taskId, getProofIntentFromPreparedProof(draft.proof));
        if (init?.error) {
            setProofUploadError(init.error);
            toast.error(init.error);
            refreshInBackground();
            return;
        }

        const uploadTarget = (init as { proofUploadTarget?: ProofUploadTarget } | undefined)?.proofUploadTarget;
        if (!uploadTarget) {
            const message = "Proof upload target missing.";
            setProofUploadError(message);
            toast.error(`Proof upload failed: ${message}`);
            refreshInBackground();
            return;
        }

        const uploadResponse = await uploadViaTarget(uploadTarget, draft);
        const uploadError = uploadResponse.error;
        if (uploadError) {
            const uploadMessage = uploadError.message || "Unknown upload error";
            setProofUploadError(`Proof upload failed (${uploadMessage}). Task is still awaiting voucher.`);
            toast.error(`Proof upload failed: ${uploadMessage}`);
            refreshInBackground();
            return;
        }

        const finalize = await finalizeTaskProofUpload(taskId, {
            mediaKind: draft.proof.mediaKind,
            mimeType: draft.proof.mimeType,
            sizeBytes: draft.proof.sizeBytes,
            durationMs: draft.proof.durationMs,
            overlayTimestampText: draft.proof.overlayTimestampText,
            bucket: uploadTarget.bucket,
            objectPath: uploadTarget.objectPath,
        });

        if (finalize?.error) {
            setProofUploadError(finalize.error);
            toast.error(`Proof finalize failed: ${finalize.error}`);
            refreshInBackground();
            return;
        }

        setTaskState((prev) => ({
            ...prev,
            proof_request_open: false,
            proof_requested_at: null,
            proof_requested_by: null,
            updated_at: new Date().toISOString(),
        }));
        setProofDraft(null);
        setProofUploadError(null);
        refreshInBackground();
    }, [refreshInBackground, setProofDraft, setProofUploadError, setTaskState]);

    const uploadProofInBackground = useCallback(async (taskId: string, draft: TaskProofDraft, uploadTarget: ProofUploadTarget) => {
        const uploadResponse = await uploadViaTarget(uploadTarget, draft);
        const uploadError = uploadResponse.error;

        if (uploadError) {
            const uploadMessage = uploadError.message || "Unknown upload error";
            setProofUploadError(`Proof upload failed (${uploadMessage}). Task reverted to active state.`);
            toast.error(`Proof upload failed: ${uploadMessage}`);
            const reverted = await revertTaskCompletionAfterProofFailure(taskId);
            if (reverted?.error) toast.error(reverted.error);
            const restoredStatus = getRestoredStatusFromRevertResult(reverted);
            if (reverted?.success && restoredStatus) {
                setTaskState((prev) => ({
                    ...prev,
                    status: restoredStatus,
                    marked_completed_at: null,
                    voucher_response_deadline: null,
                    updated_at: new Date().toISOString(),
                }));
            }
            void purgeLocalProofMedia(taskId);
            refreshInBackground();
            return;
        }

        const finalize = await finalizeTaskProofUpload(taskId, {
            mediaKind: draft.proof.mediaKind,
            mimeType: draft.proof.mimeType,
            sizeBytes: draft.proof.sizeBytes,
            durationMs: draft.proof.durationMs,
            overlayTimestampText: draft.proof.overlayTimestampText,
            bucket: uploadTarget.bucket,
            objectPath: uploadTarget.objectPath,
        });

        if (finalize?.error) {
            setProofUploadError("Proof finalize failed. Task reverted to active state.");
            toast.error(`Proof upload failed: ${finalize.error}`);
            const reverted = await revertTaskCompletionAfterProofFailure(taskId);
            if (reverted?.error) toast.error(reverted.error);
            const restoredStatus = getRestoredStatusFromRevertResult(reverted);
            if (reverted?.success && restoredStatus) {
                setTaskState((prev) => ({
                    ...prev,
                    status: restoredStatus,
                    marked_completed_at: null,
                    voucher_response_deadline: null,
                    updated_at: new Date().toISOString(),
                }));
            }
            void purgeLocalProofMedia(taskId);
            refreshInBackground();
            return;
        }

        setProofDraft(null);
        setProofUploadError(null);
        refreshInBackground();
    }, [refreshInBackground, setProofDraft, setProofUploadError, setTaskState]);

    const openProofPicker = useCallback(async (mode: ProofPickerMode = "draft") => {
        const canOpenForDraft = isOwner && isActiveParentTask && !isActionPending("markComplete");
        const canOpenForAwaitingUpload =
            isOwner &&
            (
                taskState.status === "AWAITING_VOUCHER" ||
                taskState.status === "AWAITING_AI" ||
                taskState.status === "AWAITING_USER" ||
                taskState.status === "MARKED_COMPLETE"
            ) &&
            !isActionPending("awaitingProofUpload");
        if ((mode === "draft" && !canOpenForDraft) || (mode === "awaiting-upload" && !canOpenForAwaitingUpload)) return;

        if (proofDraft) {
            const shouldReplace = window.confirm("A proof file is already attached. Press OK to replace it, or Cancel to remove it.");
            if (!shouldReplace) {
                setProofDraft(null);
                setProofUploadError(null);
                return;
            }
        }

        proofPickerModeRef.current = mode;
        if ((await import("@/components/WebcamCaptureModal")).isMobileDevice()) {
            proofInputRef.current?.click();
        } else {
            setShowWebcamModal(true);
        }
    }, [
        isOwner,
        isActiveParentTask,
        isActionPending,
        taskState.status,
        proofDraft,
        setProofDraft,
        setProofUploadError,
        proofPickerModeRef,
        proofInputRef,
        setShowWebcamModal,
    ]);

    const handleProofInputChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
        const pickerMode = proofPickerModeRef.current;
        proofPickerModeRef.current = "draft";
        const selectedFile = event.target.files?.[0];
        event.target.value = "";
        if (!selectedFile) return;

        if (pickerMode === "awaiting-upload") {
            setActionPending("awaitingProofUpload", true);
            try {
                const prepared = await prepareTaskProof(selectedFile);
                const previewUrl = URL.createObjectURL(prepared.file);
                const awaitingDraft = { proof: prepared, previewUrl };

                const optimisticProof = {
                    media_kind: prepared.mediaKind,
                    mime_type: prepared.mimeType,
                    size_bytes: prepared.sizeBytes,
                    duration_ms: prepared.durationMs,
                    overlay_timestamp_text: prepared.overlayTimestampText,
                    upload_state: "UPLOADED" as const,
                    updated_at: new Date().toISOString(),
                };
                const snapshotCompletionProof = taskState.completion_proof;
                setTaskState((prev) => ({
                    ...prev,
                    completion_proof: optimisticProof as TaskWithRelations["completion_proof"],
                    proof_request_open: false,
                    proof_requested_at: null,
                    proof_requested_by: null,
                    updated_at: new Date().toISOString(),
                }));
                setProofDraft(null);
                setProofUploadError(null);

                try {
                    await uploadAwaitingProofInBackground(taskState.id, awaitingDraft);
                } catch {
                    setTaskState((prev) => ({
                        ...prev,
                        completion_proof: snapshotCompletionProof,
                    }));
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : "Could not process proof file.";
                toast.error(message);
            } finally {
                setActionPending("awaitingProofUpload", false);
            }
            return;
        }

        await processPickedProofFile(selectedFile);
    }, [
        processPickedProofFile,
        proofPickerModeRef,
        setActionPending,
        setProofDraft,
        setProofUploadError,
        setTaskState,
        taskState.completion_proof,
        taskState.id,
        uploadAwaitingProofInBackground,
    ]);

    const handleMarkComplete = useCallback(async () => {
        if (isActionPending("markComplete")) return;
        if (isBeforeStart) {
            toast.error(beforeStartMessage);
            return;
        }
        if (incompleteSubtasksCount > 0) {
            toast.error("Complete all subtasks before marking this task complete.");
            return;
        }
        if (hasIncompletePomoRequirement) {
            const remainingMinutes = Math.ceil(remainingRequiredPomoSeconds / 60);
            toast.error(`Log ${remainingMinutes} more focus minute${remainingMinutes === 1 ? "" : "s"} before marking this task complete.`);
            return;
        }
        if (hasRunningPomoForTask) {
            toast.error("Stop the running pomodoro for this task before marking it complete.");
            return;
        }
        if (requiresProofForCompletion && !proofDraft && !storedProof) {
            toast.error("Attach proof before marking this task complete.");
            return;
        }

        setActionPending("markComplete", true);
        setProofUploadError(null);
        fireCompletionConfetti();

        const now = new Date();
        const voucherResponseDeadline = getVoucherResponseDeadlineLocal(now);
        const draft = proofDraft;
        const proofIntent = draft ? getProofIntentFromPreparedProof(draft.proof) : null;
        if (proofIntent || storedProof) {
            void purgeLocalProofMedia(taskState.id);
        }

        const result = await runOptimisticMutation({
            captureSnapshot: () => ({ taskState }),
            applyOptimistic: () => {
                setTaskState((prev) => ({
                    ...prev,
                    status: isSelfVouched ? "ACCEPTED" : (isAiVouched ? "AWAITING_AI" : "AWAITING_VOUCHER"),
                    marked_completed_at: now.toISOString(),
                    voucher_response_deadline: (isSelfVouched || isAiVouched) ? null : voucherResponseDeadline.toISOString(),
                    proof_request_open: false,
                    proof_requested_at: null,
                    proof_requested_by: null,
                    updated_at: now.toISOString(),
                }));
            },
            runMutation: () => markTaskCompleteWithProofIntent(taskState.id, userTimeZone, proofIntent),
            rollback: (snapshot) => {
                setTaskState(snapshot.taskState);
            },
            onSuccess: () => {
                if (isSelfVouched) {
                    setProofDraft(null);
                    setProofUploadError(null);
                    void purgeLocalProofMedia(taskState.id);
                } else if (!proofIntent) {
                    void purgeLocalProofMedia(taskState.id);
                }
                if (potentialRp !== null && potentialRp > 0) {
                    toast.success(`You may earn +${potentialRp} RP`);
                }
                refreshInBackground();
            },
        });

        if (result.ok && draft && !isSelfVouched) {
            const mutationResult = result.result as { proofUploadTarget?: ProofUploadTarget } | undefined;
            const uploadTarget = mutationResult?.proofUploadTarget;

            if (!uploadTarget) {
                setProofUploadError("Proof upload target missing. Task reverted to active state.");
                toast.error("Proof upload failed: Upload target missing.");
                const reverted = await revertTaskCompletionAfterProofFailure(taskState.id);
                if (reverted?.error) toast.error(reverted.error);
                refreshInBackground();
            } else {
                void uploadProofInBackground(taskState.id, draft, uploadTarget);
            }
        }

        setActionPending("markComplete", false);
    }, [
        beforeStartMessage,
        hasIncompletePomoRequirement,
        hasRunningPomoForTask,
        incompleteSubtasksCount,
        isActionPending,
        isAiVouched,
        isBeforeStart,
        isSelfVouched,
        potentialRp,
        proofDraft,
        refreshInBackground,
        remainingRequiredPomoSeconds,
        requiresProofForCompletion,
        setActionPending,
        setProofDraft,
        setProofUploadError,
        setTaskState,
        storedProof,
        taskState,
        uploadProofInBackground,
        userTimeZone,
    ]);

    const handleUndoComplete = useCallback(async () => {
        if (isActionPending("undoComplete")) return;
        if (!isOwner || (taskState.status !== "AWAITING_VOUCHER" && taskState.status !== "AWAITING_AI" && taskState.status !== "MARKED_COMPLETE")) return;
        if (new Date() >= new Date(taskState.deadline)) {
            toast.error("Cannot undo completion after the deadline.");
            return;
        }

        setActionPending("undoComplete", true);
        const restoredStatus: "ACTIVE" | "POSTPONED" = taskState.postponed_at ? "POSTPONED" : "ACTIVE";
        const nowIso = new Date().toISOString();

        await runOptimisticMutation({
            captureSnapshot: () => ({ taskState }),
            applyOptimistic: () => {
                setTaskState((prev) => ({
                    ...prev,
                    status: restoredStatus,
                    marked_completed_at: null,
                    voucher_response_deadline: null,
                    proof_request_open: false,
                    proof_requested_at: null,
                    proof_requested_by: null,
                    updated_at: nowIso,
                }));
            },
            runMutation: () => undoTaskComplete(taskState.id),
            rollback: (snapshot) => {
                setTaskState(snapshot.taskState);
            },
            onSuccess: () => {
                setProofDraft(null);
                setProofUploadError(null);
                void purgeLocalProofMedia(taskState.id);
                refreshInBackground();
            },
        });

        setActionPending("undoComplete", false);
    }, [isActionPending, isOwner, refreshInBackground, setActionPending, setProofDraft, setProofUploadError, setTaskState, taskState]);

    const handleRemoveStoredProof = useCallback(async () => {
        if (isActionPending("removeStoredProof")) return;
        if (!isOwner || !storedProof) return;
        if (!["AWAITING_VOUCHER", "AWAITING_AI", "MARKED_COMPLETE"].includes(taskState.status)) {
            toast.error("Proof can only be removed while awaiting voucher response.");
            return;
        }

        setActionPending("removeStoredProof", true);
        const nowIso = new Date().toISOString();

        await runOptimisticMutation({
            captureSnapshot: () => ({ taskState }),
            applyOptimistic: () => {
                setTaskState((prev) => ({
                    ...prev,
                    completion_proof: null,
                    updated_at: nowIso,
                }));
                setProofUploadError(null);
            },
            runMutation: () => removeAwaitingVoucherProof(taskState.id),
            rollback: (snapshot) => {
                setTaskState(snapshot.taskState);
            },
            onSuccess: () => {
                void purgeLocalProofMedia(taskState.id);
                toast.success("Proof removed.");
                refreshInBackground();
            },
        });

        setActionPending("removeStoredProof", false);
    }, [isActionPending, isOwner, refreshInBackground, setActionPending, setProofUploadError, setTaskState, storedProof, taskState]);

    return {
        processPickedProofFile,
        openProofPicker,
        handleProofInputChange,
        handleMarkComplete,
        handleUndoComplete,
        handleRemoveStoredProof,
    };
}
