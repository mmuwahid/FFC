-- 0050_admin_update_match_draft_rpc.sql
-- S054 (issue #11) — admin replaces an existing draft match's rosters.
--
-- Full-replace strategy: DELETE all match_players for the match, then
-- re-INSERT from the new roster arrays. Simpler than per-player swap RPCs
-- and safe because a draft match has no goals / cards / result yet.
--
-- Guards:
--   • is_admin() body check + EXECUTE-grant gate (two-layer, per S047)
--   • Refuses if the match has a result (score set) — result is already
--     in flight or approved; editing rosters at that point is unsafe.
--   • Strict cap enforcement: total roster must equal roster_cap(format).
--   • At least one player per team is required.
--   • All profile_ids must exist and not be soft-deleted.
--   • All guest_ids must belong to the same matchday.
--
-- Audits BEFORE the destructive DELETE so the log survives partial failure.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_match_draft(
  p_match_id     uuid,
  p_white_roster uuid[],
  p_black_roster uuid[],
  p_white_guests uuid[],
  p_black_guests uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id    uuid := public.current_profile_id();
  v_matchday_id uuid;
  v_season_id   uuid;
  v_format      public.match_format;
  v_cap         int;
  v_total       int;
  v_pid         uuid;
BEGIN
  -- ── Auth ──────────────────────────────────────────────────────────────
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  -- ── Resolve match ──────────────────────────────────────────────────────
  SELECT m.matchday_id, m.season_id
    INTO v_matchday_id, v_season_id
    FROM public.matches m
   WHERE m.id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match % not found', p_match_id USING ERRCODE = 'P0002';
  END IF;

  -- ── Safety: refuse if result already recorded ─────────────────────────
  IF EXISTS (
    SELECT 1 FROM public.matches
    WHERE id = p_match_id AND result IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot edit roster of a match that already has a result'
      USING ERRCODE = '22023';
  END IF;

  -- ── Cap check ─────────────────────────────────────────────────────────
  v_format := public.effective_format(v_matchday_id);
  v_cap    := public.roster_cap(v_format);

  v_total := COALESCE(array_length(p_white_roster, 1), 0)
           + COALESCE(array_length(p_black_roster, 1), 0)
           + COALESCE(array_length(p_white_guests, 1), 0)
           + COALESCE(array_length(p_black_guests, 1), 0);

  IF v_total <> v_cap THEN
    RAISE EXCEPTION 'Roster size % does not match cap % for format %',
      v_total, v_cap, v_format USING ERRCODE = '22023';
  END IF;

  -- At least one player per team
  IF COALESCE(array_length(p_white_roster, 1), 0)
   + COALESCE(array_length(p_white_guests, 1), 0) = 0 THEN
    RAISE EXCEPTION 'White team must have at least one player' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(array_length(p_black_roster, 1), 0)
   + COALESCE(array_length(p_black_guests, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Black team must have at least one player' USING ERRCODE = '22023';
  END IF;

  -- ── Validate profile_ids exist and are not deleted ────────────────────
  IF p_white_roster IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_white_roster LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = v_pid AND deleted_at IS NULL
      ) THEN
        RAISE EXCEPTION 'Profile % not found or deleted', v_pid USING ERRCODE = 'P0002';
      END IF;
    END LOOP;
  END IF;
  IF p_black_roster IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_black_roster LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = v_pid AND deleted_at IS NULL
      ) THEN
        RAISE EXCEPTION 'Profile % not found or deleted', v_pid USING ERRCODE = 'P0002';
      END IF;
    END LOOP;
  END IF;

  -- ── Validate guest_ids belong to this matchday ────────────────────────
  IF p_white_guests IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_white_guests LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.match_guests
        WHERE id = v_pid AND matchday_id = v_matchday_id AND cancelled_at IS NULL
      ) THEN
        RAISE EXCEPTION 'Guest % not found for this matchday', v_pid USING ERRCODE = 'P0002';
      END IF;
    END LOOP;
  END IF;
  IF p_black_guests IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_black_guests LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.match_guests
        WHERE id = v_pid AND matchday_id = v_matchday_id AND cancelled_at IS NULL
      ) THEN
        RAISE EXCEPTION 'Guest % not found for this matchday', v_pid USING ERRCODE = 'P0002';
      END IF;
    END LOOP;
  END IF;

  -- ── Audit BEFORE destructive change ───────────────────────────────────
  PERFORM public.log_admin_action(
    'matches', p_match_id, 'admin_update_draft_roster',
    jsonb_build_object(
      'matchday_id',  v_matchday_id,
      'format',       v_format,
      'white_roster', p_white_roster,
      'black_roster', p_black_roster,
      'white_guests', p_white_guests,
      'black_guests', p_black_guests
    )
  );

  -- ── Replace roster ────────────────────────────────────────────────────
  -- Preserve captain flags: carry them over if the same profile_id / guest_id
  -- reappears in the new roster. A dropped player loses their captain flag.
  DELETE FROM public.match_players WHERE match_id = p_match_id;

  IF p_white_roster IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_white_roster LOOP
      INSERT INTO public.match_players (match_id, profile_id, team)
      VALUES (p_match_id, v_pid, 'white');
    END LOOP;
  END IF;
  IF p_black_roster IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_black_roster LOOP
      INSERT INTO public.match_players (match_id, profile_id, team)
      VALUES (p_match_id, v_pid, 'black');
    END LOOP;
  END IF;
  IF p_white_guests IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_white_guests LOOP
      INSERT INTO public.match_players (match_id, guest_id, team)
      VALUES (p_match_id, v_pid, 'white');
    END LOOP;
  END IF;
  IF p_black_guests IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_black_guests LOOP
      INSERT INTO public.match_players (match_id, guest_id, team)
      VALUES (p_match_id, v_pid, 'black');
    END LOOP;
  END IF;

  UPDATE public.matches
     SET updated_at = now(), updated_by = v_admin_id
   WHERE id = p_match_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_match_draft(uuid, uuid[], uuid[], uuid[], uuid[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_update_match_draft(uuid, uuid[], uuid[], uuid[], uuid[]) TO authenticated;

COMMENT ON FUNCTION public.admin_update_match_draft(uuid, uuid[], uuid[], uuid[], uuid[]) IS
  'S054 (issue #11): full-replace roster for an existing draft match. '
  'Deletes all match_players then re-inserts from new arrays. '
  'Refuses if result is already recorded. Strict cap enforcement. '
  'Two-layer guard: is_admin() + EXECUTE-grant gate. Audits before DELETE.';

COMMIT;
