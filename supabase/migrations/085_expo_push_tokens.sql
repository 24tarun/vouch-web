-- Stores one Expo push token per device per user.
-- Multiple rows per user are expected (one per device).

CREATE TABLE expo_push_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    token       TEXT NOT NULL,
    device_name TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT expo_push_tokens_token_unique UNIQUE (token)
);

-- Index for fast lookup of all tokens for a user
CREATE INDEX expo_push_tokens_user_id_idx ON expo_push_tokens (user_id);

-- RLS
ALTER TABLE expo_push_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own tokens
CREATE POLICY "Users can manage their own push tokens"
    ON expo_push_tokens
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Auto-update updated_at
CREATE TRIGGER expo_push_tokens_updated_at
    BEFORE UPDATE ON expo_push_tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
