-- 0041_auth_purge_trigger.sql
-- S050 follow-up to S049's delete_my_account RPC. The RPC currently anonymises
-- the public.profiles row but leaves auth.users untouched (admin client required).
-- This migration adds the missing piece: an AFTER UPDATE trigger that fires on
-- the deleted_at NULL → NOT NULL transition and calls the new
-- purge-deleted-auth-user Edge Function with the OLD auth_user_id.
--
-- Re-uses the two-bearer pattern from 0035_phase2a_dispatch_shared_secret.sql:
--   * Authorization: Bearer <legacy-jwt>  (gateway auth)
--   * X-Dispatch-Secret: <shared-secret>  (caller auth inside the function)
-- Both come from Vault — populated in S048 pre-flight.
--
-- delete_my_account is also patched to stash auth_user_id in the audit payload
-- BEFORE nulling it, so the audit trail records which auth.users row was
-- targeted for purge (the trigger sees OLD.auth_user_id directly, but the
-- audit payload is the durable evidence trail).

BEGIN;

-- =============================================================
-- 1. Patch delete_my_account to record auth_user_id in audit payload.
-- =============================================================
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile_id    uuid := public.current_profile_id();
  v_auth_user_id  uuid;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Capture the auth.users id before the destructive UPDATE clears it.
  SELECT auth_user_id
    INTO v_auth_user_id
    FROM public.profiles
   WHERE id = v_profile_id;

  -- Audit BEFORE the destructive update so the log entry survives even if
  -- the soft-delete partially fails (mirrors S034 delete_season pattern).
  INSERT INTO public.admin_audit_log
    (admin_profile_id, target_entity, target_id, action, payload_jsonb)
  VALUES
    (v_profile_id, 'profiles', v_profile_id, 'player_self_deleted',
     jsonb_build_object(
       'at', now(),
       'auth_user_id', v_auth_user_id
     ));

  UPDATE public.profiles
     SET deleted_at   = now(),
         display_name = 'Deleted player',
         avatar_url   = NULL,
         auth_user_id = NULL,
         email        = NULL,
         is_active    = false
   WHERE id = v_profile_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

-- =============================================================
-- 2. Trigger function — calls purge-deleted-auth-user EF via pg_net.
-- =============================================================
-- Fires only on the deleted_at NULL → NOT NULL transition AND when the row
-- still has an auth_user_id captured in OLD (i.e. real player, not a ghost).
-- Best-effort: failures are logged via NOTICE and swallowed so the soft-delete
-- transaction is not rolled back. If the EF call drops, the auth.users row
-- is orphaned but the audit_log payload preserves the auth_user_id for a
-- future reconciliation pass.
CREATE OR REPLACE FUNCTION public.purge_auth_user_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, net, extensions, vault
AS $$
DECLARE
  v_url     text := 'https://hylarwwsedjxwavuwjrn.supabase.co/functions/v1/purge-deleted-auth-user';
  v_jwt     text;
  v_secret  text;
BEGIN
  -- Guard: only act on the soft-delete transition with a real auth_user_id.
  IF OLD.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.deleted_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.auth_user_id IS NULL THEN RETURN NEW; END IF;

  SELECT decrypted_secret INTO v_jwt
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;

  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'dispatch_shared_secret'
    LIMIT 1;

  IF v_jwt IS NULL OR v_secret IS NULL THEN
    RAISE NOTICE 'purge_auth_user_trigger: vault secret missing (service_role_key=%, dispatch_shared_secret=%); skipping purge for profile %',
      v_jwt IS NOT NULL, v_secret IS NOT NULL, NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'auth_user_id', OLD.auth_user_id,
      'profile_id', NEW.id
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_jwt,
      'X-Dispatch-Secret', v_secret
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'purge_auth_user_trigger error for profile %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_auth_user_trigger() FROM PUBLIC;

-- =============================================================
-- 3. Trigger binding.
-- =============================================================
DROP TRIGGER IF EXISTS trg_profiles_purge_auth ON public.profiles;
CREATE TRIGGER trg_profiles_purge_auth
  AFTER UPDATE OF deleted_at ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.purge_auth_user_trigger();

COMMENT ON FUNCTION public.purge_auth_user_trigger() IS
  'S050: AFTER UPDATE trigger that fires on the deleted_at NULL → NOT NULL '
  'transition. Calls purge-deleted-auth-user Edge Function via pg_net with '
  'OLD.auth_user_id; the EF uses the admin client to delete from auth.users '
  '(only callable with service-role privileges, hence the EF indirection). '
  'Mirrors notify_dispatch_trigger two-bearer auth pattern.';

COMMIT;
