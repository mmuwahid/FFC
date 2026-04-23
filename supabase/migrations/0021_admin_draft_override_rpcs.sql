-- 0021_admin_draft_override_rpcs.sql
--
-- §3.18 Phase 5.5 — admin override RPCs for stuck/abandoned draft sessions.
-- Unblocks the two disabled buttons on DraftInProgressCard (AdminMatches.tsx).
--
-- admin_draft_abandon(p_matchday_id, p_reason)
--   Flips the in-progress draft to 'abandoned' status so admins can restart
--   via a fresh captain-draft flow. Intentionally leaves match_players and
--   draft_picks intact for audit — a separate reset flow (or manual cleanup)
--   handles data realignment if needed.
--
-- admin_draft_force_complete(p_matchday_id)
--   Auto-distributes any remaining unpicked participants by alternating
--   teams starting from current_picker_team, then flips status to 'completed'.
--   "Unpicked" = match_players row whose (profile_id, guest_id) pair has no
--   matching draft_picks row for this session. For each unpicked row we
--   INSERT a draft_picks row (continuing pick_order) and UPDATE the
--   match_players.team to the assigned colour, mirroring submit_draft_pick
--   exactly. Status flips to 'completed' at the end.
--
-- Both are admin-only, SECURITY DEFINER, and audited via log_admin_action.
-- Error codes raised:
--   FFC_NO_ACTIVE_DRAFT         — no in_progress draft for the matchday
--   FFC_NO_MATCH_FOR_DRAFT      — draft exists but its matches row is missing
--   FFC_ALREADY_AT_CAP          — force-complete called but picks already == cap
--     (caller can use abandon instead or verify the draft completed on its own)

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_draft_abandon(
  p_matchday_id uuid,
  p_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin   uuid;
  v_draft   draft_sessions%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_admin := public.current_profile_id();

  SELECT * INTO v_draft
    FROM public.draft_sessions
   WHERE matchday_id = p_matchday_id
     AND status = 'in_progress'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No in-progress draft for matchday' USING ERRCODE = 'P0002', CONSTRAINT = 'FFC_NO_ACTIVE_DRAFT';
  END IF;

  UPDATE public.draft_sessions
     SET status = 'abandoned',
         completed_at = now()
   WHERE id = v_draft.id;

  PERFORM public.log_admin_action(
    'draft_sessions',
    v_draft.id,
    'admin_draft_abandon',
    jsonb_build_object(
      'matchday_id', p_matchday_id,
      'reason', p_reason,
      'started_at', v_draft.started_at,
      'elapsed_seconds', EXTRACT(EPOCH FROM (now() - v_draft.started_at))::int
    )
  );

  RETURN v_draft.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_draft_force_complete(
  p_matchday_id uuid,
  p_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin      uuid;
  v_draft      draft_sessions%ROWTYPE;
  v_match_id   uuid;
  v_cap        int;
  v_pick_order int;
  v_current    public.team_color;
  v_auto_count int := 0;
  r            record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_admin := public.current_profile_id();

  SELECT * INTO v_draft
    FROM public.draft_sessions
   WHERE matchday_id = p_matchday_id
     AND status = 'in_progress'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No in-progress draft for matchday' USING ERRCODE = 'P0002', CONSTRAINT = 'FFC_NO_ACTIVE_DRAFT';
  END IF;

  SELECT m.id INTO v_match_id
    FROM public.matches m
   WHERE m.matchday_id = p_matchday_id;
  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'No matches row for draft matchday' USING ERRCODE = 'P0002', CONSTRAINT = 'FFC_NO_MATCH_FOR_DRAFT';
  END IF;

  v_cap := public.roster_cap(public.effective_format(p_matchday_id));
  SELECT COALESCE(MAX(pick_order), 0) INTO v_pick_order
    FROM public.draft_picks WHERE draft_session_id = v_draft.id;

  IF v_pick_order >= v_cap THEN
    RAISE EXCEPTION 'Draft already at cap — use abandon or await auto-completion'
      USING ERRCODE = '22023', CONSTRAINT = 'FFC_ALREADY_AT_CAP';
  END IF;

  v_current := v_draft.current_picker_team;

  -- Iterate over match_players for this match that don't yet have a
  -- matching draft_picks row. Ordering by created_at keeps the auto-pick
  -- sequence deterministic so re-running on the same state yields the same
  -- team split (important for audit reproducibility).
  FOR r IN
    SELECT mp.profile_id, mp.guest_id
      FROM public.match_players mp
     WHERE mp.match_id = v_match_id
       AND NOT EXISTS (
         SELECT 1 FROM public.draft_picks dp
          WHERE dp.draft_session_id = v_draft.id
            AND (
              (dp.profile_id IS NOT NULL AND dp.profile_id = mp.profile_id) OR
              (dp.guest_id   IS NOT NULL AND dp.guest_id   = mp.guest_id)
            )
       )
     ORDER BY mp.created_at, mp.profile_id NULLS LAST, mp.guest_id NULLS LAST
  LOOP
    v_pick_order := v_pick_order + 1;
    v_auto_count := v_auto_count + 1;

    INSERT INTO public.draft_picks (draft_session_id, pick_order, team, profile_id, guest_id)
    VALUES (v_draft.id, v_pick_order, v_current, r.profile_id, r.guest_id);

    IF r.profile_id IS NOT NULL THEN
      UPDATE public.match_players
         SET team = v_current, updated_at = now(), updated_by = v_admin
       WHERE match_id = v_match_id AND profile_id = r.profile_id;
    ELSIF r.guest_id IS NOT NULL THEN
      UPDATE public.match_players
         SET team = v_current, updated_at = now(), updated_by = v_admin
       WHERE match_id = v_match_id AND guest_id = r.guest_id;
    END IF;

    v_current := CASE WHEN v_current = 'white' THEN 'black'::public.team_color ELSE 'white'::public.team_color END;
    EXIT WHEN v_pick_order >= v_cap;
  END LOOP;

  UPDATE public.draft_sessions
     SET status = 'completed',
         completed_at = now(),
         current_picker_team = v_current
   WHERE id = v_draft.id;

  PERFORM public.log_admin_action(
    'draft_sessions',
    v_draft.id,
    'admin_draft_force_complete',
    jsonb_build_object(
      'matchday_id', p_matchday_id,
      'reason', p_reason,
      'auto_distributed', v_auto_count,
      'final_pick_count', v_pick_order,
      'cap', v_cap,
      'started_at', v_draft.started_at,
      'elapsed_seconds', EXTRACT(EPOCH FROM (now() - v_draft.started_at))::int
    )
  );

  RETURN v_draft.id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.admin_draft_abandon(uuid, text),
  public.admin_draft_force_complete(uuid, text)
TO authenticated;

COMMIT;
