BEGIN;

-- 0034_phase2a_push_foundation.sql
-- Phase 2 Slice 2A foundation. Pre-flight required: Vault secret
-- 'service_role_key' must already exist (created via dashboard SQL editor)
-- so notify_dispatch_trigger() can fetch the JWT for the Edge Function call.
--
-- NOTE: This migration starts with DROP TABLE for push_subscriptions because
-- a stub table was previously created out-of-band (not via migrations) and
-- has 0 rows. We rebuild it cleanly to match the current spec. After this
-- migration, push_subscriptions is fully owned by migration history.

-- === Drop pre-existing out-of-band push_subscriptions =============
DROP TABLE IF EXISTS public.push_subscriptions CASCADE;

-- === pg_net extension ============================================
CREATE EXTENSION IF NOT EXISTS pg_net;

-- === push_subscriptions table ====================================
CREATE TABLE public.push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint        text NOT NULL,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, endpoint)
);

CREATE INDEX push_subscriptions_profile_idx
  ON public.push_subscriptions (profile_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_subscriptions_select_own
  ON public.push_subscriptions FOR SELECT
  USING (profile_id = public.current_profile_id());

CREATE POLICY push_subscriptions_insert_own
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (profile_id = public.current_profile_id());

CREATE POLICY push_subscriptions_delete_own
  ON public.push_subscriptions FOR DELETE
  USING (profile_id = public.current_profile_id());

-- === notifications.delivered_at ==================================
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

CREATE INDEX IF NOT EXISTS notifications_undelivered_idx
  ON public.notifications (created_at)
  WHERE delivered_at IS NULL;

-- === Realtime publication: pending_match_entries =================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pending_match_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_match_entries;
  END IF;
END$$;

-- === notify_dispatch_trigger function ============================
-- AFTER INSERT on notifications: pulls service_role JWT from Vault and
-- POSTs the row to the notify-dispatch Edge Function. Errors are logged
-- (RAISE NOTICE) so dispatch failures never block the underlying insert.
CREATE OR REPLACE FUNCTION public.notify_dispatch_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, net, extensions, vault
AS $$
DECLARE
  v_url   text := 'https://hylarwwsedjxwavuwjrn.supabase.co/functions/v1/notify-dispatch';
  v_key   text;
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;

  IF v_key IS NULL THEN
    RAISE NOTICE 'notify_dispatch_trigger: vault secret service_role_key missing; skipping dispatch';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('record', to_jsonb(NEW)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_dispatch_trigger error: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_dispatch_trigger() FROM PUBLIC;

DROP TRIGGER IF EXISTS notifications_dispatch_after_insert ON public.notifications;
CREATE TRIGGER notifications_dispatch_after_insert
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_dispatch_trigger();

COMMIT;
