-- 0029_get_ref_matchday.sql
-- Phase 2 Slice 2B-C — anonymous-callable matchday-fetch for the ref console.
--
-- Adds get_ref_matchday(p_token text) which validates a raw ref token
-- (via sha256 lookup against ref_tokens) and returns a curated JSONB
-- envelope of matchday header + white roster + black roster + token
-- expiry. Anonymous-callable; no auth session required.
--
-- Numbering note: Phase 2A automation was speculatively documented as
-- "0029" before build-order locked. Slice 2B-A took 0028. Slice 2B-C
-- (this file) takes 0029. Phase 2A automation moves to 0030.

BEGIN;

CREATE OR REPLACE FUNCTION get_ref_matchday(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token_hash text;
  v_token_row  ref_tokens%ROWTYPE;
  v_matchday   matchdays%ROWTYPE;
  v_match_id   uuid;
  v_white      jsonb;
  v_black      jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) = 0 THEN
    RAISE EXCEPTION 'Token is required' USING ERRCODE = '22023';
  END IF;

  v_token_hash := encode(digest(p_token, 'sha256'), 'hex');

  SELECT * INTO v_token_row
  FROM ref_tokens
  WHERE token_sha256 = v_token_hash
    AND consumed_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired ref token' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_matchday FROM matchdays WHERE id = v_token_row.matchday_id;

  -- Match row may or may not exist yet (admin must lock roster first; lock
  -- creates the matches row). If it doesn't exist, return an empty roster
  -- — the ref will see a "Roster not yet locked" message client-side.
  SELECT id INTO v_match_id FROM matches WHERE matchday_id = v_token_row.matchday_id;

  IF v_match_id IS NOT NULL THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'profile_id', mp.profile_id,
        'guest_id', mp.guest_id,
        'display_name', COALESCE(p.display_name, g.display_name),
        'primary_position',
          COALESCE(p.primary_position::text, g.primary_position::text),
        'is_captain', COALESCE(mp.is_captain, false)
      )
      ORDER BY mp.is_captain DESC NULLS LAST,
               COALESCE(p.display_name, g.display_name) ASC
    )
    INTO v_white
    FROM match_players mp
    LEFT JOIN profiles p ON mp.profile_id = p.id
    LEFT JOIN match_guests g ON mp.guest_id = g.id
    WHERE mp.match_id = v_match_id AND mp.team = 'white';

    SELECT jsonb_agg(
      jsonb_build_object(
        'profile_id', mp.profile_id,
        'guest_id', mp.guest_id,
        'display_name', COALESCE(p.display_name, g.display_name),
        'primary_position',
          COALESCE(p.primary_position::text, g.primary_position::text),
        'is_captain', COALESCE(mp.is_captain, false)
      )
      ORDER BY mp.is_captain DESC NULLS LAST,
               COALESCE(p.display_name, g.display_name) ASC
    )
    INTO v_black
    FROM match_players mp
    LEFT JOIN profiles p ON mp.profile_id = p.id
    LEFT JOIN match_guests g ON mp.guest_id = g.id
    WHERE mp.match_id = v_match_id AND mp.team = 'black';
  END IF;

  RETURN jsonb_build_object(
    'matchday', jsonb_build_object(
      'id', v_matchday.id,
      'kickoff_at', v_matchday.kickoff_at,
      'venue', v_matchday.venue,
      'effective_format', effective_format(v_matchday.id),
      'roster_locked_at', v_matchday.roster_locked_at
    ),
    'white', COALESCE(v_white, '[]'::jsonb),
    'black', COALESCE(v_black, '[]'::jsonb),
    'token_expires_at', v_token_row.expires_at,
    'has_match_row', v_match_id IS NOT NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_ref_matchday(text) TO anon, authenticated;

COMMENT ON FUNCTION get_ref_matchday(text) IS
  'Anonymous-callable matchday-fetch for the ref console. Validates raw
   token via sha256, returns matchday header + rosters + token expiry.
   Does not consume the token (use submit_ref_entry for that).';

COMMIT;
