import { task, wait } from "@trigger.dev/sdk/v3";
import {
    notifyAiRectificationTechnicalFailure,
    processAiRectificationDecision,
} from "@/lib/ai-voucher/rectification";
import { setTriggerWait } from "@/lib/ai-voucher/gemini";

setTriggerWait((options) => wait.for(options));

export const aiRectificationEvaluate = task({
    id: "ai-rectification-evaluate",
    run: async (payload: { requestId: string }) => {
        if (!payload.requestId) return { success: false, error: "Missing requestId" };
        let lastError: unknown;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                const result = await processAiRectificationDecision(payload.requestId, {
                    throwOnEvaluationError: true,
                });
                return { success: true, requestId: payload.requestId, result };
            } catch (error) {
                lastError = error;
                if (attempt < 3) await wait.for({ seconds: 2 ** (attempt - 1) });
            }
        }
        await notifyAiRectificationTechnicalFailure(payload.requestId);
        return {
            success: false,
            requestId: payload.requestId,
            error: lastError instanceof Error ? lastError.message : String(lastError),
        };
    },
});
