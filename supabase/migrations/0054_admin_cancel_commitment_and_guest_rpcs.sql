-- 0054_admin_cancel_commitment_and_guest_rpcs.sql
-- S055 (issue #15) — admin removes a player or guest from the matchday roster.
--
-- Inverse of 0053 admin_add_commitment + 0051 admin_add_guest. Used by the
-- Roster Setup screen pool × button when a confirmed player or guest needs
-- to be uncommitted (no-show, double-booked, added by mistake).
--
-- For registered profiles → soft-cancels poll_votes row (cancelled_at = now()).
-- For guests             → soft-cancels match_guests row (cancelled_at = now()).
--
-- Both refuse if the matchday's match already has a recorded result — once
-- a match is final, the roster is historical truth (mirrors the guard in
-- admin_update_match_draft).
--
-- Two-layer guard per S047:
--   (1) is_admin() body check
--   (2) REVOKE EXECUTE FROM PUBLIC + GRANT EXECUTE TO authenticated
--
-- Audit BEFORE the destructive UPDATE (mirrors S034 delete_season +
-- S049 delete_my_account patterns) so the log entry survives even if
-- the destructive path rolls back.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- admin_cancel_commitment — uncommit a registered player from a matchday
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_cancel_commitment(
  p_matchday_id uuid,
  p_profile_id  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := public.current_profile_id();
  v_now      timestamptz := now();
  v_existing public.poll_votes;
BEGIN
  -- ── Auth ──────────────────────────────────────────────────────────────
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  -- ── Arg validation ────────────────────────────────────────────────────
  IF p_matchday_id IS NULL THEN
    RAISE EXCEPTION 'p_matchday_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'p_profile_id is required' USING ERRCODE = '22023';
  END IF;

  -- ── Refuse if match already has a result ─────────────────────────────
  IF EXISTS (
    SELECT 1 FROM public.matches
     WHERE matchday_id = p_matchday_id
       AND result IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot cancel commitments on a matchday with a recorded result'
      USING ERRCODE = '42501';
  END IF;

  -- ── Find active yes-vote ──────────────────────────────────────────────
  SELECT * INTO v_existing
    FROM public.poll_votes
   WHERE matchday_id = p_matchday_id
     AND profile_id  = p_profile_id
     AND choice      = 'yes'
     AND cancelled_at IS NULL
   LIMIT 1;

  -- Nothing active → idempotent no-op
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- ── Audit BEFORE destructive update ──────────────────────────────────
  PERFORM public.log_admin_action(
    'poll_votes', p_profile_id, 'admin_cancel_commitment',
    jsonb_build_object(
      'matchday_id', p_matchday_id,
      'poll_vote_id', v_existing.id,
      'at', v_now
    )
  );

  -- ── Soft-cancel ──────────────────────────────────────────────────────
  UPDATE public.poll_votes
     SET cancelled_at = v_now,
         cancelled_by = v_admin_id,
         updated_at   = v_now
   WHERE id = v_existing.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_cancel_commitment(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_cancel_commitment(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_cancel_commitment(uuid, uuid) IS
  'S055 (issue #15): admin uncommits a registered player from a matchday by '
  'soft-cancelling their yes-vote. Idempotent. Refuses if matchday match has '
  'a recorded result. Two-layer guard: is_admin() + EXECUTE-grant gate.';

-- ═══════════════════════════════════════════════════════════════════════
-- admin_cancel_guest — soft-cancel a guest from a matchday
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_cancel_guest(
  p_guest_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id    uuid := public.current_profile_id();
  v_now         timestamptz := now();
  v_matchday_id uuid;
  v_cancelled   timestamptz;
BEGIN
  -- ── Auth ──────────────────────────────────────────────────────────────
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  -- ── Arg validation ────────────────────────────────────────────────────
  IF p_guest_id IS NULL THEN
    RAISE EXCEPTION 'p_guest_id is required' USING ERRCODE = '22023';
  END IF;

  -- ── Look up guest + matchday ─────────────────────────────────────────
  SELECT matchday_id, cancelled_at
    INTO v_matchday_id, v_cancelled
    FROM public.match_guests
   WHERE id = p_guest_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest % not found', p_guest_id USING ERRCODE = 'P0002';
  END IF;

  -- Already cancelled → idempotent no-op
  IF v_cancelled IS NOT NULL THEN
    RETURN;
  END IF;

  -- ── Refuse if match already has a result ─────────────────────────────
  IF EXISTS (
    SELECT 1 FROM public.matches
     WHERE matchday_id = v_matchday_id
       AND result IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot cancel guests on a matchday with a recorded result'
      USING ERRCODE = '42501';
  END IF;

  -- ── Audit BEFORE destructive update ──────────────────────────────────
  PERFORM public.log_admin_action(
    'match_guests', p_guest_id, 'admin_cancel_guest',
    jsonb_build_object(
      'matchday_id', v_matchday_id,
      'at', v_now
    )
  );

  -- ── Soft-cancel ──────────────────────────────────────────────────────
  UPDATE public.match_guests
     SET cancelled_at = v_now,
         updated_at   = v_now
   WHERE id = p_guest_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_cancel_guest(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_cancel_guest(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_cancel_guest(uuid) IS
  'S055 (issue #15): admin soft-cancels a guest from a matchday by setting '
  'match_guests.cancelled_at. Idempotent. Refuses if matchday match has a '
  'recorded result. Two-layer guard: is_admin() + EXECUTE-grant gate.';

COMMIT;
