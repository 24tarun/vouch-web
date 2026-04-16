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

  UPDATE public.friend_requests
  SET status = 'CANCELED',
      responded_at = now()
  WHERE id = p_request_id
    AND status = 'PENDING';

  RETURN QUERY
  SELECT p_request_id, 'CANCELED'::text;
END;
$$;
