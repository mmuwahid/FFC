-- 0059_admin_match_management.sql
-- S058 issue #21 — admin match management:
--
-- (1) admin_delete_match(p_match_id) — hard-delete a match record.
--     Cascades match_players + match_events via FK ON DELETE CASCADE.
--     Explicitly clears match_payment_records + payment_windows first
--     (their FKs do NOT cascade — payments shouldn't disappear silently).
--     Recomputes leaderboard implicitly (v_season_standings is a view) and
--     calls snapshot_and_diff_ranks so affected players get ranking_changed
--     notifications.
--
-- (2) admin_edit_match_roster(p_match_id, p_players jsonb) — replaces the
--     match_players roster for an approved match. Use case: "we forgot to
--     mark Sami as having played." Validates roster_cap × 2 (14 for 7v7,
--     10 for 5v5) so admins can't ship a malformed match.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- (1) admin_delete_match
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_delete_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id    uuid := public.current_profile_id();
  v_match       record;
  v_player_count int;
  v_payment_count int;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'p_match_id is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, season_id, matchday_id, score_white, score_black, result, approved_at
    INTO v_match
    FROM public.matches
   WHERE id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match % not found', p_match_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*) INTO v_player_count
    FROM public.match_players WHERE match_id = p_match_id;

  -- Audit BEFORE the destructive ops (S034 / S049 / S054 / S055 pattern —
  -- so the trail survives any partial failure / rollback).
  INSERT INTO public.admin_audit_log
    (admin_profile_id, target_entity, target_id, action, payload_jsonb)
  VALUES
    (v_admin_id, 'matches', p_match_id, 'admin_delete_match',
     jsonb_build_object(
       'season_id',   v_match.season_id,
       'matchday_id', v_match.matchday_id,
       'score_white', v_match.score_white,
       'score_black', v_match.score_black,
       'result',      v_match.result,
       'approved_at', v_match.approved_at,
       'player_count', v_player_count
     ));

  -- Clear payment FKs first (NO ACTION cascade — would block the DELETE
  -- otherwise). Treating payments as "match no longer exists ⇒ payment
  -- record orphaned" rather than auto-cascading; admin can re-attach if
  -- they recreate the match.
  DELETE FROM public.match_payment_records WHERE match_id = p_match_id;
  DELETE FROM public.payment_windows       WHERE match_id = p_match_id;
  GET DIAGNOSTICS v_payment_count = ROW_COUNT;

  -- Hard-delete the match. CASCADE on match_players + match_events handles
  -- per-player stats + event log. matchdays row is intentionally preserved
  -- (it's a separate concept — admin can submit a new result against the
  -- same matchday).
  DELETE FROM public.matches WHERE id = p_match_id;

  -- Recompute snapshot for the season so ranking_changed notifications fire
  -- for any player whose rank actually moved due to the deletion. The
  -- v_season_standings view is computed-on-read, so it already reflects the
  -- new state — only the snapshot table needed a manual refresh.
  PERFORM public.snapshot_and_diff_ranks(v_match.season_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_delete_match(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_delete_match(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_delete_match(uuid) IS
  'Admin-only. Hard-deletes a match (cascades match_players + match_events,
   explicitly clears payment_windows + match_payment_records). Re-snapshots
   ranks so affected players get ranking_changed notifications. Matchday row
   is preserved.';

-- ─────────────────────────────────────────────────────────────────────────
-- (2) admin_edit_match_roster
-- ─────────────────────────────────────────────────────────────────────────
-- Input shape: p_players is a jsonb array of objects. Each element:
--   { profile_id?: uuid, guest_id?: uuid, team: 'white'|'black',
--     is_captain?: boolean, goals?: int, yellow_cards?: int,
--     red_cards?: int, is_no_show?: boolean }
-- Exactly one of profile_id / guest_id must be set per row. Replaces the
-- entire roster — existing match_players rows for this match are deleted
-- and re-inserted from the input.

CREATE OR REPLACE FUNCTION public.admin_edit_match_roster(
  p_match_id uuid,
  p_players  jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id   uuid := public.current_profile_id();
  v_match      record;
  v_format     match_format;
  v_cap        int;
  v_total      int;
  v_white      int;
  v_black      int;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'p_match_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_players IS NULL OR jsonb_typeof(p_players) <> 'array' THEN
    RAISE EXCEPTION 'p_players must be a jsonb array' USING ERRCODE = '22023';
  END IF;

  SELECT m.id, m.matchday_id, md.format, md.season_id
    INTO v_match
    FROM public.matches m
    JOIN public.matchdays md ON md.id = m.matchday_id
   WHERE m.id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match % not found', p_match_id USING ERRCODE = 'P0002';
  END IF;

  v_format := COALESCE(v_match.format, '7v7'::match_format);
  v_cap    := public.roster_cap(v_format) / 2;  -- per-team cap (7 or 5)

  -- Validate roster sizes per team. Total cap = roster_cap (14 or 10).
  SELECT COUNT(*) FILTER (WHERE elem->>'team' = 'white'),
         COUNT(*) FILTER (WHERE elem->>'team' = 'black'),
         COUNT(*)
    INTO v_white, v_black, v_total
    FROM jsonb_array_elements(p_players) elem;

  IF v_white > v_cap OR v_black > v_cap THEN
    RAISE EXCEPTION 'Each team capped at % players for %', v_cap, v_format
      USING ERRCODE = '23514';
  END IF;

  -- Validate exactly one of profile_id / guest_id is set per row.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_players) elem
    WHERE (elem ? 'profile_id') = (elem ? 'guest_id')  -- both set or both missing
       OR (elem->>'profile_id' IS NULL AND elem->>'guest_id' IS NULL)
  ) THEN
    RAISE EXCEPTION 'Each roster row must have exactly one of profile_id or guest_id'
      USING ERRCODE = '22023';
  END IF;

  -- Replace strategy: delete existing roster, insert new. Atomic in tx.
  DELETE FROM public.match_players WHERE match_id = p_match_id;

  INSERT INTO public.match_players (
    match_id, profile_id, guest_id, team, is_captain,
    goals, yellow_cards, red_cards, is_no_show, updated_by, updated_at
  )
  SELECT
    p_match_id,
    NULLIF(elem->>'profile_id', '')::uuid,
    NULLIF(elem->>'guest_id', '')::uuid,
    (elem->>'team')::team_color,
    COALESCE((elem->>'is_captain')::boolean, false),
    COALESCE((elem->>'goals')::int, 0),
    COALESCE((elem->>'yellow_cards')::int, 0),
    COALESCE((elem->>'red_cards')::int, 0),
    COALESCE((elem->>'is_no_show')::boolean, false),
    v_admin_id,
    now()
  FROM jsonb_array_elements(p_players) elem;

  -- Audit AFTER (unlike delete-flow): the roster IS the audit-worthy state,
  -- recording it before we have it would just reflect the prior state.
  INSERT INTO public.admin_audit_log
    (admin_profile_id, target_entity, target_id, action, payload_jsonb)
  VALUES
    (v_admin_id, 'matches', p_match_id, 'admin_edit_match_roster',
     jsonb_build_object(
       'matchday_id', v_match.matchday_id,
       'format',      v_format,
       'white_count', v_white,
       'black_count', v_black,
       'total',       v_total
     ));

  -- Re-snapshot ranks because roster changes shift the leaderboard. Same
  -- pattern as admin_delete_match.
  PERFORM public.snapshot_and_diff_ranks(v_match.season_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_edit_match_roster(uuid, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_edit_match_roster(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.admin_edit_match_roster(uuid, jsonb) IS
  'Admin-only. Replaces the match_players roster for an approved match.
   Validates per-team cap (roster_cap/2) and that each row has exactly one
   of profile_id/guest_id. Re-snapshots ranks so leaderboard reflects new
   reality.';

COMMIT;
