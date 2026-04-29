# Phase 3 — WhatsApp Share PNG (Match Result Card Generator)

**Date:** 2026-04-29
**Session:** S054
**Source:** V3.0:140 backlog ("WhatsApp share PNG generator (server-side render of result card)")
**Status:** Brainstorming approved; design spec drafted; mockups + implementation plan to follow.

## Goal

Give an admin a one-tap way to broadcast the canonical Thursday-night match result to WhatsApp. The flow is: admin approves the ref entry → a "📲 Share to WhatsApp" button surfaces → tapping it produces a 1080×1080 PNG (rendered server-side from match data) and hands it to the device's native share sheet via the Web Share API. The result card stays available for re-broadcast from the standard `MatchDetailSheet` afterward.

The card's content is the **scoreboard + scorers + MOTM** — enough story to stand alone in WhatsApp without forcing a click into the app.

## Non-goals

- **Not a generic share endpoint.** Only an admin can mint a card. Players cannot share other players' matches; non-admin users don't see the button.
- **Not for in-progress / pending / rejected matches.** Render is gated to `approved` matches only.
- **Not a multi-format generator.** Only square 1080×1080 (the universal WhatsApp-chat-and-Status-acceptable ratio). No 9:16 portrait, no 16:9 landscape, no link-preview 1.91:1. If we ever need a 9:16 Status card, it's a follow-up item.
- **Not a content-edit surface.** The PNG is a derived rendering of immutable match data. There is no admin-side text override, no caption editor, no "tweak the score on the card" affordance.
- **Not a notification mechanism.** This does not push, email, or auto-post to anything. The admin still chooses recipients in the native share sheet.
- **Not a Vercel function.** Stays on the Supabase Edge Function stack to avoid a second runtime + auth wiring (rejected approach B during brainstorming).
- **Not a client-side DOM-capture path.** Rejected approach C — unreliable cross-device, contradicts masterplan's "server-side render" commitment.

---

## 1. User flow

### Primary path — admin approves and shares

```
Ref taps SUBMIT on live console
        │
        ▼
Admin opens review screen (MatchEntryReview)
        │ taps APPROVE
        ▼
Match transitions to `approved`
Leaderboard recomputes
Push notifications fire (existing S048 dispatch)
        │
        ▼
Review screen success state appears:
  "Match approved ✓"
  Primary CTA: [📲 Share to WhatsApp]   ← NEW
  Secondary: [Done]
        │ admin taps Share
        ▼
Frontend calls EF `render-match-card { match_id }`
EF returns { signed_url } (cache hit) or renders → uploads → signs (cache miss)
        │
        ▼
Frontend `fetch(signed_url)` → Blob → File("ffc-matchday-2026-04-24.png")
        │
        ▼
navigator.share({ files: [file], title, text })
        │
        ▼
Native iOS / Android share sheet opens
Admin picks WhatsApp → group chat → sends
```

### Re-share path — any approved match, later

```
User opens Matches list → taps a row
        │
        ▼
MatchDetailSheet opens (existing pattern, no URL change)
        │
        ▼
If current user `is_admin()` → footer shows [📲 Share to WhatsApp] button
Same EF call + Web Share API path as primary flow
```

### Failure handling

| Failure | Behaviour |
|---|---|
| `navigator.share` not available (e.g. desktop Chrome, no PWA install) | Button label switches to "📥 Download PNG"; tapping triggers a browser download of the same file. Admin opens WhatsApp themselves. (No "Open WhatsApp Web" link — kept simple per S054 brainstorming Q.) |
| EF returns 401 / 403 | Toast: "Couldn't generate share card — admin only." Button stays clickable for retry. No DB state mutated. |
| EF returns 5xx or network failure | Toast: "Couldn't generate share card — try again." Button stays clickable. |
| Web Share API supported but user dismisses the share sheet | Silent no-op. Same as cancelling any native sheet. Button remains. |
| `file` argument unsupported in `navigator.canShare({ files })` (rare on older Android Chrome) | Treat as if Web Share is unavailable → fall back to download. |

---

## 2. Architecture

### High-level

