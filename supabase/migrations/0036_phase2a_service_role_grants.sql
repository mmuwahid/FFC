-- 0036_phase2a_service_role_grants.sql
-- Phase 2 Slice 2A — grant service_role the DML it needs on push_subscriptions
-- and notifications.
--
-- Discovery (S048): migration 0012's ALTER DEFAULT PRIVILEGES granted DML to
-- 'authenticated' but not to 'service_role'. The notify-dispatch Edge Function
-- uses a service_role JWT and reads/deletes push_subscriptions + updates
-- notifications.delivered_at, so it needs SELECT/UPDATE/DELETE there.
--
-- Idempotent: GRANT statements are no-ops on existing privileges.

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.push_subscriptions TO service_role;

GRANT SELECT, UPDATE
  ON public.notifications TO service_role;

COMMIT;
