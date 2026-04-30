-- 0063_match_players_slot_index.sql
-- Add an explicit per-team slot order to match_players.
--
-- Problem this fixes:
--   create_match_draft / admin_update_match_draft / admin_edit_match_roster
--   all bulk-insert match_players in a single transaction. now() returns the
--   transaction start time, so every row gets the same created_at. The Poll
--   screen (and any other screen that wants to show team rosters in slot
--   order) had no stable way to recover the order admin saved them in —
--   sorting by id produced random uuid order; sorting by created_at
--   produced ties that PostgREST broke arbitrarily.
--
-- This migration:
--   (1) Adds match_players.slot_index integer (nullable; new rows set it).
--   (2) Backfills existing rows with ROW_NUMBER() OVER (PARTITION BY
--       match_id, team ORDER BY created_at, id) — best-effort but
--       deterministic from this point on.
--   (3) Updates create_match_draft, admin_update_match_draft,
--       admin_edit_match_roster to set slot_index from array position
--       (1-based to match the rest of FFC's slot UI which is 1-7).
--   (4) Adds index (match_id, team, slot_index).

BEGIN;

-- (1) Schema
ALTER TABLE public.match_players
  ADD COLUMN IF NOT EXISTS slot_index integer;

COMMENT ON COLUMN public.match_players.slot_index IS
  'Per-team slot order as saved by admin (1-based). NULL on rows from
   pre-0063 inserts that weren''t backfilled. Sort by (team, slot_index)
   to render team lists in the order admin set in Roster Setup.';

-- (2) Backfill
UPDATE public.match_players mp
   SET slot_index = sub.rn
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY match_id, team
             ORDER BY created_at, id
           ) AS rn
      FROM public.match_players
  ) sub
 WHERE mp.id = sub.id
   AND mp.slot_index IS NULL;

CREATE INDEX IF NOT EXISTS match_players_slot_idx
  ON public.match_players (match_id, team, slot_index);

