import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260810191419_task_state_commands_v2.sql"),
    "utf8"
);
const aiOrchestration = readFileSync(
    join(process.cwd(), "supabase/edgefunctions/task-proof-upload.ts"),
    "utf8"
);

const commandNames = [
    "complete_task_v2",
    "postpone_task_v2",
    "undo_task_completion_v2",
    "delete_task_v2",
    "surrender_task_v2",
    "decide_voucher_task_v2",
    "submit_ai_appeal_v2",
    "escalate_ai_task_v2",
    "accept_ai_denial_v2",
    "override_task_v2",
];

test("defines additive uniquely named task command RPCs", () => {
    for (const command of commandNames) {
        assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${command}\\(`));
        assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${command}\\([^;]+ TO authenticated;`));
        assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${command}\\([^;]+ FROM PUBLIC, anon;`));
    }
});

test("commands lock task rows and return the common result envelope", () => {
    assert.match(migration, /FOR UPDATE/g);
    assert.match(migration, /'success', true/);
    assert.match(migration, /'fromStatus'/);
    assert.match(migration, /'toStatus'/);
    assert.match(migration, /'success', false/);
    assert.match(migration, /'code'/);
    assert.match(migration, /'message'/);
});

test("completion derives its destination and never accepts a client next status", () => {
    const completion = migration.slice(
        migration.indexOf("CREATE OR REPLACE FUNCTION public.complete_task_v2"),
        migration.indexOf("CREATE OR REPLACE FUNCTION public.postpone_task_v2")
    );
    assert.doesNotMatch(completion, /p_next_status/);
    assert.match(completion, /v_next_status := 'ACCEPTED'/);
    assert.match(completion, /v_next_status := 'AWAITING_AI'/);
    assert.match(completion, /v_next_status := 'AWAITING_VOUCHER'/);
    assert.match(completion, /task_subtasks/);
    assert.match(completion, /task_completion_proofs/);
    assert.match(completion, /pomo_sessions/);
    assert.match(completion, /FOR UPDATE/);
});

test("failure ledger and event writes stay database-side", () => {
    assert.match(migration, /INSERT INTO public\.ledger_entries/);
    assert.match(migration, /INSERT INTO public\.task_events/g);
    assert.match(migration, /INSERT INTO public\.overrides/);
});

test("every command transaction enqueues its calendar outbox intent", () => {
    for (let index = 0; index < commandNames.length; index += 1) {
        const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${commandNames[index]}`);
        const nextName = commandNames[index + 1];
        const end = nextName
            ? migration.indexOf(`CREATE OR REPLACE FUNCTION public.${nextName}`)
            : migration.indexOf("REVOKE ALL ON FUNCTION public.complete_task_v2");
        const command = migration.slice(start, end);
        assert.match(command, /private\.enqueue_task_calendar_(?:upsert|delete)\(v_task\)/);
    }
});

test("AI command orchestration returns success only after dispatch and compensates atomically", () => {
    assert.match(aiOrchestration, /action: 'complete-task-command'/);
    assert.match(aiOrchestration, /action: 'submit-ai-appeal-command'/);
    assert.match(aiOrchestration, /reserve_ai_voucher_credit/);
    assert.match(aiOrchestration, /rollback_ai_voucher_submission/);
    assert.match(aiOrchestration, /if \(!triggerRes\.ok\)[\s\S]*compensateFailedQueue/);
    assert.match(aiOrchestration, /return json\(200, taskCommandResult \?\? \{ success: true \}\)/);

    const compensation = migration.slice(
        migration.indexOf("CREATE OR REPLACE FUNCTION public.rollback_ai_voucher_submission"),
        migration.indexOf("CREATE OR REPLACE FUNCTION public.complete_task_v2")
    );
    assert.match(compensation, /FOR UPDATE/);
    assert.match(compensation, /UPDATE public\.ai_voucher_usage/);
    assert.match(compensation, /state = 'released'/);
    assert.match(compensation, /UPDATE public\.tasks/);
});
