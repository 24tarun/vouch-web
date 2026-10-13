import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSql = readFileSync(
    new URL("../../supabase/migrations/20260912103958_preserve_task_subtasks_on_completion.sql", import.meta.url),
    "utf8"
);
const initialSchemaSql = readFileSync(
    new URL("../../supabase/migrations/001_initial_schema.sql", import.meta.url),
    "utf8"
);

test("completion no longer deletes subtasks", () => {
    assert.match(
        migrationSql,
        /DROP TRIGGER IF EXISTS tasks_delete_subtasks_on_completion ON public\.tasks/i
    );
    assert.match(
        migrationSql,
        /DROP FUNCTION IF EXISTS public\.delete_subtasks_on_task_completion\(\)/i
    );
    assert.doesNotMatch(migrationSql, /DELETE FROM public\.task_subtasks/i);
});

test("deleting the parent task still cascades to subtasks", () => {
    assert.match(
        initialSchemaSql,
        /task_subtasks_parent_task_id_fkey[\s\S]*?FOREIGN KEY \(parent_task_id\) REFERENCES public\.tasks \(id\) ON DELETE CASCADE/i
    );
});
