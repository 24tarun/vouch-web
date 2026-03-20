-- Add per-user opt-in for Orca AI friendship.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS orca_friend_opt_in BOOLEAN NOT NULL DEFAULT false;

-- Ensure Orca profile exists in public.profiles so friendship rows can be created reliably.
INSERT INTO public.profiles (id, email, username, default_voucher_id)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  'orca@vouch.internal',
  'Orca',
  '00000000-0000-0000-0000-000000000001'::uuid
WHERE EXISTS (
  SELECT 1
  FROM auth.users
  WHERE id = '00000000-0000-0000-0000-000000000001'::uuid
)
ON CONFLICT (id) DO UPDATE
SET
  email = EXCLUDED.email,
  username = EXCLUDED.username,
  default_voucher_id = COALESCE(public.profiles.default_voucher_id, EXCLUDED.default_voucher_id);

