-- ============================================================================
-- 0017_guest_friendly_flag.sql
-- S026 Point 2 — §3.5 +1 guest auto-flag trigger
-- ----------------------------------------------------------------------------
-- When the active guest count on a matchday crosses a configurable threshold,
-- auto-stamp `matchdays.friendly_flagged_at` so the §3.18 admin review card
-- surfaces it. Admin can then Confirm (→ is_friendly=true, excluded from
-- v_season_standings) or Dismiss (→ flag cleared).
--
-- Thresholds (per S025 close, current FFC practice):
--   7v7 matchdays: 4+ guests ⇒ friendly
--   5v5 matchdays: 3+ guests ⇒ friendly
--
-- Stored under app_settings.guest_friendly_thresholds so admin can tune
-- without a redeploy (same pattern as match_settings).
-- ============================================================================

-- 1. Settings row (idempotent)
INSERT INTO public.app_settings (key, value, description, updated_by)
VALUES (
  'guest_friendly_thresholds',
  jsonb_build_object(
    '7v7', 4,
    '5v5', 3
  ),
  'Guest-count thresholds that auto-flag a matchday for admin friendly-review. Keys match the match_format enum literals.',
  NULL
)
ON CONFLICT (key) DO NOTHING;

-- 2. Trigger function — runs after guest rows change
CREATE OR REPLACE FUNCTION public.match_guests_friendly_flag_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_matchday_id uuid;
  v_already_flagged timestamptz;
  v_confirmed boolean;
  v_format public.match_format;
  v_threshold int;
  v_thresholds jsonb;
  v_guest_count int;
BEGIN
  -- Handle INSERT (new guest) and UPDATE (re-activation via cancelled_at NULL)
  v_matchday_id := COALESCE(NEW.matchday_id, OLD.matchday_id);

  -- Short-circuit: already flagged or already confirmed as friendly
  SELECT friendly_flagged_at, is_friendly
    INTO v_already_flagged, v_confirmed
    FROM public.matchdays
   WHERE id = v_matchday_id;

  IF v_already_flagged IS NOT NULL OR COALESCE(v_confirmed, false) THEN
    RETURN NEW;
  END IF;

  -- Active guest count for this matchday
  SELECT count(*)::int
    INTO v_guest_count
    FROM public.match_guests
   WHERE matchday_id = v_matchday_id
     AND cancelled_at IS NULL;

  -- Resolve effective format (NULL on matchday → season default)
  v_format := public.effective_format(v_matchday_id);

  -- Threshold lookup
  SELECT value
    INTO v_thresholds
    FROM public.app_settings
   WHERE key = 'guest_friendly_thresholds';

  v_threshold := COALESCE(
    (v_thresholds ->> v_format::text)::int,
    CASE v_format::text WHEN '7v7' THEN 4 WHEN '5v5' THEN 3 ELSE 4 END
  );

  -- Flag if threshold reached
  IF v_guest_count >= v_threshold THEN
    UPDATE public.matchdays
       SET friendly_flagged_at = now()
     WHERE id = v_matchday_id
       AND friendly_flagged_at IS NULL
       AND COALESCE(is_friendly, false) = false;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Wire trigger (drop+create for re-run safety)
DROP TRIGGER IF EXISTS trg_match_guests_friendly_flag ON public.match_guests;

CREATE TRIGGER trg_match_guests_friendly_flag
  AFTER INSERT OR UPDATE OF cancelled_at ON public.match_guests
  FOR EACH ROW
  EXECUTE FUNCTION public.match_guests_friendly_flag_trg();

COMMENT ON FUNCTION public.match_guests_friendly_flag_trg IS
  'S026 · §3.5 auto-flag: stamps matchdays.friendly_flagged_at when active guest count on the matchday reaches app_settings.guest_friendly_thresholds[effective_format]. Short-circuits on already-flagged or already-confirmed matchdays. Idempotent. Does not mutate is_friendly — admin confirms via the §3.18 review card.';
