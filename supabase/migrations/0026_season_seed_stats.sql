-- 0026_season_seed_stats.sql
-- S037: Season seed stats table + v_season_standings rewrite to UNION live aggregates with seeds.
-- Purpose: support importing Season 11 historical stats (30 matchdays played outside the app)
-- without inventing fake matchday/match_player rows. Season 11 aggregates accumulate on top
-- of the seed as MD31+ is played inside the app.

BEGIN;

-- =============================================================================
-- 1. season_seed_stats table
-- =============================================================================

CREATE TABLE public.season_seed_stats (
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  wins_seed int NOT NULL DEFAULT 0 CHECK (wins_seed >= 0),
  draws_seed int NOT NULL DEFAULT 0 CHECK (draws_seed >= 0),
  losses_seed int NOT NULL DEFAULT 0 CHECK (losses_seed >= 0),
  goals_seed int NOT NULL DEFAULT 0 CHECK (goals_seed >= 0),
  yellows_seed int NOT NULL DEFAULT 0 CHECK (yellows_seed >= 0),
  reds_seed int NOT NULL DEFAULT 0 CHECK (reds_seed >= 0),
  motms_seed int NOT NULL DEFAULT 0 CHECK (motms_seed >= 0),
  late_cancel_points_seed int NOT NULL DEFAULT 0 CHECK (late_cancel_points_seed <= 0),
  no_show_points_seed int NOT NULL DEFAULT 0 CHECK (no_show_points_seed <= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, profile_id)
);

COMMENT ON TABLE public.season_seed_stats IS
  'Per-(season, profile) seed aggregates. Represents stats earned outside the app (e.g., '
  'pre-app history) that should be added to live match_player aggregates in v_season_standings.';

ALTER TABLE public.season_seed_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "season_seed_stats_select_all"
  ON public.season_seed_stats
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "season_seed_stats_admin_write"
  ON public.season_seed_stats
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT ON public.season_seed_stats TO authenticated;

-- =============================================================================
-- 2. v_season_standings — UNION live aggregates + seed rows
-- =============================================================================
-- Behaviour: seed-only players (no matches in-app yet) still appear in standings.
-- Formula: points = wins*3 + draws + late_cancel_points + no_show_points, summing
-- live + seed contributions for each component.

