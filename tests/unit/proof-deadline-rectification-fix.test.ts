import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationName = '20260803063210_fix_proof_deadline_and_rectification.sql';
const webMigration = readFileSync(resolve(process.cwd(), 'supabase/migrations', migrationName), 'utf8');
const mobileMigration = readFileSync(resolve(process.cwd(), '../vouch-mobile/supabase/migrations', migrationName), 'utf8');

test('web and mobile ship the same deadline and rectification fix migration', () => {
    assert.equal(webMigration, mobileMigration);
});

test('rectification approval qualifies columns that conflict with output variables', () => {
    assert.match(webMigration, /FROM public\.rectify_passes AS rp[\s\S]*WHERE rp\.user_id = NEW\.user_id/);
    assert.match(webMigration, /FROM public\.rectify_passes AS rp[\s\S]*WHERE rp\.task_id = v_request\.task_id/);
    assert.match(webMigration, /FROM public\.ledger_entries AS le[\s\S]*WHERE le\.task_id = v_request\.task_id/);
    assert.doesNotMatch(webMigration, /WHERE task_id = v_request\.task_id/);
});

test('proof finalization locks the task and enforces the inclusive deadline minute atomically', () => {
    assert.match(webMigration, /FROM public\.tasks AS t[\s\S]*FOR UPDATE/);
    assert.match(webMigration, /v_task_status <> p_task_status/);
    assert.match(webMigration, /v_proof_staged_at >= v_task_deadline \+ interval '1 minute'/);
    assert.match(webMigration, /v_task_status IN \([\s\S]*'ACTIVE','POSTPONED','AWAITING_VOUCHER','AWAITING_AI','MARKED_COMPLETE'[\s\S]*\)/);
    assert.doesNotMatch(webMigration, /v_task_status IN \([\s\S]*'AWAITING_USER'[\s\S]*\)/);
    assert.match(webMigration, /GRANT EXECUTE ON FUNCTION public\.finalize_task_proof_atomic\([\s\S]*TO service_role/);
});

test('shared upload sources reject active late proof and discard only the same pending upload', () => {
    const webUpload = readFileSync(resolve(process.cwd(), 'supabase/edgefunctions/task-proof-upload.ts'), 'utf8');
    const mobileUpload = readFileSync(resolve(process.cwd(), '../vouch-mobile/supabase/functions/task-proof-upload/index.ts'), 'utf8');
    const webDeadline = readFileSync(resolve(process.cwd(), 'supabase/edgefunctions/task-proof-deadline.ts'), 'utf8');
    const mobileDeadline = readFileSync(resolve(process.cwd(), '../vouch-mobile/supabase/functions/task-proof-upload/task-proof-deadline.ts'), 'utf8');

    assert.equal(webUpload, mobileUpload);
    assert.equal(webDeadline, mobileDeadline);
    assert.match(webDeadline, /'ACTIVE',[\s\S]*'POSTPONED'/);
    assert.match(webUpload, /const discardPendingProof = async \(\)/);
    assert.match(webUpload, /\.eq\('upload_state', 'PENDING'\)/);
    assert.match(webUpload, /failQuery = failQuery\.eq\('updated_at', proofStagedAt\)/);
    assert.match(webUpload, /await discardPendingProof\(\);[\s\S]*COMPLETION_EDIT_LOCKED_ERROR/);
});
