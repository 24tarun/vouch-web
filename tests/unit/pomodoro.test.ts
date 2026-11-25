import test from "node:test";
import assert from "node:assert/strict";
import { MAX_POMO_DURATION_MINUTES } from "../../src/lib/constants.ts";
import {
    isValidPomoDurationMinutes,
    normalizePomoDurationMinutes,
    parseRequiredPomoFromTitle,
} from "../../src/lib/pomodoro.ts";

test("Pomodoro duration validation accepts only integers from 1 through 120", () => {
    assert.equal(isValidPomoDurationMinutes(1), true);
    assert.equal(isValidPomoDurationMinutes(MAX_POMO_DURATION_MINUTES), true);
    assert.equal(isValidPomoDurationMinutes(0), false);
    assert.equal(isValidPomoDurationMinutes(MAX_POMO_DURATION_MINUTES + 1), false);
    assert.equal(isValidPomoDurationMinutes(25.5), false);
});

test("normalizePomoDurationMinutes clamps legacy values above the cap but preserves valid defaults", () => {
    assert.equal(normalizePomoDurationMinutes(45), 45);
    assert.equal(normalizePomoDurationMinutes(180), MAX_POMO_DURATION_MINUTES);
    assert.equal(normalizePomoDurationMinutes("bad-value"), 25);
});

test("parseRequiredPomoFromTitle accepts pomo 120 and rejects values above the cap", () => {
    assert.deepEqual(parseRequiredPomoFromTitle("Write report pomo 120"), {
        requiredPomoMinutes: MAX_POMO_DURATION_MINUTES,
    });
    assert.deepEqual(parseRequiredPomoFromTitle("Write report"), {
        requiredPomoMinutes: null,
    });

    const overCap = parseRequiredPomoFromTitle("Write report pomo 121");
    assert.equal(overCap.requiredPomoMinutes, null);
    assert.equal(
        overCap.error,
        `Required Pomodoro minutes must be an integer between 1 and ${MAX_POMO_DURATION_MINUTES}.`
    );
});
