UPDATE public.task_events
SET event_type = 'AI_DENIED'
WHERE event_type = 'AI_DENY';
