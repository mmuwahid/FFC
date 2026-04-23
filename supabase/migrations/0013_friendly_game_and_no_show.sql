-- supabase/migrations/0013_friendly_game_and_no_show.sql
-- Friendly game flagging + no-show penalties (spec: 2026-04-23)

-- ── 1. Schema changes ──────────────────────────────────────────────────────

ALTER TABLE matchdays
  ADD COLUMN friendly_flagged_at TIMESTAMPTZ,
  ADD COLUMN is_friendly         BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE match_players
  ADD COLUMN is_no_show BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Extend match_settings with no-show penalty values ───────────────────

UPDATE app_settings
SET value = value || '{
  "no_show_penalty_points": -2,
  "no_show_ban_days":       14
}'::jsonb
WHERE key = 'match_settings';

-- ── 3. Auto-flag trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION check_friendly_threshold()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_guest_count INT;
  v_format      match_format;
  v_threshold   INT;
BEGIN
  SELECT COUNT(*) INTO v_guest_count
  FROM match_guests
  WHERE matchday_id = NEW.matchday_id AND cancelled_at IS NULL;

  v_format    := effective_format(NEW.matchday_id);
  v_threshold := CASE WHEN v_format = '5v5' THEN 3 ELSE 4 END;

  IF v_guest_count >= v_threshold THEN
    UPDATE matchdays
    SET friendly_flagged_at = NOW()
    WHERE id = NEW.matchday_id
      AND friendly_flagged_at IS NULL
      AND NOT is_friendly;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_friendly_threshold
AFTER INSERT ON match_guests
FOR EACH ROW EXECUTE FUNCTION check_friendly_threshold();

