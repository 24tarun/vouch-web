import test from "node:test";
import assert from "node:assert/strict";
import { hasParserDrivenDeadlineHint, resolveTaskDeadline } from "../../src/lib/parser_keyword_resolver";

test("parser hint detection recognizes tomorrow and weekday variants", () => {
    assert.equal(hasParserDrivenDeadlineHint("ship it tmr"), true);
    assert.equal(hasParserDrivenDeadlineHint("ship it tmrw"), true);
    assert.equal(hasParserDrivenDeadlineHint("ship it @tmrw"), true);
    assert.equal(hasParserDrivenDeadlineHint("ship it tomorrow"), true);
    assert.equal(hasParserDrivenDeadlineHint("ship it wed"), true);
    assert.equal(hasParserDrivenDeadlineHint("ship it thur"), true);
    assert.equal(hasParserDrivenDeadlineHint("ship it fri"), true);
    assert.equal(hasParserDrivenDeadlineHint("ship it wednesday"), true);
    assert.equal(hasParserDrivenDeadlineHint("ship it thursday"), true);
    assert.equal(hasParserDrivenDeadlineHint("ship it @14"), true);
});

test("tmr and tmrw resolve to next-day deadline", () => {
    const now = new Date(2026, 3, 24, 10, 0, 0, 0);
    const tmrResolution = resolveTaskDeadline("finish report tmr", now, 60);
    const tmrwResolution = resolveTaskDeadline("finish report tmrw", now, 60);
    const atTmrwResolution = resolveTaskDeadline("finish report @tmrw", now, 60);

    assert.equal(tmrResolution.error, null);
    assert.equal(tmrResolution.deadline.getFullYear(), 2026);
    assert.equal(tmrResolution.deadline.getMonth(), 3);
    assert.equal(tmrResolution.deadline.getDate(), 25);
    assert.equal(tmrResolution.deadline.getHours(), 23);
    assert.equal(tmrResolution.deadline.getMinutes(), 0);

    assert.equal(tmrwResolution.error, null);
    assert.equal(tmrwResolution.deadline.getFullYear(), 2026);
    assert.equal(tmrwResolution.deadline.getMonth(), 3);
    assert.equal(tmrwResolution.deadline.getDate(), 25);
    assert.equal(tmrwResolution.deadline.getHours(), 23);
    assert.equal(tmrwResolution.deadline.getMinutes(), 0);

    assert.equal(atTmrwResolution.error, null);
    assert.equal(atTmrwResolution.deadline.getFullYear(), 2026);
    assert.equal(atTmrwResolution.deadline.getMonth(), 3);
    assert.equal(atTmrwResolution.deadline.getDate(), 25);
    assert.equal(atTmrwResolution.deadline.getHours(), 23);
    assert.equal(atTmrwResolution.deadline.getMinutes(), 0);
});

test("weekday variants and @14 parse to future deadlines", () => {
    const now = new Date(2026, 3, 24, 10, 0, 0, 0);
    const wedResolution = resolveTaskDeadline("finish report wed", now, 60);
    const thurResolution = resolveTaskDeadline("finish report thur", now, 60);
    const friResolution = resolveTaskDeadline("finish report fri", now, 60);
    const wednesdayResolution = resolveTaskDeadline("finish report wednesday", now, 60);
    const thursdayResolution = resolveTaskDeadline("finish report thursday", now, 60);
    const at14Resolution = resolveTaskDeadline("finish report @14", now, 60);

    assert.equal(wedResolution.error, null);
    assert.equal(thurResolution.error, null);
    assert.equal(friResolution.error, null);
    assert.equal(wednesdayResolution.error, null);
    assert.equal(thursdayResolution.error, null);
    assert.equal(at14Resolution.error, null);

    assert.ok(wedResolution.deadline.getTime() > now.getTime());
    assert.ok(thurResolution.deadline.getTime() > now.getTime());
    assert.ok(friResolution.deadline.getTime() > now.getTime());
    assert.ok(wednesdayResolution.deadline.getTime() > now.getTime());
    assert.ok(thursdayResolution.deadline.getTime() > now.getTime());
    assert.ok(at14Resolution.deadline.getTime() > now.getTime());
    assert.equal(at14Resolution.deadline.getHours(), 14);
    assert.equal(at14Resolution.deadline.getMinutes(), 0);
});
