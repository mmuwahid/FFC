-- 0028_phase2b_match_events.sql
-- Phase 2 Slice 2B-A — Live Match Console backend foundation.
--
-- Adds the schema needed for time-stamped match events captured by the ref
-- console at /ref/:token. Two parallel tables: pending_match_events (mirrors
-- the existing pending_match_entries pre-approval staging) and match_events
-- (post-promotion, attached to the permanent matches row). Existing
-- submit_ref_entry and approve_match_entry RPCs are rewritten (DROP+CREATE)
-- to read/write the event log alongside the per-player aggregates.
--
-- New admin RPC: regenerate_ref_token(matchday_id) burns any active token
-- for the matchday and mints a fresh one with 6h expiry. Returns the raw
-- token to the caller — never persisted plaintext.
--
-- Numbering note: the Phase 2 design spec mentions "migration 0029" for
-- Phase 2B because the spec was written before build-order locked. Track 2B
-- ships first; this is 0028. The Phase 2A automation migration becomes 0029
-- when slice 2A-A lands.

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 1. match_event_type enum
-- ═══════════════════════════════════════════════════════════════
CREATE TYPE match_event_type AS ENUM (
  'goal',
  'own_goal',
  'yellow_card',
  'red_card',
  'halftime',
  'fulltime',
  'pause',
  'resume'
);

COMMENT ON TYPE match_event_type IS
  'Discrete events the ref console captures during a live match. Player events
   (goal/own_goal/yellow_card/red_card) carry profile_id XOR guest_id.
   Match-state events (halftime/fulltime/pause/resume) carry neither.';

-- ═══════════════════════════════════════════════════════════════
-- 2. pending_match_events — staged event log per ref submission
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE pending_match_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_entry_id    uuid NOT NULL REFERENCES pending_match_entries(id) ON DELETE CASCADE,
  event_type          match_event_type NOT NULL,
  match_minute        int NOT NULL,
  match_second        int NOT NULL DEFAULT 0,
  team                team_color,
  profile_id          uuid REFERENCES profiles(id),
  guest_id            uuid REFERENCES match_guests(id),
  meta                jsonb NOT NULL DEFAULT '{}'::jsonb,
  ordinal             int NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_event_participant_xor CHECK (
    (event_type IN ('halftime','fulltime','pause','resume')
       AND profile_id IS NULL AND guest_id IS NULL)
    OR
    (event_type NOT IN ('halftime','fulltime','pause','resume')
       AND ((profile_id IS NULL) <> (guest_id IS NULL)))
  ),
  CONSTRAINT pending_event_minute_nonneg CHECK (match_minute >= 0 AND match_second BETWEEN 0 AND 59)
);

CREATE INDEX pending_events_entry_idx
  ON pending_match_events (pending_entry_id, ordinal);

COMMENT ON TABLE pending_match_events IS
  'Time-stamped event log captured by the ref console. Writes flow through
   submit_ref_entry; promoted to match_events on approve_match_entry.';

COMMENT ON COLUMN pending_match_events.match_minute IS
  'Continuous count from kickoff in whole minutes. Stoppage minutes 35+ are
   stored as 35, 36, 37 (continuous); the "+N" notation is rendered
   client-side from app_settings.match_half_minutes_<format>.';

-- ═══════════════════════════════════════════════════════════════
-- 3. match_events — permanent event log post-promotion
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE match_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id            uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  event_type          match_event_type NOT NULL,
  match_minute        int NOT NULL,
  match_second        int NOT NULL DEFAULT 0,
  team                team_color,
  profile_id          uuid REFERENCES profiles(id),
  guest_id            uuid REFERENCES match_guests(id),
  meta                jsonb NOT NULL DEFAULT '{}'::jsonb,
  ordinal             int NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_event_participant_xor CHECK (
    (event_type IN ('halftime','fulltime','pause','resume')
       AND profile_id IS NULL AND guest_id IS NULL)
    OR
    (event_type NOT IN ('halftime','fulltime','pause','resume')
       AND ((profile_id IS NULL) <> (guest_id IS NULL)))
  ),
  CONSTRAINT match_event_minute_nonneg CHECK (match_minute >= 0 AND match_second BETWEEN 0 AND 59)
);

CREATE INDEX match_events_match_idx
  ON match_events (match_id, ordinal);

COMMENT ON TABLE match_events IS
  'Permanent time-stamped event log promoted from pending_match_events on
   admin approval. Source of truth for "all 3 of Mohammed''s goals were
   in the 2nd half"-style stat queries on Profile + Match Detail screens.';

