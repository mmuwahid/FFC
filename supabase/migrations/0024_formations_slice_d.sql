-- 0024_formations_slice_d.sql
-- §3.19 Formation Planner Slice D — captain's notes + realtime publication.
--
-- Adds nullable `notes text` column to formations.
-- DROPs + recreates upsert_formation with an extra `p_notes text DEFAULT NULL`
-- parameter (CREATE OR REPLACE cannot add parameters).
-- Adds formations to the supabase_realtime publication so non-captains can
-- subscribe to shared tactical plans live.

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 1. formations.notes
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE formations
  ADD COLUMN notes text;

COMMENT ON COLUMN formations.notes IS
  'Captain''s free-text tactical notes. Visible to team members after share_formation.';

-- ═══════════════════════════════════════════════════════════════
-- 2. upsert_formation — drop + recreate with p_notes
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS upsert_formation(uuid, team_color, text, jsonb, jsonb, uuid);

CREATE OR REPLACE FUNCTION upsert_formation(
  p_matchday_id             uuid,
  p_team                    team_color,
  p_pattern                 text,
  p_layout_jsonb            jsonb,
  p_rotation_order          jsonb DEFAULT NULL,
  p_starting_gk_profile_id  uuid  DEFAULT NULL,
  p_notes                   text  DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_formation_id uuid;
  v_caller_id    uuid;
  v_match_id     uuid;
BEGIN
  v_caller_id := current_profile_id();

  SELECT m.id INTO v_match_id FROM matches m WHERE m.matchday_id = p_matchday_id;

  IF NOT EXISTS (
    SELECT 1 FROM match_players
    WHERE match_id = v_match_id AND profile_id = v_caller_id
      AND team = p_team AND is_captain = true
  ) THEN
    RAISE EXCEPTION 'Must be the captain of this team'
      USING ERRCODE = '42501', CONSTRAINT = 'FFC_FORM_NOT_CAPTAIN';
  END IF;

  INSERT INTO formations (
    matchday_id, team, pattern, layout_jsonb,
    formation_rotation_order, starting_gk_profile_id,
    notes, last_edited_by, last_edited_at
  ) VALUES (
    p_matchday_id, p_team, p_pattern, p_layout_jsonb,
    p_rotation_order, p_starting_gk_profile_id,
    p_notes, v_caller_id, now()
  )
  ON CONFLICT (matchday_id, team) DO UPDATE SET
    pattern                  = EXCLUDED.pattern,
    layout_jsonb             = EXCLUDED.layout_jsonb,
    formation_rotation_order = EXCLUDED.formation_rotation_order,
    starting_gk_profile_id   = EXCLUDED.starting_gk_profile_id,
    notes                    = EXCLUDED.notes,
    last_edited_by           = EXCLUDED.last_edited_by,
    last_edited_at           = EXCLUDED.last_edited_at
  RETURNING id INTO v_formation_id;

  RETURN v_formation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_formation(uuid, team_color, text, jsonb, jsonb, uuid, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3. Enable realtime on formations
-- ═══════════════════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE public.formations;

COMMIT;
