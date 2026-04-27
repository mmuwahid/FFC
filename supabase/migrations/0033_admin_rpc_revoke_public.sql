-- 0033_admin_rpc_revoke_public.sql — Defense-in-depth: REVOKE EXECUTE FROM PUBLIC
-- on every admin-gated SECURITY DEFINER RPC.
--
-- Background
-- ==========
-- S043 patched a critical NULL-3VL bug in is_admin()/is_super_admin() where
-- anon callers slipped past `IF NOT is_admin() THEN RAISE` because PL/pgSQL
-- evaluates `IF NOT NULL` as `IF NULL` (treated as FALSE -> no RAISE). The fix
-- (migration 0031) wrapped the bodies in COALESCE(..., false) so anon now
-- correctly hits the 42501 raise.
--
-- This migration adds the *second* layer: anon never reaches the function
-- body at all. Postgres grants EXECUTE to PUBLIC by default on every
-- CREATE FUNCTION; the explicit GRANT TO authenticated in earlier migrations
-- coexisted with that PUBLIC grant rather than replacing it. After this
-- migration, anon-key callers get a `42501 permission denied for function ...`
-- at the PostgREST gate before any PL/pgSQL runs.
--
-- Scope
-- =====
-- Only RPCs whose body calls is_admin() or is_super_admin() — 35 functions
-- as of 27/APR/2026, audited against pg_proc on the live DB. Functions with
-- "captain OR admin" semantics (accept_substitute) are included: captains
-- ARE authenticated users, so REVOKE FROM PUBLIC + GRANT TO authenticated
-- preserves their access while shutting out anon.
--
-- Out of scope (deliberately untouched)
-- =====================================
-- - submit_ref_entry(text, jsonb)   — anon-callable; auth via ref token
-- - get_ref_matchday(text)          — anon-callable; auth via ref token
-- - cast_poll_vote, invite_guest, edit_match_players (the non-admin variant)
--   and other authenticated-only RPCs that don't reference is_admin
--
-- Idempotent: REVOKE-IF-NOT-GRANTED is a no-op; GRANT-IF-ALREADY-GRANTED is
-- a no-op. Safe to re-run.
--
-- Signatures below were generated directly from pg_proc on 27/APR/2026 to
-- avoid the hand-typed signature drift that bit migration 0027 (ban_player
-- evolved between 0008 and 0016 — this migration uses the live form).

-- ─── Admin-gated RPCs (gate = is_admin() OR is_super_admin()) ─────────────

