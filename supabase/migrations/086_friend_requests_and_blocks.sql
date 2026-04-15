--
-- 086: Friend requests, blocks, and relationship RPCs
--

-- ============================================
-- TABLES
-- ============================================
CREATE TABLE IF NOT EXISTS public.friend_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING'::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,

  CONSTRAINT friend_requests_check_distinct_users CHECK (sender_id <> receiver_id),
  CONSTRAINT friend_requests_status_check CHECK (
    status = ANY (ARRAY['PENDING','ACCEPTED','REJECTED','CANCELED']::text[])
  )
);

CREATE TABLE IF NOT EXISTS public.user_blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_blocks_blocker_blocked_key UNIQUE (blocker_id, blocked_id),
  CONSTRAINT user_blocks_check_distinct_users CHECK (blocker_id <> blocked_id)
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_friend_requests_sender_id
  ON public.friend_requests USING btree (sender_id);

CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver_id
  ON public.friend_requests USING btree (receiver_id);

CREATE INDEX IF NOT EXISTS idx_friend_requests_status
  ON public.friend_requests USING btree (status);

CREATE INDEX IF NOT EXISTS idx_friend_requests_pair_status
  ON public.friend_requests USING btree (sender_id, receiver_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_single_pending_pair
  ON public.friend_requests USING btree (
    LEAST(sender_id, receiver_id),
    GREATEST(sender_id, receiver_id)
  )
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker_id
  ON public.user_blocks USING btree (blocker_id);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked_id
  ON public.user_blocks USING btree (blocked_id);

-- ============================================
-- RLS
-- ============================================
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own friend requests" ON public.friend_requests
  FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can view own blocks" ON public.user_blocks
  FOR SELECT USING (auth.uid() = blocker_id);

-- ============================================
-- TRIGGERS
-- ============================================
CREATE TRIGGER friend_requests_updated_at
  BEFORE UPDATE ON public.friend_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- HELPERS
-- ============================================
CREATE OR REPLACE FUNCTION public.has_pending_voucher_conflict(
  p_user_a UUID,
  p_user_b UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.status = ANY (
      ARRAY[
        'ACTIVE',
        'POSTPONED',
        'MARKED_COMPLETE',
        'AWAITING_VOUCHER',
        'AWAITING_ORCA',
        'AWAITING_USER',
        'ESCALATED'
      ]::text[]
    )
      AND (
        (t.user_id = p_user_a AND t.voucher_id = p_user_b)
        OR
        (t.user_id = p_user_b AND t.voucher_id = p_user_a)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.are_users_blocked(
  p_user_a UUID,
  p_user_b UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_blocks ub
    WHERE (ub.blocker_id = p_user_a AND ub.blocked_id = p_user_b)
       OR (ub.blocker_id = p_user_b AND ub.blocked_id = p_user_a)
  );
$$;

-- ============================================
-- RPCS
-- ============================================
CREATE OR REPLACE FUNCTION public.search_users_for_friendship(
  p_query TEXT,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  username TEXT,
  already_friends BOOLEAN,
  incoming_request_pending BOOLEAN,
  outgoing_request_pending BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT auth.uid() AS user_id
  )
  SELECT
    p.id,
    p.email,
    p.username,
    EXISTS (
      SELECT 1
      FROM public.friendships f, me
      WHERE f.user_id = me.user_id
        AND f.friend_id = p.id
    ) AS already_friends,
    EXISTS (
      SELECT 1
      FROM public.friend_requests fr, me
      WHERE fr.sender_id = p.id
        AND fr.receiver_id = me.user_id
        AND fr.status = 'PENDING'
    ) AS incoming_request_pending,
    EXISTS (
      SELECT 1
      FROM public.friend_requests fr, me
      WHERE fr.sender_id = me.user_id
        AND fr.receiver_id = p.id
        AND fr.status = 'PENDING'
    ) AS outgoing_request_pending
  FROM public.profiles p, me
  WHERE me.user_id IS NOT NULL
    AND p.id <> me.user_id
    AND (
      p.email ILIKE '%' || trim(coalesce(p_query, '')) || '%'
      OR p.username ILIKE '%' || trim(coalesce(p_query, '')) || '%'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_blocks ub
      WHERE (ub.blocker_id = me.user_id AND ub.blocked_id = p.id)
         OR (ub.blocker_id = p.id AND ub.blocked_id = me.user_id)
    )
  ORDER BY p.username ASC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 20), 50));
$$;

