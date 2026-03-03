-- Harden single-session semantics for Pomodoro by enforcing
-- at most one ACTIVE/PAUSED session per user at the DB layer.

-- If historical duplicates exist, keep the newest participating session
-- and soft-delete the rest before creating the stricter unique index.
WITH ranked_participating AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.pomo_sessions
  WHERE status IN ('ACTIVE', 'PAUSED')
)
UPDATE public.pomo_sessions AS ps
SET
  status = 'DELETED',
  completed_at = COALESCE(ps.completed_at, NOW()),
  updated_at = NOW()
WHERE ps.id IN (
  SELECT id
  FROM ranked_participating
  WHERE rn > 1
);

-- Replace the old ACTIVE-only index with ACTIVE-or-PAUSED coverage.
DROP INDEX IF EXISTS public.idx_single_active_pomo;

CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_or_paused_pomo
  ON public.pomo_sessions (user_id)
  WHERE status IN ('ACTIVE', 'PAUSED');
