import test from "node:test";
import assert from "node:assert/strict";

import {
    formatCustomDaysLabel,
    formatDeadlineLabel,
    formatDeadlineTitle,
    formatTimeUntilDeadline,
} from "../../src/components/task-input/utils/task-input-formatters";

test("formatTimeUntilDeadline returns countdown for future and passed message for past", () => {
    const now = new Date("2026-04-30T10:00:00.000Z");
    const future = formatTimeUntilDeadline(new Date("2026-04-30T11:30:00.000Z"), now);
    assert.match(future, /until deadline$/);
    assert.equal(formatTimeUntilDeadline(new Date("2026-04-30T09:59:00.000Z"), now), "Deadline passed");
});

test("formatCustomDaysLabel preserves weekday ordering independent of input order", () => {
    assert.equal(formatCustomDaysLabel([5, 1, 0]), "M F S");
    assert.equal(formatCustomDaysLabel([]), "");
});

test("deadline label/title respect mount state", () => {
    const date = new Date("2026-05-01T09:15:00.000Z");
    assert.match(formatDeadlineLabel(date, true), /\d{2}\/\d{2}\/\d{4} at \d{2}:\d{2}/);
    assert.match(formatDeadlineTitle(date, true), /\d{2}\/\d{2}\/\d{4} at \d{2}:\d{2}/);
    assert.equal(formatDeadlineLabel(date, false), "Set date");
    assert.equal(formatDeadlineTitle(date, false), "Set Date");
});
