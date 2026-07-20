import assert from "node:assert/strict";
import test from "node:test";
import { parseHttpByteRange } from "../../src/lib/http-byte-range";

test("parses bounded, open-ended, and suffix byte ranges", () => {
    assert.deepEqual(parseHttpByteRange("bytes=10-19", 100), { start: 10, end: 19 });
    assert.deepEqual(parseHttpByteRange("bytes=90-", 100), { start: 90, end: 99 });
    assert.deepEqual(parseHttpByteRange("bytes=-10", 100), { start: 90, end: 99 });
});

test("clamps an end offset beyond the file size", () => {
    assert.deepEqual(parseHttpByteRange("bytes=90-999", 100), { start: 90, end: 99 });
});

test("rejects invalid, unsatisfiable, and multiple ranges", () => {
    assert.equal(parseHttpByteRange("bytes=100-", 100), null);
    assert.equal(parseHttpByteRange("bytes=20-10", 100), null);
    assert.equal(parseHttpByteRange("bytes=0-1,4-5", 100), null);
    assert.equal(parseHttpByteRange("items=0-1", 100), null);
});
