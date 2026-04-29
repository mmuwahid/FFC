-- 0047_phase3_awards.sql
-- Phase 3 awards (V3.0:139). New season_awards snapshot table + live view +
-- AFTER UPDATE OF ended_at trigger that snapshots winners when a season ends.

-- =============================================================
-- 1. Snapshot table — ended seasons' frozen winners
-- =============================================================
CREATE TABLE season_awards (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id             uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  award_kind            text NOT NULL CHECK (award_kind IN ('ballon_dor', 'golden_boot', 'most_motm')),
  winner_profile_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  runner_up_profile_id  uuid REFERENCES profiles(id) ON DELETE RESTRICT,
  metric_value          numeric NOT NULL,
  runner_up_metric      numeric,
  meta                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  frozen_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, award_kind)
);

CREATE INDEX season_awards_season_idx ON season_awards (season_id);

-- RLS: read-only for authenticated; only the trigger writes (SECURITY DEFINER)
ALTER TABLE season_awards ENABLE ROW LEVEL SECURITY;
CREATE POLICY season_awards_select ON season_awards FOR SELECT TO authenticated USING (true);

-- Default-privileges grant on tables (mig 0012) covers SELECT for authenticated;
-- explicit grant kept for clarity per CLAUDE.md gotcha (default privileges
-- don't cover service_role and view scope can vary).
GRANT SELECT ON season_awards TO authenticated;

-- =============================================================
-- 2. Live computation view — used for ACTIVE seasons
-- =============================================================
-- Awards points formula: wins*3 + draws (NO late_cancel_points term)
-- — celebrates match performance, not roster discipline. Differs from
-- v_season_standings.points by design.
-- Tie-break cascade (applied to all 3 awards):
--   <metric> DESC, wins DESC, total_cards ASC, display_name ASC
-- — single deterministic winner.
CREATE OR REPLACE VIEW v_season_award_winners_live AS
WITH base AS (
  SELECT
    m.season_id,
    mp.profile_id,
    pr.display_name,
    COUNT(*) FILTER (WHERE m.result = 'win_white' AND mp.team = 'white')
      + COUNT(*) FILTER (WHERE m.result = 'win_black' AND mp.team = 'black') AS wins,
    COUNT(*) FILTER (WHERE m.result = 'draw') AS draws,
    COUNT(*) FILTER (WHERE m.result = 'win_white' AND mp.team = 'black')
      + COUNT(*) FILTER (WHERE m.result = 'win_black' AND mp.team = 'white') AS losses,
    COALESCE(SUM(mp.goals), 0)::int AS goals,
    COALESCE(SUM(mp.yellow_cards), 0)::int AS yellows,
    COALESCE(SUM(mp.red_cards), 0)::int AS reds,
    COUNT(*) FILTER (WHERE m.motm_user_id = mp.profile_id)::int AS motms,
    COUNT(*)::int AS matches_played
  FROM matches m
  JOIN match_players mp ON mp.match_id = m.id
  JOIN profiles pr ON pr.id = mp.profile_id
  WHERE m.approved_at IS NOT NULL
    AND mp.profile_id IS NOT NULL
    AND pr.deleted_at IS NULL
  GROUP BY m.season_id, mp.profile_id, pr.display_name
),
scored AS (
  SELECT *,
    (wins * 3 + draws) AS points,
    (yellows + reds) AS total_cards
  FROM base
),
ballon AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY season_id ORDER BY points DESC, wins DESC, total_cards ASC, display_name ASC) AS rn
  FROM scored
),
boot AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY season_id ORDER BY goals DESC, wins DESC, total_cards ASC, display_name ASC) AS rn
  FROM scored
),
motm AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY season_id ORDER BY motms DESC, wins DESC, total_cards ASC, display_name ASC) AS rn
  FROM scored
)
SELECT
  b1.season_id,
  'ballon_dor'::text AS award_kind,
  b1.profile_id AS winner_profile_id,
  b2.profile_id AS runner_up_profile_id,
  b1.points::numeric AS metric_value,
  b2.points::numeric AS runner_up_metric,
  jsonb_build_object(
    'wins', b1.wins, 'draws', b1.draws, 'losses', b1.losses,
    'matches_played', b1.matches_played,
    'win_pct', CASE WHEN b1.matches_played > 0 THEN ROUND((b1.wins::numeric / b1.matches_played) * 100) ELSE 0 END
  ) AS meta
FROM ballon b1
LEFT JOIN ballon b2 ON b2.season_id = b1.season_id AND b2.rn = 2
WHERE b1.rn = 1
UNION ALL
SELECT
  b1.season_id,
  'golden_boot'::text,
  b1.profile_id,
  b2.profile_id,
  b1.goals::numeric,
  b2.goals::numeric,
  jsonb_build_object(
    'matches_played', b1.matches_played,
    'goals_per_match', CASE WHEN b1.matches_played > 0 THEN ROUND(b1.goals::numeric / b1.matches_played, 2) ELSE 0 END
  )
FROM boot b1
LEFT JOIN boot b2 ON b2.season_id = b1.season_id AND b2.rn = 2
WHERE b1.rn = 1
UNION ALL
SELECT
  m1.season_id,
  'most_motm'::text,
  m1.profile_id,
  m2.profile_id,
  m1.motms::numeric,
  m2.motms::numeric,
  jsonb_build_object('matches_played', m1.matches_played)
FROM motm m1
LEFT JOIN motm m2 ON m2.season_id = m1.season_id AND m2.rn = 2
WHERE m1.rn = 1;

GRANT SELECT ON v_season_award_winners_live TO authenticated;

-- =============================================================
-- 3. Snapshot trigger — fires on seasons.ended_at NULL → NOT NULL transition
-- =============================================================
CREATE OR REPLACE FUNCTION snapshot_season_awards_trigger() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO season_awards (season_id, award_kind, winner_profile_id, runner_up_profile_id, metric_value, runner_up_metric, meta)
  SELECT season_id, award_kind, winner_profile_id, runner_up_profile_id, metric_value, runner_up_metric, meta
  FROM v_season_award_winners_live
  WHERE season_id = NEW.id
    AND winner_profile_id IS NOT NULL  -- skip 0-match seasons
  ON CONFLICT (season_id, award_kind) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS season_awards_snapshot ON seasons;
CREATE TRIGGER season_awards_snapshot
  AFTER UPDATE OF ended_at ON seasons
  FOR EACH ROW
  EXECUTE FUNCTION snapshot_season_awards_trigger();