-- ═══════════════════════════════════════════════════════════════
-- 4. Timing columns on pending_match_entries + matches
-- ═══════════════════════════════════════════════════════════════
-- All timestamp columns are nullable so legacy rows (pre-Phase-2) and
-- admin-direct submissions (which skip the ref console entirely) remain
-- valid. Stoppage seconds default to 0 (no stoppage) for the same reason.

ALTER TABLE pending_match_entries
  ADD COLUMN kickoff_at          timestamptz,
  ADD COLUMN halftime_at         timestamptz,
  ADD COLUMN fulltime_at         timestamptz,
  ADD COLUMN stoppage_h1_seconds int NOT NULL DEFAULT 0,
  ADD COLUMN stoppage_h2_seconds int NOT NULL DEFAULT 0;

ALTER TABLE matches
  ADD COLUMN kickoff_at          timestamptz,
  ADD COLUMN halftime_at         timestamptz,
  ADD COLUMN fulltime_at         timestamptz,
  ADD COLUMN stoppage_h1_seconds int,
  ADD COLUMN stoppage_h2_seconds int;

-- ═══════════════════════════════════════════════════════════════
-- 5. RLS — pending events admin-only; permanent events public-read
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE pending_match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_events         ENABLE ROW LEVEL SECURITY;

-- Admin can SELECT pending events for review. Writes flow only through
-- submit_ref_entry (anon-callable, token-gated, SECURITY DEFINER) and
-- approve_match_entry (admin SECURITY DEFINER) — no direct INSERT.
CREATE POLICY pending_events_admin_select
  ON pending_match_events
  FOR SELECT
  TO authenticated
  USING (is_admin());

-- Permanent match events visible to all authenticated users (parity with
-- match_players read access). Writes only via approve_match_entry.
CREATE POLICY match_events_authenticated_select
  ON match_events
  FOR SELECT
  TO authenticated
  USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 6. regenerate_ref_token — admin token rotation
