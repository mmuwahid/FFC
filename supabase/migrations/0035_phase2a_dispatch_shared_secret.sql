-- 0035_phase2a_dispatch_shared_secret.sql
-- Phase 2 Slice 2A — fix notify_dispatch_trigger auth.
--
-- Problem (discovered S048): Supabase Functions gateway accepts only legacy
-- JWT bearers, but the auto-injected SUPABASE_SERVICE_ROLE_KEY env var inside
-- the function is the new-style sb_secret_* key. The trigger could never send
-- a single bearer that satisfied both gateway auth AND function auth.
--
-- Fix: two-bearer model. Trigger sends BOTH:
--   * Authorization: Bearer <legacy-jwt>  (for the gateway)
--   * X-Dispatch-Secret: <shared-secret>  (for the function's caller-auth)
--
-- The legacy JWT is in Vault as 'service_role_key' (already set in S048).
-- The shared secret is in Vault as 'dispatch_shared_secret' (added in S048)
-- and as DISPATCH_SHARED_SECRET in the function's env (set via dashboard).
--
-- Idempotent: CREATE OR REPLACE on the function. No-op for any other state.

BEGIN;

CREATE OR REPLACE FUNCTION public.notify_dispatch_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, net, extensions, vault
AS $$
DECLARE
  v_url     text := 'https://hylarwwsedjxwavuwjrn.supabase.co/functions/v1/notify-dispatch';
  v_jwt     text;
  v_secret  text;
BEGIN
  SELECT decrypted_secret INTO v_jwt
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;

  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'dispatch_shared_secret'
    LIMIT 1;

  IF v_jwt IS NULL OR v_secret IS NULL THEN
    RAISE NOTICE 'notify_dispatch_trigger: vault secret missing (service_role_key=%, dispatch_shared_secret=%); skipping dispatch',
      v_jwt IS NOT NULL, v_secret IS NOT NULL;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('record', to_jsonb(NEW)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_jwt,
      'X-Dispatch-Secret', v_secret
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_dispatch_trigger error: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_dispatch_trigger() FROM PUBLIC;

COMMIT;
