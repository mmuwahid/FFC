-- ============================================================================
-- 0018_edit_match_players.sql
-- S026 Point 5 — Phase 2 seed
-- ----------------------------------------------------------------------------
-- edit_match_players — per-player stat correction on an already-approved match.
--   Admin-only, audited. Whitelist: goals, yellow_cards, red_cards,
--   is_no_show, is_captain, team.
--   - match_id must exist and be approved (approved_at IS NOT NULL).
--   - p_players is a jsonb array; each element addresses ONE match_players row
--     via either profile_id OR guest_id. Unknown rows are skipped (logged).
--   - Exactly one row per (match_id, profile_id) or (match_id, guest_id) is
--     mutated per element. No delete, no insert — use admin_submit_match_result
--     for roster (re)build.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.edit_match_players(
  p_match_id uuid,
  p_players  jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player           jsonb;
  v_profile_id       uuid;
  v_guest_id         uuid;
  v_before           jsonb;
  v_after            jsonb;
  v_match_exists     boolean;
  v_match_approved   timestamptz;
  v_updated_count    int := 0;
  v_skipped_count    int := 0;
  v_skipped_ids      jsonb := '[]'::jsonb;
  v_actor            uuid := public.current_profile_id();
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FFC_FORBIDDEN_NOT_ADMIN' USING ERRCODE = '42501';
  END IF;

  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'FFC_MATCH_ID_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- Validate target match exists + approved
  SELECT true, approved_at
    INTO v_match_exists, v_match_approved
    FROM public.matches
   WHERE id = p_match_id;

  IF NOT COALESCE(v_match_exists, false) THEN
    RAISE EXCEPTION 'FFC_MATCH_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_match_approved IS NULL THEN
    RAISE EXCEPTION 'FFC_EDIT_REQUIRES_APPROVED_MATCH' USING ERRCODE = '42501';
  END IF;

  IF p_players IS NULL OR jsonb_typeof(p_players) <> 'array' THEN
    RAISE EXCEPTION 'FFC_PLAYERS_MUST_BE_ARRAY' USING ERRCODE = '22023';
  END IF;

  -- Iterate
  FOR v_player IN SELECT value FROM jsonb_array_elements(p_players) LOOP
    v_profile_id := NULLIF(v_player ->> 'profile_id', '')::uuid;
    v_guest_id   := NULLIF(v_player ->> 'guest_id', '')::uuid;

    -- XOR enforcement matches match_players participant_xor CHECK
    IF (v_profile_id IS NULL AND v_guest_id IS NULL)
       OR (v_profile_id IS NOT NULL AND v_guest_id IS NOT NULL) THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped_ids := v_skipped_ids || to_jsonb(v_player);
      CONTINUE;
    END IF;

    -- Snapshot before
    SELECT to_jsonb(mp) INTO v_before
      FROM public.match_players mp
     WHERE mp.match_id = p_match_id
       AND ( (v_profile_id IS NOT NULL AND mp.profile_id = v_profile_id)
          OR (v_guest_id   IS NOT NULL AND mp.guest_id   = v_guest_id) );

    IF v_before IS NULL THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped_ids := v_skipped_ids || to_jsonb(v_player);
      CONTINUE;
    END IF;

    -- Patch — whitelist
    UPDATE public.match_players mp
       SET goals        = COALESCE((v_player ->> 'goals')::int, mp.goals),
           yellow_cards = COALESCE((v_player ->> 'yellow_cards')::int, mp.yellow_cards),
           red_cards    = COALESCE((v_player ->> 'red_cards')::int, mp.red_cards),
           is_no_show   = COALESCE((v_player ->> 'is_no_show')::boolean, mp.is_no_show),
           is_captain   = COALESCE((v_player ->> 'is_captain')::boolean, mp.is_captain),
           team         = COALESCE(NULLIF(v_player ->> 'team','')::public.team_color, mp.team),
           updated_at   = now(),
           updated_by   = v_actor
     WHERE mp.match_id = p_match_id
       AND ( (v_profile_id IS NOT NULL AND mp.profile_id = v_profile_id)
          OR (v_guest_id   IS NOT NULL AND mp.guest_id   = v_guest_id) )
     RETURNING to_jsonb(mp) INTO v_after;

    v_updated_count := v_updated_count + 1;

    -- Per-row audit
    PERFORM public.log_admin_action(
      'match_players',
      (v_after ->> 'id')::uuid,
      'edit_match_player',
      jsonb_build_object('before', v_before, 'after', v_after, 'match_id', p_match_id)
    );
  END LOOP;

  -- Summary audit (one row per call)
  PERFORM public.log_admin_action(
    'matches',
    p_match_id,
    'edit_match_players_batch',
    jsonb_build_object(
      'updated', v_updated_count,
      'skipped', v_skipped_count,
      'skipped_targets', v_skipped_ids
    )
  );

  RETURN jsonb_build_object(
    'match_id', p_match_id,
    'updated',  v_updated_count,
    'skipped',  v_skipped_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_match_players(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.edit_match_players IS
  'S026 · Admin-only patch of per-player match stats post-approval. Whitelist goals/yellow_cards/red_cards/is_no_show/is_captain/team. Matches must be approved. Skips unknown rows (does not insert). One row-level audit per update + one batch audit.';
