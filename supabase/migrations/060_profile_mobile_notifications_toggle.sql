-- Persist user preference for receiving mobile/web push notifications.
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS mobile_notifications_enabled BOOLEAN NOT NULL DEFAULT false;

-- Keep previously subscribed users opted in.
UPDATE profiles p
SET mobile_notifications_enabled = true
WHERE EXISTS (
    SELECT 1
    FROM web_push_subscriptions w
    WHERE w.user_id = p.id
);
