-- 0001_enums.sql — all application enums (§2.1)
-- Extensions required by later migrations
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- digest() for ref-token sha256
CREATE EXTENSION IF NOT EXISTS pg_cron;   -- scheduled_reminders cron binding

CREATE TYPE user_role AS ENUM ('player','admin','super_admin','rejected');
CREATE TYPE team_color AS ENUM ('white','black');
CREATE TYPE match_result AS ENUM ('win_white','win_black','draw');
CREATE TYPE poll_choice AS ENUM ('yes','no','maybe');
CREATE TYPE season_status AS ENUM ('active','ended','archived');
CREATE TYPE roster_policy AS ENUM ('fresh','carry_forward');
CREATE TYPE signup_resolution AS ENUM ('pending','approved','rejected');
CREATE TYPE pending_match_status AS ENUM ('pending','approved','rejected');

CREATE TYPE notification_kind AS ENUM (
  'poll_open','poll_reminder','roster_locked','teams_posted',
  'plus_one_unlocked','plus_one_slot_taken',
  'match_entry_submitted','match_entry_approved','match_entry_rejected',
  'signup_approved','signup_rejected',
  'admin_promoted','season_archived',
  'dropout_after_lock',
  'draft_reroll_started',
  'reroll_triggered_by_opponent',
  'captain_dropout_needs_replacement',
  'formation_reminder',
  'formation_shared'
);

CREATE TYPE reminder_kind AS ENUM (
  'poll_open_broadcast','poll_cutoff_warning',
  'plus_one_unlock_broadcast','teams_post_reminder','custom'
);
CREATE TYPE reminder_channel AS ENUM ('push','email','whatsapp_share');

CREATE TYPE player_position AS ENUM ('GK','DEF','CDM','W','ST');
CREATE TYPE theme_preference AS ENUM ('light','dark','system');
CREATE TYPE leaderboard_sort AS ENUM ('points','goals','motm','wins','last5_form');
CREATE TYPE guest_rating AS ENUM ('weak','average','strong');
CREATE TYPE guest_trait AS ENUM ('low','medium','high');
CREATE TYPE draft_status AS ENUM ('in_progress','completed','abandoned');
CREATE TYPE draft_reason AS ENUM ('initial','reroll_after_dropout');
CREATE TYPE match_format AS ENUM ('7v7','5v5');
