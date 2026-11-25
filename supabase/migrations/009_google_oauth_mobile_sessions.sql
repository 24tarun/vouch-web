CREATE TABLE IF NOT EXISTS public.google_oauth_mobile_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sid text NOT NULL UNIQUE,
  oauth_state text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  return_url text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS google_oauth_mobile_sessions_sid_idx
  ON public.google_oauth_mobile_sessions (sid);

CREATE INDEX IF NOT EXISTS google_oauth_mobile_sessions_oauth_state_idx
  ON public.google_oauth_mobile_sessions (oauth_state);

CREATE INDEX IF NOT EXISTS google_oauth_mobile_sessions_expires_at_idx
  ON public.google_oauth_mobile_sessions (expires_at);

ALTER TABLE public.google_oauth_mobile_sessions ENABLE ROW LEVEL SECURITY;
