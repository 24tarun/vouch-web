-- Rename AI voucher identity labels from legacy Orca naming to current Orca naming.
-- Keeps the same stable UUID used by the system user profile.

UPDATE auth.users
SET email = 'orca@vouch.internal'
WHERE id = '00000000-0000-0000-0000-000000000001'::uuid;

UPDATE public.profiles
SET
  email = 'orca@vouch.internal',
  username = 'Orca'
WHERE id = '00000000-0000-0000-0000-000000000001'::uuid;
