-- 0048_admin_replace_match_roster.sql
-- Admin RPC to replace a match's profile-linked roster while preserving existing
-- player stats (goals, cards). Used by the Roster Setup editor after unlocking.
--
-- Strategy:
--   1. Delete profile-linked rows for players NOT in the new roster.
--   2. UPDATE team for players already in match_players who are staying.
--   3. INSERT fresh rows (zero stats) for players newly added to a team.
--   Guest rows (guest_id IS NOT NULL) are left untouched.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_replace_match_roster(
  p_match_id          uuid,
  p_white_profile_ids uuid[],
  p_black_profile_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_all_ids uuid[];
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM matches WHERE id = p_match_id) THEN
    RAISE EXCEPTION 'Match not found' USING ERRCODE = '22023';
  END IF;

  v_all_ids :=
    COALESCE(p_white_profile_ids, ARRAY[]::uuid[]) ||
    COALESCE(p_black_profile_ids, ARRAY[]::uuid[]);

  -- Audit BEFORE destructive change (mirrors S034/S049 pattern)
  PERFORM log_admin_action('match', p_match_id, 'replace_roster', jsonb_build_object(
    'white_count', COALESCE(array_length(p_white_profile_ids, 1), 0),
    'black_count', COALESCE(array_length(p_black_profile_ids, 1), 0)
  ));

  -- Remove profile rows no longer in new roster; guest rows untouched
  DELETE FROM match_players
  WHERE match_id = p_match_id
    AND profile_id IS NOT NULL
    AND NOT (profile_id = ANY(v_all_ids));

  -- Update team for players staying (preserves goals/cards/captain/no-show)
  UPDATE match_players
  SET team = 'white', updated_at = now()
  WHERE match_id = p_match_id
    AND profile_id = ANY(COALESCE(p_white_profile_ids, ARRAY[]::uuid[]));

  UPDATE match_players
  SET team = 'black', updated_at = now()
  WHERE match_id = p_match_id
    AND profile_id = ANY(COALESCE(p_black_profile_ids, ARRAY[]::uuid[]));

  -- Insert new white players not already in match_players
  INSERT INTO match_players (match_id, profile_id, team)
  SELECT p_match_id, uid, 'white'
  FROM unnest(COALESCE(p_white_profile_ids, ARRAY[]::uuid[])) AS uid
  WHERE NOT EXISTS (
    SELECT 1 FROM match_players WHERE match_id = p_match_id AND profile_id = uid
  );

  -- Insert new black players not already in match_players
  INSERT INTO match_players (match_id, profile_id, team)
  SELECT p_match_id, uid, 'black'
  FROM unnest(COALESCE(p_black_profile_ids, ARRAY[]::uuid[])) AS uid
  WHERE NOT EXISTS (
    SELECT 1 FROM match_players WHERE match_id = p_match_id AND profile_id = uid
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_replace_match_roster(uuid, uuid[], uuid[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_replace_match_roster(uuid, uuid[], uuid[]) TO authenticated;

COMMENT ON FUNCTION public.admin_replace_match_roster(uuid, uuid[], uuid[]) IS
  'Admin-only. Replaces the profile-linked match_players for an existing match
   with the provided white/black rosters. Existing stats (goals, cards, captain,
   no-show) are preserved for players whose team is unchanged or switched.
   Guest rows are untouched. Audited before any destructive change.';

COMMIT;
