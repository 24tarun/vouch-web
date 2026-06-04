CREATE TABLE data_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_data_exports_user_id ON data_exports(user_id);

ALTER TABLE data_exports ENABLE ROW LEVEL SECURITY;
