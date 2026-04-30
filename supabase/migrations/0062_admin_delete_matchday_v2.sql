-- 0062_admin_delete_matchday_v2.sql
-- Fix for 0061: saving a roster via AdminRosterSetup calls create_match_draft,
-- which inserts an unapproved `matches` row. The original 0061 RPC refused
-- to delete the matchday in that case ("matchday_has_match_use_admin_delete_match"),
-- which was confusing — admin's mental model is "Delete matchday = nuke
-- everything attached to it".
--
-- New behaviour: if the attached match is UNAPPROVED (approved_at IS NULL),
-- clear it as part of the delete (match_players + match_events cascade,
-- payment_windows + match_payment_records cleared explicitly per
-- admin_delete_match's pattern even though they're empty for draft matches).
-- Only refuse if an APPROVED match exists — those should go through
-- admin_delete_match first to surface a more specific confirm flow.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_delete_matchday(p_matchday_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id     uuid := public.current_profile_id();
  v_matchday     record;
  v_match_id     uuid;
  v_match_appr   timestamptz;
  v_vote_count   int;
  v_token_count  int;
  v_had_match    boolean := false;
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

  -- Detect attached match. matches has only one row per matchday in current
  -- product flow, but use LIMIT 1 + ORDER BY for safety.
  SELECT id, approved_at
    INTO v_match_id, v_match_appr
    FROM public.matches
   WHERE matchday_id = p_matchday_id
   ORDER BY approved_at NULLS LAST, id
   LIMIT 1;

  IF v_match_id IS NOT NULL THEN
    v_had_match := true;
    IF v_match_appr IS NOT NULL THEN
      RAISE EXCEPTION 'matchday_has_approved_match_use_admin_delete_match'
        USING HINT = 'This matchday has an APPROVED result. Delete the match first via Admin → Matches → Delete match.',
              ERRCODE = '23503';
    END IF;
  END IF;

  -- Capture cascade impact for the audit payload.
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
       'season_id',           v_matchday.season_id,
       'kickoff_at',           v_matchday.kickoff_at,
       'format',               v_matchday.format,
       'roster_locked_at',     v_matchday.roster_locked_at,
       'cascaded_poll_votes',  v_vote_count,
       'cascaded_ref_tokens',  v_token_count,
       'had_draft_match',      v_had_match,
       'draft_match_id',       v_match_id
     ));

  -- If a draft (unapproved) match is attached, delete it first. matches has
  -- ON DELETE RESTRICT FK to matchdays, so we can't rely on cascade here —
  -- must DELETE FROM matches before DELETE FROM matchdays.
  IF v_match_id IS NOT NULL THEN
    -- Mirror admin_delete_match's payment cleanup (NO ACTION FK on those
    -- tables would otherwise block the matches DELETE). Empty for draft
    -- matches but kept defensive in case shape evolves.
    DELETE FROM public.match_payment_records WHERE match_id = v_match_id;
    DELETE FROM public.payment_windows       WHERE match_id = v_match_id;
    -- match_players + match_events cascade on matches delete.
    DELETE FROM public.matches WHERE id = v_match_id;
  END IF;

  -- Hard-delete the matchday. Cascades handle poll_votes, ref_tokens,
  -- pending_match_entries, draft_sessions (+ draft_picks), formations,
  -- match_guests.
  DELETE FROM public.matchdays WHERE id = p_matchday_id;

  -- No rank snapshot needed: the deleted match was unapproved (or absent),
  -- so v_season_standings was unaffected.
END;
$$;

COMMENT ON FUNCTION public.admin_delete_matchday(uuid) IS
  'Admin-only. Hard-deletes a matchday and any UNAPPROVED draft match
   attached to it (cascades match_players, match_events, poll_votes,
   ref_tokens, pending_match_entries, draft_sessions, formations,
   match_guests). Refuses if an APPROVED matches row exists — admin
   should run admin_delete_match first. Audited before the destructive
   op so the trail survives rollback.';

COMMIT;
