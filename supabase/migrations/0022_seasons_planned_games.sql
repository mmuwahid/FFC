-- 0022_seasons_planned_games.sql
-- Adds planned_games column + admin RPCs for creating/editing seasons.
-- Driven by Matches flashcard spec (2026-04-23).
-- NOTE: Plan originally called this 0020; renumbered to 0022 because
-- S028 already landed 0020 (v_match_commitments_guest_id) and 0021
-- (admin_draft_override_rpcs).

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 1. seasons.planned_games
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE seasons
  ADD COLUMN planned_games int
    CHECK (planned_games IS NULL OR planned_games >= 1);

COMMENT ON COLUMN seasons.planned_games IS
  'Total number of games planned for the season. Nullable = not set yet; Matches banner then renders "GAME N" with no denominator.';

-- ═══════════════════════════════════════════════════════════════
-- 2. create_season(name, starts_on, planned_games, default_format, roster_policy)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION create_season(
  p_name           text,
  p_starts_on      date,
  p_planned_games  int,
  p_default_format match_format DEFAULT '7v7',
  p_roster_policy  roster_policy DEFAULT 'carry_forward'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_id uuid;
  v_season_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  v_caller_id := current_profile_id();

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Season name required' USING ERRCODE = '22023';
  END IF;

  IF p_starts_on IS NULL THEN
    RAISE EXCEPTION 'Season starts_on required' USING ERRCODE = '22023';
  END IF;

  IF p_planned_games IS NOT NULL AND p_planned_games < 1 THEN
    RAISE EXCEPTION 'planned_games must be >= 1' USING ERRCODE = '22023';
  END IF;

  INSERT INTO seasons (name, starts_on, planned_games, default_format, roster_policy, created_by)
  VALUES (trim(p_name), p_starts_on, p_planned_games, p_default_format, p_roster_policy, v_caller_id)
  RETURNING id INTO v_season_id;

  PERFORM log_admin_action('seasons', v_season_id, 'create_season',
    jsonb_build_object(
      'name', trim(p_name),
      'starts_on', p_starts_on,
      'planned_games', p_planned_games,
      'default_format', p_default_format,
      'roster_policy', p_roster_policy
    ));

  RETURN v_season_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_season(text, date, int, match_format, roster_policy) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3. update_season_planned_games(season_id, planned_games)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_season_planned_games(
  p_season_id     uuid,
  p_planned_games int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  IF p_planned_games IS NOT NULL AND p_planned_games < 1 THEN
    RAISE EXCEPTION 'planned_games must be >= 1' USING ERRCODE = '22023';
  END IF;

  UPDATE seasons
     SET planned_games = p_planned_games
   WHERE id = p_season_id
     AND ended_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season not found or already ended' USING ERRCODE = '22023';
  END IF;

  PERFORM log_admin_action('seasons', p_season_id, 'update_season_planned_games',
    jsonb_build_object('planned_games', p_planned_games));
END;
$$;

GRANT EXECUTE ON FUNCTION update_season_planned_games(uuid, int) TO authenticated;

COMMIT;
