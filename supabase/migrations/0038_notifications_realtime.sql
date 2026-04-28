-- 0038_notifications_realtime.sql
-- S049 — add public.notifications to the supabase_realtime publication so
-- the in-app NotificationsPanel + bell-badge can subscribe to INSERT events
-- on the recipient_id filter and update unread counts live.
--
-- Idempotent: postgres errors out on a duplicate ADD TABLE, so we guard via
-- pg_publication_tables. Same pattern as migration 0034 (pending_match_entries).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname    = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename  = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;
