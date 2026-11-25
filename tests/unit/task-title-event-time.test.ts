import test from "node:test";
import assert from "node:assert/strict";
import { parseClockToken, resolveEventSchedule } from "../../src/lib/task-title-event-time.ts";

function buildAnchorDate(): Date {
    return new Date(2026, 5, 1, 12, 0, 0, 0);
}

function buildNowBeforeAnchorDay(): Date {
    return new Date(2026, 4, 31, 23, 0, 0, 0);
}

function buildNowAfterAnchorDay(): Date {
    return new Date(2026, 5, 1, 23, 0, 0, 0);
}

test("parseClockToken accepts and rejects supported clock formats", () => {
    const accepted = [
        { raw: "9", expected: { hours: 9, minutes: 0 } },
        { raw: "09", expected: { hours: 9, minutes: 0 } },
        { raw: "930", expected: { hours: 9, minutes: 30 } },
        { raw: "0930", expected: { hours: 9, minutes: 30 } },
        { raw: "9:30", expected: { hours: 9, minutes: 30 } },
        { raw: "09:30", expected: { hours: 9, minutes: 30 } },
    ];

    for (const entry of accepted) {
        assert.deepEqual(parseClockToken(entry.raw), entry.expected);
    }

    assert.equal(parseClockToken("24:00"), null);
    assert.equal(parseClockToken("9960"), null);
});

test("1) -event -start930 is rejected because -end is mandatory", () => {
    const anchor = buildAnchorDate();
    const result = resolveEventSchedule({
        rawTitle: "plan sprint -event -start930",
        anchorDate: anchor,
        defaultDurationMinutes: 60,
        now: buildNowBeforeAnchorDay(),
    });

    assert.equal(result.error, "Event tasks require both -startHHMM and -endHHMM.");
    assert.equal(result.startDate, null);
    assert.equal(result.endDate, null);
});

test("2) -event -end930 is rejected because -start is mandatory", () => {
    const anchor = buildAnchorDate();
    const result = resolveEventSchedule({
        rawTitle: "deep work -event -end930",
        anchorDate: anchor,
        defaultDurationMinutes: 60,
        now: buildNowBeforeAnchorDay(),
    });

    assert.equal(result.error, "Event tasks require both -startHHMM and -endHHMM.");
    assert.equal(result.startDate, null);
    assert.equal(result.endDate, null);
});

test("3) -event -start930 -end1030 resolves explicit start/end", () => {
    const result = resolveEventSchedule({
        rawTitle: "sync -event -start930 -end1030",
        anchorDate: buildAnchorDate(),
        defaultDurationMinutes: 15,
        now: buildNowBeforeAnchorDay(),
    });

    assert.equal(result.error, undefined);
    assert.ok(result.startDate);
    assert.ok(result.endDate);
    assert.equal(result.startDate!.getHours(), 9);
    assert.equal(result.startDate!.getMinutes(), 30);
    assert.equal(result.endDate!.getHours(), 10);
    assert.equal(result.endDate!.getMinutes(), 30);
});

test("4) -event with no -start/-end is rejected as mandatory-token violation", () => {
    const result = resolveEventSchedule({
        rawTitle: "planning -event",
        anchorDate: buildAnchorDate(),
        defaultDurationMinutes: 60,
        now: buildNowBeforeAnchorDay(),
    });

    assert.equal(result.startDate, null);
    assert.equal(result.endDate, null);
    assert.equal(result.error, "Event tasks require both -startHHMM and -endHHMM.");
});

test("5) invalid -start token is rejected", () => {
    const result = resolveEventSchedule({
        rawTitle: "focus -event -start9960 -end1000",
        anchorDate: buildAnchorDate(),
        defaultDurationMinutes: 60,
        now: buildNowBeforeAnchorDay(),
    });

    assert.equal(result.error, "Event start time is invalid. Use -start930 or -start09:30.");
    assert.equal(result.startDate, null);
    assert.equal(result.endDate, null);
});

test("6) duplicate -start or -end tokens are rejected", () => {
    const duplicateStart = resolveEventSchedule({
        rawTitle: "workshop -event -start900 -start930",
        anchorDate: buildAnchorDate(),
        defaultDurationMinutes: 60,
        now: buildNowBeforeAnchorDay(),
    });
    assert.equal(duplicateStart.error, "Use only one -start token.");

    const duplicateEnd = resolveEventSchedule({
        rawTitle: "workshop -event -end900 -end930",
        anchorDate: buildAnchorDate(),
        defaultDurationMinutes: 60,
        now: buildNowBeforeAnchorDay(),
    });
    assert.equal(duplicateEnd.error, "Use only one -end token.");
});

