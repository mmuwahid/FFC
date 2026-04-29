-- supabase/migrations/0055_payment_tracker.sql

-- ── 1. match_payment_records ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_payment_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid NOT NULL REFERENCES matches(id),
  profile_id     uuid REFERENCES profiles(id),
  guest_id       uuid REFERENCES match_guests(id),
  amount_aed     integer NOT NULL DEFAULT 60,
  paid_at        timestamptz,
  marked_paid_by uuid REFERENCES profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_record_one_subject CHECK (
    (profile_id IS NOT NULL AND guest_id IS NULL)
    OR
    (profile_id IS NULL     AND guest_id IS NOT NULL)
  )
);

-- Partial unique indexes handle nullable uniqueness correctly in Postgres
CREATE UNIQUE INDEX IF NOT EXISTS payment_record_unique_player
  ON match_payment_records (match_id, profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_record_unique_guest
  ON match_payment_records (match_id, guest_id)   WHERE guest_id  IS NOT NULL;

ALTER TABLE match_payment_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all" ON match_payment_records
  FOR SELECT TO authenticated USING (true);

-- ── 2. payment_windows ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_windows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid NOT NULL UNIQUE REFERENCES matches(id),
  opened_at   timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz,
  closed_by   uuid REFERENCES profiles(id),
  auto_closed boolean NOT NULL DEFAULT false
);

ALTER TABLE payment_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all" ON payment_windows
  FOR SELECT TO authenticated USING (true);

-- ── 3. app_settings fee row ──────────────────────────────────────────────────
INSERT INTO app_settings (key, value, description)
VALUES (
  'payment_fee_aed',
  '{"amount": 60}'::jsonb,
  'Default match fee in AED. Change value.amount to update fee for future match approvals.'
) ON CONFLICT (key) DO NOTHING;

