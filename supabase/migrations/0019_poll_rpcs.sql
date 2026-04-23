-- ============================================================================
-- 0019_poll_rpcs.sql
-- S026 Point 3 — §3.7 Poll screen RPCs
-- ----------------------------------------------------------------------------
-- cast_poll_vote  — regular player votes yes/no/maybe / cancels
-- invite_guest    — confirmed player invites a +1 (guest), validated
--                   against roster_cap(effective_format)
-- ============================================================================

-- =========================================================================
-- 1. cast_poll_vote
-- =========================================================================
-- Rules:
-- * Caller must be signed in and have a non-banned profile.
-- * Creates/updates the one row per (matchday_id, profile_id) — no duplicates.
-- * On 'yes' (re-vote after cancel): committed_at = now() (loses prior seat).
-- * On cancel (choice='cancel'): soft-delete via cancelled_at.
-- * Post-lock cancel is allowed but caller is expected to have acknowledged
--   the penalty sheet UI (app-layer). Penalty points are applied separately
--   by the approve-match / cron pipeline — this RPC does not mutate points.
-- * Returns a jsonb summary for the UI (new choice, committed_at, rank hint).
CREATE OR REPLACE FUNCTION public.cast_poll_vote(
  p_matchday_id uuid,
  p_choice text  -- 'yes' | 'no' | 'maybe' | 'cancel'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile uuid := public.current_profile_id();
  v_now timestamptz := now();
  v_row_id uuid;
  v_existing public.poll_votes;
  v_md public.matchdays;
  v_committed_at timestamptz;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'FFC_NOT_AUTHENTICATED' USING ERRCODE = '42501';
  END IF;

  IF p_matchday_id IS NULL THEN
    RAISE EXCEPTION 'FFC_MATCHDAY_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_choice NOT IN ('yes','no','maybe','cancel') THEN
    RAISE EXCEPTION 'FFC_BAD_CHOICE' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_md FROM public.matchdays WHERE id = p_matchday_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FFC_MATCHDAY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Banned / rejected / inactive profile check
  IF EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = v_profile
       AND (role = 'rejected' OR COALESCE(is_active, true) = false)
  ) THEN
    RAISE EXCEPTION 'FFC_PROFILE_BANNED_OR_REJECTED' USING ERRCODE = '42501';
  END IF;

  -- Active time-based ban check
  IF EXISTS (
    SELECT 1 FROM public.player_bans
     WHERE profile_id = v_profile
       AND revoked_at IS NULL
       AND starts_at <= v_now
       AND ends_at   >  v_now
  ) THEN
    RAISE EXCEPTION 'FFC_PROFILE_BANNED' USING ERRCODE = '42501';
  END IF;

  -- Fetch existing row (if any)
  SELECT * INTO v_existing
    FROM public.poll_votes
   WHERE matchday_id = p_matchday_id
     AND profile_id = v_profile
   LIMIT 1;

  IF p_choice = 'cancel' THEN
    IF v_existing.id IS NULL OR v_existing.cancelled_at IS NOT NULL THEN
      -- idempotent — nothing active to cancel
      RETURN jsonb_build_object('choice','cancel','cancelled_at', v_existing.cancelled_at);
    END IF;

    UPDATE public.poll_votes
       SET cancelled_at = v_now,
           cancelled_by = v_profile,
           updated_at   = v_now
     WHERE id = v_existing.id;

    RETURN jsonb_build_object('choice','cancel','cancelled_at', v_now);
  END IF;

  -- choice is yes/no/maybe
  IF v_existing.id IS NULL THEN
    INSERT INTO public.poll_votes
      (matchday_id, profile_id, choice, committed_at, created_at, updated_at)
    VALUES
      (p_matchday_id, v_profile, p_choice::public.poll_choice, v_now, v_now, v_now)
    RETURNING id, committed_at INTO v_row_id, v_committed_at;
  ELSE
    -- In-place update. If transitioning back to YES, reset committed_at
    -- (loses prior seat per §3.6 anti-cancel-and-rejoin rule).
    UPDATE public.poll_votes
       SET choice       = p_choice::public.poll_choice,
           committed_at = CASE
                           WHEN p_choice = 'yes'
                             AND (v_existing.choice <> 'yes' OR v_existing.cancelled_at IS NOT NULL)
                           THEN v_now
                           ELSE v_existing.committed_at
                         END,
           cancelled_at = NULL,
           cancelled_by = NULL,
           updated_at   = v_now
     WHERE id = v_existing.id
     RETURNING id, committed_at INTO v_row_id, v_committed_at;
  END IF;

  RETURN jsonb_build_object(
    'id',           v_row_id,
    'choice',       p_choice,
    'committed_at', v_committed_at,
    'matchday_id',  p_matchday_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cast_poll_vote(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.cast_poll_vote IS
  'S026 · Player cast / change / cancel their vote on a matchday. Idempotent upsert. Re-voting yes after cancel resets committed_at (loses prior seat). Cancel is soft-delete via cancelled_at. Raises FFC_PROFILE_BANNED_OR_REJECTED for banned profiles.';


-- =========================================================================
-- 2. invite_guest
-- =========================================================================
-- Rules:
-- * Caller must be confirmed (active 'yes' vote within roster_cap).
-- * Slot must be available: confirmed_count + guest_count < roster_cap.
-- * Writes match_guests row with full S007 stat fields.
-- * Primary/secondary positions must differ if both supplied.
-- * Rating, stamina, accuracy required (app-layer Phase-1 rule).
CREATE OR REPLACE FUNCTION public.invite_guest(
  p_matchday_id       uuid,
  p_display_name      text,
  p_primary_position  public.player_position,
  p_secondary_position public.player_position,
  p_stamina           public.guest_trait,
  p_accuracy          public.guest_trait,
  p_rating            public.guest_rating,
  p_description       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile uuid := public.current_profile_id();
  v_cap int;
  v_confirmed_count int;
  v_guest_count int;
  v_guest_id uuid;
  v_caller_rank int;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'FFC_NOT_AUTHENTICATED' USING ERRCODE = '42501';
  END IF;

  IF p_matchday_id IS NULL OR p_display_name IS NULL OR length(trim(p_display_name)) = 0 THEN
    RAISE EXCEPTION 'FFC_MISSING_REQUIRED_FIELDS' USING ERRCODE = '22023';
  END IF;

  IF length(p_display_name) > 40 THEN
    RAISE EXCEPTION 'FFC_DISPLAY_NAME_TOO_LONG' USING ERRCODE = '22001';
  END IF;

  IF p_primary_position IS NULL OR p_stamina IS NULL OR p_accuracy IS NULL OR p_rating IS NULL THEN
    RAISE EXCEPTION 'FFC_GUEST_STATS_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_secondary_position IS NOT NULL AND p_secondary_position = p_primary_position THEN
    RAISE EXCEPTION 'FFC_POSITIONS_MUST_DIFFER' USING ERRCODE = '22023';
  END IF;

  IF p_description IS NOT NULL AND length(p_description) > 140 THEN
    RAISE EXCEPTION 'FFC_DESCRIPTION_TOO_LONG' USING ERRCODE = '22001';
  END IF;

  -- Resolve cap
  v_cap := public.roster_cap(public.effective_format(p_matchday_id));

  -- Caller must be a confirmed regular (rank <= cap within the commitment order).
  SELECT slot_order
    INTO v_caller_rank
    FROM public.v_match_commitments
   WHERE matchday_id = p_matchday_id
     AND commitment_type = 'player'
     AND participant_id = v_profile
   LIMIT 1;

  IF v_caller_rank IS NULL OR v_caller_rank > v_cap THEN
    RAISE EXCEPTION 'FFC_INVITER_NOT_CONFIRMED' USING ERRCODE = '42501';
  END IF;

  -- Slot availability
  SELECT count(*) INTO v_confirmed_count
    FROM public.poll_votes
   WHERE matchday_id = p_matchday_id
     AND choice = 'yes'
     AND cancelled_at IS NULL;

  SELECT count(*) INTO v_guest_count
    FROM public.match_guests
   WHERE matchday_id = p_matchday_id
     AND cancelled_at IS NULL;

  IF (v_confirmed_count + v_guest_count) >= v_cap THEN
    RAISE EXCEPTION 'FFC_NO_GUEST_SLOT' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.match_guests(
    matchday_id, inviter_id, display_name,
    primary_position, secondary_position,
    stamina, accuracy, rating, description
  ) VALUES (
    p_matchday_id, v_profile, trim(p_display_name),
    p_primary_position, p_secondary_position,
    p_stamina, p_accuracy, p_rating, NULLIF(p_description, '')
  )
  RETURNING id INTO v_guest_id;

  RETURN jsonb_build_object(
    'guest_id', v_guest_id,
    'matchday_id', p_matchday_id,
    'display_name', p_display_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.invite_guest(uuid, text, public.player_position, public.player_position, public.guest_trait, public.guest_trait, public.guest_rating, text) TO authenticated;

COMMENT ON FUNCTION public.invite_guest IS
  'S026 · §3.5 invite flow. Confirmed-only callers. Validates slot availability against roster_cap(effective_format). Writes match_guests with full S007 stats. Raises FFC_NO_GUEST_SLOT if cap reached, FFC_INVITER_NOT_CONFIRMED otherwise.';
