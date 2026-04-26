-- 0030_pgcrypto_search_path_fix.sql
-- Phase 2 hotfix — schema-qualify pgcrypto function calls in 3 RPCs.
--
-- The three token-handling RPCs (get_ref_matchday, submit_ref_entry,
-- regenerate_ref_token) all set SECURITY DEFINER search_path = public
-- but call digest() / gen_random_bytes() unqualified. pgcrypto lives in
-- the extensions schema on Supabase, so these calls fail with
-- "function digest(text, unknown) does not exist" when invoked via
-- PostgREST (anon or authenticated). The bug was hidden because
-- `db query --linked` uses the postgres login role with a wider
-- default search_path that DOES include extensions.
--
-- Fix: DROP+CREATE each function with extensions.* qualification.
-- Function bodies are otherwise byte-identical to the 0028/0029
-- versions.

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 1. get_ref_matchday (was migration 0029)
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS get_ref_matchday(text);

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

  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

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

-- ═══════════════════════════════════════════════════════════════
-- 2. regenerate_ref_token (was migration 0028)
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS regenerate_ref_token(uuid);

CREATE OR REPLACE FUNCTION regenerate_ref_token(p_matchday_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_raw_token  text;
  v_caller_id  uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM matchdays WHERE id = p_matchday_id) THEN
    RAISE EXCEPTION 'Matchday not found' USING ERRCODE = '22023';
  END IF;

  -- Serialise concurrent regenerate calls for the same matchday so two
  -- admins can't both pass the burn step under snapshot isolation and end
  -- up with two active tokens. Lock is per-matchday and per-transaction.
  PERFORM pg_advisory_xact_lock(hashtext('regenerate_ref_token:' || p_matchday_id::text));

  v_caller_id := current_profile_id();

  -- Burn any active tokens for this matchday.
  UPDATE ref_tokens
     SET consumed_at = now()
   WHERE matchday_id = p_matchday_id
     AND consumed_at IS NULL
     AND expires_at > now();

  -- Mint fresh raw token (24 random bytes → ~32 base64url chars).
  v_raw_token := encode(extensions.gen_random_bytes(24), 'base64');
  -- base64url-safe replacements (the encode() built-in doesn't have base64url)
  v_raw_token := replace(replace(replace(v_raw_token, '+', '-'), '/', '_'), '=', '');

  INSERT INTO ref_tokens (matchday_id, token_sha256, issued_by, expires_at, label)
  VALUES (
    p_matchday_id,
    encode(extensions.digest(v_raw_token, 'sha256'), 'hex'),
    v_caller_id,
    now() + interval '6 hours',
    'Ref link · regenerated'
  );

  PERFORM log_admin_action('matchdays', p_matchday_id, 'regenerate_ref_token', '{}'::jsonb);

  RETURN v_raw_token;
END;
$$;

GRANT EXECUTE ON FUNCTION regenerate_ref_token(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3. submit_ref_entry (was migrations 0008 + 0028)
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS submit_ref_entry(text, jsonb);

CREATE OR REPLACE FUNCTION submit_ref_entry(
  p_token   text,
  p_payload jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token_hash  text;
  v_token_row   ref_tokens%ROWTYPE;
  v_entry_id    uuid;
  v_matchday_id uuid;
BEGIN
  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  SELECT * INTO v_token_row
  FROM ref_tokens
  WHERE token_sha256 = v_token_hash
    AND consumed_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired ref token' USING ERRCODE = '22023';
  END IF;

  v_matchday_id := v_token_row.matchday_id;

  IF EXISTS (
    SELECT 1 FROM pending_match_entries
    WHERE submitted_by_token_id = v_token_row.id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A pending entry already exists for this token' USING ERRCODE = '22023';
  END IF;

  INSERT INTO pending_match_entries (
    matchday_id, submitted_by_token_id, result, score_white, score_black, notes,
    kickoff_at, halftime_at, fulltime_at, stoppage_h1_seconds, stoppage_h2_seconds
  ) VALUES (
    v_matchday_id,
    v_token_row.id,
    (p_payload->>'result')::match_result,
    (p_payload->>'score_white')::int,
    (p_payload->>'score_black')::int,
    p_payload->>'notes',
    NULLIF(p_payload#>>'{timing,kickoff_at}','')::timestamptz,
    NULLIF(p_payload#>>'{timing,halftime_at}','')::timestamptz,
    NULLIF(p_payload#>>'{timing,fulltime_at}','')::timestamptz,
    COALESCE(NULLIF(p_payload#>>'{timing,stoppage_h1_seconds}','')::int, 0),
    COALESCE(NULLIF(p_payload#>>'{timing,stoppage_h2_seconds}','')::int, 0)
  ) RETURNING id INTO v_entry_id;

  -- Per-player aggregates (existing shape — unchanged).
  INSERT INTO pending_match_entry_players (
    pending_entry_id, profile_id, guest_id, team, goals, yellow_cards, red_cards, is_motm
  )
  SELECT
    v_entry_id,
    NULLIF(pl->>'profile_id', '')::uuid,
    NULLIF(pl->>'guest_id', '')::uuid,
    (pl->>'team')::team_color,
    COALESCE((pl->>'goals')::int, 0),
    COALESCE((pl->>'yellow_cards')::int, 0),
    COALESCE((pl->>'red_cards')::int, 0),
    COALESCE((pl->>'is_motm')::boolean, false)
  FROM jsonb_array_elements(p_payload->'players') pl;

  -- Event log (NEW). Skipped silently if `events` key is absent or empty.
  IF p_payload ? 'events' AND jsonb_typeof(p_payload->'events') = 'array' THEN
    INSERT INTO pending_match_events (
      pending_entry_id, event_type, match_minute, match_second,
      team, profile_id, guest_id, meta, ordinal
    )
    SELECT
      v_entry_id,
      (e->>'event_type')::match_event_type,
      (e->>'match_minute')::int,
      COALESCE((e->>'match_second')::int, 0),
      NULLIF(e->>'team','')::team_color,
      NULLIF(e->>'profile_id','')::uuid,
      NULLIF(e->>'guest_id','')::uuid,
      COALESCE(e->'meta', '{}'::jsonb),
      (e->>'ordinal')::int
    FROM jsonb_array_elements(p_payload->'events') e;
  END IF;

  -- Burn the token.
  UPDATE ref_tokens SET consumed_at = now() WHERE id = v_token_row.id;

  -- Notify admins (existing behaviour).
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT id, 'match_entry_submitted',
    'Match entry submitted',
    'A ref has submitted the result for review.',
    jsonb_build_object('pending_entry_id', v_entry_id, 'matchday_id', v_matchday_id)
  FROM profiles WHERE role IN ('admin','super_admin') AND is_active = true;

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_ref_entry(text, jsonb) TO anon, authenticated;

COMMIT;
