-- supabase/migrations/0066_notification_kind_casts.sql
--
-- S063 — fix approve_match_entry failing with
--   "column \"kind\" is of type notification_kind but expression is of type text"
--
-- Root cause: S058's mig 0057 introduced
--   INSERT INTO notifications (...) SELECT DISTINCT ..., 'match_entry_approved', ...
-- PG normally infers a string literal's type from the target INSERT column, but
-- with `SELECT DISTINCT` (and similarly with CTE chains feeding the INSERT)
-- the projection's types are locked BEFORE the INSERT context is considered.
-- The literal resolves as `text` and the cast to `notification_kind` fails.
--
-- Fix: add explicit `::notification_kind` casts on every literal in the three
-- SECURITY DEFINER functions that emit notifications via SELECT chains.
-- submit_ref_entry's plain `SELECT id, 'match_entry_submitted', ...` works
-- today (no DISTINCT, no CTE) but we cast there too — bulletproof against
-- future SELECT-chain edits.

-- ── approve_match_entry — re-issue with explicit cast ────────────────────────
CREATE OR REPLACE FUNCTION public.approve_match_entry(p_pending_id uuid, p_edits jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pme        pending_match_entries%ROWTYPE;
  v_match_id   uuid;
  v_caller_id  uuid;
  v_season_id  uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pme FROM pending_match_entries WHERE id = p_pending_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending entry not found or already resolved' USING ERRCODE = '22023';
  END IF;

  v_caller_id := current_profile_id();

  SELECT id, season_id INTO v_match_id, v_season_id
    FROM matches WHERE matchday_id = v_pme.matchday_id;
  IF v_match_id IS NULL THEN
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
    ref_name      = CASE WHEN p_edits ? 'ref_name'
                           THEN NULLIF(trim(p_edits->>'ref_name'), '')
                           ELSE COALESCE(v_pme.ref_name, ref_name) END,
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
    is_no_show   = pmep.is_no_show,
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

  -- Match-result fan-out — explicit ::notification_kind cast (S063 fix).
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT DISTINCT mp.profile_id,
    'match_entry_approved'::notification_kind,
    'Match result approved',
    'The match result has been confirmed.',
    jsonb_build_object('match_id', v_match_id)
  FROM match_players mp
  WHERE mp.match_id = v_match_id
    AND mp.profile_id IS NOT NULL;

  PERFORM public.snapshot_and_diff_ranks(v_season_id);

  RETURN v_match_id;
END;
$function$;

-- ── notify_matchday_created — explicit cast ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_matchday_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_creator uuid;
  v_kickoff_label text;
BEGIN
  v_creator := COALESCE(NEW.created_by, current_profile_id());
  v_kickoff_label := to_char(NEW.kickoff_at AT TIME ZONE 'Asia/Dubai',
                             'Dy, DD Mon');

  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT p.id,
    'matchday_created'::notification_kind,
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
$function$;

-- ── snapshot_and_diff_ranks — explicit cast ────────────────────────────────
-- Uses a CTE chain (ranked → prior → inserted → diffs → INSERT) which has
-- the same literal-type-resolution risk. Cast for safety.
CREATE OR REPLACE FUNCTION public.snapshot_and_diff_ranks(p_season_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_diff_count int := 0;
BEGIN
  WITH ranked AS (
    SELECT
      vs.season_id,
      vs.profile_id,
      vs.points::int                 AS points,
      ROW_NUMBER() OVER (
        PARTITION BY vs.season_id
        ORDER BY vs.points DESC,
                 vs.wins   DESC,
                 vs.motms  DESC,
                 vs.goals  DESC,
                 vs.profile_id ASC
      )::int AS rank
    FROM public.v_season_standings vs
    WHERE vs.season_id = p_season_id
  ),
  prior AS (
    SELECT season_id, profile_id, rank AS prev_rank
    FROM (
      SELECT prs.season_id, prs.profile_id, prs.rank,
             ROW_NUMBER() OVER (PARTITION BY prs.season_id, prs.profile_id
                                ORDER BY prs.snapshot_at DESC) AS rn
      FROM public.player_rank_snapshots prs
      WHERE prs.season_id = p_season_id
    ) sub
    WHERE rn = 1
  ),
  inserted AS (
    INSERT INTO public.player_rank_snapshots (season_id, profile_id, snapshot_at, rank, points)
    SELECT r.season_id, r.profile_id, v_now, r.rank, r.points
    FROM ranked r
    RETURNING profile_id, rank, points
  ),
  diffs AS (
    SELECT
      i.profile_id,
      p.prev_rank,
      i.rank AS new_rank,
      i.points
    FROM inserted i
    JOIN prior p ON p.profile_id = i.profile_id
    WHERE p.prev_rank IS DISTINCT FROM i.rank
  )
  INSERT INTO public.notifications (recipient_id, kind, title, body, payload)
  SELECT
    d.profile_id,
    'ranking_changed'::notification_kind,
    CASE WHEN d.new_rank < d.prev_rank
         THEN 'You moved up the table'
         ELSE 'Your league position changed'
    END,
    'Rank ' || d.prev_rank::text || ' → ' || d.new_rank::text ||
      ' · ' || d.points::text || ' pts',
    jsonb_build_object(
      'season_id', p_season_id,
      'old_rank',  d.prev_rank,
      'new_rank',  d.new_rank,
      'points',    d.points
    )
  FROM diffs d
  JOIN public.profiles pr ON pr.id = d.profile_id
  WHERE pr.is_active = true AND pr.deleted_at IS NULL;

  GET DIAGNOSTICS v_diff_count = ROW_COUNT;
  RETURN v_diff_count;
END;
$function$;

-- ── submit_ref_entry — explicit cast (defensive) ────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_ref_entry(p_token text, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    kickoff_at, halftime_at, fulltime_at, stoppage_h1_seconds, stoppage_h2_seconds,
    ref_name
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
    COALESCE(NULLIF(p_payload#>>'{timing,stoppage_h2_seconds}','')::int, 0),
    NULLIF(trim(p_payload->>'ref_name'), '')
  ) RETURNING id INTO v_entry_id;

  INSERT INTO pending_match_entry_players (
    pending_entry_id, profile_id, guest_id, team,
    goals, yellow_cards, red_cards, is_motm, is_no_show
  )
  SELECT
    v_entry_id,
    NULLIF(pl->>'profile_id', '')::uuid,
    NULLIF(pl->>'guest_id', '')::uuid,
    (pl->>'team')::team_color,
    COALESCE((pl->>'goals')::int, 0),
    COALESCE((pl->>'yellow_cards')::int, 0),
    COALESCE((pl->>'red_cards')::int, 0),
    COALESCE((pl->>'is_motm')::boolean, false),
    COALESCE((pl->>'is_no_show')::boolean, false)
  FROM jsonb_array_elements(p_payload->'players') pl;

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

  UPDATE ref_tokens SET consumed_at = now() WHERE id = v_token_row.id;

  -- Defensive cast (S063): same shape as approve_match_entry.
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT id,
    'match_entry_submitted'::notification_kind,
    'Match entry submitted',
    'A ref has submitted the result for review.',
    jsonb_build_object('pending_entry_id', v_entry_id, 'matchday_id', v_matchday_id)
  FROM profiles WHERE role IN ('admin','super_admin') AND is_active = true;

  RETURN v_entry_id;
END;
$function$;
