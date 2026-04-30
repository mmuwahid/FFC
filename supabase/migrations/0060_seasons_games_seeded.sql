-- 0060_seasons_games_seeded.sql
-- S058 follow-up — Matches tab game numbering.
--
-- Background:
--   The Matches tab card shows "GAME N / TOTAL" per match. The current
--   formula computes N = index-of-matchday-within-current-season-DB. That's
--   wrong when a season was seeded with prior games (via
--   `season_seed_stats`). Season 11 was seeded with 30 prior games + 40
--   planned, so the first matchday in this app is actually game 31, not 1.
--
-- Fix:
--   Add `games_seeded` to seasons. Frontend will compute
--   N = games_seeded + (index_in_DB + 1). Default 0 so brand-new seasons
--   number from 1.
--
-- Backfill:
--   Season 11 (`ab60594c-...`) gets games_seeded = 30 per league owner's
--   confirmation. Other future seasons start at 0 and admins set it
--   explicitly when seeding from a prior period.

BEGIN;

ALTER TABLE public.seasons
  ADD COLUMN IF NOT EXISTS games_seeded int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.seasons.games_seeded IS
  'Number of games already played before the season was tracked in this app.
   Used by Matches tab to display the correct cumulative game number
   ("GAME 31 / 40") when a season was seeded from a prior period via
   season_seed_stats. Defaults to 0 for app-native seasons.';

UPDATE public.seasons
   SET games_seeded = 30
 WHERE id = 'ab60594c-ed7f-4c4d-a18d-6a02c1af42c3'
   AND games_seeded = 0;

COMMIT;
