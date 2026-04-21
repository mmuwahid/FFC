-- 0009_rls_policies.sql — enable RLS and create all access policies (§2.8)

ALTER TABLE profiles                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_signups             ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE matchdays                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_votes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_guests                ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_players               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ref_tokens                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_match_entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_match_entry_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications               ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_bans                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings                ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_reminders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_picks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE formations                  ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY profiles_select_all ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_update_own ON profiles FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid()
              AND role = (SELECT role FROM profiles WHERE auth_user_id = auth.uid()));
CREATE POLICY profiles_update_admin ON profiles FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin() AND role = (SELECT role FROM profiles p2 WHERE p2.id = profiles.id));

-- pending_signups
CREATE POLICY pending_signups_insert_own ON pending_signups FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = auth.uid());
CREATE POLICY pending_signups_select ON pending_signups FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR is_admin());

-- seasons
CREATE POLICY seasons_select ON seasons FOR SELECT TO authenticated
  USING (archived_at IS NULL OR is_admin());
CREATE POLICY seasons_write_admin ON seasons FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- matchdays
CREATE POLICY matchdays_select ON matchdays FOR SELECT TO authenticated USING (true);
CREATE POLICY matchdays_write_admin ON matchdays FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- poll_votes
CREATE POLICY poll_votes_select ON poll_votes FOR SELECT TO authenticated USING (true);
CREATE POLICY poll_votes_insert_own ON poll_votes FOR INSERT TO authenticated
  WITH CHECK (profile_id = current_profile_id());
CREATE POLICY poll_votes_update_own ON poll_votes FOR UPDATE TO authenticated
  USING (profile_id = current_profile_id())
  WITH CHECK (profile_id = current_profile_id());
CREATE POLICY poll_votes_admin_all ON poll_votes FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- match_guests
CREATE POLICY match_guests_select ON match_guests FOR SELECT TO authenticated USING (true);
CREATE POLICY match_guests_insert_own ON match_guests FOR INSERT TO authenticated
  WITH CHECK (inviter_id = current_profile_id() OR is_admin());
CREATE POLICY match_guests_update_own ON match_guests FOR UPDATE TO authenticated
  USING (inviter_id = current_profile_id() OR is_admin())
  WITH CHECK (inviter_id = current_profile_id() OR is_admin());

-- matches
CREATE POLICY matches_select_approved ON matches FOR SELECT TO authenticated
  USING (approved_at IS NOT NULL OR is_admin());
CREATE POLICY matches_write_admin ON matches FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- match_players
CREATE POLICY match_players_select_approved ON match_players FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM matches m WHERE m.id = match_players.match_id
                 AND (m.approved_at IS NOT NULL OR is_admin())));
CREATE POLICY match_players_write_admin ON match_players FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- ref_tokens
CREATE POLICY ref_tokens_admin_all ON ref_tokens FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- pending_match_entries + players (read-only for admins; writes via RPC)
CREATE POLICY pme_admin_select ON pending_match_entries FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY pmep_admin_select ON pending_match_entry_players FOR SELECT TO authenticated
  USING (is_admin());

-- notifications
CREATE POLICY notifications_select_own ON notifications FOR SELECT TO authenticated
  USING (recipient_id = current_profile_id());
CREATE POLICY notifications_update_own ON notifications FOR UPDATE TO authenticated
  USING (recipient_id = current_profile_id())
  WITH CHECK (recipient_id = current_profile_id());

-- player_bans
CREATE POLICY player_bans_select_own ON player_bans FOR SELECT TO authenticated
  USING (profile_id = current_profile_id() OR is_admin());
CREATE POLICY player_bans_admin_write ON player_bans FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- push_subscriptions
CREATE POLICY push_subscriptions_own ON push_subscriptions FOR ALL TO authenticated
  USING (profile_id = current_profile_id())
  WITH CHECK (profile_id = current_profile_id());

-- app_settings
CREATE POLICY app_settings_read ON app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY app_settings_write_super ON app_settings FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- scheduled_reminders
CREATE POLICY scheduled_reminders_read_admin ON scheduled_reminders FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY scheduled_reminders_update_admin ON scheduled_reminders FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY scheduled_reminders_write_super ON scheduled_reminders FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- admin_audit_log
CREATE POLICY admin_audit_log_select_admin ON admin_audit_log FOR SELECT TO authenticated
  USING (is_admin());

-- draft_sessions
CREATE POLICY draft_sessions_select ON draft_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY draft_sessions_admin_all ON draft_sessions FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- draft_picks
CREATE POLICY draft_picks_select ON draft_picks FOR SELECT TO authenticated USING (true);
CREATE POLICY draft_picks_admin_all ON draft_picks FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- formations
CREATE POLICY formations_select ON formations FOR SELECT TO authenticated
  USING (
    is_admin()
    OR shared_at IS NOT NULL
    OR last_edited_by = current_profile_id()
  );
CREATE POLICY formations_admin_all ON formations FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Hard anon boundary (RPC submit_ref_entry is the only anon surface — granted in 0008)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
