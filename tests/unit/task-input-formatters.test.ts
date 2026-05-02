import test from "node:test";
import assert from "node:assert/strict";

import {
    formatCustomDaysLabel,
    formatDeadlineLabel,
    formatDeadlineTitle,
    formatTimeUntilDeadline,
} from "../../src/components/task-input/utils/task-input-formatters";

test("formatTimeUntilDeadline returns countdown for future and passed message for past", () => {
    // What/why: verifies extracted deadline countdown text is stable for TaskInput UI labels.
    const now = new Date("2026-04-30T10:00:00.000Z");
    // Passing scenario: future deadline produces a human-readable "until deadline" message.
    const future = formatTimeUntilDeadline(new Date("2026-04-30T11:30:00.000Z"), now);
    assert.match(future, /until deadline$/);
    // Failing scenario: passed deadline must not return a countdown and should show terminal text.
    assert.equal(formatTimeUntilDeadline(new Date("2026-04-30T09:59:00.000Z"), now), "Deadline passed");
});

test("formatCustomDaysLabel preserves weekday ordering independent of input order", () => {
    // What/why: ensures recurrence chip labels remain deterministic after utility extraction.
    // Passing scenario: unordered selected days are normalized to weekday order.
    assert.equal(formatCustomDaysLabel([5, 1, 0]), "M F S");
    // Failing scenario: empty selection should not fabricate day labels.
    assert.equal(formatCustomDaysLabel([]), "");
});

test("deadline label/title respect mount state", () => {
    const date = new Date("2026-05-01T09:15:00.000Z");
    // What/why: guards SSR/hydration behavior where labels must stay neutral before mount.
    // Passing scenario: mounted renders full formatted date title/label.
    assert.match(formatDeadlineLabel(date, true), /\d{2}\/\d{2}\/\d{4} at \d{2}:\d{2}/);
    assert.match(formatDeadlineTitle(date, true), /\d{2}\/\d{2}\/\d{4} at \d{2}:\d{2}/);
    // Failing scenario: before mount we should show placeholders instead of date text.
    assert.equal(formatDeadlineLabel(date, false), "Set date");
    assert.equal(formatDeadlineTitle(date, false), "Set Date");
});
