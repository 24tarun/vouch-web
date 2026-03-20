-- Migration: 051_data_type_hardening.sql
--
-- Covers:
-- 1) task_events event_type/from_status/to_status CHECK constraints
-- 2) web_push_subscriptions.user_id NOT NULL
-- 3) recurrence_rules.rule_config structural validation
-- 4) deterministic pre-cleanup + guardrails before enforcing constraints

-- Known legacy repair: ACTIVE status in event transitions.
UPDATE public.task_events
SET from_status = 'CREATED'
WHERE from_status = 'ACTIVE';

UPDATE public.task_events
SET to_status = 'CREATED'
WHERE to_status = 'ACTIVE';

-- Auto-fix for web push: remove orphaned anonymous subscriptions.
DELETE FROM public.web_push_subscriptions
WHERE user_id IS NULL;

-- Basic JSON schema validator for recurrence_rules.rule_config.
CREATE OR REPLACE FUNCTION public.is_valid_recurrence_rule_config(config jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
SELECT
    config IS NOT NULL
    AND jsonb_typeof(config) = 'object'
    AND jsonb_typeof(config->'frequency') = 'string'
    AND (config->>'frequency') IN ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'WEEKDAYS', 'CUSTOM')
    AND jsonb_typeof(config->'interval') = 'number'
    AND (config->>'interval') ~ '^[0-9]+$'
    AND (config->>'interval')::integer >= 1
    AND jsonb_typeof(config->'time_of_day') = 'string'
    AND (config->>'time_of_day') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND (
        NOT (config ? 'days_of_week')
        OR config->'days_of_week' IS NULL
        OR (
            jsonb_typeof(config->'days_of_week') = 'array'
            AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(config->'days_of_week') AS day_value(day)
                WHERE jsonb_typeof(day) <> 'number'
                    OR (day #>> '{}') !~ '^[0-9]+$'
                    OR (day #>> '{}')::integer < 0
                    OR (day #>> '{}')::integer > 6
            )
        )
    );
$$;

-- Guardrails: abort with explicit messages if unknown invalid data remains.
DO $$
DECLARE
    invalid_event_types text;
    invalid_event_status_rows text;
    invalid_rule_ids text;
BEGIN
    SELECT string_agg(event_type, ', ' ORDER BY event_type)
    INTO invalid_event_types
    FROM (
        SELECT DISTINCT event_type
        FROM public.task_events
        WHERE event_type NOT IN (
            'CREATED',
            'MARK_COMPLETE',
            'UNDO_COMPLETE',
            'PROOF_UPLOAD_FAILED_REVERT',
            'PROOF_REMOVED',
            'PROOF_REQUESTED',
            'VOUCHER_ACCEPT',
            'VOUCHER_DENY',
            'VOUCHER_DELETE',
            'RECTIFY',
            'FORCE_MAJEURE',
            'DEADLINE_MISSED',
            'VOUCHER_TIMEOUT',
            'POMO_COMPLETED',
            'DEADLINE_WARNING_1H',
            'DEADLINE_WARNING_5M',
            'GOOGLE_EVENT_CANCELLED',
            'POSTPONE'
        )
    ) AS invalid_types;

    IF invalid_event_types IS NOT NULL THEN
        RAISE EXCEPTION 'Migration 051 aborted: invalid task_events.event_type values remain: %', invalid_event_types;
    END IF;

    SELECT string_agg(row_desc, ', ' ORDER BY row_desc)
    INTO invalid_event_status_rows
    FROM (
        SELECT format('%s[%s->%s]', id, from_status, to_status) AS row_desc
        FROM public.task_events
        WHERE from_status NOT IN (
                'CREATED',
                'POSTPONED',
                'MARKED_COMPLETED',
                'AWAITING_VOUCHER',
                'COMPLETED',
                'FAILED',
                'RECTIFIED',
                'SETTLED',
                'DELETED'
            )
            OR to_status NOT IN (
                'CREATED',
                'POSTPONED',
                'MARKED_COMPLETED',
                'AWAITING_VOUCHER',
                'COMPLETED',
                'FAILED',
                'RECTIFIED',
                'SETTLED',
                'DELETED'
            )
        LIMIT 20
    ) AS invalid_status_sample;

    IF invalid_event_status_rows IS NOT NULL THEN
        RAISE EXCEPTION 'Migration 051 aborted: invalid task_events.from_status/to_status values remain (sample): %', invalid_event_status_rows;
    END IF;

    SELECT string_agg(id::text, ', ' ORDER BY id::text)
    INTO invalid_rule_ids
    FROM (
        SELECT id
        FROM public.recurrence_rules
        WHERE NOT public.is_valid_recurrence_rule_config(rule_config)
        LIMIT 20
    ) AS invalid_rules;

    IF invalid_rule_ids IS NOT NULL THEN
        RAISE EXCEPTION 'Migration 051 aborted: invalid recurrence_rules.rule_config rows found (sample ids): %', invalid_rule_ids;
    END IF;
END;
$$;

ALTER TABLE public.task_events
    DROP CONSTRAINT IF EXISTS task_events_event_type_check;

ALTER TABLE public.task_events
    ADD CONSTRAINT task_events_event_type_check
    CHECK (
        event_type IN (
            'CREATED',
            'MARK_COMPLETE',
            'UNDO_COMPLETE',
            'PROOF_UPLOAD_FAILED_REVERT',
            'PROOF_REMOVED',
            'PROOF_REQUESTED',
            'VOUCHER_ACCEPT',
            'VOUCHER_DENY',
            'VOUCHER_DELETE',
            'RECTIFY',
            'FORCE_MAJEURE',
            'DEADLINE_MISSED',
            'VOUCHER_TIMEOUT',
            'POMO_COMPLETED',
            'DEADLINE_WARNING_1H',
            'DEADLINE_WARNING_5M',
            'GOOGLE_EVENT_CANCELLED',
            'POSTPONE'
        )
    );

ALTER TABLE public.task_events
    DROP CONSTRAINT IF EXISTS task_events_from_status_check;

ALTER TABLE public.task_events
    ADD CONSTRAINT task_events_from_status_check
    CHECK (
        from_status IN (
            'CREATED',
            'POSTPONED',
            'MARKED_COMPLETED',
            'AWAITING_VOUCHER',
            'COMPLETED',
            'FAILED',
            'RECTIFIED',
            'SETTLED',
            'DELETED'
        )
    );

ALTER TABLE public.task_events
    DROP CONSTRAINT IF EXISTS task_events_to_status_check;

ALTER TABLE public.task_events
    ADD CONSTRAINT task_events_to_status_check
    CHECK (
        to_status IN (
            'CREATED',
            'POSTPONED',
            'MARKED_COMPLETED',
            'AWAITING_VOUCHER',
            'COMPLETED',
            'FAILED',
            'RECTIFIED',
            'SETTLED',
            'DELETED'
        )
    );

ALTER TABLE public.web_push_subscriptions
    ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.recurrence_rules
    DROP CONSTRAINT IF EXISTS recurrence_rules_rule_config_valid_check;

ALTER TABLE public.recurrence_rules
    ADD CONSTRAINT recurrence_rules_rule_config_valid_check
    CHECK (public.is_valid_recurrence_rule_config(rule_config));
