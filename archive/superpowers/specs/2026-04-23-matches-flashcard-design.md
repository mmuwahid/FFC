# Matches — Flashcard Redesign

- **Spec date:** 2026-04-23
- **Session:** brainstorm during S027 prep
- **Status:** approved (mockup v6 final)
- **Affected screens:** `Matches.tsx` (league history list). `MatchDetailSheet` is unchanged and continues to open on row tap.
- **Affected tables / RPCs:** `seasons` (new column), admin season-create UI (new), no changes to `matches` / `match_players`.
- **Mockup:** `.superpowers/brainstorm/1099-1776946805/content/matches-flashcard-c-v6-final.html`

## Goal

Replace the current one-line Matches row with a "flashcard" that shows each result at a glance. Every card is a split-colour scoreboard: cream on the left for White, navy on the right for Black, FFC crest on each side, score prominent, per-team scorers below, MOTM optional on the bottom strip, clear visual winner indicator.

## Visual structure

Five stacked zones, top to bottom:

| Zone | Height | Purpose |
|---|---|---|
| Banner | 28 px | `GAME N / TOTAL` on the left, `DD / MON / YYYY` on the right |
| Scoreboard | 64 px | Split half — logo, `WHITE` / `BLACK` label, score digit. `VS` badge centred. |
| Scorer footer | ~28 px (one row per scorer, no hard max) | Split half — one scorer per row, left-aligned on White side, right-aligned on Black side |
| MOTM strip | 24 px | Amber text "⭐ MOTM · <name>". Only rendered when `matches.motm_user_id` OR `matches.motm_guest_id` is set. |

Card background `#0f1a30`, border `rgba(255,255,255,0.08)`, `border-radius: 12px`. Card max-width 440 px (same as current row). Cards stacked with 14 px gap.

### Banner (`GAME N / TOTAL`)

- `N` = 1-based position of this match's matchday within the season, ordered by `matchdays.kickoff_at` ascending, friendly matchdays excluded. Matches the number the current [Matches.tsx](ffc/src/pages/Matches.tsx) already computes via `matchdayNumber[m.matchday_id]`.
- `TOTAL` = the new `seasons.planned_games` column (see Schema changes below). When `planned_games IS NULL`, render the banner as `GAME N` with no denominator.
- Label in the code (exact text): `GAME ${N} / ${TOTAL}` or `GAME ${N}` fallback.

### Scoreboard

- White half: `splitc-half` with gradient `linear-gradient(135deg, #f4ede2 0%, #e5ddcd 100%)`. Logo in a 40×40 cream circle on the left, `WHITE` label centre, score digit right-aligned near the `VS` badge.
- Black half: gradient `linear-gradient(135deg, #0b1220 0%, #1a2440 100%)`. Logo in a 40×40 navy circle on the right, `BLACK` label centre, score digit left-aligned near the `VS` badge. Flex direction is row-reverse so the layout mirrors White.
- `VS` badge: 26×26 navy circle with blue text, centred on the split seam via absolute positioning.
- Logo source: `/ffc-logo.png` (already present in `ffc/public/`). On the Black side, apply CSS `filter: invert(1) brightness(1.1)` to the `<img>` so the crest reads as white-on-navy without adding a second asset.

### Winner indicator

Combined treatment — dim + ribbon + label:

| Result | Winner half | Loser half | Banner overlay |
|---|---|---|---|
| White wins | green 3-px ribbon across the top of the White half + small pill reading `WINNER` just under the ribbon on the left | `.loser` class → `opacity: 0.5; filter: saturate(0.55)` | — |
| Black wins | same treatment mirrored to the right | `.loser` class on White half | — |
| Draw | no ribbon, no dimming | — | neutral grey `DRAW` pill centred under the banner |

Driven by `matches.result` (`win_white` / `win_black` / `draw`). No new DB fields.

### Scorer footer

- Footer strip is a 2-column CSS grid (1 fr / 1 fr) matched to the scoreboard split. Left column = white scorers (left-aligned). Right column = black scorers (right-aligned, `row-reverse`). Thin vertical divider at 50 %.
- One row per distinct scorer. Format: `⚽ <display_name>` with `×N` suffix when `goals > 1`.
- Hat-trick badge: if `goals >= 3`, append a small pink `HAT` pill next to the name (`×3 HAT`).
- Empty side: render `no goals` in italicised grey. Do not collapse the column.
- No artificial cap on scorer rows. Typical 7v7 match has 1–4 scorers per side; if a team has 5+ distinct scorers the card just grows vertically — that's an acceptable trade-off for the league scale.

