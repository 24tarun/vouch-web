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

  UPDATE public.friend_requests fr
  SET status = 'ACCEPTED',
      responded_at = now()
  WHERE fr.id = p_request_id
    AND fr.status = 'PENDING';

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

  UPDATE public.friend_requests fr
  SET status = 'REJECTED',
      responded_at = now()
  WHERE fr.id = p_request_id
    AND fr.status = 'PENDING';

  RETURN QUERY
  SELECT p_request_id, v_sender_id, 'REJECTED'::text;
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

  UPDATE public.friend_requests fr
  SET status = 'CANCELED',
      responded_at = now()
  WHERE fr.status = 'PENDING'
    AND (
      (fr.sender_id = v_user_id AND fr.receiver_id = p_target_user_id)
      OR
      (fr.sender_id = p_target_user_id AND fr.receiver_id = v_user_id)
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

CREATE OR REPLACE FUNCTION public.withdraw_friend_request(
  p_request_id UUID
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
  v_sender_id UUID;
  v_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT fr.sender_id, fr.status
  INTO v_sender_id, v_status
  FROM public.friend_requests fr
  WHERE fr.id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Friend request not found';
  END IF;

  IF v_sender_id <> v_user_id THEN
    RAISE EXCEPTION 'You can only withdraw requests you sent';
  END IF;

  IF v_status <> 'PENDING' THEN
    RAISE EXCEPTION 'This friend request is no longer pending';
  END IF;

  UPDATE public.friend_requests fr
  SET status = 'CANCELED',
      responded_at = now()
  WHERE fr.id = p_request_id
    AND fr.status = 'PENDING';

  RETURN QUERY
  SELECT p_request_id, 'CANCELED'::text;
END;
$$;