```
Frontend (React / Vite PWA)              Supabase
─────────────────────────────             ──────────────────────────────────
MatchEntryReview success state ─┐
                                ├──► [Edge Function] render-match-card
MatchDetailSheet admin footer ──┘     │
        ▲                             ▼ verify JWT, is_admin() guard
        │ download blob               │
        │                             ▼ rpc('get_match_card_payload', { p_match_id })
        │                             │
        │                             ▼ check storage cache (match-cards/<match_id>.png)
        │                             │   hit  → sign URL, return
        │                             │   miss → satori(MatchCard{...}) → SVG
        │                             │          Resvg(svg).render() → PNG bytes
        │                             │          upload to bucket
        │                             │          sign URL, return
        │                             ▼
        └─────── Response.json({ signed_url }) ──────────────
              │
              ▼
        navigator.share({ files: [File] })
              │
              ▼
        Native iOS / Android share sheet
```

### Components

| Component | Type | Lives in | New? |
|---|---|---|---|
| `get_match_card_payload(p_match_id uuid)` | Postgres function | migration `0049_match_card_payload_rpc.sql` | new |
| `match-cards` bucket + RLS policies | Storage bucket | same migration | new |
| `render-match-card` | Supabase Edge Function | `supabase/functions/render-match-card/index.ts` | new |
| `lib/shareMatchCard.ts` | Frontend helper | `ffc/src/lib/shareMatchCard.ts` | new |
| `MatchCard` Satori component | TSX inside the EF | `supabase/functions/render-match-card/MatchCard.tsx` | new |
| Share button on `MatchEntryReview` success | UI | `ffc/src/pages/MatchEntryReview.tsx` (modify) | modify |
| Share button on `MatchDetailSheet` admin footer | UI | `ffc/src/components/MatchDetailSheet.tsx` (modify) | modify |

---

## 3. Data contract

### RPC: `get_match_card_payload(p_match_id uuid) returns jsonb`

`SECURITY DEFINER`, `is_admin()` body guard, `REVOKE EXECUTE FROM PUBLIC`, `GRANT EXECUTE TO authenticated`. Pattern matches S047/S052 admin RPCs.

#### Behaviour

1. If `NOT is_admin()` → `RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501'`.
2. If match not found OR `approved_at IS NULL` → `RAISE EXCEPTION 'Match must be approved' USING ERRCODE = '22023'`.
3. Otherwise return a single jsonb object (shape below).

#### Returned shape

```json
{
  "season_name": "Season 11",
  "match_number": 12,
  "total_matches": 22,
  "kickoff_iso": "2026-04-24T19:00:00+04:00",
  "kickoff_label": "Thu, 24 Apr 2026",
  "score_white": 4,
  "score_black": 2,
  "white_scorers": [
    { "name": "Mohammed", "goals": 2, "own_goals": 0 },
    { "name": "Ali",      "goals": 1, "own_goals": 0 }
  ],
  "black_scorers": [
    { "name": "Sam",      "goals": 2, "own_goals": 0 },
    { "name": "Rashid",   "goals": 0, "own_goals": 1 }
  ],
  "motm": { "name": "Mohammed", "is_guest": false }
}
```

In the example above: White scored 4, Black scored 2. Black player Rashid scored an own-goal that counted toward White's 4 — Rashid is listed under **`black_scorers`** (his actual team) with `own_goals: 1`. The team-level `score_white` / `score_black` figures still credit the goal correctly to White. This matches standard football-reporting convention (own-goal scorer attributed to their own team, with an OG marker).

#### Derivation rules

