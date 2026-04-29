-- 0053_admin_add_commitment_rpc.sql
-- S054 (issue #11) — admin marks a registered player as confirmed for a matchday.
--
-- Inserts (or reinstates) a poll_votes row with choice='yes' on behalf of the
-- target player. This lets admin fill the roster when players haven't voted
-- through the app (e.g. confirmed via WhatsApp, or admin is setting up manually).
--
-- The target player does NOT need to have voted at all — if no row exists one
-- is created. If a cancelled row exists it is reinstated. If an active yes row
-- already exists this is a no-op (idempotent).
--
-- Guards:
--   • is_admin() body check + EXECUTE-grant gate (two-layer, per S047)
--   • Target profile must exist, not be soft-deleted, not be banned/rejected
--   • Matchday must exist
--   • Admin cannot add themselves via this path (they should use cast_poll_vote)
--
-- Does NOT enforce roster cap — that lives in create_match_draft /
-- admin_update_match_draft. Admin is allowed to over-confirm and then pick
-- who goes in the Roster Setup screen.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_add_commitment(
  p_matchday_id uuid,
  p_profile_id  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id   uuid := public.current_profile_id();
  v_now        timestamptz := now();
  v_existing   public.poll_votes;
  v_target_role public.user_role;
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

  -- ── Matchday exists ───────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.matchdays WHERE id = p_matchday_id) THEN
    RAISE EXCEPTION 'Matchday % not found', p_matchday_id USING ERRCODE = 'P0002';
  END IF;

  -- ── Target profile valid ──────────────────────────────────────────────
  SELECT role INTO v_target_role
    FROM public.profiles
   WHERE id = p_profile_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile % not found or deleted', p_profile_id USING ERRCODE = 'P0002';
  END IF;

  IF v_target_role IN ('rejected') THEN
    RAISE EXCEPTION 'Cannot add a rejected player to the roster' USING ERRCODE = '42501';
  END IF;

  -- Active time-based ban check
  IF EXISTS (
    SELECT 1 FROM public.player_bans
     WHERE profile_id = p_profile_id
       AND revoked_at IS NULL
       AND starts_at <= v_now
       AND ends_at    > v_now
  ) THEN
    RAISE EXCEPTION 'Player is currently banned' USING ERRCODE = '42501';
  END IF;

  -- ── Fetch existing vote ───────────────────────────────────────────────
  SELECT * INTO v_existing
    FROM public.poll_votes
   WHERE matchday_id = p_matchday_id
     AND profile_id  = p_profile_id
   LIMIT 1;

  -- Already an active yes vote — idempotent, nothing to do
  IF v_existing.id IS NOT NULL
     AND v_existing.choice = 'yes'
     AND v_existing.cancelled_at IS NULL THEN
    RETURN;
  END IF;

  -- ── Insert or reinstate ───────────────────────────────────────────────
  IF v_existing.id IS NULL THEN
    INSERT INTO public.poll_votes
      (matchday_id, profile_id, choice, committed_at, created_at, updated_at)
    VALUES
      (p_matchday_id, p_profile_id, 'yes', v_now, v_now, v_now);
  ELSE
    -- Row exists (cancelled or different choice) — update to active yes
    UPDATE public.poll_votes
       SET choice       = 'yes',
           committed_at = v_now,
           cancelled_at = NULL,
           cancelled_by = NULL,
           updated_at   = v_now
     WHERE id = v_existing.id;
  END IF;

  PERFORM public.log_admin_action(
    'poll_votes', p_profile_id, 'admin_add_commitment',
    jsonb_build_object('matchday_id', p_matchday_id, 'at', v_now)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_add_commitment(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_add_commitment(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_add_commitment(uuid, uuid) IS
  'S054 (issue #11): admin marks a registered player as confirmed (yes) for a '
  'matchday, inserting or reinstating a poll_votes row on their behalf. '
  'Idempotent if already an active yes. Does not enforce roster cap. '
  'Two-layer guard: is_admin() + EXECUTE-grant gate.';

COMMIT;