-- ── 4. Admin RPCs ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION confirm_friendly_matchday(p_matchday_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE matchdays SET is_friendly = true WHERE id = p_matchday_id;
  PERFORM log_admin_action('matchday', p_matchday_id, 'confirm_friendly', '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION dismiss_friendly_flag(p_matchday_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE matchdays
  SET friendly_flagged_at = NULL, is_friendly = false
  WHERE id = p_matchday_id;
  PERFORM log_admin_action('matchday', p_matchday_id, 'dismiss_friendly', '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION record_no_shows(p_match_id UUID, p_profile_ids UUID[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_kickoff_at TIMESTAMPTZ;
  v_admin_id   UUID;
  v_pid        UUID;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  v_admin_id := current_profile_id();

  SELECT md.kickoff_at INTO v_kickoff_at
  FROM matches m
  JOIN matchdays md ON md.id = m.matchday_id
  WHERE m.id = p_match_id;

  UPDATE match_players
  SET is_no_show = true
  WHERE match_id = p_match_id AND profile_id = ANY(p_profile_ids);

  FOREACH v_pid IN ARRAY p_profile_ids LOOP
    INSERT INTO player_bans (profile_id, starts_at, ends_at, reason, imposed_by)
    SELECT v_pid,
           v_kickoff_at,
           v_kickoff_at + INTERVAL '14 days',
           'no_show',
           v_admin_id
    WHERE NOT EXISTS (
      SELECT 1 FROM player_bans
      WHERE profile_id = v_pid AND reason = 'no_show' AND starts_at = v_kickoff_at
    );
  END LOOP;

  PERFORM log_admin_action('match', p_match_id, 'record_no_shows',
    jsonb_build_object('profile_ids', p_profile_ids));
END;
$$;

-- ── 5. Grant RPCs (required per 0012 DEFAULT PRIVILEGES pattern) ───────────

GRANT EXECUTE ON FUNCTION confirm_friendly_matchday(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION dismiss_friendly_flag(UUID)       TO authenticated;
GRANT EXECUTE ON FUNCTION record_no_shows(UUID, UUID[])     TO authenticated;
-- check_friendly_threshold is a trigger function — no GRANT needed.

-- ── 6. Recreate views (drop dependents first) ──────────────────────────────

DROP VIEW IF EXISTS v_captain_eligibility;
DROP VIEW IF EXISTS v_player_last5;
DROP VIEW IF EXISTS v_season_standings;

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
  JOIN matchdays md ON md.id = m.matchday_id
  JOIN match_players mp ON mp.match_id = m.id
  WHERE m.approved_at IS NOT NULL AND mp.profile_id IS NOT NULL AND NOT md.is_friendly
  GROUP BY m.season_id, mp.profile_id
),
penalties AS (
  SELECT md.season_id, pv.profile_id,
    SUM(CASE
          WHEN pv.cancelled_at IS NULL                                  THEN 0
          WHEN pv.cancelled_at > (md.kickoff_at - INTERVAL '24 hours') THEN -1
          WHEN md.roster_locked_at IS NOT NULL
               AND pv.cancelled_at > md.roster_locked_at               THEN -1
          ELSE 0
        END) AS late_cancel_points
  FROM poll_votes pv
  JOIN matchdays md ON md.id = pv.matchday_id
  WHERE pv.choice = 'yes' AND NOT md.is_friendly
  GROUP BY md.season_id, pv.profile_id
),
no_show_penalties AS (
  SELECT md.season_id, mp.profile_id,
    SUM(CASE WHEN mp.is_no_show THEN -2 ELSE 0 END) AS no_show_points
  FROM match_players mp
  JOIN matches m  ON m.id  = mp.match_id
  JOIN matchdays md ON md.id = m.matchday_id
  WHERE m.approved_at IS NOT NULL AND mp.profile_id IS NOT NULL AND NOT md.is_friendly
  GROUP BY md.season_id, mp.profile_id
)
SELECT p.season_id, p.profile_id, pr.display_name,
       p.wins, p.draws, p.losses, p.goals, p.yellows, p.reds, p.motms,
       COALESCE(pen.late_cancel_points, 0) AS late_cancel_points,
       COALESCE(nsp.no_show_points, 0)     AS no_show_points,
       (p.wins * 3 + p.draws * 1
        + COALESCE(pen.late_cancel_points, 0)
        + COALESCE(nsp.no_show_points, 0)) AS points
FROM played p
JOIN profiles pr ON pr.id = p.profile_id
LEFT JOIN penalties         pen ON pen.season_id = p.season_id AND pen.profile_id = p.profile_id
LEFT JOIN no_show_penalties nsp ON nsp.season_id = p.season_id AND nsp.profile_id = p.profile_id;

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
  WHERE m.approved_at IS NOT NULL AND mp.profile_id IS NOT NULL AND NOT md.is_friendly
)
SELECT season_id, profile_id, match_id, kickoff_at, outcome, rn
FROM ranked WHERE rn <= 5;

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
    COALESCE((value->>'captain_min_matches_this_season')::int,  5)   AS min_matches,
    COALESCE((value->>'captain_cooldown_matchdays')::int,       4)   AS cooldown,
    COALESCE((value->>'captain_min_attendance_rate')::float,  0.6)   AS min_attendance
  FROM app_settings WHERE key = 'match_settings'
)
SELECT ss.season_id, ss.profile_id, pr.display_name,
       ss.matches_played, ss.points, ss.motms,
       COALESCE(att.yes_votes::float / NULLIF(att.total_votes, 0), 0) AS attendance_rate,
       COALESCE(cd.matchdays_since_captained, 999)                    AS matchdays_since_captained,
       (ss.matches_played >= s.min_matches)                                                        AS meets_min_matches,
       (COALESCE(att.yes_votes::float / NULLIF(att.total_votes, 0), 0) >= s.min_attendance)        AS meets_attendance,
       (COALESCE(cd.matchdays_since_captained, 999) >= s.cooldown)                                 AS cooldown_ok,
       (ss.matches_played >= s.min_matches
        AND COALESCE(att.yes_votes::float / NULLIF(att.total_votes, 0), 0) >= s.min_attendance
        AND COALESCE(cd.matchdays_since_captained, 999) >= s.cooldown)                             AS is_eligible
FROM season_stats ss
JOIN profiles pr    ON pr.id = ss.profile_id
LEFT JOIN attendance att ON att.season_id = ss.season_id AND att.profile_id = ss.profile_id
LEFT JOIN cooldown   cd  ON cd.season_id  = ss.season_id AND cd.profile_id  = ss.profile_id
CROSS JOIN settings s;
