-- 0027_season11_roster_import.sql
-- S037: Fresh-start data migration.
--
--   1. Archive "Test Player" (role='rejected', is_active=false)
--   2. TRUNCATE all transactional/match-related tables (CASCADE handles child FKs)
--   3. Insert 39 ghost profiles (auth_user_id NULL, claim flow handled in a future session)
--      - Ahmed Saleh, Rawad, Abood, Barhoom → role='admin'
--      - All others → role='player'
--   4. Seed Season 11 aggregate stats into season_seed_stats (40 rows: 39 new + Mohammed)
--
-- Mohammed Muwahid (super_admin, id cce905a8-…) is preserved and receives his Season 11
-- seed row under display_name 'Mohammed Muwahid' (he is "Moody" in the source sheet).
--
-- Season 11 id: ab60594c-ed7f-4c4d-a18d-6a02c1af42c3
--
-- Derivation from source sheet (Matchday 30/40, seed rows are pre-app history only):
--   draws_seed  = max(0, points - 3*wins)
--   losses_seed = GP - wins - draws_seed
--   late_cancel_points_seed = LEAST(0, points - 3*wins - draws_seed)  -- Murad & Simo = -1

BEGIN;

-- =============================================================================
-- 1. Archive Test Player
-- =============================================================================

UPDATE public.profiles
SET role = 'rejected'::user_role,
    is_active = false,
    reject_reason = 'Archived during S037 (Season 11 roster import)',
    updated_at = now()
WHERE id = 'ca3181b2-ca3b-426e-8ae9-690962128530'::uuid
  AND display_name = 'Test Player';

-- =============================================================================
-- 2. Wipe transactional tables (CASCADE cleans child FK rows)
-- =============================================================================
-- Order is from leaf-most to parent, though CASCADE makes order flexible.
-- Tables preserved: profiles, seasons, app_settings, pending_signups,
-- push_subscriptions (auth/config state).

TRUNCATE TABLE
  public.notifications,
  public.draft_picks,
  public.draft_sessions,
  public.formations,
  public.match_guests,
  public.match_players,
  public.matches,
  public.poll_votes,
  public.player_bans,
  public.ref_tokens,
  public.scheduled_reminders,
  public.pending_match_entry_players,
  public.pending_match_entries,
  public.admin_audit_log,
  public.matchdays
RESTART IDENTITY CASCADE;

-- =============================================================================
-- 3. Insert 39 ghost profiles
-- =============================================================================

INSERT INTO public.profiles (display_name, role, is_active, auth_user_id, email) VALUES
  ('Karim Hamdan', 'player'::user_role, true, NULL, NULL),
  ('Anas',         'player'::user_role, true, NULL, NULL),
  ('Firas',        'player'::user_role, true, NULL, NULL),
  ('Mostafa',      'player'::user_role, true, NULL, NULL),
  ('Rawad',        'admin'::user_role,  true, NULL, NULL),
  ('Arek',         'player'::user_role, true, NULL, NULL),
  ('Noz',          'player'::user_role, true, NULL, NULL),
  ('Abood',        'admin'::user_role,  true, NULL, NULL),
  ('Jawad M',      'player'::user_role, true, NULL, NULL),
  ('Moe Hamdan',   'player'::user_role, true, NULL, NULL),
  ('Johnny',       'player'::user_role, true, NULL, NULL),
  ('Saz',          'player'::user_role, true, NULL, NULL),
  ('Latif',        'player'::user_role, true, NULL, NULL),
  ('Moataz',       'player'::user_role, true, NULL, NULL),
  ('Mufid',        'player'::user_role, true, NULL, NULL),
  ('Aaron',        'player'::user_role, true, NULL, NULL),
  ('Luca',         'player'::user_role, true, NULL, NULL),
  ('Mustafa J',    'player'::user_role, true, NULL, NULL),
  ('Nicolas',      'player'::user_role, true, NULL, NULL),
  ('Hazem',        'player'::user_role, true, NULL, NULL),
  ('Ziad',         'player'::user_role, true, NULL, NULL),
  ('Jack',         'player'::user_role, true, NULL, NULL),
  ('Ahmed Saleh',  'admin'::user_role,  true, NULL, NULL),
  ('Ahmad',        'player'::user_role, true, NULL, NULL),
  ('Sami',         'player'::user_role, true, NULL, NULL),
  ('Dani',         'player'::user_role, true, NULL, NULL),
  ('Parwar',       'player'::user_role, true, NULL, NULL),
  ('Tareq',        'player'::user_role, true, NULL, NULL),
  ('Hicham',       'player'::user_role, true, NULL, NULL),
  ('Murad',        'player'::user_role, true, NULL, NULL),
  ('Hesham',       'player'::user_role, true, NULL, NULL),
  ('Shary',        'player'::user_role, true, NULL, NULL),
  ('Husam',        'player'::user_role, true, NULL, NULL),
  ('Ivan',         'player'::user_role, true, NULL, NULL),
  ('Loay',         'player'::user_role, true, NULL, NULL),
  ('Ibra',         'player'::user_role, true, NULL, NULL),
  ('Roda',         'player'::user_role, true, NULL, NULL),
  ('Simo',         'player'::user_role, true, NULL, NULL),
  ('Barhoom',      'admin'::user_role,  true, NULL, NULL);

