-- 0057_notifications_match_lifecycle.sql
-- S058 issue #23 — notification pipeline coverage gaps:
--
-- (a) approve_match_entry was inserting one notification per ACTIVE PROFILE
--     (200+ rows / approval). It should fan out only to the players in
--     that match. Bug since 0008 / 0028 rewrite.
--
-- (b) Matchday creation produced no notification. Adding an AFTER INSERT
--     trigger on matchdays that notifies all admins (excluding the creator
--     so they don't self-ping). Players already get poll_open via the
--     scheduled_reminders cron — this is admin-side awareness only.

-- ─────────────────────────────────────────────────────────────────────────
-- Block 1: enum value addition (must commit before being used).
-- ─────────────────────────────────────────────────────────────────────────
BEGIN;
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'matchday_created';
COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Block 2: function + trigger + approve_match_entry rewrite.
-- ─────────────────────────────────────────────────────────────────────────
BEGIN;

-- (a) approve_match_entry — scope match_entry_approved to the players in
-- this match instead of broadcasting to ALL active profiles.
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

  -- S058 fix: scope to the match's players instead of broadcasting.
  -- profile_id IS NOT NULL excludes guest rows (no auth profile to notify).
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT DISTINCT mp.profile_id, 'match_entry_approved',
    'Match result approved',
    'The match result has been confirmed.',
    jsonb_build_object('match_id', v_match_id)
  FROM match_players mp
  WHERE mp.match_id = v_match_id
    AND mp.profile_id IS NOT NULL;

  RETURN v_match_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_match_entry(uuid, jsonb) TO authenticated;

-- (b) matchday_created notification trigger.
CREATE OR REPLACE FUNCTION notify_matchday_created()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_creator uuid;
  v_kickoff_label text;
BEGIN
  v_creator := COALESCE(NEW.created_by, current_profile_id());
  v_kickoff_label := to_char(NEW.kickoff_at AT TIME ZONE 'Asia/Dubai',
                             'Dy, DD Mon');

  -- Notify all admins EXCEPT the creator (who triggered this themselves).
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT p.id, 'matchday_created',
    'Matchday created',
    'New matchday on ' || v_kickoff_label || ' — set up the roster.',
    jsonb_build_object('matchday_id', NEW.id)
  FROM profiles p
  WHERE p.role IN ('admin', 'super_admin')
    AND p.is_active = true
    AND p.deleted_at IS NULL
    AND p.id IS DISTINCT FROM v_creator;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_matchday_created_notify ON matchdays;
CREATE TRIGGER trg_matchday_created_notify
  AFTER INSERT ON matchdays
  FOR EACH ROW
  EXECUTE FUNCTION notify_matchday_created();

COMMIT;
