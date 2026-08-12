import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
    new URL("../../supabase/migrations/20260809211047_auto_end_pomodoro_on_owner_exit.sql", import.meta.url),
    "utf8"
);
const mobileBackgroundFixSql = readFileSync(
    new URL("../../supabase/migrations/20260809213120_exclude_backgrounded_mobile_pomos_from_heartbeat_timeout.sql", import.meta.url),
    "utf8"
);

test("owner lifecycle migration schedules stale Pomodoro completion", () => {
    assert.match(sql, /ADD COLUMN close_requested_at timestamp with time zone/i);
    assert.match(sql, /ADD COLUMN owner_heartbeat_at timestamp with time zone/i);
    assert.match(sql, /ps\.owner_heartbeat_at <= clock_timestamp\(\) - interval '45 seconds'/i);
    assert.match(sql, /owner_heartbeat_at IS NOT NULL/i);
    assert.match(sql, /ps\.close_requested_at <= clock_timestamp\(\) - interval '5 seconds'/i);
    assert.match(sql, /'complete-stale-pomodoro-sessions',[\s\S]*'10 seconds'/i);
});

test("stale completion is capped and treats paused sessions as ongoing", () => {
    assert.match(sql, /LEAST\([\s\S]*stale\.duration_minutes \* 60/i);
    assert.match(sql, /ps\.status IN \('ACTIVE', 'PAUSED'\)/i);
    assert.match(sql, /'owner_heartbeat_timeout'/i);
    assert.match(sql, /'owner_close'/i);
});

test("cron-only cleanup function is not executable through the Data API", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION private\.complete_stale_pomo_sessions/i);
    assert.match(sql, /SET search_path = ''/i);
    assert.match(sql, /REVOKE ALL ON FUNCTION private\.complete_stale_pomo_sessions\(\) FROM PUBLIC/i);
    assert.match(sql, /REVOKE ALL ON FUNCTION private\.complete_stale_pomo_sessions\(\) FROM authenticated/i);
});

test("backgrounded mobile sessions do not expire from missing heartbeats", () => {
    assert.match(mobileBackgroundFixSql, /LEFT JOIN public\.user_client_instances AS owner/i);
    assert.match(mobileBackgroundFixSql, /owner\.platform NOT IN \('ios', 'android'\)/i);
    assert.match(mobileBackgroundFixSql, /ps\.close_requested_at <= clock_timestamp\(\) - interval '5 seconds'/i);
});
