-- Lower the minimum commitment duration from 4 days (diff >= 3) to 3 days (diff >= 2).
-- e.g. Apr 15 → Apr 17 is end_date - start_date = 2, which should be valid.
ALTER TABLE commitments
  DROP CONSTRAINT commitments_min_duration_check;

ALTER TABLE commitments
  ADD CONSTRAINT commitments_min_duration_check CHECK ((end_date - start_date) >= 2);