REVOKE EXECUTE ON FUNCTION public.accept_substitute(p_matchday_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_draft_abandon(p_matchday_id uuid, p_reason text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_draft_force_complete(p_matchday_id uuid, p_reason text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_drop_pending_match_event(p_event_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_submit_match_result(p_matchday_id uuid, p_score_white integer, p_score_black integer, p_motm_profile_id uuid, p_motm_guest_id uuid, p_players jsonb, p_notes text, p_approve boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_match_entry(p_pending_id uuid, p_edits jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_signup(p_pending_id uuid, p_claim_profile_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.archive_season(p_season_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ban_player(p_profile_id uuid, p_reason text, p_ends_at timestamp with time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_friendly_matchday(p_matchday_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_match_draft(p_matchday_id uuid, p_white_roster uuid[], p_black_roster uuid[], p_white_guests uuid[], p_black_guests uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_matchday(p_season_id uuid, p_kickoff_at timestamp with time zone, p_venue text, p_poll_opens_at timestamp with time zone, p_poll_closes_at timestamp with time zone, p_format match_format) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_season(p_name text, p_starts_on date, p_planned_games integer, p_default_format match_format, p_roster_policy roster_policy) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_season(p_season_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.demote_admin(p_profile_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dismiss_friendly_flag(p_matchday_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.edit_match_players(p_match_id uuid, p_players jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.edit_match_result(p_match_id uuid, p_edits jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lock_roster(p_matchday_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pick_captains_random(p_matchday_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_admin(p_profile_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_from_waitlist(p_matchday_id uuid, p_departing_profile uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_no_shows(p_match_id uuid, p_profile_ids uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.regenerate_ref_token(p_matchday_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reinstate_rejected(p_profile_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_match_entry(p_pending_id uuid, p_reason text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_signup(p_pending_id uuid, p_reason text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_matchday_captains(p_matchday_id uuid, p_white_profile_id uuid, p_black_profile_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.suggest_captain_pairs(p_matchday_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unban_player(p_profile_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_guest_stats(p_guest_id uuid, p_primary_position player_position, p_secondary_position player_position, p_stamina guest_trait, p_accuracy guest_trait, p_rating guest_rating, p_description text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_matchday(p_matchday_id uuid, p_kickoff_at timestamp with time zone, p_venue text, p_poll_opens_at timestamp with time zone, p_poll_closes_at timestamp with time zone, p_format match_format, p_venue_explicit_null boolean, p_format_explicit_null boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_player_profile(p_profile_id uuid, p_display_name text, p_primary_position player_position, p_secondary_position player_position, p_is_active boolean, p_role user_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_season(p_season_id uuid, p_name text, p_starts_on date, p_ends_on date, p_planned_games integer, p_default_format match_format, p_roster_policy roster_policy, p_clear_ends_on boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_season_planned_games(p_season_id uuid, p_planned_games integer) FROM PUBLIC;

-- ─── Re-affirm GRANT TO authenticated (idempotent — already granted by ─────
-- ─── earlier migrations; included as belt-and-braces against future drift) ─

GRANT EXECUTE ON FUNCTION public.accept_substitute(p_matchday_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_draft_abandon(p_matchday_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_draft_force_complete(p_matchday_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_drop_pending_match_event(p_event_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_submit_match_result(p_matchday_id uuid, p_score_white integer, p_score_black integer, p_motm_profile_id uuid, p_motm_guest_id uuid, p_players jsonb, p_notes text, p_approve boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_match_entry(p_pending_id uuid, p_edits jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_signup(p_pending_id uuid, p_claim_profile_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_season(p_season_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ban_player(p_profile_id uuid, p_reason text, p_ends_at timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_friendly_matchday(p_matchday_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_match_draft(p_matchday_id uuid, p_white_roster uuid[], p_black_roster uuid[], p_white_guests uuid[], p_black_guests uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_matchday(p_season_id uuid, p_kickoff_at timestamp with time zone, p_venue text, p_poll_opens_at timestamp with time zone, p_poll_closes_at timestamp with time zone, p_format match_format) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_season(p_name text, p_starts_on date, p_planned_games integer, p_default_format match_format, p_roster_policy roster_policy) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_season(p_season_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.demote_admin(p_profile_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_friendly_flag(p_matchday_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_match_players(p_match_id uuid, p_players jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_match_result(p_match_id uuid, p_edits jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lock_roster(p_matchday_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pick_captains_random(p_matchday_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_admin(p_profile_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_from_waitlist(p_matchday_id uuid, p_departing_profile uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_no_shows(p_match_id uuid, p_profile_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_ref_token(p_matchday_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reinstate_rejected(p_profile_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_match_entry(p_pending_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_signup(p_pending_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_matchday_captains(p_matchday_id uuid, p_white_profile_id uuid, p_black_profile_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.suggest_captain_pairs(p_matchday_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unban_player(p_profile_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_guest_stats(p_guest_id uuid, p_primary_position player_position, p_secondary_position player_position, p_stamina guest_trait, p_accuracy guest_trait, p_rating guest_rating, p_description text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_matchday(p_matchday_id uuid, p_kickoff_at timestamp with time zone, p_venue text, p_poll_opens_at timestamp with time zone, p_poll_closes_at timestamp with time zone, p_format match_format, p_venue_explicit_null boolean, p_format_explicit_null boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_player_profile(p_profile_id uuid, p_display_name text, p_primary_position player_position, p_secondary_position player_position, p_is_active boolean, p_role user_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_season(p_season_id uuid, p_name text, p_starts_on date, p_ends_on date, p_planned_games integer, p_default_format match_format, p_roster_policy roster_policy, p_clear_ends_on boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_season_planned_games(p_season_id uuid, p_planned_games integer) TO authenticated;
