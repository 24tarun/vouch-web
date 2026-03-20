-- Enforce YYYY-MM format on all period columns.
-- Prevents invalid strings from being inserted via any client.

ALTER TABLE public.ledger_entries
    ADD CONSTRAINT ledger_entries_period_format
    CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$');

ALTER TABLE public.rectify_passes
    ADD CONSTRAINT rectify_passes_period_format
    CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$');

ALTER TABLE public.force_majeure
    ADD CONSTRAINT force_majeure_period_format
    CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$');
