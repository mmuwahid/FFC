-- 0058_ranking_change_notifications.sql
-- S058 issue #23 — full coverage: notify players when their leaderboard
-- rank shifts after a match approval.
--
-- Problem: leaderboard is a computed view (v_season_standings); ranks have
-- no natural event source.
--
-- Solution:
--   1. New table player_rank_snapshots — append-only row per profile per
--      season per snapshot_at.
--   2. New function snapshot_and_diff_ranks(p_season_id) that:
--      a. Reads each profile's most recent prior snapshot for that season.
--      b. Computes current ranks via ROW_NUMBER OVER the leaderboard tiebreak
--         chain (points → wins → motms → goals → name).
--      c. Inserts new snapshot rows.
--      d. For each profile whose rank changed, inserts a ranking_changed
--         notification with payload {old_rank, new_rank, points}.
--      First snapshot per season has no diff (no prior); silently skipped.
--   3. approve_match_entry rewritten ONE MORE TIME (after 0057's rewrite)
--      to PERFORM snapshot_and_diff_ranks at the end.

-- ─────────────────────────────────────────────────────────────────────────
-- Block 1: enum value addition.
-- ─────────────────────────────────────────────────────────────────────────
BEGIN;
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'ranking_changed';
COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Block 2: snapshot table + function + approve_match_entry call site.
-- ─────────────────────────────────────────────────────────────────────────
BEGIN;

CREATE TABLE IF NOT EXISTS public.player_rank_snapshots (
  season_id    uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  snapshot_at  timestamptz NOT NULL DEFAULT now(),
  rank         int  NOT NULL,
  points       int  NOT NULL,
  PRIMARY KEY (season_id, profile_id, snapshot_at)
);

-- Index for fast "latest snapshot per profile per season" lookups.
CREATE INDEX IF NOT EXISTS player_rank_snapshots_recent_idx
  ON public.player_rank_snapshots (season_id, profile_id, snapshot_at DESC);

-- Service-role/admin only — players don't read this table directly.
ALTER TABLE public.player_rank_snapshots ENABLE ROW LEVEL SECURITY;

-- snapshot_and_diff_ranks — computes current ranks, snapshots them, emits
-- ranking_changed notifications for profiles whose rank moved.
CREATE OR REPLACE FUNCTION public.snapshot_and_diff_ranks(
  p_season_id uuid
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now timestamptz := now();
  v_diff_count int := 0;
BEGIN
  -- Build current ranks via ROW_NUMBER. Tiebreak chain mirrors Leaderboard.tsx
  -- (points DESC, wins DESC, motms DESC, goals DESC, profile_id ASC for stable
  -- order when everything else is equal).
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
    -- Most-recent snapshot per profile prior to v_now. Window over
    -- player_rank_snapshots ordered by snapshot_at DESC, take row 1.
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
    'ranking_changed',
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
  -- guard: only notify ACTIVE non-deleted profiles
  JOIN public.profiles pr ON pr.id = d.profile_id
  WHERE pr.is_active = true AND pr.deleted_at IS NULL;

  GET DIAGNOSTICS v_diff_count = ROW_COUNT;
  RETURN v_diff_count;
END;
$$;

-- approve_match_entry — supersedes 0057's rewrite. Adds a single call to
-- snapshot_and_diff_ranks(season_id) after the existing fan-out.
CREATE OR REPLACE FUNCTION approve_match_entry(
  p_pending_id uuid,
  p_edits      jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  -- Match-result fan-out (scoped to match's players, S058 fix from 0057).
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT DISTINCT mp.profile_id, 'match_entry_approved',
    'Match result approved',
    'The match result has been confirmed.',
    jsonb_build_object('match_id', v_match_id)
  FROM match_players mp
  WHERE mp.match_id = v_match_id
    AND mp.profile_id IS NOT NULL;

  -- S058 — snapshot ranks + emit ranking_changed for any profile whose
  -- rank moved. First snapshot per season has no prior to diff against,
  -- so initial run is a silent baseline.
  PERFORM public.snapshot_and_diff_ranks(v_season_id);

  RETURN v_match_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_match_entry(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_and_diff_ranks(uuid) TO authenticated;

COMMIT;