-- =============================================================================
-- 4. Seed Season 11 stats (40 rows: 39 new + Mohammed)
-- =============================================================================

INSERT INTO public.season_seed_stats
  (season_id, profile_id,
   wins_seed, draws_seed, losses_seed,
   goals_seed, yellows_seed, reds_seed, motms_seed,
   late_cancel_points_seed, no_show_points_seed)
SELECT
  'ab60594c-ed7f-4c4d-a18d-6a02c1af42c3'::uuid,
  p.id,
  v.wins, v.draws, v.losses,
  v.goals, v.yellows, v.reds, v.motms,
  v.late_cancel, v.no_show
FROM (VALUES
  -- display_name,       W,  D,  L,  G,  YC, RC, MOTM, LC,  NS
  ('Karim Hamdan',       13, 5,  6,  0,  0,  0,  1,    0,   0),
  ('Anas',               12, 5,  10, 2,  0,  0,  0,    0,   0),
  ('Firas',              12, 4,  13, 46, 1,  0,  4,    0,   0),
  ('Mostafa',            12, 3,  9,  37, 0,  0,  5,    0,   0),
  ('Rawad',              11, 5,  12, 24, 1,  0,  3,    0,   0),
  ('Arek',               11, 2,  11, 16, 3,  0,  1,    0,   0),
  ('Noz',                10, 4,  8,  24, 1,  1,  3,    0,   0),
  ('Abood',              10, 4,  10, 12, 1,  0,  2,    0,   0),
  ('Jawad M',            9,  3,  11, 25, 1,  0,  1,    0,   0),
  ('Moe Hamdan',         7,  1,  2,  14, 0,  0,  1,    0,   0),
  ('Johnny',             7,  1,  5,  10, 0,  0,  1,    0,   0),
  ('Saz',                6,  2,  8,  12, 0,  0,  0,    0,   0),
  ('Latif',              5,  1,  6,  3,  0,  0,  0,    0,   0),
  ('Moataz',             4,  4,  10, 24, 4,  1,  2,    0,   0),
  ('Mufid',              5,  0,  5,  1,  0,  0,  0,    0,   0),
  ('Aaron',              4,  3,  3,  4,  0,  0,  0,    0,   0),
  ('Luca',               4,  3,  5,  1,  0,  0,  0,    0,   0),
  ('Mustafa J',          4,  0,  1,  5,  0,  0,  1,    0,   0),
  ('Nicolas',            3,  3,  3,  5,  0,  0,  0,    0,   0),
  ('Hazem',              4,  0,  10, 14, 0,  0,  1,    0,   0),
  ('Ziad',               3,  0,  2,  0,  0,  0,  0,    0,   0),
  ('Mohammed Muwahid',   2,  2,  4,  10, 0,  0,  1,    0,   0),   -- "Moody" in sheet
  ('Jack',               2,  0,  0,  0,  0,  0,  0,    0,   0),
  ('Ahmed Saleh',        2,  0,  1,  2,  0,  0,  0,    0,   0),
  ('Ahmad',              2,  0,  1,  0,  0,  0,  0,    0,   0),
  ('Sami',               1,  1,  3,  10, 0,  0,  1,    0,   0),
  ('Dani',               1,  0,  0,  3,  0,  0,  0,    0,   0),
  ('Parwar',             1,  0,  0,  0,  0,  0,  0,    0,   0),
  ('Tareq',              1,  0,  1,  1,  0,  0,  0,    0,   0),
  ('Hicham',             1,  0,  6,  2,  0,  0,  0,    0,   0),
  ('Murad',              1,  0,  3,  2,  0,  0,  0,    -1,  0),
  ('Hesham',             0,  1,  1,  1,  0,  0,  0,    0,   0),
  ('Shary',              0,  1,  1,  0,  0,  0,  0,    0,   0),
  ('Husam',              0,  0,  3,  0,  0,  0,  0,    0,   0),
  ('Ivan',               0,  0,  1,  1,  0,  0,  0,    0,   0),
  ('Loay',               0,  0,  1,  1,  0,  0,  0,    0,   0),
  ('Ibra',               0,  0,  1,  0,  0,  0,  0,    0,   0),
  ('Roda',               0,  0,  1,  0,  0,  0,  0,    0,   0),
  ('Simo',               0,  0,  1,  0,  0,  0,  0,    -1,  0),
  ('Barhoom',            0,  0,  0,  0,  0,  0,  0,    0,   0)
) AS v(display_name, wins, draws, losses, goals, yellows, reds, motms, late_cancel, no_show)
JOIN public.profiles p
  ON p.display_name = v.display_name
  AND p.role <> 'rejected'::user_role;

COMMIT;
