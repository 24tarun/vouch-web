import test from "node:test";
import assert from "node:assert/strict";
import {
    buildTaskTitleHighlightSegments,
    getParserKeywordCompletion,
    parseProofRequiredFromTitle,
    stripProofRequiredTokens,
} from "../../src/lib/task-title-parser.ts";

test("proof parser token detection and stripping are deterministic", () => {
    const titleWithProof = "send update -proof tomorrow";
    const titleWithoutProof = "send update tomorrow";

    assert.equal(parseProofRequiredFromTitle(titleWithProof), true);
    assert.equal(parseProofRequiredFromTitle(titleWithoutProof), false);
    assert.equal(stripProofRequiredTokens(titleWithProof), "send update tomorrow");
    assert.equal(stripProofRequiredTokens("send update -proof"), "send update");
});

test("proof keyword participates in parser autocomplete and highlight model", () => {
    const completion = getParserKeywordCompletion("send update -proo", "send update -proo".length, []);
    const segments = buildTaskTitleHighlightSegments("send update -proof");

    assert.equal(completion?.insertText, "-proof");
    assert.equal(completion?.suffix, "f");
    assert.ok(
        segments.some(
            (segment) => segment.className === "text-orange-400" && segment.text.includes("-proof")
        )
    );
});
