import test from "node:test";
import assert from "node:assert/strict";
import {
    GOOGLE_EVENT_COLOR_OPTIONS,
    findNearestColorHelperToken,
    isGoogleEventColorId,
    replaceNearestColorHelperToken,
    resolveEventColorFromTitle,
    stripEventColorTokens,
    validateEventColorUsage,
} from "../../src/lib/task-title-event-color.ts";

test("1) alias token resolves to expected Google colorId", () => {
    const result = resolveEventColorFromTitle("focus block -event -pink");
    assert.equal(result.colorId, "4");
    assert.equal(result.aliasToken, "-pink");
    assert.equal(result.nativeToken, "-flamingo");
});

test("2) native token resolves to canonical alias and colorId", () => {
    const result = resolveEventColorFromTitle("focus block -event -flamingo");
    assert.equal(result.colorId, "4");
    assert.equal(result.aliasToken, "-pink");
    assert.equal(result.nativeToken, "-flamingo");
});

test("3) alias variants resolve to lgreen/lblue mappings", () => {
    const green = resolveEventColorFromTitle("review -event -lightgreen");
    assert.equal(green.colorId, "2");
    assert.equal(green.aliasToken, "-lgreen");

    const blue = resolveEventColorFromTitle("review -event -light-blue");
    assert.equal(blue.colorId, "7");
    assert.equal(blue.aliasToken, "-lblue");
});

test("4) multiple color tokens use last-valid-wins rule", () => {
    const result = resolveEventColorFromTitle("xyz -event -red -blue -pink");
    assert.equal(result.colorId, "4");
    assert.equal(result.aliasToken, "-pink");
});

test("5) non-event color usage is blocked by shared validator", () => {
    const withColor = validateEventColorUsage("write docs -pink", false);
    assert.match(withColor.error ?? "", /only for -event/i);

    const withHelper = validateEventColorUsage("write docs -color", false);
    assert.match(withHelper.error ?? "", /only for -event/i);
});

test("6) unresolved -color helper is rejected for event titles", () => {
    const unresolved = validateEventColorUsage("planning -event -color", true);
    assert.match(unresolved.error ?? "", /choose a color token/i);
});

test("7) nearest helper token is selected based on caret position", () => {
    const title = "plan -event -color later notes -color";
    const first = findNearestColorHelperToken(title, title.indexOf("-color") + 2);
    assert.ok(first);
    assert.equal(first?.token.toLowerCase(), "-color");

    const second = findNearestColorHelperToken(title, title.lastIndexOf("-color") + 2);
    assert.ok(second);
    assert.equal(second?.token.toLowerCase(), "-color");
});

test("8) helper replacement swaps nearest token and returns next caret index", () => {
    const title = "focus -event -color block";
    const caret = title.indexOf("-color") + 3;
    const replacement = replaceNearestColorHelperToken(title, caret, "-pink");

    assert.equal(replacement.replaced, true);
    assert.equal(replacement.nextTitle, "focus -event -pink block");
    assert.equal(replacement.nextCaretIndex, "focus -event -pink".length);
});

test("9) stripping removes helper/color tokens while preserving non-color metadata", () => {
    const stripped = stripEventColorTokens("xyz -event -start0900 -color -pink notes");
    assert.equal(stripped, "xyz -event -start0900 notes");
});

test("10) palette exports contain exactly 11 unique valid Google color IDs", () => {
    const ids = GOOGLE_EVENT_COLOR_OPTIONS.map((option) => option.colorId);
    const unique = new Set(ids);
    assert.equal(GOOGLE_EVENT_COLOR_OPTIONS.length, 11);
    assert.equal(unique.size, 11);
    for (const id of unique) {
        assert.equal(isGoogleEventColorId(id), true);
    }
});

test("11) color-id validator rejects out-of-range values", () => {
    assert.equal(isGoogleEventColorId("1"), true);
    assert.equal(isGoogleEventColorId("11"), true);
    assert.equal(isGoogleEventColorId("12"), false);
    assert.equal(isGoogleEventColorId("0"), false);
});
