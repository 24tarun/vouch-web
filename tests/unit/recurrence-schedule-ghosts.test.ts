import assert from "node:assert/strict";
import test from "node:test";
import {
    computeOccurrenceTimes,
    listUpcomingOccurrences,
    type RecurrenceScheduleRule,
} from "../../src/lib/recurrence-schedule";

const baseRule: RecurrenceScheduleRule = {
    id: "rule-1",
    title: "Gym",
    rule_config: { frequency: "DAILY", interval: 1, time_of_day: "18:00" },
    timezone: "Europe/Berlin",
    last_generated_date: "2026-11-22",
    paused_at: null,
    created_at: "2026-11-01T08:00:00Z",
};

const now = new Date("2026-11-22T10:00:00Z");
const weekStart = Date.parse("2026-11-22T23:00:00Z"); // Mon 23 Nov 00:00 Berlin
const weekEnd = Date.parse("2026-11-29T23:00:00Z");

test("daily ghosts cover each ungenerated day in the week", () => {
    const ghosts = listUpcomingOccurrences(baseRule, weekStart, weekEnd, now);
    assert.equal(ghosts.length, 7);
    assert.equal(ghosts[0].localDate, "2026-11-23");
    assert.equal(ghosts[0].deadlineIso, "2026-11-23T17:00:00.000Z");
    assert.equal(ghosts[0].isEvent, false);
});

test("already-generated dates and past dates never produce ghosts", () => {
    const ghosts = listUpcomingOccurrences({ ...baseRule, last_generated_date: "2026-11-25" }, weekStart, weekEnd, now);
    assert.deepEqual(ghosts.map((g) => g.localDate), ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    const pastWeek = listUpcomingOccurrences(baseRule, Date.parse("2026-11-08T23:00:00Z"), Date.parse("2026-11-15T23:00:00Z"), now);
    assert.equal(pastWeek.length, 0);
});

test("paused rules produce no ghosts", () => {
    assert.equal(listUpcomingOccurrences({ ...baseRule, paused_at: "2026-11-20T00:00:00Z" }, weekStart, weekEnd, now).length, 0);
});

test("weekly rules only land on chosen weekdays", () => {
    const rule = { ...baseRule, rule_config: { frequency: "WEEKLY" as const, interval: 1, days_of_week: [1, 3], time_of_day: "09:30" } };
    const ghosts = listUpcomingOccurrences(rule, weekStart, weekEnd, now);
    assert.deepEqual(ghosts.map((g) => g.localDate), ["2026-11-23", "2026-11-25"]);
});

test("midnight occurrences are due the following midnight, like the generator", () => {
    const rule = { ...baseRule, rule_config: { ...baseRule.rule_config, time_of_day: "00:00" } };
    assert.equal(computeOccurrenceTimes(rule, "2026-11-23").deadlineIso, "2026-11-23T23:00:00.000Z");
    const ghosts = listUpcomingOccurrences(rule, weekStart, weekEnd, now);
    // Generated Sun 22 is already done; Mon 23's instance is due Tue 00:00, ... Sun 29's is due after the week.
    assert.equal(ghosts[0].localDate, "2026-11-23");
    assert.equal(ghosts.length, 6);
});

test("event rules carry their window start", () => {
    const rule = { ...baseRule, google_sync_for_rule: true, window_start_offset_minutes: 90 };
    const [first] = listUpcomingOccurrences(rule, weekStart, weekEnd, now);
    assert.equal(first.isEvent, true);
    assert.equal(first.spanStartIso, "2026-11-23T15:30:00.000Z");
});

test("yearly rule repeats on the first deadline's date, not the day it was created", () => {
    const birthday: RecurrenceScheduleRule = {
        ...baseRule,
        rule_config: { frequency: "YEARLY", interval: 1, time_of_day: "09:00" },
        created_at: "2026-11-22T10:00:00Z",
        last_generated_date: "2027-08-24",
    };
    const ghosts = listUpcomingOccurrences(birthday, Date.parse("2026-11-23T00:00:00Z"), Date.parse("2027-12-01T00:00:00Z"), now);
    assert.deepEqual(ghosts.map((g) => g.localDate), []);
    const nextYear = listUpcomingOccurrences(birthday, Date.parse("2028-08-01T00:00:00Z"), Date.parse("2028-09-01T00:00:00Z"), new Date("2028-08-01T00:00:00Z"));
    assert.deepEqual(nextYear.map((g) => g.localDate), ["2028-08-24"]);
    assert.equal(nextYear[0].deadlineIso, "2028-08-24T07:00:00.000Z");
});

test("rules without a generated date still anchor on created_at", () => {
    const monthly: RecurrenceScheduleRule = {
        ...baseRule,
        rule_config: { frequency: "MONTHLY", interval: 1, time_of_day: "18:00" },
        created_at: "2026-10-25T08:00:00Z",
        last_generated_date: null,
    };
    assert.deepEqual(listUpcomingOccurrences(monthly, weekStart, weekEnd, now).map((g) => g.localDate), ["2026-11-25"]);
});