-- (3a) create_match_draft — set slot_index from array index.
CREATE OR REPLACE FUNCTION public.create_match_draft(
  p_matchday_id  uuid,
  p_white_roster uuid[],
  p_black_roster uuid[],
  p_white_guests uuid[],
  p_black_guests uuid[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_match_id  uuid;
  v_season_id uuid;
  v_format    match_format;
  v_cap       int;
  v_total     int;
  v_pid       uuid;
  v_idx       int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT season_id INTO v_season_id FROM public.matchdays WHERE id = p_matchday_id;
  v_format := public.effective_format(p_matchday_id);
  v_cap    := public.roster_cap(v_format);
  v_total  := COALESCE(array_length(p_white_roster,1),0)
            + COALESCE(array_length(p_black_roster,1),0)
            + COALESCE(array_length(p_white_guests,1),0)
            + COALESCE(array_length(p_black_guests,1),0);

  IF v_total <> v_cap THEN
    RAISE EXCEPTION 'Roster size % does not match cap % for format %',
      v_total, v_cap, v_format USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.matches (matchday_id, season_id)
  VALUES (p_matchday_id, v_season_id)
  RETURNING id INTO v_match_id;

  -- White players: slot_index 1..N in input order.
  v_idx := 0;
  IF p_white_roster IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_white_roster LOOP
      v_idx := v_idx + 1;
      INSERT INTO public.match_players (match_id, profile_id, team, slot_index)
      VALUES (v_match_id, v_pid, 'white', v_idx);
    END LOOP;
  END IF;
  -- White guests continue after white players (same team list).
  IF p_white_guests IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_white_guests LOOP
      v_idx := v_idx + 1;
      INSERT INTO public.match_players (match_id, guest_id, team, slot_index)
      VALUES (v_match_id, v_pid, 'white', v_idx);
    END LOOP;
  END IF;

  -- Black players.
  v_idx := 0;
  IF p_black_roster IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_black_roster LOOP
      v_idx := v_idx + 1;
      INSERT INTO public.match_players (match_id, profile_id, team, slot_index)
      VALUES (v_match_id, v_pid, 'black', v_idx);
    END LOOP;
  END IF;
  IF p_black_guests IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_black_guests LOOP
      v_idx := v_idx + 1;
      INSERT INTO public.match_players (match_id, guest_id, team, slot_index)
      VALUES (v_match_id, v_pid, 'black', v_idx);
    END LOOP;
  END IF;

  PERFORM public.log_admin_action('matches', v_match_id, 'create_draft',
    jsonb_build_object('matchday_id', p_matchday_id, 'format', v_format));

  RETURN v_match_id;
END;
$$;

-- (3b) admin_update_match_draft — same per-team 1-based slot indexing.
CREATE OR REPLACE FUNCTION public.admin_update_match_draft(
  p_match_id     uuid,
  p_white_roster uuid[],
  p_black_roster uuid[],
  p_white_guests uuid[],
  p_black_guests uuid[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_admin_id    uuid := public.current_profile_id();
  v_matchday_id uuid;
  v_season_id   uuid;
  v_format      public.match_format;
  v_cap         int;
  v_total       int;
  v_pid         uuid;
  v_idx         int;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT m.matchday_id, m.season_id
    INTO v_matchday_id, v_season_id
    FROM public.matches m
   WHERE m.id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match % not found', p_match_id USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.matches
    WHERE id = p_match_id AND result IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot edit roster of a match that already has a result'
      USING ERRCODE = '22023';
  END IF;

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

  IF COALESCE(array_length(p_white_roster, 1), 0)
   + COALESCE(array_length(p_white_guests, 1), 0) = 0 THEN
    RAISE EXCEPTION 'White team must have at least one player' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(array_length(p_black_roster, 1), 0)
   + COALESCE(array_length(p_black_guests, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Black team must have at least one player' USING ERRCODE = '22023';
  END IF;

  -- Validate profile_ids exist.
  IF p_white_roster IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_white_roster LOOP
      IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_pid AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Profile % not found or deleted', v_pid USING ERRCODE = 'P0002';
      END IF;
    END LOOP;
  END IF;
  IF p_black_roster IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_black_roster LOOP
      IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_pid AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Profile % not found or deleted', v_pid USING ERRCODE = 'P0002';
      END IF;
    END LOOP;
  END IF;

  -- Validate guest_ids belong to this matchday.
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

  DELETE FROM public.match_players WHERE match_id = p_match_id;

  v_idx := 0;
  IF p_white_roster IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_white_roster LOOP
      v_idx := v_idx + 1;
      INSERT INTO public.match_players (match_id, profile_id, team, slot_index)
      VALUES (p_match_id, v_pid, 'white', v_idx);
    END LOOP;
  END IF;
  IF p_white_guests IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_white_guests LOOP
      v_idx := v_idx + 1;
      INSERT INTO public.match_players (match_id, guest_id, team, slot_index)
      VALUES (p_match_id, v_pid, 'white', v_idx);
    END LOOP;
  END IF;

  v_idx := 0;
  IF p_black_roster IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_black_roster LOOP
      v_idx := v_idx + 1;
      INSERT INTO public.match_players (match_id, profile_id, team, slot_index)
      VALUES (p_match_id, v_pid, 'black', v_idx);
    END LOOP;
  END IF;
  IF p_black_guests IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_black_guests LOOP
      v_idx := v_idx + 1;
      INSERT INTO public.match_players (match_id, guest_id, team, slot_index)
      VALUES (p_match_id, v_pid, 'black', v_idx);
    END LOOP;
  END IF;

  UPDATE public.matches
     SET updated_at = now(), updated_by = v_admin_id
   WHERE id = p_match_id;
END;
$$;

-- (3c) admin_edit_match_roster — read-from-jsonb path; assign slot_index
-- in the input array order, partitioned per team.
CREATE OR REPLACE FUNCTION public.admin_edit_match_roster(
  p_match_id uuid,
  p_players  jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id   uuid := public.current_profile_id();
  v_match      record;
  v_format     match_format;
  v_cap        int;
  v_total      int;
  v_white      int;
  v_black      int;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'p_match_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_players IS NULL OR jsonb_typeof(p_players) <> 'array' THEN
    RAISE EXCEPTION 'p_players must be a jsonb array' USING ERRCODE = '22023';
  END IF;

  SELECT m.id, m.matchday_id, md.format, md.season_id
    INTO v_match
    FROM public.matches m
    JOIN public.matchdays md ON md.id = m.matchday_id
   WHERE m.id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match % not found', p_match_id USING ERRCODE = 'P0002';
  END IF;

  v_format := COALESCE(v_match.format, '7v7'::match_format);
  v_cap    := public.roster_cap(v_format) / 2;

  SELECT COUNT(*) FILTER (WHERE elem->>'team' = 'white'),
         COUNT(*) FILTER (WHERE elem->>'team' = 'black'),
         COUNT(*)
    INTO v_white, v_black, v_total
    FROM jsonb_array_elements(p_players) elem;

  IF v_white > v_cap OR v_black > v_cap THEN
    RAISE EXCEPTION 'Each team capped at % players for %', v_cap, v_format
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_players) elem
    WHERE (elem ? 'profile_id') = (elem ? 'guest_id')
       OR (elem->>'profile_id' IS NULL AND elem->>'guest_id' IS NULL)
  ) THEN
    RAISE EXCEPTION 'Each roster row must have exactly one of profile_id or guest_id'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.match_players WHERE match_id = p_match_id;

  -- WITH ORDINALITY gives us the input array index. ROW_NUMBER() partitioned
  -- by team derives the per-team slot_index.
  INSERT INTO public.match_players (
    match_id, profile_id, guest_id, team, is_captain,
    goals, yellow_cards, red_cards, is_no_show, slot_index, updated_by, updated_at
  )
  SELECT
    p_match_id,
    NULLIF(elem->>'profile_id', '')::uuid,
    NULLIF(elem->>'guest_id', '')::uuid,
    (elem->>'team')::team_color,
    COALESCE((elem->>'is_captain')::boolean, false),
    COALESCE((elem->>'goals')::int, 0),
    COALESCE((elem->>'yellow_cards')::int, 0),
    COALESCE((elem->>'red_cards')::int, 0),
    COALESCE((elem->>'is_no_show')::boolean, false),
    ROW_NUMBER() OVER (PARTITION BY elem->>'team' ORDER BY ord),
    v_admin_id,
    now()
  FROM jsonb_array_elements(p_players) WITH ORDINALITY AS t(elem, ord);

  INSERT INTO public.admin_audit_log
    (admin_profile_id, target_entity, target_id, action, payload_jsonb)
  VALUES
    (v_admin_id, 'matches', p_match_id, 'admin_edit_match_roster',
     jsonb_build_object(
       'matchday_id', v_match.matchday_id,
       'format',      v_format,
       'white_count', v_white,
       'black_count', v_black,
       'total',       v_total
     ));

  PERFORM public.snapshot_and_diff_ranks(v_match.season_id);
END;
$$;

COMMIT;
