-- 0006_views.sql — read-optimised views (§2.6)

-- Commitment order for poll screen (14-slot)
CREATE VIEW v_match_commitments AS
SELECT matchday_id, 'player'::text AS commitment_type,
       profile_id AS participant_id, NULL::uuid AS inviter_id,
       NULL::text AS guest_display_name,
       committed_at AS sort_ts,
       ROW_NUMBER() OVER (PARTITION BY matchday_id ORDER BY committed_at) AS slot_order
FROM poll_votes
WHERE choice = 'yes' AND cancelled_at IS NULL
UNION ALL
SELECT matchday_id, 'guest'::text,
       NULL, inviter_id, display_name,
       created_at AS sort_ts,
       ROW_NUMBER() OVER (PARTITION BY matchday_id ORDER BY created_at) + 10000 AS slot_order
FROM match_guests
WHERE cancelled_at IS NULL;

-- Season standings (leaderboard)
CREATE VIEW v_season_standings AS
WITH played AS (
  SELECT m.season_id, mp.profile_id,
    COUNT(*) FILTER (WHERE m.result = 'win_white' AND mp.team = 'white') +
    COUNT(*) FILTER (WHERE m.result = 'win_black' AND mp.team = 'black')  AS wins,
    COUNT(*) FILTER (WHERE m.result = 'draw')                             AS draws,
    COUNT(*) FILTER (WHERE m.result = 'win_white' AND mp.team = 'black') +
    COUNT(*) FILTER (WHERE m.result = 'win_black' AND mp.team = 'white')  AS losses,
    COALESCE(SUM(mp.goals), 0)        AS goals,
    COALESCE(SUM(mp.yellow_cards), 0) AS yellows,
    COALESCE(SUM(mp.red_cards), 0)    AS reds,
    COUNT(*) FILTER (WHERE m.motm_user_id = mp.profile_id) AS motms
  FROM matches m
  JOIN match_players mp ON mp.match_id = m.id
  WHERE m.approved_at IS NOT NULL AND mp.profile_id IS NOT NULL
  GROUP BY m.season_id, mp.profile_id
),
penalties AS (
  SELECT md.season_id, pv.profile_id,
    SUM(CASE
          WHEN pv.cancelled_at IS NULL                                   THEN 0
          WHEN pv.cancelled_at > (md.kickoff_at - INTERVAL '24 hours')   THEN -1
          WHEN md.roster_locked_at IS NOT NULL
               AND pv.cancelled_at > md.roster_locked_at                 THEN -1
          ELSE 0
        END) AS late_cancel_points
  FROM poll_votes pv
  JOIN matchdays md ON md.id = pv.matchday_id
  WHERE pv.choice = 'yes'
  GROUP BY md.season_id, pv.profile_id
)
SELECT p.season_id, p.profile_id, pr.display_name,
       p.wins, p.draws, p.losses, p.goals, p.yellows, p.reds, p.motms,
       COALESCE(pen.late_cancel_points, 0) AS late_cancel_points,
       (p.wins * 3 + p.draws * 1 + COALESCE(pen.late_cancel_points, 0)) AS points
FROM played p
JOIN profiles pr ON pr.id = p.profile_id
LEFT JOIN penalties pen ON pen.season_id = p.season_id AND pen.profile_id = p.profile_id;

-- Last-5 form per player per season
CREATE VIEW v_player_last5 AS
WITH ranked AS (
  SELECT m.season_id, mp.profile_id, m.id AS match_id, md.kickoff_at,
    CASE
      WHEN m.result = 'draw' THEN 'D'
      WHEN (m.result = 'win_white' AND mp.team = 'white') OR
           (m.result = 'win_black' AND mp.team = 'black') THEN 'W'
      ELSE 'L'
    END AS outcome,
    ROW_NUMBER() OVER (
      PARTITION BY m.season_id, mp.profile_id ORDER BY md.kickoff_at DESC
    ) AS rn
  FROM matches m
  JOIN matchdays md ON md.id = m.matchday_id
  JOIN match_players mp ON mp.match_id = m.id
  WHERE m.approved_at IS NOT NULL AND mp.profile_id IS NOT NULL
)
SELECT season_id, profile_id, match_id, kickoff_at, outcome, rn
FROM ranked WHERE rn <= 5;

-- Captain eligibility (3 criteria per player)
CREATE VIEW v_captain_eligibility AS
WITH season_stats AS (
  SELECT s.season_id, s.profile_id,
         s.wins + s.draws + s.losses AS matches_played,
         s.points, s.motms
  FROM v_season_standings s
),
attendance AS (
  SELECT md.season_id, pv.profile_id,
         COUNT(*) FILTER (WHERE pv.choice = 'yes' AND pv.cancelled_at IS NULL) AS yes_votes,
         COUNT(*) AS total_votes
  FROM poll_votes pv
  JOIN matchdays md ON md.id = pv.matchday_id
  GROUP BY md.season_id, pv.profile_id
),
cooldown AS (
  SELECT m.season_id, mp.profile_id,
         MAX(md.kickoff_at) AS last_captained_at,
         COUNT(DISTINCT m2.matchday_id) AS matchdays_since_captained
  FROM matches m
  JOIN matchdays md ON md.id = m.matchday_id
  JOIN match_players mp ON mp.match_id = m.id AND mp.is_captain = true
  LEFT JOIN matches m2   ON m2.season_id = m.season_id
                         AND m2.matchday_id <> m.matchday_id
                         AND m2.approved_at IS NOT NULL
  LEFT JOIN matchdays md2 ON md2.id = m2.matchday_id
                           AND md2.kickoff_at > md.kickoff_at
  WHERE m.approved_at IS NOT NULL
  GROUP BY m.season_id, mp.profile_id
),
settings AS (
  SELECT
    COALESCE((value->>'captain_min_matches_this_season')::int, 5)    AS min_matches,
    COALESCE((value->>'captain_cooldown_matchdays')::int,      4)    AS cooldown,
    COALESCE((value->>'captain_min_attendance_rate')::float,  0.6)   AS min_attendance
  FROM app_settings WHERE key = 'match_settings'
)
SELECT ss.season_id, ss.profile_id, pr.display_name,
       ss.matches_played, ss.points, ss.motms,
       COALESCE(att.yes_votes::float / NULLIF(att.total_votes, 0), 0)  AS attendance_rate,
       COALESCE(cd.matchdays_since_captained, 999)                     AS matchdays_since_captained,
       (ss.matches_played >= s.min_matches)                                                         AS meets_min_matches,
       (COALESCE(att.yes_votes::float / NULLIF(att.total_votes, 0), 0) >= s.min_attendance)         AS meets_attendance,
       (COALESCE(cd.matchdays_since_captained, 999) >= s.cooldown)                                  AS cooldown_ok,
       (ss.matches_played >= s.min_matches
        AND COALESCE(att.yes_votes::float / NULLIF(att.total_votes, 0), 0) >= s.min_attendance
        AND COALESCE(cd.matchdays_since_captained, 999) >= s.cooldown)                              AS is_eligible
FROM season_stats ss
JOIN profiles pr    ON pr.id = ss.profile_id
LEFT JOIN attendance att ON att.season_id = ss.season_id AND att.profile_id = ss.profile_id
LEFT JOIN cooldown cd    ON cd.season_id = ss.season_id  AND cd.profile_id = ss.profile_id
CROSS JOIN settings s;
