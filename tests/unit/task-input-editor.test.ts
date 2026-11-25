import test from "node:test";
import assert from "node:assert/strict";
import {
    applyParserKeywordCompletion,
    buildTaskTitleHighlightSegments,
    buildTaskTitleOverlayModel,
    getParserKeywordCompletion,
} from "../../src/lib/task-input-editor";

test("highlight model preserves original text and marks keyword tokens", () => {
    const title = "check dustbin emptiness tmrw";
    const segments = buildTaskTitleHighlightSegments(title);
    const rebuilt = segments.map((segment) => segment.text).join("");

    assert.equal(rebuilt, title);
    assert.ok(
        segments.some(
            (segment) =>
                segment.className === "text-orange-400" &&
                segment.text.toLowerCase().includes("tmrw")
        )
    );
});

test("keyword completion triggers only at end-of-input", () => {
    const text = "check tmr";
    const atEnd = getParserKeywordCompletion(text, text.length, []);
    const inMiddle = getParserKeywordCompletion(text, text.length - 1, []);

    assert.equal(atEnd?.insertText, "tmrw");
    assert.equal(atEnd?.suffix, "w");
    assert.equal(inMiddle, null);
});

test("weekday shorthand suggests full weekday keyword completion", () => {
    const completion = getParserKeywordCompletion("check mon", "check mon".length, []);

    assert.equal(completion?.insertText, "monday");
    assert.equal(completion?.suffix, "day");
});

test("overlay model reports completion suffix without changing parser behavior", () => {
    const completionModel = buildTaskTitleOverlayModel("check tmr", "check tmr".length, true, false, []);
    const plainFocusedModel = buildTaskTitleOverlayModel("check dustbin", "check dustbin".length, true, false, []);
    const plainBlurredModel = buildTaskTitleOverlayModel("check dustbin", "check dustbin".length, false, false, []);

    assert.equal(completionModel.inlineKeywordCompletion?.suffix, "w");
    assert.equal(completionModel.showTitleOverlay, true);
    assert.equal(plainFocusedModel.inlineKeywordCompletion, null);
    assert.equal(plainFocusedModel.showTitleOverlay, true);
    assert.equal(plainBlurredModel.inlineKeywordCompletion, null);
    assert.equal(plainBlurredModel.showTitleOverlay, false);
});

test("event hour-only start/end tokens remain highlighted as valid parser inputs", () => {
    const title = "sync -event -start9 -end10";
    const segments = buildTaskTitleHighlightSegments(title);

    assert.ok(
        segments.some(
            (segment) => segment.className === "text-orange-400" && segment.text.includes("-start9")
        )
    );
    assert.ok(
        segments.some(
            (segment) => segment.className === "text-orange-400" && segment.text.includes("-end10")
        )
    );
});

test("completion application helper replaces only fragment and returns exact caret index", () => {
    const completion = getParserKeywordCompletion("check tmr", "check tmr".length, []);
    assert.ok(completion);

    const applied = applyParserKeywordCompletion("check tmr", completion);
    assert.equal(applied.nextTitle, "check tmrw");
    assert.equal(applied.nextCaretIndex, "check tmrw".length);
});
