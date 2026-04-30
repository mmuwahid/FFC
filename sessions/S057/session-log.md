# Session S057 — 30/APR/2026 · Home PC

**Start state:** `main` at `62d27da` (docs S056 corrections). Home PC (`User`). Migrations on live DB: 55.
**End state:** `main` at `717ab34`. No new migrations. 6 commits this session.

---

## What was done

### 1. PR merges — Atomo's two open PRs

| PR | Branch | Changes | Closes |
|----|--------|---------|--------|
| #29 | `fix/issue-19-datetime-confirm` | Add "Set ✓" confirm button to all 3 datetime-local inputs in `CreateMatchdaySheet`; draft/confirmed state split means Thursday warning + poll auto-derive only fire on explicit confirm | #19 |
| #28 | `feature/issue-20-roster-fixes` | Full rewrite of `AdminRosterSetup.tsx` (1825+/766−): 3-phase workflow (Pool → Teams → Saved), Unassigned/Waitlist/Removed sections, auto-alternating team assignment, slot × restores to correct section, lock/unlock/edit flow, mockup included as `mockups/admin-roster-setup-v2.html` | #20 |

Both PRs: Vercel checks passing before merge. Squash-merged in order (#29 → #28). `tsc -b` EXIT 0 post-merge. HEAD after merges: `105bb19`.

### 2. Issue housekeeping

- Closed **#16** via `gh issue close` with delivery note (S056 `e2a8a33` — ✏ pencil hint on admin player rows).
- Closed **#17** via `gh issue close` with delivery note (S056 `e2a8a33` — position pill colour-coding).
- **#19**, **#20** auto-closed by PR merges.

### 3. New issues triage — Atomo's #21–#27

7 new issues opened by Atomo. Triaged by complexity:

| # | Title | Decision |
|---|-------|----------|
| #27 | Admin match management (future-date result guard) | Fix now |
| #24a | Avatar initial overflows box | Fix now |
| #24b | Profile header not clearing dynamic island | Fix now |
| #26 | Awards winner tap + cumulative data | Tap: fix now; data: confirmed correct (1 approved match in DB) |
| #22 | UI footer alignment (broad audit) | Defer to S058 |
| #24c | Career goals formula mismatch | Fixed in-session — view-based aggregation |
| #25 | Recent matches empty + card format | Defer to S058 |
| #23 | Push notifications not firing | Defer to S058 |
| #21 | Edit result + roster flow redesign | Defer to S058 (mockup first per rule #1) |

### 4. Quick-win fixes — commit `275ede8`

- **#27** — `isPast = new Date(md.kickoff_at).getTime() < Date.now()` added to `MatchdayCard`; "Enter result" button wrapped in `{isPast && (...)}` — future matchdays no longer show the button.
- **#24a avatar** — `.pf-avatar-wrap img.pf-avatar { display: block }` — previously applied to all `.pf-avatar` children including `<span>` initials, overriding `display: grid; place-items: center` and causing the initial letter to overflow. Now only the `<img>` variant gets `display: block`.
- **#24b profile nav** — `.pf-nav` padding-top changed from `10px` to `calc(var(--safe-top, 0px) + 10px)` so the back/edit nav bar clears the dynamic island on Profile screen (which suppresses the AppTopBar and renders its own nav).

`tsc -b` EXIT 0.

### 5. Awards winner navigation — commits `275ede8` + `f135a66`

Initial fix added `text-decoration: underline` to `.aw-hero-name`. User rejected underline. Revised approach:
- Reverted underline.
- Changed `aw-hero-avatar` from `<div>` to `<button>` with same `onClick={() => winner && navigate(...)}` as the name button — provides a 60×60 px tap target (the avatar photo/initials circle) without any text decoration.
- Added `padding: 0; cursor: pointer` to `.aw-hero-avatar` CSS to neutralise browser button defaults.
- `tsc -b` EXIT 0.

---

## Commits

| Hash | Message |
|------|---------|
| `6bd4bda` | docs(s057): merge PRs #28+#29, close issues #16-#17-#19-#20, triage issues #21-#27 |
| `275ede8` | fix(s057): issue quick-wins — #27 future-match guard, #24 avatar+profile-nav, #26 winner tap |
| `f135a66` | fix(s057): #26 winner avatar button navigates to profile, no underline on name |
| `717ab34` | fix(s057): #24c career stats read from v_season_standings for consistency with leaderboard |

(Plus the two squash-merge commits from GitHub: `c…` PR#29, `1…` PR#28, totalling 6 commits on local main.)

---

### 6. Career goals formula — #24c — commit `717ab34`

Root cause: `Profile.tsx` computed career goals/yellows/reds/motms/matches from a `match_players` + embedded `matches` PostgREST query whose embedded-relation under-counted relative to `v_season_standings`. Atomo observed Moody showing 3 career goals while the season stats card showed 13.

Fix: career aggregates now sum `v_season_standings` rows across **all seasons** (no season_id filter) — the same SQL view the leaderboard uses. Streak computation still uses `recentP` (per-match data required for RLE streak algorithm).

**#26 cumulative data confirmed**: `v_season_award_winners_live` view SQL is cumulative (GROUP BY season_id + profile_id across all approved matches). "Only last game data" is because only 1 match is approved in the live DB — not a code bug. Closed with explanation.

`tsc -b` EXIT 0. Issues #24 + #26 closed on GitHub.

---

## Deferred to S058

- **#22** — Full bottom-nav/safe-area/alignment audit across all screens
- **#25** — Matches tab empty, recent-match card format alignment
- **#23** — Push notification pipeline end-to-end
- **#21** — Edit result + roster flow redesign (mockup first per CLAUDE.md rule #1)
