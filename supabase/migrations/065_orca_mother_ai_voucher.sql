-- Orca AI Voucher Identity
-- Creates a system user that serves as the AI voucher for tasks requiring proof
-- Uses a stable UUID: 00000000-0000-0000-0000-000000000001

-- Insert system user for Orca into auth.users
INSERT INTO auth.users (
  id,
  email,
  role,
  instance_id,
  aud,
  created_at,
  updated_at,
  email_confirmed_at
)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'orca@vouch.internal',
  'authenticated',
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  now(),
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

-- Update the auto-created profile to set the display name
UPDATE public.profiles
SET username = 'Orca'
WHERE id = '00000000-0000-0000-0000-000000000001'::uuid;

-- Track escalation history: AI-vouched tasks escalated to humans stay 0.5x weight
ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS ai_escalated_from boolean NOT NULL DEFAULT false;