- **`season_name`** ← `seasons.name` via `matches.matchday_id → matchdays.season_id`.
- **`match_number`** ← rank of this matchday among non-friendly matchdays in the same season, ordered by `(kickoff_at, id)` ascending. SQL: `(SELECT COUNT(*) FROM matchdays md2 WHERE md2.season_id = v_matchday.season_id AND md2.is_friendly = false AND (md2.kickoff_at, md2.id) <= (v_matchday.kickoff_at, v_matchday.id))`. Friendly matchdays excluded so league-game numbering stays stable.
- **`total_matches`** ← `seasons.planned_games` (admin-configured per-season target). If `NULL`, falls back to total non-friendly matchday count for the season.
- **`kickoff_iso`** ← `matchdays.kickoff_at::text`.
- **`kickoff_label`** ← `to_char(matchdays.kickoff_at AT TIME ZONE 'Asia/Dubai', 'Dy, DD Mon YYYY')`. (Asia/Dubai matches the league's home timezone.)
- **`score_white` / `score_black`** ← `matches.score_white` / `matches.score_black` (canonical totals stored on the match row; not re-derived from events).
- **Scorer lists** ← aggregate from `match_events` where `event_type IN ('goal', 'own_goal')`:
  - Group by `(event.team, profile_id, guest_id)`. Each row credits the scorer to **their own team's** list — `event.team` is always the player's actual team, regardless of whether the event was a goal or own-goal.
  - For each row: `goals = COUNT(event_type='goal')`, `own_goals = COUNT(event_type='own_goal')`.
  - Sort within each side by `(goals + own_goals) DESC, name ASC`.
- **Player name resolution** ← `LEFT JOIN profiles ON profile_id` (use `display_name`); `LEFT JOIN match_guests ON guest_id` (use guest's display_name). For profiles where `deleted_at IS NOT NULL`, substitute `'Deleted player'` (matches Wall of Fame convention from S053).
- **MOTM** ← from `matches.motm_user_id` (profile path) or `matches.motm_guest_id` (guest path); `is_guest` flag indicates which. Same `Deleted player` substitution applies.

#### Why a single RPC vs. multi-query in the EF

- One round-trip → ~100 ms saved on cold-render path.
- Aggregation logic lives in Postgres (testable via `npx supabase db query --linked`), not split across TypeScript.
- Mirrors the S051 spec-vs-schema-drift trap — fewer column references in the EF to drift against later schema changes.

### Storage bucket: `match-cards`

| Property | Value |
|---|---|
| `id` / `name` | `match-cards` |
| `public` | `false` (private; signed URLs only) |
| Object key | `<match_id>.png` (single file per match, overwritable on `?force=true`) |
| Owner | `service_role` (EF context) |

**RLS on `storage.objects` for this bucket:**
- INSERT / UPDATE / DELETE: `service_role` only (default; no extra policy needed).
- SELECT: no public select; reads always go through `createSignedUrl`.

---

## 4. Edge Function: `render-match-card`

### Endpoint contract

| Property | Value |
|---|---|
| Path | `POST /functions/v1/render-match-card` |
| Auth | `Authorization: Bearer <user_jwt>` (verified via `supabase.auth.getUser`) |
| Body | `{ "match_id": "<uuid>", "force": false }` |
| `force` | Optional `boolean` (default `false`). When `true`, bypasses cache and overwrites stored PNG. Admin-only by virtue of the RPC guard. |
| 200 response | `{ "signed_url": "<https://...supabase.co/storage/v1/...&token=...>" }` (15-min expiry) |
| 401 | invalid / missing JWT |
| 403 | valid JWT but `NOT is_admin()` |
| 422 | `match_id` malformed / not approved |
| 5xx | render or upload failure |

### Render pipeline (cache miss path)

1. **Verify caller** — `supabase.auth.getUser(jwt)` → 401 on failure.
2. **Fetch payload** — `supabase.rpc('get_match_card_payload', { p_match_id })` → 403 / 422 on RPC errors.
3. **Render SVG** — `await satori(<MatchCard {...payload} />, { width: 1080, height: 1080, fonts: [PLAYFAIR_700, INTER_600] })`.
4. **Rasterise** — `new Resvg(svg, { fitTo: { mode: 'width', value: 1080 } }).render().asPng()`.
5. **Upload** — `supabase.storage.from('match-cards').upload(`${match_id}.png`, png, { contentType: 'image/png', upsert: force })`.
6. **Sign** — `supabase.storage.from('match-cards').createSignedUrl(`${match_id}.png`, 900)`.
7. **Return** `{ signed_url }`.

### Render pipeline (cache hit path)

1. Verify caller (steps 1 above).
2. Check storage existence via `list('', { search: '<match_id>.png' })`.
3. If `force === false` AND the object exists → skip steps 3–5, jump straight to sign + return.

### Embedded fonts

| Slot | Font | Weight | Licence |
|---|---|---|---|
| Score numbers, body | Inter | 600 | SIL OFL 1.1 |
| Title, scorer names | Playfair Display | 700 | SIL OFL 1.1 |

Why these two:
- The awards page CSS declares `Fraunces, "Playfair Display", Georgia, serif` but **none of those are loaded as web fonts** today, so on every real device users see Georgia. We ship Playfair Display in the EF — it's the closest open-licensed match to the *intent* of the brand-serif chain. The PNG will look slightly more refined than the in-app awards page; that's deliberate (broadcast > everyday).
- Inter for body covers the score numbers and the scorer rows in a clean modern sans, similar to the in-app system-stack rendering.

**Bundled, not fetched.** Both TTF buffers are committed to `supabase/functions/render-match-card/fonts/` (Inter-SemiBold.ttf ~310 KB, PlayfairDisplay-Bold.ttf ~210 KB) and imported via Deno's static-asset pattern (`Deno.readFile(new URL('./fonts/...', import.meta.url))` cached in module scope on cold-start). No external HTTP at runtime — eliminates egress-firewall risk and CDN-latency variance.

### FFC crest handling

- Source: `ffc/public/ffc-crest.svg` (~11.5 KB, vector, extracted via PyMuPDF in S051).
- Inline as `<img src={CREST_DATA_URI} />` in the Satori tree, where `CREST_DATA_URI = 'data:image/svg+xml;base64,' + base64(crestSvg)`.
- Crest fetched from `ffc/public/ffc-crest.svg` (or a copy committed to the EF folder) at EF startup, cached in module scope.
- **Risk:** Satori supports a subset of SVG. If the crest's path data uses any unsupported feature (e.g. nested transforms with skew), Satori silently drops it. Mitigation: in mockup phase, render the crest in a Satori playground first; if anything's off, pre-rasterize to a 256×256 PNG and ship that as the data URI instead.

### Cold-start cost

| Phase | First call | Warm call |
|---|---|---|
| Font load (from disk) + Resvg WASM init | ~1–1.5 s | 0 (module-scope cached) |
| RPC + Satori + Resvg render | ~400 ms | ~400 ms |
| Storage upload | ~200 ms | n/a (cache hit) |
| Total | ~1.5–2 s | <500 ms (cache hit ~250 ms) |

A "Generating card…" spinner on the button covers the cold-start UX.

---

## 5. Frontend wiring

### `lib/shareMatchCard.ts` (~80 LOC)

Single export:

```ts
export async function shareMatchCard(matchId: string): Promise<ShareResult>
```

Returns a discriminated union:

```ts
type ShareResult =
  | { kind: 'shared' }              // navigator.share completed
  | { kind: 'cancelled' }           // user dismissed share sheet
  | { kind: 'downloaded' }          // fallback path triggered download
  | { kind: 'error'; message: string }
```

Implementation outline:

```ts
async function shareMatchCard(matchId: string): Promise<ShareResult> {
  // 1. Call EF
  const { data, error } = await supabase.functions.invoke('render-match-card', {
    body: { match_id: matchId },
  });
  if (error) return { kind: 'error', message: error.message };
  const { signed_url } = data as { signed_url: string };

  // 2. Download blob
  const res = await fetch(signed_url);
  if (!res.ok) return { kind: 'error', message: 'Failed to fetch card' };
  const blob = await res.blob();
  const file = new File([blob], filenameFor(matchId), { type: 'image/png' });

  // 3. Web Share API path
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'FFC Match Result', text: 'Result is in 🏆' });
      return { kind: 'shared' };
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return { kind: 'cancelled' };
      // fall through to download
    }
  }

  // 4. Download fallback
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  return { kind: 'downloaded' };
}

function filenameFor(matchId: string): string {
  return `ffc-match-${matchId.slice(0, 8)}.png`;
}
```

### Call site 1: `MatchEntryReview.tsx`

The existing review screen already has APPROVE / REJECT buttons. After APPROVE succeeds, the screen swaps into a success state:

```
┌──────────────────────────────┐
│ ✓ Match approved             │
│                              │
│  Final score:                │
│  WHITE 4 – 2 BLACK           │
│                              │
│  ┌────────────────────────┐ │
│  │ 📲 Share to WhatsApp   │ │  ← primary CTA
│  └────────────────────────┘ │
│  ┌────────────────────────┐ │
│  │ Done                   │ │  ← secondary
│  └────────────────────────┘ │
└──────────────────────────────┘
```

The Share button calls `shareMatchCard(match.id)`; while the EF runs, the button shows "Generating card…" and is disabled. On any `ShareResult` other than `error`, the button re-enables (admin can re-share). On `error`, a toast appears and the button re-enables for retry.

### Call site 2: `MatchDetailSheet`

This sheet is opened from row-tap on the Matches list. Currently a read-only view of a match. We add an **admin-only footer**:

```
[ existing match details ... ]
─────────────────────────────────
Admin tools                          ← footer separator (only renders if is_admin)
[ 📲 Share to WhatsApp ]
```

Same `shareMatchCard(match.id)` call. Visible only when `currentUser.role === 'super_admin' || currentUser.role === 'admin'` (matches existing admin-gating elsewhere).

---

## 6. Auth model

| Layer | Check | Failure mode |
|---|---|---|
| Frontend Share button | Render-time check on `useAppContext().role` (admin / super_admin only) | Button doesn't render |
| EF entry | `supabase.auth.getUser(jwt)` | 401 |
| RPC body | `IF NOT is_admin() THEN RAISE EXCEPTION ...` | 403 surfaced as error |
| Storage bucket | `service_role` writes only; reads via signed URL | n/a (server-side) |

Defence-in-depth — three independent gates. A non-admin who somehow finds the EF endpoint can't render a card; an admin who bypasses the frontend can still only render their own admin-permitted matches.

---

## 7. Failure modes & decisions

| Question | Decision |
|---|---|
| Cache TTL? | Forever. Match results are immutable post-approval; ~100 KB × ~50 matches/season ≈ 5 MB/yr; Free tier ships 1 GB. |
| `?force=true` flag? | Yes. Admin-only by RPC guard. Used during dev iteration or one-off render glitch. |
| Web Share API unavailable fallback? | Download PNG only. No "Open WhatsApp Web" link (kept simple; admin opens WA themselves). |
| Soft-deleted players on the card? | Render as `'Deleted player'` (matches Wall of Fame convention). Their goals still count to team total. |
| MOTM = soft-deleted profile? | Same — `'Deleted player'`. |
| Match never had MOTM picked? | `motm: null` in payload; renderer omits the MOTM line entirely. |
| Match was a 0-0 draw? | Empty scorer lists, "0 – 0" scoreboard. Renderer shows a centred "—" in each empty column. |
| Guest scorer with no `display_name`? | Substitute "Guest". Schema constraint should prevent this in practice. |
| Match number derivation includes / excludes friendly matchdays? | Excludes (`is_friendly = false`). League-game numbering stays sequential even if friendlies are interleaved. |
| `seasons.planned_games` is NULL? | Fall back to `COUNT(*)` of non-friendly matchdays in the season. Card still reads "Match 12 of N". |
| Admin opens MatchDetailSheet for a non-approved match? | Share button hidden (only shown when `match.approved_at IS NOT NULL`). |
| pg_net or HTTP available in EF for crest fetch? | EF reads crest from a local file committed to `supabase/functions/render-match-card/ffc-crest.svg`. No external HTTP. |
| Storage upload race on concurrent Share clicks? | Storage `upsert` is idempotent; second uploader wins (deterministic content); both callers get the same signed URL on next sign call. Acceptable. |
| What if `seasons.name` changes after the card was cached? | Cache stays. The PNG is a frozen snapshot of the moment. To re-render, admin uses `?force=true`. Documented behaviour. |

---

## 8. Visual design

Finalised in `mockups/3-26-phase3-share-png.html` (commit `1eaf5cd`). The Satori `MatchCard` component must mirror this mockup element-for-element. CSS values translate to inline `style={{ ... }}` on the Satori JSX tree (Satori is layout-only, no real stylesheet — every element needs `display: flex` or it breaks).

A/B preview that informed the picks: `mockups/3-25-phase3-share-png-style-compare.html` (commit `d082023`).

**Final layout (1080×1080, hybrid serif-header + sans-body):**

```
┌──────────────────────────── 1080 ────────────────────────────┐
│           [FFC crest, 120×120, centred, top of card]          │
│                                                                │
│                       Season 11                                │  ← serif gold, 64px Playfair
│           Match 12 of 22 · Thu, 24 Apr 2026                   │  ← serif muted-gold, 28px
│                                                                │
│                                                                │
│        WHITE         │         BLACK                          │  ← uppercase sans, 28px, letter-spaced
│                      │                                         │
│          4           │           2                            │  ← sans 200px / 900 weight
│                                                                │
│              ↑ vertical gold gradient divider, 220px tall     │
│                                                                │
│      Mohammed × 2    │       Sam × 2                          │  ← sans 28px, line-height 1.4
│      Ali × 1         │       Rashid (OG)                      │
│                                                                │
│                                                                │
│            [✨ MOTM · Mohammed] (gold-bordered pill)           │  ← sans 24px uppercase, gold border
│                                                                │
│ (no footer)                                                   │
└────────────────────────────────────────────────────────────────┘
padding: 64px on all sides; flex column with `align-items: center`.
```

### Tokens & per-region treatment

| Region | Font | Size / weight | Colour | Notes |
|---|---|---|---|---|
| Crest | inline SVG | 120×120 | gold strokes | top of card, centred |
| Title (`Season 11`) | Playfair Display 700 | 64px | `#e5ba5b` accent | letter-spacing 0.02em |
| Meta (`Match 12 of 22 · Thu, 24 Apr 2026`) | Playfair Display 700 | 28px | `#c9b88a` muted-gold | single line; no venue, no friendly indicator |
| Team labels (`WHITE` / `BLACK`) | Inter 600 | 28px | `#f2ead6` cream | uppercase, letter-spacing 0.24em |
| Score numbers | Inter 600 (subbing for 900 unavailable) | 200px | `#f2ead6` cream | line-height 1; no leading-zero padding |
| Vertical divider | n/a | 2px wide × 220px tall | gradient `transparent → #e5ba5b → transparent` | between team columns and scorer columns |
| Scorer rows | Inter 600 | 28px | `#f2ead6` cream | each row a flex column item; line-height 1.4 |
| Empty scorer column | Inter 600 | 28px | `#6e6450` footer-muted | centred `—` |
| MOTM pill | Inter 600 | 24px uppercase | `#e5ba5b` text on transparent, gold border 1px | letter-spacing 0.16em; padding 12×28; border-radius 999px |
| Card background | n/a | n/a | `#0e1826` paper-navy | flat fill, no gradient |

### Edge-case rendering

- **0-0 draw:** scoreboard reads `0 — 0`; both scorer columns render a single centred `—` placeholder.
- **One-sided result (e.g. 5-0):** losing column renders `—` placeholder; winning column shows full scorer list.
- **Soft-deleted scorer / MOTM:** name replaced with `Deleted player` (matches Wall of Fame convention).
- **No MOTM picked:** the gold pill is omitted entirely. The scorer block extends to the bottom padding.
- **Long scorer name (e.g. > 16 chars):** allow natural wrap; the column is centred so wrapped lines stay aligned. No truncation.
- **Guest scorer:** rendered with `(G)` suffix appended to the name, e.g. `Sam (G) × 2`. (Implementation note: the renderer reads `is_guest` from the payload's MOTM block but for scorer lists, the guest distinction comes from whether `guest_id` was non-null in the source row — derived in the RPC by suffixing the name during JSON construction.)

All brand tokens align with CLAUDE.md "Per-screen brand tokens": `--bg:#0e1826` paper, `--text:#f2ead6` cream, `--accent:#e5ba5b` gold, `--muted:#c9b88a`, `--footer:#6e6450`.

---

## 9. Implementation breakdown

Six commits, finalised in the implementation plan:

1. **Migration** — `0049_match_card_payload_rpc.sql` adds:
   - `get_match_card_payload(p_match_id uuid) returns jsonb` (SECURITY DEFINER + is_admin guard + REVOKE EXECUTE FROM PUBLIC + GRANT EXECUTE TO authenticated)
   - `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('match-cards', 'match-cards', false, 524288, '{image/png}'::text[])`
   - RLS policy on `storage.objects` for SELECT (none — signed URLs only) and INSERT/UPDATE/DELETE (service_role only — covered by default role checks).
2. **EF source** — `supabase/functions/render-match-card/index.ts` + `MatchCard.tsx` + bundled `ffc-crest.svg` + bundled fonts (or remote fetch on cold-start). `npx supabase functions deploy render-match-card`.
3. **Frontend helper** — `ffc/src/lib/shareMatchCard.ts` (~80 LOC).
4. **Wire into `MatchEntryReview.tsx`** — success state + Share button + loading state + error toast.
5. **Wire into `MatchDetailSheet`** — admin-only footer + Share button.
6. **Final verify** — `tsc -b` (no unused imports per `noUnusedLocals: true`) + `vite build` + Edge Function smoke test against a real approved match.

Plan artifact: `docs/superpowers/plans/2026-04-29-phase3-share-png.md` (via writing-plans skill).

---

## 10. Risks & open items

| Risk | Severity | Mitigation |
|---|---|---|
| Satori can't render the FFC crest SVG cleanly | Medium | Test in mockup phase. Fallback: pre-rasterize crest to 256×256 PNG and inline as data URI. |
| Resvg-wasm cold-start adds 1.5-2 s | Low | Acceptable for once-weekly admin action. Loading spinner on button. |
| Web Share API behaves differently in iOS PWA standalone mode | Medium | Test on installed PWA. If standalone misbehaves, fall back to download in that path too. |
| Storage bucket RLS misconfigured (e.g. allows public LIST) | High | Migration creates bucket as `public=false`; verify via `SELECT * FROM storage.buckets WHERE id='match-cards'` post-deploy. |
| Font binary too large to deploy | Low | Bundled fonts together ≈520 KB. Supabase Edge Function deploy size cap is 10 MB. Well under. |
| Card looks bad on small WhatsApp thumbnails | Low | Mockup-first review on actual phone screens before approval. |
| Leak of pre-approval match data via cache hit on a re-rendered match | None | Cache key is `<match_id>.png`; pre-approval matches never get a cache entry because the RPC returns 422. |

### Decisions locked in mockup phase

- Header: crest top-centre, serif title beneath, meta sub-line below. ✓
- Score typography: TEAM WHITE / BLACK side-by-side with vertical gold divider; sans-serif 200px numbers. ✓
- Captain names on the card: **excluded.** Reduces visual noise. (Captain pair is visible inside the app for those who want it.)
- Late-cancellation indicators on the card: **excluded.** Too niche for the broadcast moment.
- Footer URL: **omitted entirely.** No URL, no timestamp. The card stands alone.
- Match number / total games: **shown** in the meta sub-line as `Match N of M`. Source: rank of non-friendly matchdays + `seasons.planned_games`.
- Venue: **excluded** from the card. It was in the original draft; user direction during mockup phase removed it.

---

## 11. Out of scope (explicit follow-ups)

- **9:16 portrait Status card.** Add as a sibling render path if league members request it.
- **Push notification with PNG attached** (e.g. "League result is in 🏆" + thumbnail). Different surface, different worker.
- **Auto-post to a configured WhatsApp group via WhatsApp Cloud API.** Heavyweight integration; only worth it if admins ask for fully-automated broadcasts.
- **Brand-customisable card** (admins can pick a layout per match). Premature.
- **Awards-page share PNG.** Same engine, different payload — can reuse `render-match-card`'s fonts + Resvg setup as `render-award-card` later.

---

**End of spec.**