-- CREATE OR REPLACE (not DROP): v_captain_eligibility depends on this view.
-- Column signature is unchanged from the prior version, so REPLACE is safe.
CREATE OR REPLACE VIEW public.v_season_standings AS
WITH played AS (
  SELECT md.season_id,
         mp.profile_id,
         count(*) FILTER (WHERE m.result = 'win_white'::match_result AND mp.team = 'white'::team_color)
           + count(*) FILTER (WHERE m.result = 'win_black'::match_result AND mp.team = 'black'::team_color) AS wins,
         count(*) FILTER (WHERE m.result = 'draw'::match_result) AS draws,
         count(*) FILTER (WHERE m.result = 'win_white'::match_result AND mp.team = 'black'::team_color)
           + count(*) FILTER (WHERE m.result = 'win_black'::match_result AND mp.team = 'white'::team_color) AS losses,
         COALESCE(sum(mp.goals), 0::bigint) AS goals,
         COALESCE(sum(mp.yellow_cards), 0::bigint) AS yellows,
         COALESCE(sum(mp.red_cards), 0::bigint) AS reds,
         count(*) FILTER (WHERE m.motm_user_id = mp.profile_id) AS motms
  FROM public.matches m
    JOIN public.matchdays md ON md.id = m.matchday_id
    JOIN public.match_players mp ON mp.match_id = m.id
  WHERE m.approved_at IS NOT NULL
    AND mp.profile_id IS NOT NULL
    AND NOT md.is_friendly
  GROUP BY md.season_id, mp.profile_id
),
penalties AS (
  SELECT md.season_id,
         pv.profile_id,
         sum(
           CASE
             WHEN pv.cancelled_at IS NULL THEN 0
             WHEN pv.cancelled_at > (md.kickoff_at - '24:00:00'::interval) THEN -1
             WHEN md.roster_locked_at IS NOT NULL AND pv.cancelled_at > md.roster_locked_at THEN -1
             ELSE 0
           END
         ) AS late_cancel_points
  FROM public.poll_votes pv
    JOIN public.matchdays md ON md.id = pv.matchday_id
  WHERE pv.choice = 'yes'::poll_choice
    AND NOT md.is_friendly
  GROUP BY md.season_id, pv.profile_id
),
no_show_penalties AS (
  SELECT md.season_id,
         mp.profile_id,
         sum(CASE WHEN mp.is_no_show THEN ns_cfg.pts ELSE 0 END) AS no_show_points
  FROM public.match_players mp
    JOIN public.matches m ON m.id = mp.match_id
    JOIN public.matchdays md ON md.id = m.matchday_id
    CROSS JOIN (
      SELECT COALESCE((app_settings.value ->> 'no_show_penalty_points')::integer, -2) AS pts
      FROM public.app_settings
      WHERE app_settings.key = 'match_settings'
    ) ns_cfg
  WHERE m.approved_at IS NOT NULL
    AND mp.profile_id IS NOT NULL
    AND NOT md.is_friendly
  GROUP BY md.season_id, mp.profile_id
),
combined AS (
  SELECT season_id, profile_id FROM played
  UNION
  SELECT season_id, profile_id FROM public.season_seed_stats
)
SELECT c.season_id,
       c.profile_id,
       pr.display_name,
       (COALESCE(p.wins,    0::bigint) + COALESCE(s.wins_seed,    0)::bigint)   AS wins,
       (COALESCE(p.draws,   0::bigint) + COALESCE(s.draws_seed,   0)::bigint)   AS draws,
       (COALESCE(p.losses,  0::bigint) + COALESCE(s.losses_seed,  0)::bigint)   AS losses,
       (COALESCE(p.goals,   0::bigint) + COALESCE(s.goals_seed,   0)::bigint)   AS goals,
       (COALESCE(p.yellows, 0::bigint) + COALESCE(s.yellows_seed, 0)::bigint)   AS yellows,
       (COALESCE(p.reds,    0::bigint) + COALESCE(s.reds_seed,    0)::bigint)   AS reds,
       (COALESCE(p.motms,   0::bigint) + COALESCE(s.motms_seed,   0)::bigint)   AS motms,
       (COALESCE(pen.late_cancel_points, 0::bigint) + COALESCE(s.late_cancel_points_seed, 0)::bigint) AS late_cancel_points,
       (COALESCE(nsp.no_show_points,     0::bigint) + COALESCE(s.no_show_points_seed,     0)::bigint) AS no_show_points,
       (
         (COALESCE(p.wins,  0::bigint) + COALESCE(s.wins_seed,  0)::bigint) * 3
         + (COALESCE(p.draws, 0::bigint) + COALESCE(s.draws_seed, 0)::bigint)
         + COALESCE(pen.late_cancel_points, 0::bigint) + COALESCE(s.late_cancel_points_seed, 0)::bigint
         + COALESCE(nsp.no_show_points,     0::bigint) + COALESCE(s.no_show_points_seed,     0)::bigint
       ) AS points
FROM combined c
  JOIN public.profiles pr ON pr.id = c.profile_id
  LEFT JOIN played p  ON p.season_id = c.season_id AND p.profile_id = c.profile_id
  LEFT JOIN penalties pen ON pen.season_id = c.season_id AND pen.profile_id = c.profile_id
  LEFT JOIN no_show_penalties nsp ON nsp.season_id = c.season_id AND nsp.profile_id = c.profile_id
  LEFT JOIN public.season_seed_stats s ON s.season_id = c.season_id AND s.profile_id = c.profile_id;

GRANT SELECT ON public.v_season_standings TO authenticated;

COMMIT;
