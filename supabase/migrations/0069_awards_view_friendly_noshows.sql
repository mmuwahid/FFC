-- 0069_awards_view_friendly_noshows.sql
-- Fix issue #48: v_season_award_winners_live was counting friendly matches
-- and no-show ghost entries, causing awards to diverge from the leaderboard.
-- Align with v_season_standings: join matchdays, filter NOT is_friendly,
-- filter NOT is_no_show.

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
  JOIN matchdays md ON md.id = m.matchday_id
  JOIN match_players mp ON mp.match_id = m.id
  JOIN profiles pr ON pr.id = mp.profile_id
  WHERE m.approved_at IS NOT NULL
    AND mp.profile_id IS NOT NULL
    AND pr.deleted_at IS NULL
    AND NOT md.is_friendly
    AND NOT mp.is_no_show
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
