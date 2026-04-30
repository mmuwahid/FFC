-- 0060_admin_delete_matchday.sql
-- S058 follow-up — admin can delete an unplayed matchday created by mistake.
--
-- admin_delete_matchday(p_matchday_id) — hard-deletes a matchdays row.
--   FK cascade map (verified against 0003-0005):
--     ON DELETE CASCADE — match_guests, poll_votes, ref_tokens,
--                         pending_match_entries, draft_sessions
--                         (→ draft_picks cascades), formations
--     ON DELETE RESTRICT — matches  (this RPC refuses if a match exists;
--                          admin must run admin_delete_match first)
--
--   roster_assignments: no separate table — roster lives in match_players
--   under a draft `matches` row created by create_match_draft. So if the
--   admin saved a roster, a matches row exists and we route them to
--   admin_delete_match first. (Verified by inspection of
--   create_match_draft / admin_update_match_draft RPCs.)
--
--   Audit log entry is written BEFORE the destructive DELETE so the trail
--   survives even on rollback (matches the S034 / S049 / S054 / S055 /
--   S058 pattern in admin_delete_match).

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_delete_matchday(p_matchday_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id   uuid := public.current_profile_id();
  v_matchday   record;
  v_has_match  boolean;
  v_vote_count int;
  v_token_count int;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;
  IF p_matchday_id IS NULL THEN
    RAISE EXCEPTION 'p_matchday_id is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, season_id, kickoff_at, format, roster_locked_at
    INTO v_matchday
    FROM public.matchdays
   WHERE id = p_matchday_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Matchday % not found', p_matchday_id USING ERRCODE = 'P0002';
  END IF;

  -- Block deletion if a `matches` row exists (FK is RESTRICT — DELETE would
  -- error anyway, but we want a clear, actionable error message). Covers
  -- both draft matches (no result) and approved matches.
  SELECT EXISTS (SELECT 1 FROM public.matches WHERE matchday_id = p_matchday_id)
    INTO v_has_match;

  IF v_has_match THEN
    RAISE EXCEPTION 'matchday_has_match_use_admin_delete_match'
      USING HINT = 'Delete the match record first via admin_delete_match.',
            ERRCODE = '23503';
  END IF;

  -- Capture cascade impact for the audit payload (informational; cascades
  -- happen automatically on DELETE).
  SELECT COUNT(*) INTO v_vote_count
    FROM public.poll_votes WHERE matchday_id = p_matchday_id;
  SELECT COUNT(*) INTO v_token_count
    FROM public.ref_tokens WHERE matchday_id = p_matchday_id;

  -- Audit BEFORE the destructive op (S034 / S049 / S054 / S055 / S058
  -- pattern — trail survives any partial failure / rollback).
  INSERT INTO public.admin_audit_log
    (admin_profile_id, target_entity, target_id, action, payload_jsonb)
  VALUES
    (v_admin_id, 'matchdays', p_matchday_id, 'admin_delete_matchday',
     jsonb_build_object(
       'season_id',        v_matchday.season_id,
       'kickoff_at',       v_matchday.kickoff_at,
       'format',           v_matchday.format,
       'roster_locked_at', v_matchday.roster_locked_at,
       'cascaded_poll_votes',  v_vote_count,
       'cascaded_ref_tokens',  v_token_count
     ));

  -- Hard-delete the matchday. Cascades handle poll_votes, ref_tokens,
  -- pending_match_entries, draft_sessions (+ draft_picks), formations,
  -- match_guests.
  DELETE FROM public.matchdays WHERE id = p_matchday_id;

  -- No rank snapshot needed: with no matches row, there's no leaderboard
  -- impact (v_season_standings only counts approved matches).
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_delete_matchday(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_delete_matchday(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_delete_matchday(uuid) IS
  'Admin-only. Hard-deletes an unplayed matchday and its cascaded children
   (poll_votes, ref_tokens, pending_match_entries, draft_sessions,
   formations, match_guests). Refuses if a matches row exists — admin must
   run admin_delete_match first. Audited before the destructive op so the
   trail survives rollback.';

COMMIT;
