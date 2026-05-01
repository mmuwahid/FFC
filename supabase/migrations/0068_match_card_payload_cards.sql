-- supabase/migrations/0068_match_card_payload_cards.sql
--
-- S063 — extend get_match_card_payload's per-team scorer lists with
-- yellow_cards and red_cards so the share PNG can show the same icon
-- cluster as the in-app match card (⚽ + 🟨 + 🟥 + ⭐).
--
-- Behavior change vs mig 0067:
--   - Source: match_players (per-player-per-actual-team) instead of
--     match_events filtered to {goal, own_goal}.
--   - own_goals are still derived from match_events.event_type='own_goal'
--     but joined to the SCORER (profile_id/guest_id) regardless of the
--     event's "benefiting team" tag. This places the unfortunate self-
--     scorer in their actual team's column with `(OG×N)` annotation —
--     more intuitive than the previous "credit to the benefiting team"
--     approach where Firas's own-goal made him appear in BLACK's list
--     while his actual team is WHITE.
--   - A player appears in the scorer list if they have ANY non-zero stat:
--     goals, own_goals, yellow_cards, or red_cards. Players with all
--     zeros stay off the card.
--   - Sort: (goals + own_goals) DESC, (yellow + red) DESC, name ASC.

CREATE OR REPLACE FUNCTION public.get_match_card_payload(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match           record;
  v_matchday        record;
  v_match_number    int;
  v_total_matches   int;
  v_season_name     text;
  v_kickoff_iso     text;
  v_kickoff_label   text;
  v_white_scorers   jsonb;
  v_black_scorers   jsonb;
  v_motm            jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT id, matchday_id, score_white, score_black, motm_user_id, motm_guest_id, approved_at
    INTO v_match
    FROM matches
   WHERE id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found' USING ERRCODE = '22023';
  END IF;

  IF v_match.approved_at IS NULL THEN
    RAISE EXCEPTION 'Match must be approved' USING ERRCODE = '22023';
  END IF;

  SELECT md.id, md.kickoff_at, md.season_id, md.is_friendly,
         s.name AS season_name, s.planned_games, s.games_seeded
    INTO v_matchday
    FROM matchdays md
    JOIN seasons s ON s.id = md.season_id
   WHERE md.id = v_match.matchday_id;

  v_season_name   := v_matchday.season_name;
  v_kickoff_iso   := v_matchday.kickoff_at::text;
  v_kickoff_label := to_char(
    v_matchday.kickoff_at AT TIME ZONE 'Asia/Dubai',
    'Dy, DD Mon YYYY'
  );

  SELECT COALESCE(v_matchday.games_seeded, 0) + COUNT(*)
    INTO v_match_number
    FROM matchdays md2
   WHERE md2.season_id = v_matchday.season_id
     AND md2.is_friendly = false
     AND (md2.kickoff_at, md2.id) <= (v_matchday.kickoff_at, v_matchday.id);

  v_total_matches := COALESCE(
    v_matchday.planned_games,
    (SELECT COUNT(*) FROM matchdays md3 WHERE md3.season_id = v_matchday.season_id AND md3.is_friendly = false)
  );

  WITH player_stats AS (
    SELECT
      mp.team,
      mp.profile_id,
      mp.guest_id,
      mp.goals,
      mp.yellow_cards,
      mp.red_cards
    FROM match_players mp
    WHERE mp.match_id = p_match_id
  ),
  own_goals AS (
    -- e.team is the benefiting team for an own_goal — we ignore it and
    -- match the scorer back to their actual match_players row.
    SELECT
      e.profile_id,
      e.guest_id,
      COUNT(*)::int AS own_goals
    FROM match_events e
    WHERE e.match_id = p_match_id
      AND e.event_type = 'own_goal'
    GROUP BY e.profile_id, e.guest_id
  ),
  combined AS (
    SELECT
      ps.team,
      ps.profile_id,
      ps.guest_id,
      ps.goals,
      COALESCE(og.own_goals, 0) AS own_goals,
      ps.yellow_cards,
      ps.red_cards
    FROM player_stats ps
    LEFT JOIN own_goals og
      ON  (ps.profile_id IS NOT NULL AND og.profile_id = ps.profile_id)
       OR (ps.guest_id   IS NOT NULL AND og.guest_id   = ps.guest_id)
  ),
  named AS (
    SELECT
      c.team,
      COALESCE(
        CASE WHEN p.deleted_at IS NOT NULL THEN 'Deleted player' ELSE p.display_name END,
        CASE WHEN mg.id IS NOT NULL THEN mg.display_name || ' (G)' END,
        'Guest'
      ) AS name,
      c.goals,
      c.own_goals,
      c.yellow_cards,
      c.red_cards
    FROM combined c
    LEFT JOIN profiles p     ON p.id  = c.profile_id
    LEFT JOIN match_guests mg ON mg.id = c.guest_id
    WHERE c.goals > 0 OR c.own_goals > 0 OR c.yellow_cards > 0 OR c.red_cards > 0
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'name', name,
      'goals', goals,
      'own_goals', own_goals,
      'yellow_cards', yellow_cards,
      'red_cards', red_cards
    ) ORDER BY (goals + own_goals) DESC,
              (yellow_cards + red_cards) DESC,
              name) FILTER (WHERE team = 'white'), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object(
      'name', name,
      'goals', goals,
      'own_goals', own_goals,
      'yellow_cards', yellow_cards,
      'red_cards', red_cards
    ) ORDER BY (goals + own_goals) DESC,
              (yellow_cards + red_cards) DESC,
              name) FILTER (WHERE team = 'black'), '[]'::jsonb)
    INTO v_white_scorers, v_black_scorers
  FROM named;

  IF v_match.motm_user_id IS NOT NULL THEN
    SELECT jsonb_build_object(
             'name',
             CASE WHEN p.deleted_at IS NOT NULL THEN 'Deleted player' ELSE p.display_name END,
             'is_guest', false
           )
      INTO v_motm
      FROM profiles p
     WHERE p.id = v_match.motm_user_id;
  ELSIF v_match.motm_guest_id IS NOT NULL THEN
    SELECT jsonb_build_object('name', mg.display_name, 'is_guest', true)
      INTO v_motm
      FROM match_guests mg
     WHERE mg.id = v_match.motm_guest_id;
  ELSE
    v_motm := NULL;
  END IF;

  RETURN jsonb_build_object(
    'season_name',    v_season_name,
    'match_number',   v_match_number,
    'total_matches',  v_total_matches,
    'kickoff_iso',    v_kickoff_iso,
    'kickoff_label',  v_kickoff_label,
    'score_white',    v_match.score_white,
    'score_black',    v_match.score_black,
    'white_scorers',  v_white_scorers,
    'black_scorers',  v_black_scorers,
    'motm',           v_motm
  );
END;
$$;
