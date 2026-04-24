-- 0025_seasons_admin_rpcs.sql
-- Adds full edit + guarded delete RPCs for the Admin Seasons screen redesign.
-- Also makes planned_games REQUIRED in create_season per S034 spec.
-- See sessions/S034 for context.

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 1. create_season — make planned_games required (drop + recreate,
--    because default-arg changes require a signature rebuild).
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS create_season(text, date, int, match_format, roster_policy);

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

  -- S034: planned_games is now required (was optional).
  IF p_planned_games IS NULL THEN
    RAISE EXCEPTION 'planned_games required' USING ERRCODE = '22023',
      CONSTRAINT = 'FFC_SEASON_PLANNED_REQUIRED';
  END IF;

  IF p_planned_games < 1 THEN
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
-- 2. update_season — full edit of name/dates/planned/format/policy.
--    All fields optional; only non-NULL args are applied.
--    Raises FFC_SEASON_NOT_FOUND if the id doesn't exist.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_season(
  p_season_id      uuid,
  p_name           text           DEFAULT NULL,
  p_starts_on      date           DEFAULT NULL,
  p_ends_on        date           DEFAULT NULL,
  p_planned_games  int            DEFAULT NULL,
  p_default_format match_format   DEFAULT NULL,
  p_roster_policy  roster_policy  DEFAULT NULL,
  p_clear_ends_on  boolean        DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  IF p_name IS NOT NULL AND length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Season name cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_planned_games IS NOT NULL AND p_planned_games < 1 THEN
    RAISE EXCEPTION 'planned_games must be >= 1' USING ERRCODE = '22023';
  END IF;

  UPDATE seasons SET
    name           = COALESCE(trim(p_name), name),
    starts_on      = COALESCE(p_starts_on, starts_on),
    -- p_ends_on NULL = leave alone unless p_clear_ends_on = true.
    -- To clear the end date, caller must pass p_clear_ends_on=true.
    ends_on        = CASE
                       WHEN p_clear_ends_on THEN NULL
                       WHEN p_ends_on IS NOT NULL THEN p_ends_on
                       ELSE ends_on
                     END,
    -- When ends_on is moved into the past, stamp ended_at/ended_by.
    -- When cleared, unstamp.
    ended_at       = CASE
                       WHEN p_clear_ends_on THEN NULL
                       WHEN p_ends_on IS NOT NULL AND p_ends_on <= CURRENT_DATE THEN v_now
                       ELSE ended_at
                     END,
    ended_by       = CASE
                       WHEN p_clear_ends_on THEN NULL
                       WHEN p_ends_on IS NOT NULL AND p_ends_on <= CURRENT_DATE THEN current_profile_id()
                       ELSE ended_by
                     END,
    planned_games  = COALESCE(p_planned_games, planned_games),
    default_format = COALESCE(p_default_format, default_format),
    roster_policy  = COALESCE(p_roster_policy, roster_policy)
  WHERE id = p_season_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season not found' USING ERRCODE = '22023',
      CONSTRAINT = 'FFC_SEASON_NOT_FOUND';
  END IF;

  PERFORM log_admin_action('seasons', p_season_id, 'update_season',
    jsonb_build_object(
      'name', p_name,
      'starts_on', p_starts_on,
      'ends_on', p_ends_on,
      'planned_games', p_planned_games,
      'default_format', p_default_format,
      'roster_policy', p_roster_policy,
      'clear_ends_on', p_clear_ends_on
    ));
END;
$$;

GRANT EXECUTE ON FUNCTION update_season(uuid, text, date, date, int, match_format, roster_policy, boolean) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3. delete_season — guarded. Refuses if any matchdays exist on
--    this season. Audits before DELETE so the log survives.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION delete_season(
  p_season_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_matchday_count int;
  v_name           text;
  v_starts_on      date;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT name, starts_on INTO v_name, v_starts_on
    FROM seasons WHERE id = p_season_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season not found' USING ERRCODE = '22023',
      CONSTRAINT = 'FFC_SEASON_NOT_FOUND';
  END IF;

  SELECT COUNT(*) INTO v_matchday_count
    FROM matchdays WHERE season_id = p_season_id;

  IF v_matchday_count > 0 THEN
    RAISE EXCEPTION 'Season has % matchdays — cannot delete', v_matchday_count
      USING ERRCODE = '22023', CONSTRAINT = 'FFC_SEASON_HAS_MATCHDAYS';
  END IF;

  -- Audit BEFORE delete so the log row survives (admin_audit_log keeps
  -- the snapshot; the seasons row itself is gone).
  PERFORM log_admin_action('seasons', p_season_id, 'delete_season',
    jsonb_build_object('name', v_name, 'starts_on', v_starts_on));

  DELETE FROM seasons WHERE id = p_season_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_season(uuid) TO authenticated;

COMMIT;