-- ═══════════════════════════════════════════════════════════════
-- Burns any active (non-consumed, non-expired) token for the matchday
-- and mints a fresh one with 6h expiry. Returns the RAW token string —
-- this is the only moment the plaintext exists; the DB only stores
-- sha256. Caller (admin UI in slice 2B-B) is responsible for showing
-- the URL once and never re-fetching it.

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
  v_raw_token := encode(gen_random_bytes(24), 'base64');
  -- base64url-safe replacements (the encode() built-in doesn't have base64url)
  v_raw_token := replace(replace(replace(v_raw_token, '+', '-'), '/', '_'), '=', '');

  INSERT INTO ref_tokens (matchday_id, token_sha256, issued_by, expires_at, label)
  VALUES (
    p_matchday_id,
    encode(digest(v_raw_token, 'sha256'), 'hex'),
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
-- 7. submit_ref_entry — extended with timing + event log
-- ═══════════════════════════════════════════════════════════════
-- Signature unchanged (text + jsonb returns uuid) so DROP+CREATE is
-- not strictly required, but we drop anyway to ensure a clean rewrite
-- and to GRANT identically afterwards. Payload shape extended:
--
--   {
--     "result":         "white"|"black"|"draw",
--     "score_white":    int,
--     "score_black":    int,
--     "notes":          string|null,
--     "players": [{
--       "profile_id":    uuid|null,
--       "guest_id":      uuid|null,
--       "team":          "white"|"black",
--       "goals":         int,
--       "yellow_cards":  int,
--       "red_cards":     int,
--       "is_motm":       bool
--     }, ...],
--     "events": [{
--       "event_type":    "goal"|...,
--       "match_minute":  int,
--       "match_second":  int,
--       "team":          "white"|"black"|null,
--       "profile_id":    uuid|null,
--       "guest_id":      uuid|null,
--       "meta":          jsonb,
--       "ordinal":       int
--     }, ...],
--     "timing": {
--       "kickoff_at":           timestamptz,
--       "halftime_at":          timestamptz,
--       "fulltime_at":          timestamptz,
--       "stoppage_h1_seconds":  int,
--       "stoppage_h2_seconds":  int
--     }
--   }
--
-- Backwards-compatible: clients that omit `events` and `timing` (e.g. the
-- legacy stub or admin direct-entry path) still write valid pending rows.

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
  v_token_hash := encode(digest(p_token, 'sha256'), 'hex');

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

-- ═══════════════════════════════════════════════════════════════
-- 8. approve_match_entry — extended to copy event log + timing
-- ═══════════════════════════════════════════════════════════════
-- Same signature; rewritten body adds:
--   - copies pending_match_entries timing columns to matches
--   - copies pending_match_events rows to match_events (preserving ordinal)

DROP FUNCTION IF EXISTS approve_match_entry(uuid, jsonb);

CREATE OR REPLACE FUNCTION approve_match_entry(
  p_pending_id uuid,
  p_edits      jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pme        pending_match_entries%ROWTYPE;
  v_match_id   uuid;
  v_caller_id  uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pme FROM pending_match_entries WHERE id = p_pending_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending entry not found or already resolved' USING ERRCODE = '22023';
  END IF;

  v_caller_id := current_profile_id();

  SELECT id INTO v_match_id FROM matches WHERE matchday_id = v_pme.matchday_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No draft match found for matchday' USING ERRCODE = '22023';
  END IF;

  UPDATE matches SET
    result        = COALESCE((p_edits->>'result')::match_result, v_pme.result),
    score_white   = COALESCE((p_edits->>'score_white')::int, v_pme.score_white),
    score_black   = COALESCE((p_edits->>'score_black')::int, v_pme.score_black),
    motm_user_id  = CASE WHEN p_edits ? 'motm_user_id'
                          THEN NULLIF(p_edits->>'motm_user_id','')::uuid
                          ELSE motm_user_id END,
    motm_guest_id = CASE WHEN p_edits ? 'motm_guest_id'
                           THEN NULLIF(p_edits->>'motm_guest_id','')::uuid
                           ELSE motm_guest_id END,
    notes         = COALESCE(p_edits->>'notes', v_pme.notes),
    -- NEW: copy timing columns from pending entry IFF pending has timing data
    -- (kickoff_at as sentinel). Admin-direct submissions don't carry timing,
    -- so we leave existing matches.* timing columns untouched in that case.
    kickoff_at          = CASE WHEN v_pme.kickoff_at IS NOT NULL
                               THEN v_pme.kickoff_at ELSE kickoff_at END,
    halftime_at         = CASE WHEN v_pme.kickoff_at IS NOT NULL
                               THEN v_pme.halftime_at ELSE halftime_at END,
    fulltime_at         = CASE WHEN v_pme.kickoff_at IS NOT NULL
                               THEN v_pme.fulltime_at ELSE fulltime_at END,
    stoppage_h1_seconds = CASE WHEN v_pme.kickoff_at IS NOT NULL
                               THEN v_pme.stoppage_h1_seconds ELSE stoppage_h1_seconds END,
    stoppage_h2_seconds = CASE WHEN v_pme.kickoff_at IS NOT NULL
                               THEN v_pme.stoppage_h2_seconds ELSE stoppage_h2_seconds END,
    approved_at = now(),
    approved_by = v_caller_id,
    updated_at  = now(),
    updated_by  = v_caller_id
  WHERE id = v_match_id;

  -- Reconcile match_players stats from pending line items (unchanged).
  UPDATE match_players mp SET
    goals        = pmep.goals,
    yellow_cards = pmep.yellow_cards,
    red_cards    = pmep.red_cards,
    updated_at   = now(),
    updated_by   = v_caller_id
  FROM pending_match_entry_players pmep
  WHERE pmep.pending_entry_id = p_pending_id
    AND mp.match_id = v_match_id
    AND (
      (pmep.profile_id IS NOT NULL AND mp.profile_id = pmep.profile_id) OR
      (pmep.guest_id   IS NOT NULL AND mp.guest_id   = pmep.guest_id)
    );

  -- NEW: copy event log to permanent match_events. Idempotent because
  -- approve_match_entry can only be called once (status flip below blocks
  -- re-entry).
  INSERT INTO match_events (
    match_id, event_type, match_minute, match_second,
    team, profile_id, guest_id, meta, ordinal
  )
  SELECT
    v_match_id, event_type, match_minute, match_second,
    team, profile_id, guest_id, meta, ordinal
  FROM pending_match_events
  WHERE pending_entry_id = p_pending_id
  ORDER BY ordinal;

  UPDATE pending_match_entries SET
    status = 'approved', approved_at = now(), approved_by = v_caller_id
  WHERE id = p_pending_id;

  PERFORM log_admin_action('matches', v_match_id, 'approve_match_entry',
    jsonb_build_object('pending_id', p_pending_id));

  -- Fan-out approval notifications (unchanged).
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT id, 'match_entry_approved',
    'Match result approved',
    'The match result has been confirmed.',
    jsonb_build_object('match_id', v_match_id)
  FROM profiles WHERE is_active = true;

  RETURN v_match_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_match_entry(uuid, jsonb) TO authenticated;

COMMIT;
