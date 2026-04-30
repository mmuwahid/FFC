-- Migration 0065: Player formal name for standardized display
-- Adds formal_name (TEXT NULL) to profiles.
-- When set, formal_name is used in leaderboard and match cards instead of display_name.
-- display_name remains the nickname used informally in the app.
-- Admin sets formal_name via set_player_formal_name RPC.

-- 1. Add column
ALTER TABLE public.profiles ADD COLUMN formal_name TEXT;

-- 2. Update v_season_standings to prefer formal_name over display_name
CREATE OR REPLACE VIEW public.v_season_standings AS
WITH played AS (
  SELECT md.season_id,
    mp.profile_id,
    (count(*) FILTER (WHERE (m.result = 'win_white'::match_result AND mp.team = 'white'::team_color))
     + count(*) FILTER (WHERE (m.result = 'win_black'::match_result AND mp.team = 'black'::team_color))) AS wins,
    count(*) FILTER (WHERE m.result = 'draw'::match_result) AS draws,
    (count(*) FILTER (WHERE (m.result = 'win_white'::match_result AND mp.team = 'black'::team_color))
     + count(*) FILTER (WHERE (m.result = 'win_black'::match_result AND mp.team = 'white'::team_color))) AS losses,
    COALESCE(sum(mp.goals), 0::bigint) AS goals,
    COALESCE(sum(mp.yellow_cards), 0::bigint) AS yellows,
    COALESCE(sum(mp.red_cards), 0::bigint) AS reds,
    count(*) FILTER (WHERE m.motm_user_id = mp.profile_id) AS motms
  FROM matches m
  JOIN matchdays md ON md.id = m.matchday_id
  JOIN match_players mp ON mp.match_id = m.id
  WHERE m.approved_at IS NOT NULL AND mp.profile_id IS NOT NULL AND NOT md.is_friendly
  GROUP BY md.season_id, mp.profile_id
),
penalties AS (
  SELECT md.season_id,
    pv.profile_id,
    sum(
      CASE
        WHEN pv.cancelled_at IS NULL THEN 0
        WHEN pv.cancelled_at > (md.kickoff_at - INTERVAL '24 hours') THEN -1
        WHEN md.roster_locked_at IS NOT NULL AND pv.cancelled_at > md.roster_locked_at THEN -1
        ELSE 0
      END
    ) AS late_cancel_points
  FROM poll_votes pv
  JOIN matchdays md ON md.id = pv.matchday_id
  WHERE pv.choice = 'yes'::poll_choice AND NOT md.is_friendly
  GROUP BY md.season_id, pv.profile_id
),
no_show_penalties AS (
  SELECT md.season_id,
    mp.profile_id,
    sum(CASE WHEN mp.is_no_show THEN ns_cfg.pts ELSE 0 END) AS no_show_points
  FROM match_players mp
  JOIN matches m ON m.id = mp.match_id
  JOIN matchdays md ON md.id = m.matchday_id
  CROSS JOIN (
    SELECT COALESCE((value->>'no_show_penalty_points')::integer, -2) AS pts
    FROM app_settings WHERE key = 'match_settings'
  ) ns_cfg
  WHERE m.approved_at IS NOT NULL AND mp.profile_id IS NOT NULL AND NOT md.is_friendly
  GROUP BY md.season_id, mp.profile_id
),
combined AS (
  SELECT season_id, profile_id FROM played
  UNION
  SELECT season_id, profile_id FROM season_seed_stats
)
SELECT
  c.season_id,
  c.profile_id,
  COALESCE(pr.formal_name, pr.display_name) AS display_name,
  (COALESCE(p.wins,  0::bigint) + COALESCE(s.wins_seed,  0)::bigint) AS wins,
  (COALESCE(p.draws, 0::bigint) + COALESCE(s.draws_seed, 0)::bigint) AS draws,
  (COALESCE(p.losses,0::bigint) + COALESCE(s.losses_seed,0)::bigint) AS losses,
  (COALESCE(p.goals, 0::bigint) + COALESCE(s.goals_seed, 0)::bigint) AS goals,
  (COALESCE(p.yellows,0::bigint)+ COALESCE(s.yellows_seed,0)::bigint) AS yellows,
  (COALESCE(p.reds,  0::bigint) + COALESCE(s.reds_seed,  0)::bigint) AS reds,
  (COALESCE(p.motms, 0::bigint) + COALESCE(s.motms_seed, 0)::bigint) AS motms,
  (COALESCE(pen.late_cancel_points, 0::bigint) + COALESCE(s.late_cancel_points_seed, 0)::bigint) AS late_cancel_points,
  (COALESCE(nsp.no_show_points, 0::bigint) + COALESCE(s.no_show_points_seed, 0)::bigint) AS no_show_points,
  (
    (COALESCE(p.wins,  0::bigint) + COALESCE(s.wins_seed,  0)::bigint) * 3
    + (COALESCE(p.draws,0::bigint) + COALESCE(s.draws_seed,0)::bigint)
    + COALESCE(pen.late_cancel_points, 0::bigint) + COALESCE(s.late_cancel_points_seed, 0)::bigint
    + COALESCE(nsp.no_show_points,     0::bigint) + COALESCE(s.no_show_points_seed,     0)::bigint
  ) AS points
FROM combined c
JOIN profiles pr ON pr.id = c.profile_id AND pr.deleted_at IS NULL
LEFT JOIN played p ON p.season_id = c.season_id AND p.profile_id = c.profile_id
LEFT JOIN penalties pen ON pen.season_id = c.season_id AND pen.profile_id = c.profile_id
LEFT JOIN no_show_penalties nsp ON nsp.season_id = c.season_id AND nsp.profile_id = c.profile_id
LEFT JOIN season_seed_stats s ON s.season_id = c.season_id AND s.profile_id = c.profile_id;

-- 3. Admin RPC: set a player's formal name (or clear it with NULL)
CREATE OR REPLACE FUNCTION public.set_player_formal_name(
  p_profile_id uuid,
  p_formal_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
     SET formal_name = NULLIF(btrim(COALESCE(p_formal_name, '')), ''),
         updated_at  = now(),
         updated_by  = public.current_profile_id()
   WHERE id = p_profile_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_player_formal_name(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.set_player_formal_name(uuid, text) TO authenticated;