CREATE OR REPLACE FUNCTION public.send_friend_request(
  p_target_user_id UUID
)
RETURNS TABLE (
  request_id UUID,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_request_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user is required';
  END IF;

  IF p_target_user_id = v_user_id THEN
    RAISE EXCEPTION 'You cannot send a friend request to yourself';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'No user found for that target';
  END IF;

  IF public.are_users_blocked(v_user_id, p_target_user_id) THEN
    RAISE EXCEPTION 'You cannot send a friend request for this user';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.friendships f
    WHERE f.user_id = v_user_id
      AND f.friend_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'Already friends with this user';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.friend_requests fr
    WHERE fr.status = 'PENDING'
      AND (
        (fr.sender_id = v_user_id AND fr.receiver_id = p_target_user_id)
        OR
        (fr.sender_id = p_target_user_id AND fr.receiver_id = v_user_id)
      )
  ) THEN
    RAISE EXCEPTION 'A friend request is already pending for this user';
  END IF;

  INSERT INTO public.friend_requests (
    sender_id,
    receiver_id,
    status
  )
  VALUES (
    v_user_id,
    p_target_user_id,
    'PENDING'
  )
  RETURNING id INTO v_request_id;

  RETURN QUERY
  SELECT v_request_id, 'PENDING'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_friend_request(
  p_request_id UUID
)
RETURNS TABLE (
  request_id UUID,
  friend_user_id UUID,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_sender_id UUID;
  v_receiver_id UUID;
  v_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT fr.sender_id, fr.receiver_id, fr.status
  INTO v_sender_id, v_receiver_id, v_status
  FROM public.friend_requests fr
  WHERE fr.id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Friend request not found';
  END IF;

  IF v_receiver_id <> v_user_id THEN
    RAISE EXCEPTION 'You can only accept requests sent to you';
  END IF;

  IF v_status <> 'PENDING' THEN
    RAISE EXCEPTION 'This friend request is no longer pending';
  END IF;

  IF public.are_users_blocked(v_sender_id, v_receiver_id) THEN
    RAISE EXCEPTION 'This friendship cannot be created';
  END IF;

  UPDATE public.friend_requests
  SET status = 'ACCEPTED',
      responded_at = now()
  WHERE id = p_request_id
    AND status = 'PENDING';

  INSERT INTO public.friendships (user_id, friend_id)
  VALUES (v_sender_id, v_receiver_id)
  ON CONFLICT (user_id, friend_id) DO NOTHING;

  INSERT INTO public.friendships (user_id, friend_id)
  VALUES (v_receiver_id, v_sender_id)
  ON CONFLICT (user_id, friend_id) DO NOTHING;

  RETURN QUERY
  SELECT p_request_id, v_sender_id, 'ACCEPTED'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_friend_request(
  p_request_id UUID
)
RETURNS TABLE (
  request_id UUID,
  sender_user_id UUID,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_sender_id UUID;
  v_receiver_id UUID;
  v_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT fr.sender_id, fr.receiver_id, fr.status
  INTO v_sender_id, v_receiver_id, v_status
  FROM public.friend_requests fr
  WHERE fr.id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Friend request not found';
  END IF;

  IF v_receiver_id <> v_user_id THEN
    RAISE EXCEPTION 'You can only reject requests sent to you';
  END IF;

  IF v_status <> 'PENDING' THEN
    RAISE EXCEPTION 'This friend request is no longer pending';
  END IF;

  UPDATE public.friend_requests
  SET status = 'REJECTED',
      responded_at = now()
  WHERE id = p_request_id
    AND status = 'PENDING';

  RETURN QUERY
  SELECT p_request_id, v_sender_id, 'REJECTED'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_friend(
  p_target_user_id UUID
)
RETURNS TABLE (
  removed_user_id UUID,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user is required';
  END IF;

  IF public.has_pending_voucher_conflict(v_user_id, p_target_user_id) THEN
    RAISE EXCEPTION 'Cannot remove this friend because one of you is still the voucher for the other on pending tasks';
  END IF;

  DELETE FROM public.friendships
  WHERE (user_id = v_user_id AND friend_id = p_target_user_id)
     OR (user_id = p_target_user_id AND friend_id = v_user_id);

  UPDATE public.profiles
  SET default_voucher_id = v_user_id
  WHERE id = v_user_id
    AND default_voucher_id = p_target_user_id;

  UPDATE public.profiles
  SET default_voucher_id = p_target_user_id
  WHERE id = p_target_user_id
    AND default_voucher_id = v_user_id;

  RETURN QUERY
  SELECT p_target_user_id, 'REMOVED'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_user(
  p_target_user_id UUID
)
RETURNS TABLE (
  blocked_user_id UUID,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user is required';
  END IF;

  IF p_target_user_id = v_user_id THEN
    RAISE EXCEPTION 'You cannot block yourself';
  END IF;

  IF public.has_pending_voucher_conflict(v_user_id, p_target_user_id) THEN
    RAISE EXCEPTION 'Cannot block this user because one of you is still the voucher for the other on pending tasks';
  END IF;

  INSERT INTO public.user_blocks (blocker_id, blocked_id)
  VALUES (v_user_id, p_target_user_id)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

  DELETE FROM public.friendships
  WHERE (user_id = v_user_id AND friend_id = p_target_user_id)
     OR (user_id = p_target_user_id AND friend_id = v_user_id);

  UPDATE public.friend_requests
  SET status = 'CANCELED',
      responded_at = now()
  WHERE status = 'PENDING'
    AND (
      (sender_id = v_user_id AND receiver_id = p_target_user_id)
      OR
      (sender_id = p_target_user_id AND receiver_id = v_user_id)
    );

  UPDATE public.profiles
  SET default_voucher_id = v_user_id
  WHERE id = v_user_id
    AND default_voucher_id = p_target_user_id;

  UPDATE public.profiles
  SET default_voucher_id = p_target_user_id
  WHERE id = p_target_user_id
    AND default_voucher_id = v_user_id;

  RETURN QUERY
  SELECT p_target_user_id, 'BLOCKED'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.unblock_user(
  p_target_user_id UUID
)
RETURNS TABLE (
  unblocked_user_id UUID,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM public.user_blocks
  WHERE blocker_id = v_user_id
    AND blocked_id = p_target_user_id;

  RETURN QUERY
  SELECT p_target_user_id, 'UNBLOCKED'::text;
END;
$$;

-- ============================================
-- REALTIME PUBLICATION
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_blocks;
