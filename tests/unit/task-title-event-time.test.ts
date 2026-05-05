import test from "node:test";
import assert from "node:assert/strict";
import { parseClockToken, resolveEventSchedule } from "../../src/lib/task-title-event-time.ts";

function buildAnchorDate(): Date {
    // We intentionally use a fixed local-calendar date for deterministic assertions.
    // The parser sets hours/minutes onto this "anchor day".
    return new Date(2026, 5, 1, 12, 0, 0, 0); // June 1, 2026 local time
}

function buildNowBeforeAnchorDay(): Date {
    // "Now" is controlled so tests don't flake across real-time execution.
    // This guarantees normal daytime event starts on anchor day remain in the future.
    return new Date(2026, 4, 31, 23, 0, 0, 0); // May 31, 2026 23:00 local
}

function buildNowAfterAnchorDay(): Date {
    // This timestamp is intentionally later than anchor-day event times so we can
    // validate past-event acceptance without relying on wall-clock execution time.
    return new Date(2026, 5, 1, 23, 0, 0, 0); // June 1, 2026 23:00 local
}

test("parseClockToken accepts and rejects supported clock formats", () => {
    /*
     * WHAT + WHY:
     * This test validates the low-level clock parser used by both -start and -end token handling.
     * If this parser is wrong, all higher-level event schedule behavior becomes inconsistent.
     *
     * PASSING SCENARIO:
     * Supported formats (9, 09, 930, 0930, 9:30, 09:30) should parse into exact hour/minute values.
     *
     * FAILING SCENARIO:
     * Invalid values (like 24:00 or 99:60) must return null to prevent invalid event schedules.
     */
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
    /*
     * What and why this test checks:
     * Event mode now requires both boundary tokens, so start-only input must be rejected deterministically.
     *
     * Passing scenario:
     * Resolver returns the strict missing-boundary validation error and no resolved start/end dates.
     *
     * Failing scenario:
     * If start-only resolves successfully, users can bypass the required dual-boundary contract.
     */
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
    /*
     * What and why this test checks:
     * Event mode now requires both boundary tokens, so end-only input must be rejected deterministically.
     *
     * Passing scenario:
     * Resolver returns the strict missing-boundary validation error and no resolved start/end dates.
     *
     * Failing scenario:
     * If end-only resolves successfully, users can bypass the required dual-boundary contract.
     */
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
    /*
     * WHAT + WHY:
     * This verifies explicit dual-token behavior where user provides both boundaries.
     * When both are present, resolver must honor both exactly (not auto-fill).
     *
     * PASSING SCENARIO:
     * "-start930 -end1030" should produce 09:30 to 10:30 exactly.
     *
     * FAILING SCENARIO:
     * If parser overrides one boundary with default duration, explicit user intent is lost.
     */
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
    /*
     * What and why this test checks:
     * This enforces the strict rule that event tasks must provide both boundary tokens.
     * Without this check, events would silently fallback and violate product requirements.
     *
     * Passing scenario:
     * Resolver returns a validation error for "-event" without start/end.
     *
     * Failing scenario:
     * If this returned success, event tasks could be created with ambiguous time semantics.
     */
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
    /*
     * WHAT + WHY:
     * Invalid time fragments must be rejected to prevent malformed schedules from entering DB/API flow.
     *
     * PASSING SCENARIO:
     * "-start9960" should fail because 99:60 is not a valid clock time.
     *
     * FAILING SCENARIO:
     * If accepted, parser would create impossible times and downstream logic (calendar sync/reminders) could break.
     */
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
    /*
     * WHAT + WHY:
     * Duplicate boundary tokens introduce conflicting intent.
     * The parser is intentionally strict to keep behavior predictable and auditable.
     *
     * PASSING SCENARIO:
     * A title with duplicate -start should fail with duplicate-token error.
     *
     * FAILING SCENARIO:
     * If parser accepted duplicates and picked one arbitrarily, users would see non-deterministic schedules.
     */
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
    /*
     * WHAT + WHY:
     * Product rule explicitly rejects overnight interpretation for this migration.
     * Therefore, same-day end must be strictly greater than start.
     *
     * PASSING SCENARIO:
     * "-start1030 -end0930" should fail with end-before-start error.
     *
     * FAILING SCENARIO:
     * If this passed, parser would implicitly allow overnight events, contradicting agreed scope.
     */
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
    /*
     * WHAT + WHY:
     * This validates UX-friendly token parsing with optional whitespace.
     * Users often type a space after token keyword; parser should still accept valid forms.
     *
     * PASSING SCENARIO:
     * "-start 930 -end 10:45" should parse and resolve successfully.
     *
     * FAILING SCENARIO:
     * If optional-space regex support regresses, these common inputs would be rejected unexpectedly.
     */
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
    /*
     * WHAT + WHY:
     * This verifies the new parser aliases requested for ergonomics.
     * The aliases .s/-s and .e/-e must behave exactly like -start and -end so users can type shorter event syntax.
     *
     * PASSING SCENARIO:
     * Titles using "-s" with ".e" resolve to the same explicit same-day schedule as long-form tokens.
     *
     * FAILING SCENARIO:
     * If aliases are ignored or parsed inconsistently, these shorthand titles would either fail validation
     * or produce incorrect start/end times.
     */
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
    /*
     * WHAT + WHY:
     * This ensures aliases feed the same duplicate-detection rules as the original tokens.
     * Without this, a title could sneak in conflicting boundaries by mixing token spellings.
     *
     * PASSING SCENARIO:
     * Using "-start" with "-s" or "-end" with ".e" returns the same duplicate-token errors as before.
     *
     * FAILING SCENARIO:
     * If aliases are treated as separate token families, conflicting boundaries would be accepted and parsed arbitrarily.
     */
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
    /*
     * WHAT + WHY:
     * This verifies boundary between event parser and legacy non-event @ parser.
     * The shared event resolver should do nothing when -event is absent.
     *
     * PASSING SCENARIO:
     * Title without -event returns hasEvent=false and no schedule/error.
     *
     * FAILING SCENARIO:
     * If resolver tried to parse @ tokens here, it would conflict with existing non-event deadline flow.
     */
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
    /*
     * What and why this test checks:
     * This verifies @time is now treated as an end-time alias for event tasks.
     * Event tasks still require a start token, so @time alone cannot produce a full window.
     *
     * Passing scenario:
     * "-event @930" fails with the missing-time error because -start is absent.
     *
     * Failing scenario:
     * If this returns a mixed-syntax error, the resolver is still applying the old @ rejection logic.
     */
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
    /*
     * What and why this test checks:
     * This ensures @time maps to event end-time semantics and conflicts with explicit -end.
     *
     * Passing scenario:
     * Resolver rejects title with duplicate end specification and does not resolve a schedule.
     *
     * Failing scenario:
     * If resolver accepts this title, users can submit conflicting end-times and create ambiguous events.
     */
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
    /*
     * WHAT + WHY:
     * Product behavior now allows creating calendar-block events in the past.
     * This test ensures parser no longer rejects schedules solely because start is before now.
     *
     * PASSING SCENARIO:
     * With now at 23:00, "-start900 -end1000" on the same anchor day still resolves successfully.
     *
     * FAILING SCENARIO:
     * If legacy future-start enforcement still exists, resolver would return
     * "Event start time must be in the future." and block this use case.
     */
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
