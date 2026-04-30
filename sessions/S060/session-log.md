# Session Log — 2026-04-30 — Session060 — Payment tracker close + #41 ref/bandage + #38 topbar HIG + slop-mockup lesson

**Project:** FFC
**Type:** Build/Fix
**Phase:** Phase 3 backlog
**Duration:** Deep
**Commits:** `b962291`, `fb0b542` + this docs commit
**Live DB migrations:** 63 → **64** (mig 0064 applied)

---

## What Was Done

### Phase 3 payment tracker (V3.0:147) — verified shipped, marked complete
- Inventory found: backend complete in S056 mig 0055 (10 RPCs + 2 triggers + realtime publication), frontend complete in S056+S058 (`Payments.tsx` 264L + `PaymentLedgerSheet.tsx` 269L + CSS restored verbatim).
- Live-verified `/payments` empty state at dev preview: header / season pill / summary strip / banner-hidden / `No matches played this season yet.` All 5 overview sections + 4 ledger sections from spec §8 already implemented.
- RPC `get_season_payment_summary` POST → 200 confirmed via network log.
- Empty because Game 31 was approved BEFORE mig 0055; `on_match_approved_trigger` only fires on `NULL→NOT NULL` transition; spec §11 explicitly accepts no historic backfill.
- Mockup-first did NOT apply (skeleton already shipped; spec was the design doc).
- Full pipeline (banner / cards / ledger / mark-paid / close-window / override) now sits in live-verification block alongside other Thursday-matchday-blocked items.

### PR #39 triage — closed as unmergeable
- atomosh's `feature/fix-login` branch was 69 commits behind `main`, mergeStateStatus DIRTY.
- Net diff vs main: **−19,315 / +1,639** — would have erased S053–S059 (16 migrations 0047/0049/0051–0063 + Awards.tsx + Payments.tsx + PaymentLedgerSheet.tsx + shareMatchCard.ts + render-match-card EF + 7 plan/spec docs + 14 page rewrites).
- Root cause: classic squash-merge + branch reuse anti-pattern. PR #9 squash-merged on 29/APR 11:22Z, but atomosh kept pushing to the same `feature/fix-login` branch from its old base `d8c8938`. Six PRs landed on main during the next 36h; branch never pulled any of them.
- Posted comprehensive triage comment at https://github.com/mmuwahid/FFC/pull/39#issuecomment-4352366245 with: (1) impact tables (deletes/adds), (2) commit-by-commit timeline reconstruction, (3) 9 workflow rules to prevent recurrence (never reuse branch after merge / sync daily / delete merged branches / trust mergeStateStatus / squash-merge discipline / verify migration version slot / etc).
- Decision: don't merge. Wait for atomosh response before closing.

### Issue #41 — ref name + bandage injury tag (commit `b962291`)
**Mockup-first cycle:**
- First mockup attempt rebuilt match card from scratch instead of using live `matches.css` — user rejected hard ("this is much worse now. why are you not following the existing format from live database?").
- Located canonical CSS at `ffc/src/styles/matches.css` (143L) — separate file from `ffc/src/index.css` where `.mt-screen` lives. Cross-file rule sets are a recurring trap.
- Rebuilt mockup with the matches.css rule set copied verbatim into the `<style>` block + only the new `.mt-card-ref-pill` and `.mt-stat-icon--injury` classes added.
- Mockup approved.

**Schema (mig 0064):**
- `ALTER TABLE matches ADD COLUMN ref_name TEXT NULL`
- `ALTER TABLE pending_match_entries ADD COLUMN ref_name TEXT NULL`
- `ALTER TABLE pending_match_entry_players ADD COLUMN is_no_show BOOLEAN NOT NULL DEFAULT false`
- `CREATE OR REPLACE FUNCTION submit_ref_entry` — reads `p_payload->>'ref_name'` + per-player `is_no_show`
- `CREATE OR REPLACE FUNCTION approve_match_entry` — copies `ref_name` from pending → matches; updates `match_players.is_no_show` from `pending_match_entry_players`

**Frontend (5 files):**
- `ffc/src/lib/useMatchSession.ts` — added `refName` + `setRefName` + `injuredIds: Set<string>` + `toggleInjured`. Extended `PersistedState` to include `ref_name` and `injured_player_ids[]`. Hydration tolerates missing keys for forward compat.
- `ffc/src/pages/RefEntry.tsx` pre-match — required ref-name input above KICK OFF, gated `≥2 chars`. New `.ref-name-wrap` block.
- `ffc/src/pages/RefEntry.tsx` review — new "Injured Players" section per team, tap to toggle bandage. Uses existing roster from payload.
- `ffc/src/pages/RefEntry.tsx` payload — extended `SubmitPlayer` (added `is_no_show`) + `SubmitPayload` (added `ref_name`). `buildSubmitPayload` reads `injuredIds.has(profile_id ?? guest_id)` to set per-player flag.
- `ffc/src/pages/Matches.tsx` — added `ref_name` to query select, added gold REF pill render in banner middle (`{m.ref_name && <span class="mt-card-ref-pill">…}`), swapped 🤕 → 🩹 in `ParticipantBadge` (replace_all both occurrences).

