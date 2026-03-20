/**
 * Trigger.dev Task: AI Voucher Video Proof Evaluation
 *
 * Evaluates video proofs asynchronously. Fired after a video proof upload completes.
 * Images are evaluated synchronously in the server action (Gemini is fast enough).
 */

import { task, wait } from "@trigger.dev/sdk/v3";
import {
  notifyAiVoucherEvaluationErrorByTaskId,
  processAiVoucherDecision,
} from "@/lib/ai-voucher/evaluate";
import { setTriggerWait } from "@/lib/ai-voucher/gemini";

setTriggerWait((opts) => wait.for(opts));

export const aiVoucherEvaluate = task({
  id: "ai-voucher-evaluate",
  run: async (payload: { taskId: string }) => {
    const { taskId } = payload;
    if (!taskId) return { success: false, error: "Missing taskId" };

    console.info(`Starting AI voucher evaluation for task ${taskId}`);

    // Retry up to 3 times with exponential backoff.
    let attempt = 0;
    const maxAttempts = 3;
    let lastError: unknown;

    while (attempt < maxAttempts) {
      try {
        await processAiVoucherDecision(taskId, {
          throwOnEvaluationError: true,
          notifyOnEvaluationError: false,
        });
        console.info(`AI voucher evaluation succeeded for task ${taskId}`);
        return { success: true, taskId };
      } catch (error) {
        attempt += 1;
        lastError = error;

        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(
          `AI voucher evaluation failed (attempt ${attempt}/${maxAttempts}) for task ${taskId}: ${errorMsg}`
        );

        if (attempt < maxAttempts) {
          const backoffMs = Math.pow(2, attempt - 1) * 1000;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);
    console.error(
      `AI voucher evaluation failed after ${maxAttempts} attempts for task ${taskId}: ${errorMsg}`
    );

    await notifyAiVoucherEvaluationErrorByTaskId(taskId, lastError ?? errorMsg);

    return {
      success: false,
      taskId,
      error: errorMsg,
      message: `Failed to evaluate proof after ${maxAttempts} attempts. Task remains in AWAITING_VOUCHER.`,
    };
  },
});
