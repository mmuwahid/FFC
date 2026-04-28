-- 0039_profiles_soft_delete.sql
-- S049 — Self-delete-account foundation. Adds deleted_at column to profiles
-- and refreshes v_season_standings so deleted players drop off the
-- leaderboard. Match history rows continue to reference the (now-anonymised)
-- profile so historical data stays intact.
--
-- Pattern: same as match_guests.cancelled_at / poll_votes.cancelled_at
-- (single nullable timestamp; partial index on the active subset).
--
-- v_season_standings: v_captain_eligibility depends on this view, so we use
-- CREATE OR REPLACE with an identical column signature. Only the body's
-- JOIN-to-profiles gains a WHERE pr.deleted_at IS NULL filter.

BEGIN;

-- =============================================================================
-- 1. profiles.deleted_at + partial active index
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.profiles.deleted_at IS
  'Soft-delete timestamp set by the delete_my_account() RPC. When set, the '
  'profile is filtered out of the leaderboard but match_players + poll_votes '
  'rows referencing this id are preserved (historical accuracy).';

CREATE INDEX IF NOT EXISTS profiles_active_idx
  ON public.profiles (id) WHERE deleted_at IS NULL;

-- =============================================================================
-- 2. v_season_standings — REPLACE with deleted-profile filter
-- =============================================================================
-- Body is identical to migration 0026's definition except for the added
-- "AND pr.deleted_at IS NULL" predicate on the JOIN to profiles. Column
-- signature unchanged so v_captain_eligibility (the dependent view) stays
-- compatible without a DROP+CREATE chain.

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
  JOIN public.profiles pr ON pr.id = c.profile_id AND pr.deleted_at IS NULL
  LEFT JOIN played p  ON p.season_id = c.season_id AND p.profile_id = c.profile_id
  LEFT JOIN penalties pen ON pen.season_id = c.season_id AND pen.profile_id = c.profile_id
  LEFT JOIN no_show_penalties nsp ON nsp.season_id = c.season_id AND nsp.profile_id = c.profile_id
  LEFT JOIN public.season_seed_stats s ON s.season_id = c.season_id AND s.profile_id = c.profile_id;

GRANT SELECT ON public.v_season_standings TO authenticated;

COMMIT;
