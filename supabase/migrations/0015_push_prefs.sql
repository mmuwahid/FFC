-- 0015 — profiles.push_prefs jsonb (§3.16 Settings row 2 backing storage)
--
-- Adds a single jsonb column storing per-event notification preferences.
-- Shape (exact 7 keys, enforced by application layer):
--   { "master": bool,
--     "poll_open": bool, "poll_reminder": bool, "roster_locked": bool,
--     "plus_one_unlocked": bool, "match_result_posted": bool,
--     "dropout_after_lock": bool }
--
-- NOT NULL with default so every existing row (2 at time of migration)
-- auto-fills with opt-in-by-default values. Push-delivery backend (Section 5
-- notification fan-out) remains Phase 2 — this column only stores preferences.
--
-- No constraint on jsonb shape; the app is authoritative. If a legacy
-- `position_changed` key is present on read (from pre-S010 drafts), it is
-- silently ignored and stripped on next write per spec §3.16 AC5.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS push_prefs jsonb NOT NULL DEFAULT
    jsonb_build_object(
      'master', true,
      'poll_open', true,
      'poll_reminder', true,
      'roster_locked', true,
      'plus_one_unlocked', true,
      'match_result_posted', true,
      'dropout_after_lock', true
    );
