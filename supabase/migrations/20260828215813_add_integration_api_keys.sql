CREATE TABLE public.integration_api_keys (
  user_id       uuid        NOT NULL,
  key_prefix    text        NOT NULL,
  secret_hash   text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  CONSTRAINT integration_api_keys_pkey PRIMARY KEY (user_id),
  CONSTRAINT integration_api_keys_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT integration_api_keys_key_prefix_key UNIQUE (key_prefix),
  CONSTRAINT integration_api_keys_key_prefix_check
    CHECK (key_prefix ~ '^[A-Za-z0-9_-]{12}$'),
  CONSTRAINT integration_api_keys_secret_hash_check
    CHECK (secret_hash ~ '^[a-f0-9]{64}$')
);

ALTER TABLE public.integration_api_keys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.integration_api_keys FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.integration_api_keys TO service_role;
