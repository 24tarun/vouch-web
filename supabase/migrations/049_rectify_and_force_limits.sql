-- ============================================
-- RECTIFY PASSES: enforce 5/month limit at DB level
-- ============================================
-- Application code already checks this, but two concurrent requests can both
-- pass the check and both insert (race condition). This trigger prevents that.

CREATE OR REPLACE FUNCTION check_rectify_pass_limit()
RETURNS TRIGGER AS $$
BEGIN
    IF (
        SELECT COUNT(*)
        FROM rectify_passes
        WHERE user_id = NEW.user_id
          AND period = NEW.period
    ) >= 5 THEN
        RAISE EXCEPTION 'Rectify pass limit of 5 per month reached for user % in period %', NEW.user_id, NEW.period;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_rectify_pass_limit
    BEFORE INSERT ON public.rectify_passes
    FOR EACH ROW EXECUTE FUNCTION check_rectify_pass_limit();

-- ============================================
-- FORCE MAJEURE: enforce 1/month limit at DB level
-- ============================================
-- A unique constraint is sufficient here since the condition is strictly one row
-- per user per period, with no configurable threshold.

ALTER TABLE public.force_majeure
    ADD CONSTRAINT force_majeure_user_period_unique UNIQUE (user_id, period);