test("7) end <= start is rejected (overnight not supported)", () => {
    const result = resolveEventSchedule({
        rawTitle: "handoff -event -start1030 -end0930",
        anchorDate: buildAnchorDate(),
        defaultDurationMinutes: 60,
        now: buildNowBeforeAnchorDay(),
    });

    assert.equal(result.error, "Event end time must be after start time.");
    assert.equal(result.startDate, null);
    assert.equal(result.endDate, null);
});

test("8) optional space formats (-start 930 / -end 09:30) are accepted", () => {
    const result = resolveEventSchedule({
        rawTitle: "review -event -start 930 -end 10:45",
        anchorDate: buildAnchorDate(),
        defaultDurationMinutes: 60,
        now: buildNowBeforeAnchorDay(),
    });

    assert.equal(result.error, undefined);
    assert.ok(result.startDate);
    assert.ok(result.endDate);
    assert.equal(result.startDate!.getHours(), 9);
    assert.equal(result.startDate!.getMinutes(), 30);
    assert.equal(result.endDate!.getHours(), 10);
    assert.equal(result.endDate!.getMinutes(), 45);
});

test("9) short and dotted aliases resolve the same as long-form start/end tokens", () => {
    const result = resolveEventSchedule({
        rawTitle: "demo prep -event -s930 .e10:45",
        anchorDate: buildAnchorDate(),
        defaultDurationMinutes: 60,
        now: buildNowBeforeAnchorDay(),
    });

    assert.equal(result.error, undefined);
    assert.ok(result.startDate);
    assert.ok(result.endDate);
    assert.equal(result.startDate!.getHours(), 9);
    assert.equal(result.startDate!.getMinutes(), 30);
    assert.equal(result.endDate!.getHours(), 10);
    assert.equal(result.endDate!.getMinutes(), 45);
});

test("10) mixed long-form and alias boundary tokens still count as duplicates", () => {
    const duplicateStart = resolveEventSchedule({
        rawTitle: "workshop -event -start900 -s930",
        anchorDate: buildAnchorDate(),
        defaultDurationMinutes: 60,
        now: buildNowBeforeAnchorDay(),
    });
    assert.equal(duplicateStart.error, "Use only one -start token.");

    const duplicateEnd = resolveEventSchedule({
        rawTitle: "workshop -event -end900 .e930",
        anchorDate: buildAnchorDate(),
        defaultDurationMinutes: 60,
        now: buildNowBeforeAnchorDay(),
    });
    assert.equal(duplicateEnd.error, "Use only one -end token.");
});

test("11) non-event title with @930 remains outside event resolver scope", () => {
    const result = resolveEventSchedule({
        rawTitle: "call mom @930",
        anchorDate: buildAnchorDate(),
        defaultDurationMinutes: 60,
        now: buildNowBeforeAnchorDay(),
    });

    assert.equal(result.hasEvent, false);
    assert.equal(result.startDate, null);
    assert.equal(result.endDate, null);
    assert.equal(result.error, undefined);
});

test("12) -event with @930 but no -start still fails mandatory-token rule", () => {
    const result = resolveEventSchedule({
        rawTitle: "planning -event @930",
        anchorDate: buildAnchorDate(),
        defaultDurationMinutes: 60,
        now: buildNowBeforeAnchorDay(),
    });

    assert.equal(result.error, "Event tasks require both -startHHMM and -endHHMM.");
    assert.equal(result.startDate, null);
    assert.equal(result.endDate, null);
});

test("13) -event with -start/-end plus @930 is rejected as duplicate end", () => {
    const result = resolveEventSchedule({
        rawTitle: "planning -event -start930 -end1030 @930",
        anchorDate: buildAnchorDate(),
        defaultDurationMinutes: 60,
        now: buildNowBeforeAnchorDay(),
    });

    assert.equal(result.error, "Use only one -end token.");
    assert.equal(result.startDate, null);
    assert.equal(result.endDate, null);
});

test("14) past event windows are accepted when start/end are in the past", () => {
    const result = resolveEventSchedule({
        rawTitle: "retro log -event -start900 -end1000",
        anchorDate: buildAnchorDate(),
        defaultDurationMinutes: 60,
        now: buildNowAfterAnchorDay(),
    });

    assert.equal(result.error, undefined);
    assert.ok(result.startDate);
    assert.ok(result.endDate);
    assert.equal(result.startDate!.getHours(), 9);
    assert.equal(result.endDate!.getHours(), 10);
});
