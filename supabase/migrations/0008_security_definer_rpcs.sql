-- 0008_security_definer_rpcs.sql — 20 SECURITY DEFINER RPCs + private helper + grants (§2.7)

-- ═══════════════════════════════════════════════════════════════
-- Private helper — written by every admin-role RPC before return
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION log_admin_action(
  p_target_entity text,
  p_target_id     uuid,
  p_action        text,
  p_payload       jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO admin_audit_log (admin_profile_id, target_entity, target_id, action, payload_jsonb)
  VALUES (current_profile_id(), p_target_entity, p_target_id, p_action, p_payload);
$$;
REVOKE EXECUTE ON FUNCTION log_admin_action(text, uuid, text, jsonb) FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════════
-- RPC 1 — submit_ref_entry (anon-callable)
-- ═══════════════════════════════════════════════════════════════
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

  -- Check no pending entry already exists for this token
  IF EXISTS (
    SELECT 1 FROM pending_match_entries
    WHERE submitted_by_token_id = v_token_row.id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A pending entry already exists for this token' USING ERRCODE = '22023';
  END IF;

  INSERT INTO pending_match_entries (
    matchday_id, submitted_by_token_id, result, score_white, score_black, notes
  ) VALUES (
    v_matchday_id,
    v_token_row.id,
    (p_payload->>'result')::match_result,
    (p_payload->>'score_white')::int,
    (p_payload->>'score_black')::int,
    p_payload->>'notes'
  ) RETURNING id INTO v_entry_id;

  -- Insert player line items from payload.players array
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

  -- Burn the token
  UPDATE ref_tokens SET consumed_at = now() WHERE id = v_token_row.id;

  -- Notify admins
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT id, 'match_entry_submitted',
    'Match entry submitted',
    'A ref has submitted the result for review.',
    jsonb_build_object('pending_entry_id', v_entry_id, 'matchday_id', v_matchday_id)
  FROM profiles WHERE role IN ('admin','super_admin') AND is_active = true;

  RETURN v_entry_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 2 — create_match_draft (admin)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION create_match_draft(
  p_matchday_id  uuid,
  p_white_roster uuid[],
  p_black_roster uuid[],
  p_white_guests uuid[],
  p_black_guests uuid[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_match_id uuid;
  v_season_id uuid;
  v_format    match_format;
  v_cap       int;
  v_total     int;
  v_pid       uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT season_id INTO v_season_id FROM matchdays WHERE id = p_matchday_id;
  v_format := effective_format(p_matchday_id);
  v_cap    := roster_cap(v_format);
  v_total  := array_length(p_white_roster,1) + array_length(p_black_roster,1)
            + COALESCE(array_length(p_white_guests,1),0)
            + COALESCE(array_length(p_black_guests,1),0);

  IF v_total <> v_cap THEN
    RAISE EXCEPTION 'Roster size % does not match cap % for format %',
      v_total, v_cap, v_format USING ERRCODE = '22023';
  END IF;

  INSERT INTO matches (matchday_id, season_id)
  VALUES (p_matchday_id, v_season_id)
  RETURNING id INTO v_match_id;

  -- White players
  FOREACH v_pid IN ARRAY p_white_roster LOOP
    INSERT INTO match_players (match_id, profile_id, team) VALUES (v_match_id, v_pid, 'white');
  END LOOP;
  -- Black players
  FOREACH v_pid IN ARRAY p_black_roster LOOP
    INSERT INTO match_players (match_id, profile_id, team) VALUES (v_match_id, v_pid, 'black');
  END LOOP;
  -- White guests
  IF p_white_guests IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_white_guests LOOP
      INSERT INTO match_players (match_id, guest_id, team) VALUES (v_match_id, v_pid, 'white');
    END LOOP;
  END IF;
  -- Black guests
  IF p_black_guests IS NOT NULL THEN
    FOREACH v_pid IN ARRAY p_black_guests LOOP
      INSERT INTO match_players (match_id, guest_id, team) VALUES (v_match_id, v_pid, 'black');
    END LOOP;
  END IF;

  PERFORM log_admin_action('matches', v_match_id, 'create_draft',
    jsonb_build_object('matchday_id', p_matchday_id, 'format', v_format));

  RETURN v_match_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 3 — approve_match_entry (admin)
-- ═══════════════════════════════════════════════════════════════
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
    result      = COALESCE((p_edits->>'result')::match_result, v_pme.result),
    score_white = COALESCE((p_edits->>'score_white')::int, v_pme.score_white),
    score_black = COALESCE((p_edits->>'score_black')::int, v_pme.score_black),
    motm_user_id = CASE WHEN p_edits ? 'motm_user_id'
                        THEN NULLIF(p_edits->>'motm_user_id','')::uuid
                        ELSE motm_user_id END,
    motm_guest_id = CASE WHEN p_edits ? 'motm_guest_id'
                         THEN NULLIF(p_edits->>'motm_guest_id','')::uuid
                         ELSE motm_guest_id END,
    notes       = COALESCE(p_edits->>'notes', v_pme.notes),
    approved_at = now(),
    approved_by = v_caller_id,
    updated_at  = now(),
    updated_by  = v_caller_id
  WHERE id = v_match_id;

  -- Reconcile match_players stats from pending line items
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

  UPDATE pending_match_entries SET
    status = 'approved', approved_at = now(), approved_by = v_caller_id
  WHERE id = p_pending_id;

  PERFORM log_admin_action('matches', v_match_id, 'approve_match_entry',
    jsonb_build_object('pending_id', p_pending_id));

  -- Fan-out approval notifications to all active players
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT id, 'match_entry_approved',
    'Match result approved',
    'The match result has been confirmed.',
    jsonb_build_object('match_id', v_match_id)
  FROM profiles WHERE is_active = true;

  RETURN v_match_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 4 — reject_match_entry (admin)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION reject_match_entry(
  p_pending_id uuid,
  p_reason     text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pme       pending_match_entries%ROWTYPE;
  v_caller_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pme FROM pending_match_entries WHERE id = p_pending_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending entry not found or already resolved' USING ERRCODE = '22023';
  END IF;

  v_caller_id := current_profile_id();

  UPDATE pending_match_entries SET
    status = 'rejected', rejected_at = now(), rejected_by = v_caller_id,
    rejection_reason = p_reason
  WHERE id = p_pending_id;

  -- Re-arm token for resubmission
  UPDATE ref_tokens SET consumed_at = NULL WHERE id = v_pme.submitted_by_token_id;

  PERFORM log_admin_action('pending_match_entries', p_pending_id, 'reject_match_entry',
    jsonb_build_object('reason', p_reason));

  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT id, 'match_entry_rejected',
    'Match entry rejected',
    COALESCE(p_reason, 'The submitted result was rejected. Please resubmit.'),
    jsonb_build_object('pending_id', p_pending_id)
  FROM profiles WHERE role IN ('admin','super_admin') AND is_active = true;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 5 — approve_signup (admin)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION approve_signup(
  p_pending_id      uuid,
  p_claim_profile_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ps         pending_signups%ROWTYPE;
  v_profile_id uuid;
  v_caller_id  uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ps FROM pending_signups WHERE id = p_pending_id AND resolution = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending signup not found or already resolved' USING ERRCODE = '22023';
  END IF;

  v_caller_id := current_profile_id();

  IF p_claim_profile_id IS NOT NULL THEN
    -- Claim existing ghost profile
    UPDATE profiles SET
      auth_user_id = v_ps.auth_user_id,
      email        = v_ps.email,
      is_active    = true,
      updated_at   = now(),
      updated_by   = v_caller_id
    WHERE id = p_claim_profile_id
    RETURNING id INTO v_profile_id;
  ELSE
    -- Create new profile
    INSERT INTO profiles (auth_user_id, display_name, email, phone)
    VALUES (v_ps.auth_user_id, v_ps.display_name, v_ps.email, v_ps.phone)
    RETURNING id INTO v_profile_id;
  END IF;

  UPDATE pending_signups SET
    resolution = 'approved', resolved_at = now(), resolved_by = v_caller_id,
    resolved_profile_id = v_profile_id
  WHERE id = p_pending_id;

  PERFORM log_admin_action('pending_signups', p_pending_id, 'approve_signup',
    jsonb_build_object('profile_id', v_profile_id, 'claimed', p_claim_profile_id IS NOT NULL));

  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  VALUES (v_profile_id, 'signup_approved',
    'Welcome to FFC!',
    'Your signup has been approved. You can now vote in the weekly poll.',
    '{}'::jsonb);

  RETURN v_profile_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 6 — reject_signup (admin)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION reject_signup(
  p_pending_id uuid,
  p_reason     text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ps        pending_signups%ROWTYPE;
  v_caller_id uuid;
  v_ghost_id  uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ps FROM pending_signups WHERE id = p_pending_id AND resolution = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending signup not found or already resolved' USING ERRCODE = '22023';
  END IF;

  v_caller_id := current_profile_id();

  -- Create a ghost profiles row with role='rejected' for the audit trail
  INSERT INTO profiles (auth_user_id, display_name, email, role, reject_reason, is_active)
  VALUES (v_ps.auth_user_id, v_ps.display_name, v_ps.email, 'rejected', p_reason, false)
  RETURNING id INTO v_ghost_id;

  UPDATE pending_signups SET
    resolution = 'rejected', resolved_at = now(), resolved_by = v_caller_id,
    rejection_reason = p_reason, resolved_profile_id = v_ghost_id
  WHERE id = p_pending_id;

  PERFORM log_admin_action('pending_signups', p_pending_id, 'reject_signup',
    jsonb_build_object('reason', p_reason, 'ghost_profile_id', v_ghost_id));
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 7a — promote_admin / 7b — demote_admin (super_admin)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION promote_admin(p_profile_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Super-admin role required' USING ERRCODE = '42501';
  END IF;
  UPDATE profiles SET role = 'admin', updated_at = now(), updated_by = current_profile_id()
  WHERE id = p_profile_id AND role = 'player';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found or already admin' USING ERRCODE = '22023';
  END IF;
  PERFORM log_admin_action('profiles', p_profile_id, 'promote_admin', '{}'::jsonb);
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  VALUES (p_profile_id, 'admin_promoted',
    'You are now an admin',
    'You have been promoted to admin on FFC.',
    '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION demote_admin(p_profile_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Super-admin role required' USING ERRCODE = '42501';
  END IF;
  UPDATE profiles SET role = 'player', updated_at = now(), updated_by = current_profile_id()
  WHERE id = p_profile_id AND role = 'admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found or not an admin' USING ERRCODE = '22023';
  END IF;
  PERFORM log_admin_action('profiles', p_profile_id, 'demote_admin', '{}'::jsonb);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 8 — archive_season (admin)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION archive_season(p_season_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  v_caller_id := current_profile_id();

  UPDATE seasons SET
    archived_at = now(), archived_by = v_caller_id, updated_at = now()
  WHERE id = p_season_id AND ended_at IS NOT NULL AND archived_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season not found, not ended, or already archived' USING ERRCODE = '22023';
  END IF;

  PERFORM log_admin_action('seasons', p_season_id, 'archive_season', '{}'::jsonb);

  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT id, 'season_archived',
    'Season archived',
    'A season has been archived.',
    jsonb_build_object('season_id', p_season_id)
  FROM profiles WHERE is_active = true;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 9 — fire_scheduled_reminder (pg_cron / super_admin only)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fire_scheduled_reminder(p_reminder_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rem     scheduled_reminders%ROWTYPE;
  v_title   text;
  v_body    text;
  v_payload jsonb;
BEGIN
  SELECT * INTO v_rem FROM scheduled_reminders WHERE id = p_reminder_id AND enabled = true;
  IF NOT FOUND THEN RETURN; END IF;

  v_title   := COALESCE(v_rem.payload_template->>'title', v_rem.label);
  v_body    := COALESCE(v_rem.payload_template->>'body', '');
  v_payload := v_rem.payload_template;

  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT p.id,
    CASE v_rem.kind
      WHEN 'poll_open_broadcast'       THEN 'poll_open'
      WHEN 'poll_cutoff_warning'       THEN 'poll_reminder'
      WHEN 'plus_one_unlock_broadcast' THEN 'plus_one_unlocked'
      WHEN 'teams_post_reminder'       THEN 'teams_posted'
      ELSE 'poll_open'
    END::notification_kind,
    v_title, v_body, v_payload
  FROM profiles p
  WHERE p.is_active = true AND (
    v_rem.target_audience = 'all'
    OR (v_rem.target_audience = 'active_players')
    OR (v_rem.target_audience = 'admins' AND p.role IN ('admin','super_admin'))
    OR (v_rem.target_audience = 'super_admins' AND p.role = 'super_admin')
  );

  UPDATE scheduled_reminders SET
    last_fired_at    = now(),
    last_fire_status = 'ok'
  WHERE id = p_reminder_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 10 — suggest_captain_pairs (admin)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION suggest_captain_pairs(p_matchday_id uuid)
RETURNS TABLE(white_captain uuid, black_captain uuid, score int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_season_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM matchdays WHERE id = p_matchday_id AND roster_locked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Roster must be locked before suggesting captain pairs' USING ERRCODE = '22023';
  END IF;

  SELECT season_id INTO v_season_id FROM matchdays WHERE id = p_matchday_id;

  RETURN QUERY
  WITH roster AS (
    SELECT mp.profile_id
    FROM match_players mp
    JOIN matches m ON m.id = mp.match_id
    WHERE m.matchday_id = p_matchday_id
      AND mp.profile_id IS NOT NULL
  ),
  eligible AS (
    SELECT ce.profile_id, ce.matches_played, ce.matchdays_since_captained
    FROM v_captain_eligibility ce
    JOIN roster r ON r.profile_id = ce.profile_id
    WHERE ce.season_id = v_season_id AND ce.is_eligible = true
  ),
  ranked AS (
    SELECT profile_id,
           ROW_NUMBER() OVER (ORDER BY matches_played DESC, matchdays_since_captained DESC) AS rank
    FROM eligible
  )
  SELECT
    CASE WHEN a.rank > b.rank THEN a.profile_id ELSE b.profile_id END AS white_captain,
    CASE WHEN a.rank > b.rank THEN b.profile_id ELSE a.profile_id END AS black_captain,
    (a.rank + b.rank)::int AS score
  FROM ranked a
  JOIN ranked b ON b.profile_id > a.profile_id
  WHERE ABS(a.rank - b.rank) <= 5
  ORDER BY (a.rank + b.rank)
  LIMIT 5;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 11 — pick_captains_random (admin)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION pick_captains_random(p_matchday_id uuid)
RETURNS TABLE(white_captain uuid, black_captain uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cap int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM matchdays WHERE id = p_matchday_id AND roster_locked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Roster must be locked' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH roster AS (
    SELECT mp.profile_id
    FROM match_players mp
    JOIN matches m ON m.id = mp.match_id
    WHERE m.matchday_id = p_matchday_id AND mp.profile_id IS NOT NULL
    ORDER BY random()
    LIMIT 2
  ),
  picks AS (
    SELECT profile_id, ROW_NUMBER() OVER () AS n FROM roster
  )
  SELECT
    (SELECT profile_id FROM picks WHERE n = 1),
    (SELECT profile_id FROM picks WHERE n = 2);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 12 — set_matchday_captains (admin)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION set_matchday_captains(
  p_matchday_id     uuid,
  p_white_profile_id uuid,
  p_black_profile_id uuid
) RETURNS TABLE(white_captain uuid, black_captain uuid, assigned_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_match_id  uuid;
  v_caller_id uuid;
  v_now       timestamptz := now();
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  IF p_white_profile_id = p_black_profile_id THEN
    RAISE EXCEPTION 'Captains must be different profiles'
      USING ERRCODE = '22023', CONSTRAINT = 'FFC_CAPT_SAME_PROFILE';
  END IF;

  SELECT m.id INTO v_match_id
  FROM matches m WHERE m.matchday_id = p_matchday_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No draft match found for matchday'
      USING ERRCODE = '22023', CONSTRAINT = 'FFC_CAPT_NO_DRAFT';
  END IF;

  -- Validate both on roster
  IF NOT EXISTS (
    SELECT 1 FROM match_players WHERE match_id = v_match_id AND profile_id = p_white_profile_id
  ) THEN
    RAISE EXCEPTION 'White captain not on roster'
      USING ERRCODE = '22023', CONSTRAINT = 'FFC_CAPT_NOT_ON_ROSTER';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM match_players WHERE match_id = v_match_id AND profile_id = p_black_profile_id
  ) THEN
    RAISE EXCEPTION 'Black captain not on roster'
      USING ERRCODE = '22023', CONSTRAINT = 'FFC_CAPT_NOT_ON_ROSTER';
  END IF;

  -- Validate no active bans
  IF EXISTS (
    SELECT 1 FROM player_bans
    WHERE profile_id = p_white_profile_id AND ends_at > now() AND revoked_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM player_bans
    WHERE profile_id = p_black_profile_id AND ends_at > now() AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'One or both captains have an active ban'
      USING ERRCODE = '22023', CONSTRAINT = 'FFC_CAPT_BANNED';
  END IF;

  v_caller_id := current_profile_id();

  -- Reset all captains, then set the two
  UPDATE match_players SET is_captain = false WHERE match_id = v_match_id;
  UPDATE match_players SET is_captain = true
  WHERE match_id = v_match_id AND profile_id IN (p_white_profile_id, p_black_profile_id);

  PERFORM log_admin_action('matches', v_match_id, 'set_matchday_captains',
    jsonb_build_object('white', p_white_profile_id, 'black', p_black_profile_id));

  RETURN QUERY SELECT p_white_profile_id, p_black_profile_id, v_now;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 13 — update_guest_stats (admin)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_guest_stats(
  p_guest_id           uuid,
  p_primary_position   player_position,
  p_secondary_position player_position,
  p_stamina            guest_trait,
  p_accuracy           guest_trait,
  p_rating             guest_rating,
  p_description        text
) RETURNS match_guests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row match_guests%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required'
      USING ERRCODE = '42501', CONSTRAINT = 'FFC_GUEST_NOT_ADMIN';
  END IF;

  UPDATE match_guests SET
    primary_position   = p_primary_position,
    secondary_position = p_secondary_position,
    stamina            = p_stamina,
    accuracy           = p_accuracy,
    rating             = p_rating,
    description        = p_description,
    updated_by         = current_profile_id(),
    updated_at         = now()
  WHERE id = p_guest_id AND cancelled_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest not found or cancelled'
      USING ERRCODE = '22023', CONSTRAINT = 'FFC_GUEST_NOT_FOUND';
  END IF;

  PERFORM log_admin_action('match_guests', p_guest_id, 'update_guest_stats',
    jsonb_build_object('rating', p_rating, 'position', p_primary_position));

  RETURN v_row;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 14 — edit_match_result (admin)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION edit_match_result(
  p_match_id uuid,
  p_edits    jsonb
) RETURNS matches
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_match     matches%ROWTYPE;
  v_caller_id uuid;
  v_before    jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required'
      USING ERRCODE = '42501', CONSTRAINT = 'FFC_EDIT_NOT_ADMIN';
  END IF;

  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found' USING ERRCODE = '22023';
  END IF;

  IF v_match.approved_at IS NULL THEN
    RAISE EXCEPTION 'Match not approved yet — use approve_match_entry instead'
      USING ERRCODE = '22023', CONSTRAINT = 'FFC_EDIT_NOT_APPROVED';
  END IF;

  v_caller_id := current_profile_id();
  v_before    := to_jsonb(v_match);

  UPDATE matches SET
    result        = COALESCE((p_edits->>'result')::match_result, result),
    score_white   = COALESCE((p_edits->>'score_white')::int, score_white),
    score_black   = COALESCE((p_edits->>'score_black')::int, score_black),
    motm_user_id  = CASE WHEN p_edits ? 'motm_user_id'
                         THEN NULLIF(p_edits->>'motm_user_id','')::uuid ELSE motm_user_id END,
    motm_guest_id = CASE WHEN p_edits ? 'motm_guest_id'
                         THEN NULLIF(p_edits->>'motm_guest_id','')::uuid ELSE motm_guest_id END,
    notes         = COALESCE(p_edits->>'notes', notes),
    updated_at    = now(),
    updated_by    = v_caller_id
  WHERE id = p_match_id
  RETURNING * INTO v_match;

  PERFORM log_admin_action('matches', p_match_id, 'edit_result',
    jsonb_build_object('before', v_before, 'edits', p_edits));

  RETURN v_match;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 15 — promote_from_waitlist (admin)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION promote_from_waitlist(
  p_matchday_id       uuid,
  p_departing_profile uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_match_id    uuid;
  v_team        team_color;
  v_next_player uuid;
  v_caller_id   uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required'
      USING ERRCODE = '42501', CONSTRAINT = 'FFC_SUB_NOT_ADMIN';
  END IF;

  SELECT m.id INTO v_match_id FROM matches m WHERE m.matchday_id = p_matchday_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No draft match found for matchday' USING ERRCODE = '22023';
  END IF;

  SELECT team INTO v_team FROM match_players
  WHERE match_id = v_match_id AND profile_id = p_departing_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Departing player not on roster'
      USING ERRCODE = '22023', CONSTRAINT = 'FFC_SUB_NOT_ON_ROSTER';
  END IF;

  -- Remove departing player
  DELETE FROM match_players WHERE match_id = v_match_id AND profile_id = p_departing_profile;

  -- Find first waitlisted player (slot_order > cap)
  SELECT vc.participant_id INTO v_next_player
  FROM v_match_commitments vc
  WHERE vc.matchday_id = p_matchday_id
    AND vc.commitment_type = 'player'
    AND vc.participant_id NOT IN (
      SELECT profile_id FROM match_players WHERE match_id = v_match_id AND profile_id IS NOT NULL
    )
  ORDER BY vc.slot_order
  LIMIT 1;

  IF v_next_player IS NULL THEN RETURN NULL; END IF;

  v_caller_id := current_profile_id();

  INSERT INTO match_players (match_id, profile_id, team, substituted_in_by)
  VALUES (v_match_id, v_next_player, v_team, v_caller_id);

  PERFORM log_admin_action('matches', v_match_id, 'promote_from_waitlist',
    jsonb_build_object('departed', p_departing_profile, 'promoted', v_next_player));

  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT id, 'dropout_after_lock',
    'Roster change',
    'A player has dropped out and been replaced.',
    jsonb_build_object('matchday_id', p_matchday_id, 'substitute', v_next_player)
  FROM profiles WHERE is_active = true;

  RETURN v_next_player;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 16 — accept_substitute (captain)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION accept_substitute(p_matchday_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_id uuid;
  v_match_id  uuid;
BEGIN
  v_caller_id := current_profile_id();

  SELECT m.id INTO v_match_id FROM matches m WHERE m.matchday_id = p_matchday_id;

  IF NOT EXISTS (
    SELECT 1 FROM match_players
    WHERE match_id = v_match_id AND profile_id = v_caller_id AND is_captain = true
  ) AND NOT is_admin() THEN
    RAISE EXCEPTION 'Must be captain or admin'
      USING ERRCODE = '42501', CONSTRAINT = 'FFC_ACC_NOT_CAPTAIN';
  END IF;

  UPDATE notifications SET
    payload = payload || '{"outcome":"accepted"}'::jsonb,
    read_at = COALESCE(read_at, now())
  WHERE recipient_id = v_caller_id
    AND kind = 'dropout_after_lock'
    AND read_at IS NULL
    AND (payload->>'matchday_id')::uuid = p_matchday_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 17 — request_reroll (captain)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION request_reroll(p_matchday_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_id      uuid;
  v_match_id       uuid;
  v_kickoff        timestamptz;
  v_cutoff_hours   int;
  v_session_id     uuid;
BEGIN
  v_caller_id := current_profile_id();

  SELECT m.id, md.kickoff_at INTO v_match_id, v_kickoff
  FROM matches m JOIN matchdays md ON md.id = m.matchday_id
  WHERE md.id = p_matchday_id;

  IF NOT EXISTS (
    SELECT 1 FROM match_players
    WHERE match_id = v_match_id AND profile_id = v_caller_id AND is_captain = true
  ) THEN
    RAISE EXCEPTION 'Must be a captain of this matchday'
      USING ERRCODE = '42501', CONSTRAINT = 'FFC_REROLL_NOT_CAPTAIN';
  END IF;

  SELECT COALESCE((value::text)::int, 12) INTO v_cutoff_hours
  FROM app_settings WHERE key = 'reroll_cutoff_hours_before_kickoff';

  IF now() > (v_kickoff - (v_cutoff_hours || ' hours')::interval) THEN
    RAISE EXCEPTION 'Too close to kickoff — reroll cutoff has passed'
      USING ERRCODE = '22023', CONSTRAINT = 'FFC_REROLL_CUTOFF_PASSED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM draft_sessions WHERE matchday_id = p_matchday_id AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'A draft session is already in progress'
      USING ERRCODE = '22023', CONSTRAINT = 'FFC_REROLL_SESSION_EXISTS';
  END IF;

  -- Clear team assignments for non-captains
  UPDATE match_players SET team = 'white'  -- placeholder; draft will reassign
  WHERE match_id = v_match_id AND is_captain = false;

  INSERT INTO draft_sessions (matchday_id, reason, triggered_by_profile_id)
  VALUES (p_matchday_id, 'reroll_after_dropout', v_caller_id)
  RETURNING id INTO v_session_id;

  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT id, 'draft_reroll_started',
    'Team re-draft started',
    'A captain has requested a team re-draft.',
    jsonb_build_object('draft_session_id', v_session_id, 'matchday_id', p_matchday_id)
  FROM profiles WHERE is_active = true;

  RETURN v_session_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 18 — submit_draft_pick (captain, current picker)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION submit_draft_pick(
  p_draft_session_id uuid,
  p_profile_id       uuid DEFAULT NULL,
  p_guest_id         uuid DEFAULT NULL
) RETURNS draft_picks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session   draft_sessions%ROWTYPE;
  v_caller_id uuid;
  v_match_id  uuid;
  v_pick_order int;
  v_cap        int;
  v_pick_row   draft_picks%ROWTYPE;
BEGIN
  IF (p_profile_id IS NULL AND p_guest_id IS NULL) OR
     (p_profile_id IS NOT NULL AND p_guest_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of profile_id or guest_id must be provided'
      USING ERRCODE = '22023', CONSTRAINT = 'FFC_PICK_XOR';
  END IF;

  SELECT * INTO v_session FROM draft_sessions WHERE id = p_draft_session_id AND status = 'in_progress';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft session not found or not in progress' USING ERRCODE = '22023';
  END IF;

  v_caller_id := current_profile_id();
  SELECT m.id INTO v_match_id FROM matches m JOIN matchdays md ON md.id = m.matchday_id
  WHERE md.id = v_session.matchday_id;

  -- Verify caller is the current picking captain
  IF NOT EXISTS (
    SELECT 1 FROM match_players
    WHERE match_id = v_match_id
      AND profile_id = v_caller_id
      AND team = v_session.current_picker_team
      AND is_captain = true
  ) THEN
    RAISE EXCEPTION 'Not the current picking captain'
      USING ERRCODE = '42501', CONSTRAINT = 'FFC_PICK_NOT_CURRENT_CAPTAIN';
  END IF;

  -- Check not already picked
  IF (p_profile_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM draft_picks WHERE draft_session_id = p_draft_session_id AND profile_id = p_profile_id
  )) OR (p_guest_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM draft_picks WHERE draft_session_id = p_draft_session_id AND guest_id = p_guest_id
  )) THEN
    RAISE EXCEPTION 'Participant already picked this session'
      USING ERRCODE = '22023', CONSTRAINT = 'FFC_PICK_ALREADY_PICKED';
  END IF;

  SELECT COALESCE(MAX(pick_order), 0) + 1 INTO v_pick_order
  FROM draft_picks WHERE draft_session_id = p_draft_session_id;

  INSERT INTO draft_picks (draft_session_id, pick_order, team, profile_id, guest_id)
  VALUES (p_draft_session_id, v_pick_order, v_session.current_picker_team, p_profile_id, p_guest_id)
  RETURNING * INTO v_pick_row;

  -- Update match_players team assignment
  IF p_profile_id IS NOT NULL THEN
    UPDATE match_players SET team = v_session.current_picker_team
    WHERE match_id = v_match_id AND profile_id = p_profile_id;
  ELSE
    UPDATE match_players SET team = v_session.current_picker_team
    WHERE match_id = v_match_id AND guest_id = p_guest_id;
  END IF;

  -- Flip picker team
  UPDATE draft_sessions SET
    current_picker_team = CASE WHEN current_picker_team = 'white' THEN 'black' ELSE 'white' END
  WHERE id = p_draft_session_id;

  -- Check completion
  v_cap := roster_cap(effective_format(v_session.matchday_id));
  IF v_pick_order >= v_cap THEN
    UPDATE draft_sessions SET status = 'completed', completed_at = now()
    WHERE id = p_draft_session_id;
  END IF;

  RETURN v_pick_row;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 19 — upsert_formation (captain)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION upsert_formation(
  p_matchday_id           uuid,
  p_team                  team_color,
  p_pattern               text,
  p_layout_jsonb          jsonb,
  p_rotation_order        jsonb DEFAULT NULL,
  p_starting_gk_profile_id uuid DEFAULT NULL
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
    last_edited_by, last_edited_at
  ) VALUES (
    p_matchday_id, p_team, p_pattern, p_layout_jsonb,
    p_rotation_order, p_starting_gk_profile_id,
    v_caller_id, now()
  )
  ON CONFLICT (matchday_id, team) DO UPDATE SET
    pattern                  = EXCLUDED.pattern,
    layout_jsonb             = EXCLUDED.layout_jsonb,
    formation_rotation_order = EXCLUDED.formation_rotation_order,
    starting_gk_profile_id  = EXCLUDED.starting_gk_profile_id,
    last_edited_by           = EXCLUDED.last_edited_by,
    last_edited_at           = EXCLUDED.last_edited_at
  RETURNING id INTO v_formation_id;

  RETURN v_formation_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC 20 — share_formation (captain)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION share_formation(p_formation_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_formation formations%ROWTYPE;
  v_caller_id uuid;
BEGIN
  v_caller_id := current_profile_id();

  SELECT * INTO v_formation FROM formations WHERE id = p_formation_id;
  IF NOT FOUND OR v_formation.last_edited_by <> v_caller_id THEN
    RAISE EXCEPTION 'Not the formation captain'
      USING ERRCODE = '42501', CONSTRAINT = 'FFC_SHARE_NOT_CAPTAIN';
  END IF;

  UPDATE formations SET shared_at = now() WHERE id = p_formation_id;

  -- Only notify if not shared in last 10 minutes (de-duplicate)
  IF v_formation.shared_at IS NULL OR v_formation.shared_at < now() - INTERVAL '10 minutes' THEN
    INSERT INTO notifications (recipient_id, kind, title, body, payload)
    SELECT mp.profile_id, 'formation_shared',
      'Formation shared',
      'Your captain has shared the team formation.',
      jsonb_build_object('formation_id', p_formation_id, 'matchday_id', v_formation.matchday_id)
    FROM match_players mp
    JOIN matches m ON m.id = mp.match_id
    WHERE m.matchday_id = v_formation.matchday_id
      AND mp.team = v_formation.team
      AND mp.profile_id IS NOT NULL
      AND mp.profile_id <> v_caller_id;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- Grants (§2.7)
-- ═══════════════════════════════════════════════════════════════
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

GRANT EXECUTE ON FUNCTION submit_ref_entry(text, jsonb)                                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_match_draft(uuid, uuid[], uuid[], uuid[], uuid[])            TO authenticated;
GRANT EXECUTE ON FUNCTION approve_match_entry(uuid, jsonb)                                    TO authenticated;
GRANT EXECUTE ON FUNCTION reject_match_entry(uuid, text)                                      TO authenticated;
GRANT EXECUTE ON FUNCTION approve_signup(uuid, uuid)                                          TO authenticated;
GRANT EXECUTE ON FUNCTION reject_signup(uuid, text)                                           TO authenticated;
GRANT EXECUTE ON FUNCTION promote_admin(uuid)                                                 TO authenticated;
GRANT EXECUTE ON FUNCTION demote_admin(uuid)                                                  TO authenticated;
GRANT EXECUTE ON FUNCTION archive_season(uuid)                                                TO authenticated;
GRANT EXECUTE ON FUNCTION suggest_captain_pairs(uuid)                                         TO authenticated;
GRANT EXECUTE ON FUNCTION pick_captains_random(uuid)                                          TO authenticated;
GRANT EXECUTE ON FUNCTION set_matchday_captains(uuid, uuid, uuid)                             TO authenticated;
GRANT EXECUTE ON FUNCTION update_guest_stats(uuid, player_position, player_position, guest_trait, guest_trait, guest_rating, text) TO authenticated;
GRANT EXECUTE ON FUNCTION edit_match_result(uuid, jsonb)                                      TO authenticated;
GRANT EXECUTE ON FUNCTION promote_from_waitlist(uuid, uuid)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION accept_substitute(uuid)                                             TO authenticated;
GRANT EXECUTE ON FUNCTION request_reroll(uuid)                                                TO authenticated;
GRANT EXECUTE ON FUNCTION submit_draft_pick(uuid, uuid, uuid)                                 TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_formation(uuid, team_color, text, jsonb, jsonb, uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION share_formation(uuid)                                               TO authenticated;
GRANT EXECUTE ON FUNCTION effective_format(uuid)                                              TO authenticated;
GRANT EXECUTE ON FUNCTION roster_cap(match_format)                                            TO authenticated;
-- fire_scheduled_reminder: pg_cron superuser only — not granted to authenticated
-- log_admin_action: SECURITY DEFINER bodies only — not granted
