-- Track whether a proof was submitted at the time of voucher acceptance.
-- Stamped by voucherAccept() before the proof row is deleted.
-- Defaults false; existing completed tasks have no historical proof data.
ALTER TABLE tasks ADD COLUMN has_proof boolean NOT NULL DEFAULT false;
