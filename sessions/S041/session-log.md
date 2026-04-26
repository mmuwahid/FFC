# S041 — Phase 2 Slice 2B-B — Admin "Generate ref link" UI

**Date:** 26/APR/2026
**PC:** Home (`User`)
**Topic:** Slice 2B-B builds on the slice 2B-A backend foundation. Wires the admin-side UI that mints + manages ref tokens: each AdminMatches matchday card surfaces (post-roster-lock) a Ref link section with Generate / Copy / Regenerate / WhatsApp-share affordances and an expires-in countdown chip. Frontend-only — no migration.
**Outcome:** Complete. 5 commits pushed (1 plan + 2 feature + 2 code-review fixes); build clean; migration count on live DB unchanged at 28.

## What landed

### Slice 2B-B plan (commit `600ab99`)

Implementation plan written before any code under `docs/superpowers/plans/2026-04-26-phase2-slice-2B-B.md`. Scope: extend AdminMatches data layer with `activeToken` per matchday + `RefLinkSection` inside MatchdayCard + `RefLinkSheet` portal + single `handleMintRefLink` handler driving `regenerate_ref_token(p_matchday_id)`. CSS namespaced under `.admin-ref-link-*`. Acceptance criteria + risk table. Sets the bar the next commits must satisfy.

### Task 1 — Data layer (commit `c6add71`)

Extended `type MatchdayWithMatch` with optional `activeToken: { expires_at: string }`. Added a fourth `Promise.all` branch in `loadAll` querying `ref_tokens` filtered to `consumed_at IS NULL AND expires_at > now()`, building a `tokensByMd` Map keyed on `matchday_id`. Merge step folds the token info into each row alongside the existing `match` + `draft` fan-outs. Added `formatExpiresIn(iso)` helper for the chip ("expires in 4h 22m" / "expires in 12m" / "expired"). No UI yet — pure type + data work; Task 2 reads from these fields.

`tsc -b` EXIT 0 — `ref_tokens` typing is in the regenerated types from S040, so the new query is fully type-checked.

### Task 2 main — UI + sheet (commit `b2788c9`)

Three concrete additions inside `AdminMatches.tsx`:

1. **`RefLinkSection`** rendered inside MatchdayCard, conditional on `roster_locked_at`. Two states:
   - **No active token** → dashed-border `+ Generate ref link` CTA.
   - **Active token** → gold-tinted button showing `Ref link · expires in Xh Ym` + 🔄 icon. Tap regenerates (burns the previous token via the same RPC).
2. **`RefLinkSheet`** portal-rendered via `createPortal`. Captures the raw token in `useState` and builds `${origin}/ref/${token}`. Layout: title + explanation copy ("Shown once — regenerate to share again") + read-only URL `<input>` (long-press selectable on mobile) + grid of two action buttons (📋 Copy via `navigator.clipboard.writeText` + 💬 Share to WhatsApp via `https://wa.me/?text=<encoded message>`) + Done. Closes on scrim-tap or Done.
3. **`handleMintRefLink(md)`** — single handler shared between Generate and Regenerate. Calls `supabase.rpc('regenerate_ref_token', { p_matchday_id: md.id })`, captures the returned plaintext token, opens the sheet, then re-runs `loadAll()` so the card chip flips to fresh expiry the moment the sheet closes.

CSS appended under `.admin-ref-link-*`: dashed-border generate CTA, gold-accent active variant (`rgba(229,186,91,0.08)` / `rgba(229,186,91,0.35)` border), monospace URL input, safe-area-bottom padding on the sheet. Toast "Link copied" pattern reused — sheet stays open on copy so admin can also share to WhatsApp.

### Task 2 code-review fix #1 — sheet-class dedup (commit `2fa75b5`)

First-pass introduced a parallel naming family (`.admin-sheet`, `.admin-sheet-grabber`, `.admin-sheet-title`, `.admin-sheet-scrim`, `.admin-ref-sheet-actions`) for the new portal sheet. Self-review caught it before push: `<ConfirmSheet>` already lives in the same file using the shared `.sheet*` foundation. Two parallel naming families would drift in style over time as one gets a tweak the other doesn't.

Fix: dropped the `admin-` prefix on the sheet structural classes. `.sheet`/`.sheet-scrim`/`.sheet-grabber`/`.sheet-title`/`.sheet-actions` are the single source of truth; only the truly-novel ref-link bits (`.admin-ref-link-*` for the section CTAs + URL input + sheet-specific copy) keep custom classes. `RefLinkSheet`'s JSX adjusted to use the shared classnames.