-- ── 4. open_match_payment_window ─────────────────────────────────────────────
-- Called by trigger on approved_at transition. NOT admin-guarded (no auth.uid in trigger).
CREATE OR REPLACE FUNCTION open_match_payment_window(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fee integer;
BEGIN
  SELECT COALESCE((value->>'amount')::integer, 60)
  INTO v_fee
  FROM app_settings
  WHERE key = 'payment_fee_aed';

  IF v_fee IS NULL THEN v_fee := 60; END IF;

  -- Idempotent window open
  INSERT INTO payment_windows (match_id, opened_at)
  VALUES (p_match_id, now())
  ON CONFLICT (match_id) DO NOTHING;

  -- match_players has both registered players (profile_id set) and guests (guest_id set)
  INSERT INTO match_payment_records (match_id, profile_id, guest_id, amount_aed)
  SELECT p_match_id, mp.profile_id, mp.guest_id, v_fee
  FROM match_players mp
  WHERE mp.match_id = p_match_id
    AND (mp.is_no_show IS NULL OR mp.is_no_show = false)
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION open_match_payment_window(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION open_match_payment_window(uuid) TO authenticated;

-- ── 5. mark_payment_paid ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_payment_paid(p_match_id uuid, p_profile_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM payment_windows
    WHERE match_id = p_match_id AND closed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Window closed — use override to reopen' USING ERRCODE = '42501';
  END IF;
  UPDATE match_payment_records
  SET paid_at = now(), marked_paid_by = current_profile_id()
  WHERE match_id = p_match_id AND profile_id = p_profile_id AND paid_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_payment_paid(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION mark_payment_paid(uuid, uuid) TO authenticated;

-- ── 6. mark_guest_payment_paid ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_guest_payment_paid(p_match_id uuid, p_guest_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM payment_windows
    WHERE match_id = p_match_id AND closed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Window closed — use override to reopen' USING ERRCODE = '42501';
  END IF;
  UPDATE match_payment_records
  SET paid_at = now(), marked_paid_by = current_profile_id()
  WHERE match_id = p_match_id AND guest_id = p_guest_id AND paid_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_guest_payment_paid(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION mark_guest_payment_paid(uuid, uuid) TO authenticated;

-- ── 7. close_payment_window ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION close_payment_window(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  UPDATE payment_windows
  SET closed_at = now(), closed_by = current_profile_id(), auto_closed = false
  WHERE match_id = p_match_id AND closed_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION close_payment_window(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION close_payment_window(uuid) TO authenticated;

-- ── 8. reopen_payment_window ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reopen_payment_window(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  UPDATE payment_windows
  SET closed_at = NULL, closed_by = NULL, auto_closed = false
  WHERE match_id = p_match_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION reopen_payment_window(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION reopen_payment_window(uuid) TO authenticated;

-- ── 9. get_season_payment_summary ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_season_payment_summary(p_season_id uuid)
RETURNS TABLE (
  profile_id      uuid,
  guest_id        uuid,
  display_name    text,
  avatar_url      text,
  matches_played  integer,
  matches_paid    integer,
  total_owed_aed  integer,
  total_paid_aed  integer,
  outstanding_aed integer
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.profile_id,
    r.guest_id,
    COALESCE(p.display_name, g.display_name)                                         AS display_name,
    p.avatar_url,
    COUNT(r.id)::integer                                                              AS matches_played,
    COUNT(r.paid_at)::integer                                                         AS matches_paid,
    SUM(r.amount_aed)::integer                                                        AS total_owed_aed,
    COALESCE(SUM(r.amount_aed) FILTER (WHERE r.paid_at IS NOT NULL), 0)::integer      AS total_paid_aed,
    (SUM(r.amount_aed)
      - COALESCE(SUM(r.amount_aed) FILTER (WHERE r.paid_at IS NOT NULL), 0))::integer AS outstanding_aed
  FROM match_payment_records r
  JOIN matches m     ON m.id  = r.match_id
  LEFT JOIN profiles p       ON p.id  = r.profile_id
  LEFT JOIN match_guests g   ON g.id  = r.guest_id
  WHERE m.season_id = p_season_id
  GROUP BY r.profile_id, r.guest_id, p.display_name, g.display_name, p.avatar_url
  ORDER BY outstanding_aed DESC, display_name ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_season_payment_summary(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_season_payment_summary(uuid) TO authenticated;

-- ── 10. get_player_payment_ledger ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_player_payment_ledger(
  p_profile_id uuid DEFAULT NULL,
  p_guest_id   uuid DEFAULT NULL,
  p_season_id  uuid DEFAULT NULL
)
RETURNS TABLE (
  match_id      uuid,
  match_number  integer,
  kickoff_at    timestamptz,
  amount_aed    integer,
  paid_at       timestamptz,
  window_open   boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (p_profile_id IS NULL) = (p_guest_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_guest_id must be provided';
  END IF;

  RETURN QUERY
  SELECT
    r.match_id,
    ROW_NUMBER() OVER (ORDER BY m.kickoff_at)::integer AS match_number,
    m.kickoff_at,
    r.amount_aed,
    r.paid_at,
    (pw.closed_at IS NULL)                             AS window_open
  FROM match_payment_records r
  JOIN matches m             ON m.id        = r.match_id
  LEFT JOIN payment_windows pw ON pw.match_id = r.match_id
  WHERE (p_season_id IS NULL OR m.season_id = p_season_id)
    AND (
      (p_profile_id IS NOT NULL AND r.profile_id = p_profile_id)
      OR
      (p_guest_id   IS NOT NULL AND r.guest_id   = p_guest_id)
    )
  ORDER BY m.kickoff_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_player_payment_ledger(uuid, uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_player_payment_ledger(uuid, uuid, uuid) TO authenticated;

-- ── 11. auto-close trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auto_close_payment_window_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM match_payment_records
    WHERE match_id = NEW.match_id AND paid_at IS NULL
  ) THEN
    UPDATE payment_windows
    SET closed_at = now(), auto_closed = true
    WHERE match_id = NEW.match_id AND closed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_close_payment_window
  AFTER UPDATE OF paid_at ON match_payment_records
  FOR EACH ROW EXECUTE FUNCTION auto_close_payment_window_trigger();

-- ── 12. match approval trigger ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION on_match_approved_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL THEN
    PERFORM open_match_payment_window(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_match_approved
  AFTER UPDATE OF approved_at ON matches
  FOR EACH ROW EXECUTE FUNCTION on_match_approved_trigger();

-- ── 13. Realtime ──────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE match_payment_records;
ALTER PUBLICATION supabase_realtime ADD TABLE payment_windows;