**CSS (2 files):**
- `ffc/src/styles/matches.css` — `.mt-card-ref-pill` + `.mt-card-ref-pill-label` + `.mt-stat-icon--injury` (color: #f4c89a).
- `ffc/src/styles/ref-entry.css` — `.ref-name-wrap` / `.ref-name-label` / `.ref-name-req` / `.ref-name-input` / `.ref-name-hint` for pre-match input; `.ref-review-injuries` / `-teams` / `-team` / `-team-label` / `-list` / `-row` / `-name` / `.ref-review-injury-btn` / `--active` for review section.

**Verification:**
- `tsc -b` exit 0
- /matches DOM eval: 1 card rendered, banner intact (`GAME 31 / 40 / 23/APR/2026`), 0 ref pills (correct — Game 31 approved pre-mig), 0 bandages (correct — no `is_no_show=true` in DB).
- All 4 new CSS classes confirmed in live stylesheet via DOM eval (`foundRefPill`, `foundInjury`, `foundRefName`, `foundInjBtn` all true).

### Issue #38 CRITICAL — topbar touch targets (commit `fb0b542`)
- `.app-topbar-bell`: 36×36 → 44×44, font-size 18 → 20.
- `.app-topbar-avatar`: 36×36 → 44×44, border-radius 12 → 14.
- `.app-topbar-avatar-initials`: 13 → 15.
- Apple HIG mandates ≥44×44pt for thumb-tap reliability. Was a launch-day latent issue.
- Verified live: bell + avatar both `width/height: 44px` per `preview_inspect`. tsc clean.

### Slop-mockup lesson — captured 3 places
1. **`tasks/lessons.md` Critical Rule #6 sharpened** from "Match existing app styling" to: "Mockup matches live state verbatim, additions only" with explicit `grep -rn "\.<class>" ffc/src/styles/` instruction and rule that fresh-design is only permitted for screens that genuinely don't exist.
2. **`tasks/lessons.md` S060 patterns section added** — 3 entries: verbatim-mockup rule, screenshots-are-ground-truth rule, inline-SVG-for-cross-platform-emoji rule (⚽ U+26BD renders blue/white on Windows, black/white on iOS).
3. **Auto-memory file created** — `memory/feedback_mockup_no_redesign.md` + index pointer in `memory/MEMORY.md`.

---

## Files Created or Modified

### Commit `b962291` — feat(#41): ref name on match card + bandage injury tag
- `supabase/migrations/0064_match_ref_name_and_injury.sql` — NEW (231L)
- `ffc/src/lib/database.types.ts` — regen after mig push (+13 ref_name/is_no_show occurrences)
- `ffc/src/lib/useMatchSession.ts` — `refName` + `injuredIds` state + persistence
- `ffc/src/pages/RefEntry.tsx` — pre-match input + review injuries section + payload extension
- `ffc/src/pages/Matches.tsx` — ref_name query + REF pill + 🤕→🩹 swap
- `ffc/src/styles/matches.css` — `.mt-card-ref-pill` + `.mt-stat-icon--injury`
- `ffc/src/styles/ref-entry.css` — ref-name input + injuries section CSS
- `tasks/lessons.md` — rule #6 sharpened + S060 patterns section
- `tasks/todo.md` — payment tracker marked verified-shipped, S060 verification block added
- `mockups/match-card-fifa.html` — NEW (final approved version using live matches.css verbatim)

### Commit `fb0b542` — fix(#38 CRITICAL): topbar touch targets 36→44px
- `ffc/src/index.css` — `.app-topbar-bell` + `.app-topbar-avatar` + `.app-topbar-avatar-initials` sized for HIG

### Outside git (process artifacts)
- `_wip/pr39-triage-comment.md` — draft for the GitHub comment posted to PR #39
- `memory/feedback_mockup_no_redesign.md` — auto-memory file (NEW)
- `memory/MEMORY.md` — index pointer added

---

## Key Decisions

- **Don't merge PR #39.** Branch is too stale to rebase. Captured root cause + 9 workflow rules in the public PR comment so the lesson is on the record. Closing deferred until atomosh responds.
- **Phase 3 payment tracker = already shipped (skeleton state).** Mockup-first rule does not apply when production code already implements the spec verbatim. Live-pipeline verification is Thursday-matchday-blocked, same bucket as the rest of S058–S059 acceptance items.
- **Bandage data source = existing `match_players.is_no_show`.** No new "injured" column. Semantically `is_no_show` already covers "didn't play / went off". Avoids dual-truth state.
- **Ref name flow = ref types once on pre-match → submit_ref_entry payload → pending_match_entries.ref_name → approve_match_entry copies → matches.ref_name.** Single source of truth, no admin re-entry required.
- **Required ref name = ≥2 chars.** Disables KICK OFF until satisfied. Cheaper than an upstream validator since the gate is ephemeral state.
- **#38 CRITICAL touch-targets shipped solo.** HIG fix is a 1-file CSS commit — separated from the larger #38 design-system sweep (radius tokens + focus rings + skeleton coverage) which is queued as `#38 HIGH`.

## Open Questions

- atomosh response on PR #39 — When Possible. Branch + close action is on hold pending his read of the triage comment.
- Issue #41 + #38 CRITICAL live-verification owed Thursday matchday — When Possible.
- Issue #40 (player-name standardization) and #38 HIGH (design-system sprint) untouched. — When Possible.

## Lessons Learned

### Mistakes
| Date | Mistake | Root Cause | Prevention Rule |
|------|---------|------------|-----------------|
| 2026-04-30 | First #41 mockup invented a fresh match-card design (gold WINNER text, gold-bordered VS pill, uniform dark splitc halves, square fake "F" logos) instead of using the live `matches.css` ruleset | Styled from memory of the spec instead of locating the canonical CSS file. Skipped the `grep -rn` step that would have surfaced `ffc/src/styles/matches.css` (separate from `index.css`) | **Mockups for live/approved screens MUST `grep` for the root class first, copy the matching rule set verbatim into the mockup `<style>`, and add only diffs.** Sharpened in lessons.md rule #6. Saved as auto-memory `feedback_mockup_no_redesign.md`. |
| 2026-04-30 | First mockup used ⚽ emoji which renders blue/white on Windows Segoe UI Emoji vs black/white on iOS — user flagged the inconsistency | Treated all emoji as cross-platform-stable. Symbol emoji (🟨🟥) ARE consistent; stylized-object emoji (⚽🏆🩹) are not | **For stylized-object emoji where consistency matters, use inline SVG via `<symbol>` + `<use>` instead.** Captured in lessons.md S060 patterns. |

### Validated Patterns
- [2026-04-30] **Verbatim live-CSS copy + diff-only additions** for mockups of existing screens — Why: any drift from production look gets caught immediately by the user, costing a full mockup rebuild round.
- [2026-04-30] **Migration + RPC update pair shipped in a single migration file** (mig 0064 alters tables + `CREATE OR REPLACE` for both `submit_ref_entry` and `approve_match_entry`) — Why: keeps the schema/DML/DDL change atomic; rollback is one file; reviewer sees the full data-flow path in one place.
- [2026-04-30] **`Set<string>` in React state for selection toggles** + persisted as `Array.from(set)` in localStorage — Why: cleaner than per-item booleans, JSON-serializable on hydrate, supports `O(1)` `.has()` checks in the render path.
- [2026-04-30] **PR triage as a public comment with workflow rules**, rather than a quiet close — Why: the lesson lives where future PRs in the same shape will be referenced from, and the contributor sees concrete rules instead of just a rejection.

## Next Actions
- [ ] Wait for atomosh response on PR #39, then close + delete `feature/fix-login` branch
- [ ] Issue #40 — standardize player names (FirstName + LastInitial.) — schema + util + render-site sweep — mockup-first per Rule #1
- [ ] #38 HIGH — radius tokens (`--radius-sm/md/lg`) + global `:focus-visible` ring + skeleton-row coverage extension — design-system sprint
- [ ] Live verification owed Thursday matchday — payment tracker pipeline (mig 0055), #41 ref name + bandage flow (mig 0064), #38 CRITICAL touch targets, plus carried S058–S059 items

---

## Commits and Deploy
- **Commit 1:** `b962291` — feat(#41): ref name on match card + bandage injury tag (10 files, +1094 / −18)
- **Commit 2:** `fb0b542` — fix(#38 CRITICAL): topbar touch targets 36→44px (1 file, +11 / −7)
- **Live:** https://ffc-gilt.vercel.app (Vercel auto-deploy on push)
- **Live DB migrations:** 63 → **64**

---
_Session logged: 2026-04-30 | Logged by: Claude (session-log skill) | Session060_
