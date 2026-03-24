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

    /*
     * What and why this test checks:
     * This verifies the new extracted highlight model remains text-stable while still tagging parser keywords.
     * Caret alignment depends on mirrored text having identical character order to the native input value.
     *
     * Passing scenario:
     * Rebuilt segment text exactly matches the source title and at least one segment marks the `tmrw` keyword as highlighted.
     *
     * Failing scenario:
     * If concatenated text drifts or no keyword segment is highlighted, overlay rendering can desync from typed content and regress parser highlighting.
     */
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

    /*
     * What and why this test checks:
     * This checks the completion contract used by TaskInput: suggestions are end-of-line only to avoid caret jumps in the middle of text.
     *
     * Passing scenario:
     * End-of-input caret returns a completion (`tmrw` from `tmr`) and mid-text caret returns null.
     *
     * Failing scenario:
     * If completion appears mid-text, Tab insertion can corrupt text and move caret unexpectedly.
     */
    assert.equal(atEnd?.insertText, "tmrw");
    assert.equal(atEnd?.suffix, "w");
    assert.equal(inMiddle, null);
});

test("weekday shorthand suggests full weekday keyword completion", () => {
    const completion = getParserKeywordCompletion("check mon", "check mon".length, []);

    /*
     * What and why this test checks:
     * This verifies parser autocomplete supports weekday shorthand so typing `mon` offers `monday`.
     * It keeps weekday deadlines discoverable with the same ghost-completion UX as other parser keywords.
     *
     * Passing scenario:
     * End-of-input `mon` returns `monday` with suffix `day`.
     *
     * Failing scenario:
     * If completion is missing, weekday keyword discoverability regresses and users lose expected inline assistance.
     */
    assert.equal(completion?.insertText, "monday");
    assert.equal(completion?.suffix, "day");
});

test("overlay model reports completion suffix without changing parser behavior", () => {
    const completionModel = buildTaskTitleOverlayModel("check tmr", "check tmr".length, true, false, []);
    const plainFocusedModel = buildTaskTitleOverlayModel("check dustbin", "check dustbin".length, true, false, []);
    const plainBlurredModel = buildTaskTitleOverlayModel("check dustbin", "check dustbin".length, false, false, []);

    /*
     * What and why this test checks:
     * This validates that the combined overlay model still decides visibility based on highlight/completion state.
     * The component relies on this model to render ghost suffix safely while leaving plain input rendering untouched.
     *
     * Passing scenario:
     * Partial keyword input yields a visible completion suffix, plain text while focused still shows overlay,
     * and plain text while blurred yields no overlay requirement.
     *
     * Failing scenario:
     * If plain titles force overlay or completion suffix disappears, caret stability and autocomplete UX both regress.
     */
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

    /*
     * What and why this test checks:
     * This preserves parser-compatibility in the extracted highlight helper: event time tokens with hour-only forms are valid.
     * The previous implementation highlighted these tokens through shared clock parsing, so the refactor must keep that behavior.
     *
     * Passing scenario:
     * Both `-start9` and `-end10` are represented in orange keyword segments.
     *
     * Failing scenario:
     * If either token is no longer highlighted, users see incorrect syntax feedback for parser-valid event titles.
     */
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

    /*
     * What and why this test checks:
     * This verifies the pure completion-application helper used by TaskInput for atomic text+caret updates.
     * Centralizing this logic avoids divergent inline insertion paths between component handlers.
     *
     * Passing scenario:
     * Applying completion changes `check tmr` to `check tmrw` and sets caret to the end of inserted token.
     *
     * Failing scenario:
     * If replacement range or caret index are wrong, Tab completion can duplicate text or leave caret behind.
     */
    const applied = applyParserKeywordCompletion("check tmr", completion);
    assert.equal(applied.nextTitle, "check tmrw");
    assert.equal(applied.nextCaretIndex, "check tmrw".length);
});
