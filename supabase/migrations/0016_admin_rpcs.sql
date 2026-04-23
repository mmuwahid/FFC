-- Migration 0016 — Admin RPCs for §3.17 Players edit/ban and §3.18 Matches CRUD.
-- All RPCs are SECURITY DEFINER, admin-gated, and write to admin_audit_log via
-- log_admin_action(admin_profile_id, target_entity, target_id, action, payload jsonb).

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- §3.17 — Player profile admin edits
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_player_profile(
  p_profile_id uuid,
  p_display_name text,
  p_primary_position public.player_position,
  p_secondary_position public.player_position,
  p_is_active boolean,
  p_role public.user_role DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid;
  v_before jsonb;
  v_old_role public.user_role;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v_admin := public.current_profile_id();

  SELECT to_jsonb(p.*) - 'avatar_url' - 'push_prefs' - 'notes',
         p.role
    INTO v_before, v_old_role
    FROM public.profiles p
   WHERE p.id = p_profile_id
   FOR UPDATE;

  IF v_before IS NULL THEN RAISE EXCEPTION 'profile_not_found'; END IF;

  IF p_display_name IS NULL OR length(btrim(p_display_name)) < 2 THEN
    RAISE EXCEPTION 'display_name_too_short';
  END IF;

  IF p_primary_position IS NOT NULL
     AND p_secondary_position IS NOT NULL
     AND p_primary_position = p_secondary_position THEN
    RAISE EXCEPTION 'positions_identical';
  END IF;

  -- Role change guarded: only super_admin may change role; super_admin elevation blocked.
  IF p_role IS NOT NULL AND p_role <> v_old_role THEN
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'role_change_super_admin_only' USING ERRCODE = '42501';
    END IF;
    IF p_role = 'super_admin' THEN
      RAISE EXCEPTION 'super_admin_elevation_blocked';
    END IF;
    IF v_old_role = 'rejected' AND p_role <> 'rejected' THEN
      -- allow, but reject_reason is cleared
      UPDATE public.profiles SET reject_reason = NULL WHERE id = p_profile_id;
    END IF;
    UPDATE public.profiles SET role = p_role WHERE id = p_profile_id;
  END IF;

  UPDATE public.profiles
     SET display_name       = btrim(p_display_name),
         primary_position   = p_primary_position,
         secondary_position = p_secondary_position,
         is_active          = COALESCE(p_is_active, is_active),
         updated_at         = now(),
         updated_by         = v_admin
   WHERE id = p_profile_id;

  PERFORM public.log_admin_action(
    'profile',
    p_profile_id,
    'update_player_profile',
    jsonb_build_object(
      'before', v_before,
      'patch', jsonb_build_object(
        'display_name', btrim(p_display_name),
        'primary_position', p_primary_position,
        'secondary_position', p_secondary_position,
        'is_active', p_is_active,
        'role', p_role
      )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ban_player(
  p_profile_id uuid,
  p_reason text,
  p_ends_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid;
  v_ban_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v_admin := public.current_profile_id();

  IF length(btrim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason_too_short';
  END IF;
  IF p_ends_at IS NULL OR p_ends_at <= now() THEN
    RAISE EXCEPTION 'ends_at_must_be_future';
  END IF;

  -- Idempotency guard: active ban already exists?
  IF EXISTS (
    SELECT 1 FROM public.player_bans
     WHERE profile_id = p_profile_id
       AND revoked_at IS NULL
       AND ends_at > now()
  ) THEN
    RAISE EXCEPTION 'already_banned';
  END IF;

  INSERT INTO public.player_bans(profile_id, starts_at, ends_at, reason, imposed_by)
    VALUES (p_profile_id, now(), p_ends_at, btrim(p_reason), v_admin)
    RETURNING id INTO v_ban_id;

  UPDATE public.profiles
     SET is_active = false, updated_at = now(), updated_by = v_admin
   WHERE id = p_profile_id;

  PERFORM public.log_admin_action(
    'profile', p_profile_id, 'ban_player',
    jsonb_build_object('ban_id', v_ban_id, 'reason', btrim(p_reason), 'ends_at', p_ends_at)
  );

  RETURN v_ban_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unban_player(p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid;
  v_count int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v_admin := public.current_profile_id();

  UPDATE public.player_bans
     SET revoked_at = now(), revoked_by = v_admin
   WHERE profile_id = p_profile_id
     AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.profiles
     SET is_active = true, updated_at = now(), updated_by = v_admin
   WHERE id = p_profile_id;

  PERFORM public.log_admin_action(
    'profile', p_profile_id, 'unban_player',
    jsonb_build_object('bans_revoked', v_count)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reinstate_rejected(p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid;
  v_reason text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v_admin := public.current_profile_id();

  SELECT reject_reason INTO v_reason
    FROM public.profiles
   WHERE id = p_profile_id AND role = 'rejected';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_rejected'; END IF;

  UPDATE public.profiles
     SET role          = 'player',
         reject_reason = NULL,
         is_active     = true,
         updated_at    = now(),
         updated_by    = v_admin
   WHERE id = p_profile_id;

  PERFORM public.log_admin_action(
    'profile', p_profile_id, 'reinstate_rejected',
    jsonb_build_object('previous_reason', v_reason)
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- §3.18 — Matchday admin CRUD + result entry
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_matchday(
  p_season_id uuid,
  p_kickoff_at timestamptz,
  p_venue text,
  p_poll_opens_at timestamptz,
  p_poll_closes_at timestamptz,
  p_format public.match_format DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid;
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v_admin := public.current_profile_id();

  IF p_poll_opens_at IS NULL OR p_poll_closes_at IS NULL OR p_kickoff_at IS NULL THEN
    RAISE EXCEPTION 'timestamps_required';
  END IF;
  IF p_poll_opens_at >= p_poll_closes_at THEN
    RAISE EXCEPTION 'poll_window_invalid';
  END IF;
  IF p_poll_closes_at > p_kickoff_at THEN
    RAISE EXCEPTION 'poll_must_close_before_kickoff';
  END IF;

  INSERT INTO public.matchdays(
    season_id, kickoff_at, venue,
    poll_opens_at, poll_closes_at, format, created_by
  ) VALUES (
    p_season_id, p_kickoff_at, NULLIF(btrim(COALESCE(p_venue,'')),''),
    p_poll_opens_at, p_poll_closes_at, p_format, v_admin
  ) RETURNING id INTO v_id;

  PERFORM public.log_admin_action(
    'matchday', v_id, 'create_matchday',
    jsonb_build_object(
      'season_id', p_season_id, 'kickoff_at', p_kickoff_at,
      'venue', p_venue, 'format', p_format
    )
  );
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_matchday(
  p_matchday_id uuid,
  p_kickoff_at timestamptz DEFAULT NULL,
  p_venue text DEFAULT NULL,
  p_poll_opens_at timestamptz DEFAULT NULL,
  p_poll_closes_at timestamptz DEFAULT NULL,
  p_format public.match_format DEFAULT NULL,
  p_venue_explicit_null boolean DEFAULT false,
  p_format_explicit_null boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid;
  v_before jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v_admin := public.current_profile_id();

  SELECT to_jsonb(m.*) INTO v_before FROM public.matchdays m WHERE m.id = p_matchday_id FOR UPDATE;
  IF v_before IS NULL THEN RAISE EXCEPTION 'matchday_not_found'; END IF;

  UPDATE public.matchdays
     SET kickoff_at     = COALESCE(p_kickoff_at,     kickoff_at),
         poll_opens_at  = COALESCE(p_poll_opens_at,  poll_opens_at),
         poll_closes_at = COALESCE(p_poll_closes_at, poll_closes_at),
         venue          = CASE WHEN p_venue_explicit_null THEN NULL
                                ELSE COALESCE(p_venue, venue) END,
         format         = CASE WHEN p_format_explicit_null THEN NULL
                                ELSE COALESCE(p_format, format) END
   WHERE id = p_matchday_id;

  PERFORM public.log_admin_action(
    'matchday', p_matchday_id, 'update_matchday',
    jsonb_build_object(
      'before', v_before,
      'patch', jsonb_build_object(
        'kickoff_at', p_kickoff_at, 'venue', p_venue,
        'poll_opens_at', p_poll_opens_at, 'poll_closes_at', p_poll_closes_at,
        'format', p_format
      )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.lock_roster(p_matchday_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid;
  v_locked timestamptz;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v_admin := public.current_profile_id();

  SELECT roster_locked_at INTO v_locked
    FROM public.matchdays WHERE id = p_matchday_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'matchday_not_found'; END IF;
  IF v_locked IS NOT NULL THEN RAISE EXCEPTION 'already_locked'; END IF;

  UPDATE public.matchdays SET roster_locked_at = now() WHERE id = p_matchday_id;

  PERFORM public.log_admin_action(
    'matchday', p_matchday_id, 'lock_roster', '{}'::jsonb
  );
END;
$$;

-- Admin submits a full match result directly (bypasses ref-entry flow for Phase 1).
-- Creates one matches row + N match_players rows. If a matches row already exists
-- for the matchday, the caller should use edit_match_result instead.
--
-- p_players shape (jsonb array):
--   [
--     { "profile_id": "...", "team": "white"|"black",
--       "is_captain": bool, "goals": int, "yellow_cards": int, "red_cards": int,
--       "is_no_show": bool },
--     { "guest_id":   "...", "team": "white"|"black",
--       "is_captain": bool, "goals": int, "yellow_cards": int, "red_cards": int,
--       "is_no_show": bool },
--     ...
--   ]
CREATE OR REPLACE FUNCTION public.admin_submit_match_result(
  p_matchday_id uuid,
  p_score_white int,
  p_score_black int,
  p_motm_profile_id uuid,
  p_motm_guest_id uuid,
  p_players jsonb,
  p_notes text DEFAULT NULL,
  p_approve boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid;
  v_season uuid;
  v_result public.match_result;
  v_match_id uuid;
  v_row jsonb;
  v_mp_count int := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v_admin := public.current_profile_id();

  IF p_score_white IS NULL OR p_score_black IS NULL
     OR p_score_white < 0 OR p_score_black < 0 THEN
    RAISE EXCEPTION 'scores_invalid';
  END IF;

  SELECT season_id INTO v_season FROM public.matchdays WHERE id = p_matchday_id;
  IF v_season IS NULL THEN RAISE EXCEPTION 'matchday_not_found'; END IF;

  IF EXISTS (SELECT 1 FROM public.matches WHERE matchday_id = p_matchday_id) THEN
    RAISE EXCEPTION 'match_exists_use_edit_match_result';
  END IF;

  v_result := CASE
    WHEN p_score_white > p_score_black THEN 'win_white'::public.match_result
    WHEN p_score_black > p_score_white THEN 'win_black'::public.match_result
    ELSE 'draw'::public.match_result
  END;

  IF p_motm_profile_id IS NOT NULL AND p_motm_guest_id IS NOT NULL THEN
    RAISE EXCEPTION 'motm_only_one_allowed';
  END IF;

  INSERT INTO public.matches(
    matchday_id, season_id, result,
    score_white, score_black,
    motm_user_id, motm_guest_id,
    notes,
    approved_at, approved_by,
    updated_by
  ) VALUES (
    p_matchday_id, v_season, v_result,
    p_score_white, p_score_black,
    p_motm_profile_id, p_motm_guest_id,
    NULLIF(btrim(COALESCE(p_notes,'')), ''),
    CASE WHEN p_approve THEN now() ELSE NULL END,
    CASE WHEN p_approve THEN v_admin ELSE NULL END,
    v_admin
  ) RETURNING id INTO v_match_id;

  IF p_players IS NOT NULL AND jsonb_typeof(p_players) = 'array' THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_players) LOOP
      -- exactly one of profile_id | guest_id must be present
      IF (v_row ? 'profile_id') = (v_row ? 'guest_id') THEN
        RAISE EXCEPTION 'player_row_must_have_exactly_one_id';
      END IF;

      INSERT INTO public.match_players(
        match_id, profile_id, guest_id, team, is_captain,
        goals, yellow_cards, red_cards, is_no_show,
        updated_by
      ) VALUES (
        v_match_id,
        NULLIF(v_row->>'profile_id','')::uuid,
        NULLIF(v_row->>'guest_id','')::uuid,
        (v_row->>'team')::public.team_color,
        COALESCE((v_row->>'is_captain')::boolean, false),
        COALESCE((v_row->>'goals')::int, 0),
        COALESCE((v_row->>'yellow_cards')::int, 0),
        COALESCE((v_row->>'red_cards')::int, 0),
        COALESCE((v_row->>'is_no_show')::boolean, false),
        v_admin
      );
      v_mp_count := v_mp_count + 1;
    END LOOP;
  END IF;

  PERFORM public.log_admin_action(
    'match', v_match_id, 'admin_submit_match_result',
    jsonb_build_object(
      'matchday_id', p_matchday_id,
      'score_white', p_score_white, 'score_black', p_score_black,
      'result', v_result,
      'motm_profile_id', p_motm_profile_id,
      'motm_guest_id', p_motm_guest_id,
      'player_rows', v_mp_count,
      'approved', p_approve
    )
  );

  RETURN v_match_id;
END;
$$;

-- Grant EXECUTE on the admin RPCs so the authenticated role can call them.
-- (DEFAULT PRIVILEGES from 0012 cover most cases, but SECURITY DEFINER functions
-- require an explicit grant from the owner role to be callable from PostgREST.)
GRANT EXECUTE ON FUNCTION
  public.update_player_profile(uuid, text, public.player_position, public.player_position, boolean, public.user_role),
  public.ban_player(uuid, text, timestamptz),
  public.unban_player(uuid),
  public.reinstate_rejected(uuid),
  public.create_matchday(uuid, timestamptz, text, timestamptz, timestamptz, public.match_format),
  public.update_matchday(uuid, timestamptz, text, timestamptz, timestamptz, public.match_format, boolean, boolean),
  public.lock_roster(uuid),
  public.admin_submit_match_result(uuid, int, int, uuid, uuid, jsonb, text, boolean)
TO authenticated;

COMMIT;
