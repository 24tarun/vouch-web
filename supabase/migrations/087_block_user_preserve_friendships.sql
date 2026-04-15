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
