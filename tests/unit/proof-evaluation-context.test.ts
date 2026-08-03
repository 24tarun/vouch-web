import test from "node:test";
import assert from "node:assert/strict";
import { buildProofEvaluationSystemPrompt } from "../../src/lib/ai-voucher/proof-evaluation-context.ts";

test("ordinary AI evaluation uses the effective postponed deadline", () => {
    const prompt = buildProofEvaluationSystemPrompt({
        taskTitle: "Track weight",
        timing: {
            mode: "completion",
            originalDeadline: "2026-08-02T06:00:00.000Z",
            effectiveDeadline: "2026-08-02T08:00:00.000Z",
            postponedAt: "2026-08-02T05:00:00.000Z",
            proofTimestampAt: "2026-08-02T08:05:00.000Z",
            proofTimestampSource: "CAMERA_CAPTURE",
            proofTimezone: "Europe/Berlin",
        },
    });

    assert.match(prompt, /Original deadline: 2026-08-02T06:00:00.000Z/);
    assert.match(prompt, /Effective deadline: 2026-08-02T08:00:00.000Z/);
    assert.match(prompt, /effective deadline is authoritative/i);
    assert.match(prompt, /after the effective deadline, deny the proof/i);
});

test("rectification permits credible proof captured after the deadline", () => {
    const prompt = buildProofEvaluationSystemPrompt({
        taskTitle: "Track weight",
        taskDescription: "Original outcome: MISSED.\n\nRectification context: completed after waking late.",
        timing: {
            mode: "rectification",
            originalDeadline: "2026-08-02T08:00:00.000Z",
            effectiveDeadline: "2026-08-02T08:00:00.000Z",
            proofTimestampAt: "2026-08-02T09:00:00.000Z",
            proofTimestampSource: "EXIF",
            proofTimezone: "Europe/Berlin",
        },
    });

    assert.match(prompt, /Completion after the effective deadline is allowed/);
    assert.match(prompt, /09:00 proof may rectify an 08:00 task/);
    assert.match(prompt, /visible media credibly demonstrates/);
});

test("attachment fallback is never represented as capture time", () => {
    const prompt = buildProofEvaluationSystemPrompt({
        taskTitle: "Track weight",
        timing: {
            mode: "rectification",
            effectiveDeadline: "2026-08-02T08:00:00.000Z",
            proofTimestampAt: "2026-08-02T16:00:00.000Z",
            proofTimestampSource: "ATTACHED",
            proofTimezone: "Europe/Berlin",
        },
    });

    assert.match(prompt, /ATTACHED means Vouch could not recover the original capture time/);
    assert.doesNotMatch(prompt, /Proof evidence timestamp: Unavailable/);
});