### Task 2 code-review fix #2 — double-tap guard (commit `1d22d8e`)

The Generate / Regenerate button issued an RPC followed by a `loadAll()` refresh. A fast second tap before `loadAll()` resolved would issue a second RPC — slice 2B-A's advisory lock still serialises the burn-then-mint, but the second call burns the just-minted token from the first, so the admin's first sheet shows a now-already-burned URL.

Fix: added `mintBusy: string | null` component state (`null = idle | <md.id> = busy on this row`). Click-handler short-circuits if `mintBusy === md.id`. The button receives `disabled={mintBusy === md.id}`. Cleared in a `finally` block so a thrown RPC doesn't permanently lock the row.

## Verification

### Build

`node ./node_modules/typescript/bin/tsc -b` EXIT 0 at every commit checkpoint. `node ./node_modules/vite/bin/vite.js build` produces 11 PWA precache entries / ~1485 KB. Vite warned 0× on the new code.

### No migration changes

`supabase migration list` unchanged at 28 entries. No SQL files added or modified. `regenerate_ref_token` RPC was already live (slice 2B-A) — this slice is purely the UI binding.

### No UI files touched outside scope

Modified files: `ffc/src/pages/admin/AdminMatches.tsx` + `ffc/src/pages/admin/admin-matches.css` only.

## Patterns / lessons (additive)

- **One-shot raw token UX pattern.** When a server returns a one-shot secret (here: plaintext base64url token, server stores `sha256(token)` only), the UI must capture it the moment the RPC resolves and never persist it. The matchday-row reload only fetches the chip-driving fact (`expires_at`) afterwards, not the token. If the admin closes the sheet, the URL is gone forever — they must regenerate. Pattern: keep the raw secret in `useState`, never in any persistent store, never in the parent row.
- **`loadAll` fan-out for derived per-row state.** When a per-card UI needs auxiliary data that lives in a different table (`ref_tokens` per matchday), fetch it as an additional `Promise.all` branch in the same load function and merge into the row type via a Map lookup. Single source of truth for the page state; no per-card `useEffect` queries that would N+1.
- **Reuse base sheet classes — don't invent parallel naming.** When a portal-rendered sheet already exists in the same file using a shared class family (`.sheet*` for `<ConfirmSheet>`), reuse the foundation. Only truly-novel ref-link bits earn custom classes. Two parallel naming families would drift in style over time; the dedup is cheap to do at write-time and prohibitively expensive once both are deployed.
- **`mintBusy: string | null` per-row in-flight guard.** When a button issues a side-effecting RPC followed by a state-refreshing query, fast double-tap can race the refresh. Storing the in-flight identifier as `null | <id>` lets the disabled-state + click-handler short-circuit synchronously, no ref-vs-state mismatch. Cleared in `finally` so a thrown RPC doesn't permanently lock the row. Re-usable for any "fire RPC then reload list" interaction.
- **WhatsApp deep link via `wa.me`.** `https://wa.me/?text=<encoded>` opens the app on mobile and Web WhatsApp on desktop. The phone number is omitted (no `?phone=`) so the user picks the recipient. `target="_blank"` + `rel="noreferrer noopener"` is the safe default. Works on iOS WhatsApp ≥ 2.21; canonical Meta-blessed URL scheme.

## Commits

| SHA | Message |
|---|---|
| `600ab99` | docs(plan): slice 2B-B — admin Generate ref link UI on matchday cards |
| `c6add71` | feat(s041,2b-b): AdminMatches data layer for active ref tokens |
| `b2788c9` | feat(s041,2b-b): admin "Generate ref link" UI on matchday cards |
| `2fa75b5` | fix(s041,2b-b): reuse existing sheet base classes — drop parallel admin-sheet-* |
| `1d22d8e` | fix(s041,2b-b): in-flight guard on regenerate_ref_token — prevent double-tap race |

## Next session: S042

- **Slice 2B-C** — RefEntry pre-match mode. Token URL `/ref/:token` opens to roster confirmation + KICK OFF button + screen-wake lock. Calls a new public-RPC `get_ref_matchday(token)` to fetch matchday + rosters anonymously (token validates server-side; sha256 lookup per slice 2B-A pattern). Persist start-timestamp to `localStorage[ffc_ref_<sha256>]` so refresh survives.
- Carry-over backlog still pending acceptance: S031 21-item checklist, S032/33/34/35 acceptance items.
- Captain reroll live test — deferred until MD31 runs in-app.
- Backburner unchanged.
