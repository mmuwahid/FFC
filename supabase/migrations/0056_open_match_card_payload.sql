-- 0056_open_match_card_payload.sql
-- S058 issue #25(a) — open get_match_card_payload to all authenticated users.
--
-- Background:
--   Migration 0049 introduced get_match_card_payload as an admin-only RPC for
--   the WhatsApp share PNG (V3.0:140). The match-card Edge Function calls it
--   under the caller's auth context; non-admins received "Admin role required"
--   (42501).
--
-- Why open it:
--   Issue #25(a) asks for the recent-matches detail sheet to show the share-card
--   PNG hero at the top — that requires every authenticated player to be able
--   to invoke the RPC. The PNG content (season name, match number, scores,
--   scorer names, MOTM) is identical to data already exposed to authenticated
--   readers via matches/match_players/profiles/match_guests, so opening this
--   RPC adds no new information disclosure.
--
-- Approach:
--   CREATE OR REPLACE keeps the same signature, drops the is_admin() guard.
--   GRANT EXECUTE TO authenticated already restricts to logged-in callers
--   (see migration 0049 line 151). REVOKE EXECUTE FROM PUBLIC also stays.

BEGIN;

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
  -- S058: dropped admin guard. Any authenticated caller may render their
  -- own match-card PNG. The data exposed here is identical to data already
  -- visible via matches / match_players / profiles / match_guests reads.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required' USING ERRCODE = '42501';
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
         s.name AS season_name, s.planned_games
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

  SELECT COUNT(*)
    INTO v_match_number
    FROM matchdays md2
   WHERE md2.season_id = v_matchday.season_id
     AND md2.is_friendly = false
     AND (md2.kickoff_at, md2.id) <= (v_matchday.kickoff_at, v_matchday.id);

  v_total_matches := COALESCE(
    v_matchday.planned_games,
    (SELECT COUNT(*) FROM matchdays md3 WHERE md3.season_id = v_matchday.season_id AND md3.is_friendly = false)
  );

  WITH grouped AS (
    SELECT
      e.team AS credit_team,
      e.profile_id,
      e.guest_id,
      SUM(CASE WHEN e.event_type = 'goal'     THEN 1 ELSE 0 END)::int AS goals,
      SUM(CASE WHEN e.event_type = 'own_goal' THEN 1 ELSE 0 END)::int AS own_goals
    FROM match_events e
    WHERE e.match_id = p_match_id
      AND e.event_type IN ('goal', 'own_goal')
    GROUP BY e.team, e.profile_id, e.guest_id
  ),
  named AS (
    SELECT
      g.credit_team,
      COALESCE(
        CASE WHEN p.deleted_at IS NOT NULL THEN 'Deleted player' ELSE p.display_name END,
        CASE WHEN mg.id IS NOT NULL THEN mg.display_name || ' (G)' END,
        'Guest'
      ) AS name,
      g.goals,
      g.own_goals
    FROM grouped g
    LEFT JOIN profiles p     ON p.id  = g.profile_id
    LEFT JOIN match_guests mg ON mg.id = g.guest_id
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object('name', name, 'goals', goals, 'own_goals', own_goals)
                       ORDER BY (goals + own_goals) DESC, name) FILTER (WHERE credit_team = 'white'), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object('name', name, 'goals', goals, 'own_goals', own_goals)
                       ORDER BY (goals + own_goals) DESC, name) FILTER (WHERE credit_team = 'black'), '[]'::jsonb)
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

COMMENT ON FUNCTION public.get_match_card_payload(uuid) IS
  'S058: open to any authenticated user. Returns the data payload for rendering
   a match-result share PNG. Aggregates goal + own_goal events into per-team
   scorer lists, resolves MOTM, formats kickoff in Asia/Dubai. Used by the
   render-match-card Edge Function.';

COMMIT;
