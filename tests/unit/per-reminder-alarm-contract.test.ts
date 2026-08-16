import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const migration = readFileSync(
    join(root, "supabase/migrations/20260809211526_per_reminder_alarm_controls.sql"),
    "utf8"
);
const generator = readFileSync(join(root, "src/trigger/recurrence-generator.ts"), "utf8");
const reminderActions = readFileSync(join(root, "src/actions/tasks/subtasks.ts"), "utf8");

test("reminder alarm columns default existing and new records to normal delivery", () => {
    assert.match(
        migration,
        /ADD COLUMN IF NOT EXISTS alarm_enabled boolean NOT NULL DEFAULT false/
    );
    assert.doesNotMatch(
        migration,
        /UPDATE public\.task_reminders\s+SET alarm_enabled = (?:true|false)/
    );
    assert.match(
        migration,
        /ADD COLUMN IF NOT EXISTS alarm_reminder_offsets_ms jsonb NOT NULL DEFAULT '\[\]'::jsonb/
    );
});

test("atomic task creation remains compatible and validates aligned alarm arrays", () => {
    assert.match(migration, /RENAME TO create_task_atomic_legacy/);
    assert.match(migration, /p_reminder_alarm_enabled boolean\[\] DEFAULT ARRAY\[\]::boolean\[\]/);
    assert.match(
        migration,
        /COALESCE\(array_length\(v_alarm_flags, 1\), 0\) NOT IN \([\s\S]*COALESCE\(array_length\(v_reminder_at, 1\), 0\)/
    );
    assert.match(migration, /Reminder alarm payload is invalid/);
    assert.match(migration, /public\.create_task_atomic_legacy\(/);
});

test("authenticated reminder mutations enforce ownership and refresh recurrence metadata", () => {
    for (const functionName of [
        "add_task_reminder",
        "set_task_reminder_alarm",
        "delete_task_reminder",
    ]) {
        assert.match(migration, new RegExp(`FUNCTION public\\.${functionName}`));
    }

    assert.match(migration, /v_user_id uuid := \(SELECT auth\.uid\(\)\)/);
    assert.match(migration, /task\.user_id = v_user_id/);
    assert.match(migration, /reminder\.notified_at IS NULL/);
    assert.match(migration, /reminder\.reminder_at > NOW\(\)/);
    assert.match(migration, /PERFORM public\.refresh_recurrence_reminder_offsets/);
    assert.match(migration, /SECURITY INVOKER/);
    assert.match(migration, /TO authenticated/);
});

test("recurrence generation applies alarm offsets to manual, preset, and deadline reminders", () => {
    assert.match(generator, /alarm_reminder_offsets_ms/);
    assert.match(generator, /alarm_enabled: alarmOffsetsMs\.has/);
    assert.match(generator, /applyGeneratedAlarmOffsets/);
});

test("task-detail reminder RPC calls retain the Supabase client context", () => {
    assert.match(
        reminderActions,
        /const callReminderMutation = \(supabase\.rpc as unknown as \([\s\S]*?\)\.bind\(supabase\);/
    );
    assert.doesNotMatch(reminderActions, /const callReminderMutation = supabase\.rpc as unknown as/);
});
