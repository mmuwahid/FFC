# Session S067 — Injury / Unavailable list — spec + plan

**Date:** 04/MAY/2026
**PC:** Work (`UNHOEC03`)
**Branch:** main
**Start HEAD:** 609ca3a
**End HEAD:** 9e4cb8a
**Migrations applied:** 0
**Open PRs closed:** 0
**GH issues closed:** 0

---

## Goal

Net-new feature scoping session for Phase 3 backlog item: **long-term unavailability flag on profiles** (V3.0:147). User asked to also add **H2H (head-to-head) comparison** (V3.0:144) — decomposed into a separate spec/plan to be written in a follow-up session. This session covers injury/unavailable list only: brainstorm → design spec → implementation plan.

---

## Work done

No DB or app code touched. Two new docs created.

### `docs/superpowers/specs/2026-05-04-injury-unavailable-design.md` (design spec)

Approved design via 6 clarifying questions:

| Q | Decision |
|---|---|
| 1. State scope | Typed states: Injured / Travelling / Suspended / Retired (4 non-available states + Available) |
| 2. Authority | Self-serve from Settings; admin override via AdminPlayers |
| 3. Return logic | Optional return date; auto-clears at 00:00 UAE on that date via pg_cron |
| 4. Poll behaviour | Hide unavailable players entirely from poll until they return |
| 5. Leaderboard | Stay in rank, muted with status pill |
| 6. Notifications | Admin push when player self-marks; admin override is silent; auto-clear notifies admins |

**Data-model approach chosen:** A — three columns on `profiles` (status enum + until + reason). No history table (YAGNI).

Full edge-case coverage: locked-roster (no auto-cascade — admin manually drops), open-poll-vote (cleared on flip to OUT), past-date until (RPC rejects), retired+until (rejected), status transition while OUT (fires fresh push), pg_cron miss (next-day catches up via `until <= CURRENT_DATE`).

### `docs/superpowers/plans/2026-05-04-injury-unavailable.md` (implementation plan)

12 tasks, bite-sized steps, no placeholders. Self-review clean. Mockup-first (Task 0 is gated on user approval per Rule #1).

Task summary:
- T0: HTML mockup of all 6 surfaces with verbatim live-CSS copy (Rule #1 gate)
- T1: Migration 0070 — enum + 3 cols + CHECK + 4 RPCs + view update + 2 notification kinds + pg_cron schedule
- T2: Apply migration + regen `database.types.ts`
- T3: Shared `<UnavailabilityPill>` component + CSS tokens
- T4: AppContext profile field extension
- T5: Settings — Availability card (self-serve + "I'm back")
- T6: AdminPlayers — Availability row + edit modal (silent admin override)
- T7: Poll — query filter + render exclusion + clear poll vote on OUT-flip
- T8: AdminRosterSetup pool — same filter (locked rosters not auto-modified)
- T9: Leaderboard — pill + dim row via `[data-unavailable]` attr
- T10: Profile — status banner
- T11: Full `tsc -b` + lint + dev-preview smoke + push + session-log close-out

S063 lessons baked in: explicit `::notification_kind` casts in all `INSERT INTO notifications` chains; `extractErrMessage` toast wrapper used in frontend handlers.

### Backfill: `sessions/S066/session-log.md`

S066 (token-efficiency audit, 04/MAY/2026 morning) shipped 3 commits closing GH issue #50 but was never formally logged. Reconstructed log from git history before adding S067 row, so INDEX progression stays continuous.

---

## Decisions

- **H2H comparison decomposed** into a separate session — same scope-check pattern brainstorming skill recommends for multi-subsystem requests. Independent DB queries, independent UI surface, no shared state with injury list. Will brainstorm + spec in S068+.
- **Mockup-first preserved** — even though the user said "skip and execute" mid-design-presentation, that meant skip the in-chat section-by-section design review, not skip Rule #1. Mockup is Task 0 of the plan.
- **Subagent-driven execution deferred to next session.** 12 tasks × 3 subagent dispatches per task is too heavy for this session's remaining context budget. Cleaner to commit spec + plan, end session, and start fresh next session for execution.

---

## Open at session end

- 0 PRs · 0 issues open.
- Live DB: 69 migrations (unchanged).
- Live: https://ffc-gilt.vercel.app (unchanged).
- Spec + plan committed and pushed; ready for S068 to start at Task 0 (mockup).

---

## Patterns to remember

- **For multi-feature requests, decompose at brainstorm-skill scope-check time** rather than refining a combined spec. Each gets spec → plan → build cycle independently.
- **Approach selection (3 options + recommendation)** keeps data-model decisions explicit and tied to YAGNI. Approach A here was the right call: no premature history table.
- **Edge cases live in the spec**, not the plan. Plan tasks reference them via constraint/RPC validation; reviewer can cross-check spec at sign-off without reading the plan.
- **Recommend session split** when the plan is 10+ tasks and brainstorming has already consumed significant context. Cleaner handoff > squeezing tasks into a fading context window.
