import test from "node:test";
import assert from "node:assert/strict";
import {
    buildTaskTitleHighlightSegments,
    getParserKeywordCompletion,
    parseReminderTimesFromTitle,
} from "../../src/lib/task-title-parser";

test("remind@ parser accepts hour-only and compact reminder times", () => {
    const parsed = parseReminderTimesFromTitle("deep work remind@20 remind@2200 remind@08");

    assert.deepEqual(parsed, [
        { hours: 20, minutes: 0 },
        { hours: 22, minutes: 0 },
        { hours: 8, minutes: 0 },
    ]);
});

test("legacy `remind <time>` syntax is no longer parsed", () => {
    const parsed = parseReminderTimesFromTitle("legacy remind 2200 remind 08:30");

    assert.equal(parsed.length, 0);
});

test("overlay highlighting and keyword completion align with remind@ format", () => {
    const highlightSegments = buildTaskTitleHighlightSegments("plan remind@2200");
    const completion = getParserKeywordCompletion("plan remi", "plan remi".length, []);

    assert.ok(
        highlightSegments.some(
            (segment) => segment.className === "text-orange-400" && segment.text.includes("remind@2200")
        )
    );
    assert.equal(completion?.insertText, "remind@");
});

