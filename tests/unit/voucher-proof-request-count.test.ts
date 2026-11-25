import test from "node:test";
import assert from "node:assert/strict";
import { buildProofRequestCountByTaskId } from "../../src/lib/voucher-proof-request";

test("proof request count aggregation groups PROOF_REQUESTED rows by task id", () => {
    const rows = [
        { task_id: "task-a" },
        { task_id: "task-b" },
        { task_id: "task-a" },
        { task_id: null },
        {},
    ];

    const counts = buildProofRequestCountByTaskId(rows);

    assert.equal(counts.get("task-a"), 2);
    assert.equal(counts.get("task-b"), 1);
    assert.equal(counts.has(""), false);
});

test("proof request count defaults to zero for task ids absent from the grouped map", () => {
    const counts = buildProofRequestCountByTaskId([{ task_id: "task-a" }]);

    assert.equal(counts.get("task-missing"), undefined);
});
