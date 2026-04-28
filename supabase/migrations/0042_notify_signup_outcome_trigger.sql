-- 0042_notify_signup_outcome_trigger.sql
-- S050 — fires the notify-signup-outcome Edge Function whenever an admin
-- approves or rejects a pending_signups row. The EF sends an email via
-- Resend (free tier, 100/day) telling the applicant the outcome.
--
-- Trigger condition: AFTER UPDATE OF resolution ON pending_signups when
-- OLD.resolution = 'pending' AND NEW.resolution IN ('approved','rejected').
-- The CHECK constraint on the table guarantees resolved_at + resolved_by are
-- populated whenever resolution moves out of 'pending'.
--
-- Two-bearer auth pattern reused from 0035 (notify-dispatch). Best-effort —
-- failures are RAISE NOTICE only so admin approve/reject still commits.
--
-- Pre-flight required before this trigger does anything useful:
--   1. Resend account (https://resend.com) free tier; copy API key
--   2. Set RESEND_API_KEY env on the notify-signup-outcome Edge Function
--   3. (Optional) verify a custom sending domain in Resend; default is
--      onboarding@resend.dev which is fine for testing but rate-limited.
--
-- Until pre-flight (2) is done, the trigger fires but the EF returns 500;
-- this is logged in EF logs and does NOT roll back the resolution UPDATE.

BEGIN;

CREATE OR REPLACE FUNCTION public.notify_signup_outcome_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, net, extensions, vault
AS $$
DECLARE
  v_url     text := 'https://hylarwwsedjxwavuwjrn.supabase.co/functions/v1/notify-signup-outcome';
  v_jwt     text;
  v_secret  text;
BEGIN
  -- Guard: only on the pending → resolved transition.
  IF OLD.resolution <> 'pending' THEN RETURN NEW; END IF;
  IF NEW.resolution NOT IN ('approved', 'rejected') THEN RETURN NEW; END IF;
  IF NEW.email IS NULL OR length(trim(NEW.email)) = 0 THEN
    RAISE NOTICE 'notify_signup_outcome_trigger: no email on pending_signups %, skipping', NEW.id;
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_jwt
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;

  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'dispatch_shared_secret'
    LIMIT 1;

  IF v_jwt IS NULL OR v_secret IS NULL THEN
    RAISE NOTICE 'notify_signup_outcome_trigger: vault secret missing (service_role_key=%, dispatch_shared_secret=%); skipping for pending_signups %',
      v_jwt IS NOT NULL, v_secret IS NOT NULL, NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'pending_signup_id', NEW.id,
      'email', NEW.email,
      'display_name', NEW.display_name,
      'resolution', NEW.resolution::text,
      'rejection_reason', NEW.rejection_reason
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_jwt,
      'X-Dispatch-Secret', v_secret
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_signup_outcome_trigger error for pending_signups %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_signup_outcome_trigger() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_pending_signups_notify_outcome ON public.pending_signups;
CREATE TRIGGER trg_pending_signups_notify_outcome
  AFTER UPDATE OF resolution ON public.pending_signups
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_signup_outcome_trigger();

COMMENT ON FUNCTION public.notify_signup_outcome_trigger() IS
  'S050: fires on pending_signups resolution change pending → approved/rejected. '
  'Calls notify-signup-outcome Edge Function via pg_net (Resend email send). '
  'Best-effort: failures swallowed, admin resolution still commits.';

COMMIT;