### MOTM strip

- Rendered only when `matches.motm_user_id` OR `matches.motm_guest_id` is non-null.
- Source name: `matches.motm_member.display_name ?? matches.motm_guest.display_name`.
- Text: `⭐ MOTM · ${name}`. Amber tint background, centred, 24 px tall.

### Tap target

Whole card is a `<button>` with `onClick={() => setOpenMatchId(m.id)}` — same behaviour as today. No chevron needed; the card itself is obviously tappable.

## Data changes

### Schema: `seasons.planned_games`

New column on `seasons`:

```sql
ALTER TABLE seasons ADD COLUMN planned_games int
  CHECK (planned_games IS NULL OR planned_games >= 1);
```

- Nullable. Existing seasons keep `NULL` (banner degrades to `GAME N`).
- No back-fill required. Admin fills it via the new season-create form.

### Admin: AdminSeasons page (new)

There's no AdminSeasons page today — Season 1 was seeded via migration `0011_seed_super_admin.sql`. This redesign creates one:

- New route `/admin/seasons` (5th tab in the admin nav, or a sub-entry under AdminHome — decide in the plan).
- Form fields: `name` (text, required), `starts_on` (date, required), `default_format` (select `7v7` / `5v5` — exists), `roster_policy` (select `carry_forward` / `reset` — exists), **`planned_games`** (int, optional, placeholder "e.g. 30").
- Actions: `Create season`, `Edit season` (in-place edit of name / planned_games only while season is active), `End season` (calls existing logic pattern), `Archive season` (calls existing `archive_season` RPC).
- Creation path: new RPC `create_season(name, starts_on, planned_games, default_format, roster_policy)` in a new migration, SECURITY DEFINER, admin-only, audits via `log_admin_action`.

### Query changes in `Matches.tsx`

The existing matches query already pulls `motm_member` and `motm_guest`. Add `match_players` embed to get scorers:

```
matchday:matchdays!inner(id, kickoff_at, is_friendly),
motm_member:profiles!matches_motm_user_id_fkey(display_name),
motm_guest:match_guests!matches_motm_guest_id_fkey(display_name),
scorers:match_players(
  team,
  goals,
  profile:profiles(display_name),
  guest:match_guests(display_name)
)
```

Client-side, filter `scorers` to rows where `goals > 0`, group by `team`, sort by `goals` desc then name asc.

Also fetch `seasons.planned_games` in the season-load query: change the `select` to `id, name, ended_at, archived_at, created_at, planned_games`.

## Out of scope

- Cards (yellow / red). Not in this redesign. They're tracked in `match_players.yellow_cards` / `red_cards` but won't render on the flashcard.
- Clean-sheet flag. Explicitly dropped per user decision.
- Own goals. No schema field today; untouched.
- Friendly matchdays. Still filtered out client-side (`is_friendly` check) — Matches is league-only.
- Match Detail sheet redesign. Untouched for this spec.

## Files to change

| Path | Change |
|---|---|
| `supabase/migrations/0020_seasons_planned_games.sql` | new migration — `ALTER TABLE seasons ADD COLUMN planned_games int ...` + `create_season` RPC + GRANT EXECUTE |
| `ffc/src/pages/admin/AdminSeasons.tsx` | new admin page — create / edit / end / archive |
| `ffc/src/components/RoleLayout.tsx` (or wherever admin tabs are defined) | add "Seasons" tab for admins |
| `ffc/src/pages/Matches.tsx` | replace row markup + CSS with flashcard layout; extend matches query; read `planned_games` from season row |
| `ffc/src/styles/matches.css` (or inline — follow the existing `mt-*` class convention) | new `splitc-*` classes per the mockup |
| `ffc/src/lib/database.types.ts` | regenerate via `npx supabase gen types typescript --linked 2>/dev/null` after migration applies |

## Open items requiring product decisions

None — all decisions made during the brainstorm session:

- Layout: Option C split-half confirmed
- Height: ~120–145 px (half of v1 size) confirmed
- Logo: real transparent FFC crest, inverted on Black side
- Banner format: `GAME N / TOTAL`, TOTAL from `seasons.planned_games`
- Scorers: one per row, per-team columns
- Hat-trick: pink `HAT` pill, yes
- Clean-sheet: removed
- Winner indicator: dim loser + green ribbon + WINNER label combo
- `planned_games` source: new column on seasons, admin inputs it on season creation
