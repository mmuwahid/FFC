# Session S015 — 21/APR/2026 (Home PC)

**Focus:** Phase 1 implementation kickoff — Step 0 of V2.8 sequencing. End state: end-to-end GitHub → Vercel pipeline live with Supabase env vars verified in production build.

**Outcome — full close of Step 0:**
- **Workspace migrated** from OneDrive to `C:/Users/UNHOEC03/FFC/` (git-only sync going forward; OneDrive kept as read-only snapshot).
- **GitHub repo** `github.com/mmuwahid/FFC` (private) created; 5 commits on `main`.
- **Supabase project** `ffc` (`hylarwwsedjxwavuwjrn`) created in a new FFC org (separate from PadelHub's), region **ap-south-1 Mumbai**, status Healthy.
- **Vercel project** `prj_2NszuyOepArCTUAJCOxH8NsAAeSv` (`ffc` on team `team_HYo81T72HYGzt54bLoeLYkZx`), Git-connected, Root Directory `ffc`, framework auto-detected as Vite, 3 auto-deploys from `main`, all READY.
- **6 env vars wired** clean (URL × 3 envs, anon key × 3 envs) — all set via `vercel env add --value --yes` after discovering PowerShell's `echo | pipe` appends `\n` and corrupts values.
- **Anon key upgraded** from legacy JWT (`eyJhbGci…`) to new publishable (`sb_publishable_EbFL…`) format to eliminate pending tech debt.
- **Step 0 acceptance verified twice** via DevTools console on `ffc-gilt.vercel.app` — both values resolve, exact lengths (40 / 46) confirm zero newline drift.
- **Logo rollout DEFERRED to S016** — user still to export transparent PNG/SVG from `shared/FF_LOGO_FINAL.pdf`.
- **Step 1 (scaffold elaboration) + Step 2 (11 migrations) DEFERRED to S016** — clean handoff for focused impl session.

**Live:** https://ffc-gilt.vercel.app

---

## Item 1 — Cold-start briefing

Invoked `anthropic-skills:session-resume`. Read `CLAUDE.md` (S014 summary at top), `sessions/INDEX.md` (14 rows), `sessions/S014/session-log.md` (full close), `tasks/todo.md` (S015 NEXT SESSION block). Briefing presented: design gate cleared; S015 is first code session; 5-item agenda (logo rollout blocked; Steps 0–2 of V2.8 ready).

User chose: **"straight to Step 0 — GitHub + Supabase + Vercel wiring"**, deferring logo until assets are ready.

---

## Item 2 — Framing decisions before execution

4 clarifying questions asked in sequence, all answered before any external system touched:

| Decision | Options considered | Chosen |
|---|---|---|
| Supabase org | (a) new project in existing PadelBattle org; (b) user creates new FFC org; (c) skip Supabase | **User created new FFC org manually** — strictest interpretation of the separation rule in memory |
| Git repo location | (a) OneDrive root; (b) separate path C:/Users/UNHOEC03/FFC/; (c) subfolder only | **Separate path outside OneDrive** — collaboration-friendly, eliminates `.git/` corruption risk from OneDrive sync, git+GitHub becomes the sync mechanism across PCs |
| Repo scope (what collaborator sees) | (a) everything incl. sessions + planning; (b) code + design only; (c) code only | **Everything** — fullest context for collaborator; _wip + .claude + .superpowers + brief-screenshots gitignored |
| Migration safety | (a) copy + keep OneDrive as snapshot; (b) move; (c) start fresh | **Copy + keep OneDrive** — safety net during transition |

Key reasoning surfaced to user: OneDrive actively syncs `.git/` object store → known corruption source; git workflow adds explicit push/pull discipline (slight friction) but enables proper collaboration and cross-PC work via a single source of truth.

---

## Item 3 — Workspace migration

```
source:  C:/Users/UNHOEC03/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC   (32 MB, 77 files)
target:  C:/Users/UNHOEC03/FFC/                                                                                 (32 MB, 77 files)
```

- `mkdir -p` target → `cp -r . <target>` from source root → `du -sh` + file-count verification (77 = 77, 32 MB = 32 MB).
- OneDrive copy untouched — serves as frozen pre-migration snapshot until user is comfortable deleting.

---

## Item 4 — Repo scaffolding

Preparation before `git init`:

- **`.gitignore`** written at repo root covering: `node_modules` · `dist` · `.env*` · `.vercel/` · `.claude/` · `.superpowers/` · `_wip/` · OS/editor noise · `docs/brief-screenshots/` (13 MB of regenerable PNGs excluded).
- **`README.md`** written at repo root: project description · stack table · folder layout · getting-started stub · pointers to masterplan V2.8 + design spec + mockups.
- **Mockups copied** from `.superpowers/brainstorm/635-1776592878/content/` (which is `.gitignored`) to `mockups/` (tracked). 10 HTML files + `ffc-logo.jpg` + `welcome.html`. Fixes a README path that would have pointed collaborators into a gitignored directory.

---

## Item 5 — GitHub repo + first push (with TLS detour)

1. `git init -b main` in `C:/Users/UNHOEC03/FFC/`.
2. **Committer identity** set locally via `git config user.name "Mohammed Muwahid"` + `git config user.email "m.muwahid@gmail.com"` (per CLAUDE.md cross-PC rule — not the work-PC default).
3. **Initial commit `1c03b7b`** — 52 files, 20,746 insertions. Full design artifact set.
4. **`gh auth login` failed with TLS cert-verification error** (`x509: certificate signed by unknown authority`). Root cause: Go-compiled binaries ship their own CA pool; the user's network (home router or antivirus HTTPS inspection) presents an intercepting cert that Windows trusts but Go's CA pool doesn't.
5. **PAT workaround attempted** (`gh auth login --with-token < token.txt`) — same TLS wall on `api.github.com/` validation call.
6. **Pivoted to path B**: user created the empty repo in Chrome at https://github.com/new (Chrome uses Windows cert store → works). I wired the remote via `git remote add origin https://github.com/mmuwahid/FFC.git` and pushed.
7. **`git push`** succeeded first try — git on Windows uses `schannel` backend which reads the OS cert store, not Go's pool. Confirmed via `git config --get http.sslBackend` → `schannel`.

---

## Item 6 — Supabase project

- User created a new **FFC** org on supabase.com directly (MCP couldn't create orgs, and my OAuth-scoped MCP still sees only PadelBattle's org — noted as an open item to reconnect the Supabase MCP with FFC-scoped PAT in a future session).
- User created project **FFC** in that org:
  - Project URL: `https://hylarwwsedjxwavuwjrn.supabase.co`
  - Project Ref: `hylarwwsedjxwavuwjrn`
  - Region: `ap-south-1` (South Asia / Mumbai) — chosen based on UAE latency (~50–100 ms vs ~150 ms from London).
  - Compute: `t4g.nano` (Free tier).
  - Security settings I recommended (enabled at create time): Enable Data API ✓; **Automatically expose new tables** ✗ (explicit RLS-per-table discipline via `0009_rls.sql`); **Enable automatic RLS** ✓ (belt-and-suspenders safety for any table created outside migrations).
- User saved all 5 credentials (DB password · publishable key `sb_publishable_...` · legacy anon JWT · secret key `sb_secret_...` · legacy service_role JWT) to their password manager. I never saw the DB password or service_role key.

---

## Item 7 — Vite scaffold + Vercel project + first deploy

- **`npm create vite@latest ffc -- --template react-ts`** from repo root → scaffolded React 19.2.5 + Vite 8.0.9 + TypeScript 6.0.2 into `ffc/`. 18 files.
- CLAUDE.md's Stack line says "React 18" — React 19 is the current stable in April 2026. Accepted; flagged for a CLAUDE.md stack-line bump at close.
- **Commit `caa3e0a`** — `Step 1 (minimal) — scaffold Vite + React + TypeScript in ffc/`.
- **`npx vercel login`** via device-OAuth worked on the first try (Node's HTTP client appears to read Windows cert store for npm registry calls — TLS wall is specific to Go binaries). User confirmed "Congratulations! You are now signed in."
- **`npx vercel link --yes --project FFC`** rejected (uppercase). Retried with `--project ffc` → linked to `mmuwahid-4273s-projects/ffc`, project ID `prj_2NszuyOepArCTUAJCOxH8NsAAeSv`, framework auto-detected as Vite.
- **`npx vercel git connect https://github.com/mmuwahid/FFC.git --yes`** connected the GitHub repo (CLI needed the explicit URL because we ran from the `ffc/` subdirectory, not the repo root).
- **`npx vercel --yes`** from `ffc/` — first CLI deploy, went to production target, READY in ~30s. Aliases include `ffc-gilt.vercel.app`.

---

## Item 8 — Root Directory + env vars + Step 0 acceptance

### 8.1 Root Directory
User set **Root Directory = `ffc`** via Vercel dashboard → Project Settings → Build and Deployment. Required for GitHub push-triggered builds since our repo has the Vite app in a subdirectory, not at repo root. Framework preset confirmed as Vite.

### 8.2 Env vars — first attempt (via `echo | pipe`)
User ran `echo https://...supabase.co | npx vercel env add VITE_SUPABASE_URL production` and similar for the other 5 envs. **Bug: PowerShell's `echo` always appends `\n`**, so 2 URL entries got saved with trailing newlines (Vercel warned "WARNING! Value contains newlines"). Preview environment also got hung on a "which Git branch?" prompt that consumed no input.

### 8.3 Interactive re-entry + missing production anon key
User recovered via interactive prompts (type value at prompt instead of piping). Got 4 of 6 entries but accidentally ran `preview` twice and missed `production` for the anon key. Triple-confirmed state with `vercel env ls`.

### 8.4 First acceptance via commit `9f6fb76`
Added `console.log` lines to `ffc/src/main.tsx` reading `import.meta.env.VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. Pushed → **GitHub webhook fired** → Vercel auto-deploy (source `git`, not CLI) → READY in 30s. User verified in DevTools:
```
[FFC boot] Supabase URL: https://hylarwwsedjxwavuwjrn.supabase.co
[FFC boot] Anon key prefix: eyJhbGciOiJIUzI1…
```
**Step 0 first-pass accepted.** Legacy JWT anon key format noted for later cleanup.

### 8.5 Anon key swap (legacy JWT → publishable) — eliminate tech debt
User opted to swap immediately rather than defer. Received the `sb_publishable_EbFLhm6kXbTJBqrge-A7vw_0LswX2EB` value in chat (safe — Supabase UI explicitly states "Publishable keys can be safely shared publicly"; key lives in every client JS bundle we ship anyway).

Fully redid all 6 env vars using clean CLI flags:
```bash
npx vercel env rm <NAME> <env> --yes            # × 6
npx vercel env add <NAME> production --value "$V" --yes
npx vercel env add <NAME> preview "" --value "$V" --yes   # "" = all preview branches
npx vercel env add <NAME> development --value "$V" --yes
```

**Two CLI gotchas discovered:**
- `--value --yes` **bypasses the VITE_-prefix warning prompt and the "sensitive?" prompt** — clean, non-interactive, no `\n` contamination.
- For **preview**, `--yes` alone does NOT satisfy "Add to which Git branch? (leave empty for all Preview branches)" — Vercel CLI returns `{"reason":"git_branch_required"}` JSON error with a hint. **Fix**: pass empty string positional arg: `vercel env add <NAME> preview "" --value "$V" --yes`.

### 8.6 Second acceptance via commit `22a3209`
Edited `main.tsx` to log value **lengths** alongside prefixes — a future `\n` drift would immediately show as length 41 (URL) or 47 (anon key) instead of the expected 40 / 46. Pushed → auto-deploy READY. User verified:
```
[FFC boot] Supabase URL: https://hylarwwsedjxwavuwjrn.supabase.co (len: 40)
[FFC boot] Anon key prefix: sb_publishable_EbFLh… (len: 46)
```
Both lengths exact — **zero newline debt, publishable key resolving**.

---

## Files Created or Modified

### Commit 1 (`1c03b7b`) — 52 files, 20,746 insertions
- `.gitignore` (repo root) — new; excludes `_wip/`, `.claude/`, `.superpowers/`, `node_modules`, `.vercel`, `.env*`, `docs/brief-screenshots/`.
- `README.md` (repo root) — new; stack table, folder layout, pointers.
- 50 files copied wholesale from OneDrive source: `CLAUDE.md` · `archive/` × 3 · `docs/FFC App Brief.docx` + `build-collaborator-brief.js` + `platform/iphone-safe-area.md` + `superpowers/specs/2026-04-17-ffc-phase1-design.md` · `mockups/` × 11 (10 mockups + logo JPG) · `planning/` × 10 (V1.0 → V2.8) · `sessions/` × 15 (INDEX + S001–S014) · `shared/` × 3 (logo PDF, palette PDF, photo) · `tasks/` × 2 (todo, lessons).

### Commit 2 (`caa3e0a`) — 18 files, 679 insertions
- `ffc/` Vite + React 19 + TypeScript scaffold (`npm create vite@latest ffc -- --template react-ts`).

### Commit 3 (`9f6fb76`) — 1 file
- `ffc/src/main.tsx` — added 4-line env-var boot log block for Step 0 first acceptance.

### Commit 4 (`b0579d8`) — 1 file
- `ffc/.gitignore` — added `.vercel` (auto-added by `vercel link`).

### Commit 5 (`22a3209`) — 1 file
- `ffc/src/main.tsx` — replaced console logs with length-aware version (detects future `\n` drift).

---

## Key Decisions
- **Git-only sync, not OneDrive.** Workspace moved to `C:/Users/UNHOEC03/FFC/`. OneDrive actively syncs `.git/` and is a known git-corruption source; git+GitHub is the cross-device + collaborator sync mechanism. OneDrive folder retained as read-only snapshot until user confirms comfort.
- **Everything in the repo.** Sessions + planning + mockups + docs + shared assets all tracked — full design context for collaborators. Only `_wip/`, `.claude/`, `.superpowers/`, `docs/brief-screenshots/`, `node_modules`, env files, build artifacts excluded.
- **TypeScript scaffold.** Will generate Postgres → TS types from the 20-table schema via Supabase MCP `generate_typescript_types`; catches DB-drift at compile time — aligns with CLAUDE.md Rule #7 (verify DB columns).
- **React 19 accepted** (scaffold pulled 19.2.5). CLAUDE.md Stack line ("React 18") is stale; updated at session close.
- **Supabase region = ap-south-1 Mumbai** (not London). Chosen for UAE latency.
- **Legacy JWT anon key retired** in favour of `sb_publishable_...` — no blocker, but eliminates "future migration" pending item.
- **Vercel CLI over dashboard** for most setup — faster once `npx vercel login` worked. Dashboard reserved for Root Directory (no CLI equivalent).
- **Logo rollout + Step 1 + Step 2 deferred to S016.** Scope discipline: Step 0 alone is a genuine milestone. Session closed before token/energy wall.

---

## Open Questions
- **Supabase MCP scope.** My MCP tool is still authenticated against a PAT scoped to the PadelBattle org and can't see the new FFC org. For S016 migrations via MCP (`apply_migration`), user needs to reconnect the Supabase MCP in Claude settings with a PAT that includes the FFC org — or we stick with `npx supabase db push` (CLAUDE.md's preferred path anyway). — **Mohammed** — **This Week** (must resolve before Step 2).
- **Logo transparent PNG/SVG export.** Still pending user deliverable from `shared/FF_LOGO_FINAL.pdf`. Blocks: PWA manifest icons, welcome screen crest, WhatsApp OG image. — **Mohammed** — **When Possible**.
- **Brand palette re-alignment.** Mockups use red+navy; brand palette (`shared/COLORS.pdf`) is black+white+khaki-gold+cream. User explicitly chose to keep current palette at S012. Still on backburner. — **Mohammed** — **When Possible**.
- **`gh` CLI TLS.** Go-binary CA-pool issue unresolved. Workaround is functional (browser + git push). If user wants `gh repo` / `gh pr` commands later, point `SSL_CERT_FILE` at the network's CA bundle. — **Mohammed** — **When Possible**.

---

## Lessons Learned

### Mistakes
| Date | Mistake | Root Cause | Prevention Rule |
|------|---------|------------|-----------------|
| 21/APR/2026 (S015) | Set 3 Vercel env vars via `echo "value" \| npx vercel env add` in PowerShell. Values stored with trailing `\n`, which would have broken `fetch(url)` and `createClient(url, key)` at runtime. Console output was misleading (console.log hides invisible `\n`). | PowerShell `echo` (alias for `Write-Output`) always appends a trailing newline. CLIs that read stdin-to-EOF capture the newline as part of the value. Git Bash's `echo -n` suppresses, but PowerShell has no direct equivalent. | **For Vercel env vars on Windows, always use `vercel env add <NAME> <env> --value "<v>" --yes`. For preview specifically, pass empty string positional branch: `vercel env add <NAME> preview "" --value "<v>" --yes`. Never use `echo \| pipe` in PowerShell to feed stdin to a CLI that treats value-to-EOF. If piping is necessary, use `printf '%s' "$v"` from Git Bash (no `\n`), NOT `echo`. Add a runtime canary: `console.log(..., '(len:', v.length, ')')` so a newline-drift shows as length = expected+1.** |
| 21/APR/2026 (S015) | `gh auth login` failed with `x509: certificate signed by unknown authority` despite Chrome loading `github.com` fine in the same browser. Burned ~15 min on PAT workaround attempts before pivoting. | Go-compiled binaries (`gh`, `docker`, `kubectl`, etc.) ship their own Mozilla CA bundle and ignore the Windows cert store. If the network does TLS interception (corporate SSL-inspection, some home antivirus, some routers), the intercepting cert chain is installed in the OS cert store but NOT in Go's CA pool. Chrome uses the OS store → works; gh doesn't → fails. The PAT login flow ALSO calls `api.github.com` to validate the token, so switching auth method doesn't help. | **For Windows with any TLS-interception suspicion: skip `gh` CLI entirely. Create repos in Chrome at github.com/new; use `git` (which on Windows defaults to `schannel` backend = OS cert store) for push/pull. Verify with `git config --get http.sslBackend` → should say `schannel`. If `gh` is required later, get the network's CA bundle as `.pem` and set `SSL_CERT_FILE` env var — but for 95% of git workflows, raw git is sufficient.** |
| 21/APR/2026 (S015) | Attempted to automate Vercel env-var prompts by piping `printf '\n%s\nn\n' "$K"` to `vercel env add`. The `\n` after the value was still interpreted as a trailing character on the value — CLI warned "Value contains newlines". Wasted one round of setup. | Vercel CLI reads stdin as the VALUE prompt response — including any newline you use to terminate it. Stdin-via-pipe cannot cleanly answer multi-prompt interactive flows (value + warning + sensitive + branch) because each `\n` boundary becomes content, not separator. | **For any Vercel env var, use `--value --yes` flags — they bypass all prompts cleanly. The `--yes` flag alone does NOT satisfy the preview-branch prompt, though — positional empty string `""` is required: `vercel env add <NAME> preview "" --value "$v" --yes`. Discovered via CLI's own `next[]` hint in a JSON error response — read JSON errors from Vercel CLI carefully; they contain copy-paste fixes.** |
| 21/APR/2026 (S015) | README.md initially linked to mockups at `.superpowers/brainstorm/635-1776592878/content/` — a gitignored path. Collaborators cloning the repo would see no mockups at the advertised path. | I wrote `.gitignore` (excluding `.superpowers/`) and `README.md` as near-simultaneous operations without cross-checking that paths the README referenced were INSIDE the tracked set. The `mockups/` folder per CLAUDE.md folder layout existed but was empty — the actual HTML files lived under `.superpowers/`. | **Any file referenced from README.md or documentation MUST be inside the tracked set (or explicitly excluded with a note). Before committing, do a sanity grep: `grep -oE '(docs/\|mockups/\|planning/\|shared/)[^ ]+' README.md` and verify each path is `git check-ignore` clean. For FFC, mockups' canonical home is `mockups/` — keep them there, not under tool-specific paths. Copy (don't move — originals may be referenced by other tools) from `.superpowers/` to `mockups/` when a mockup is user-approved.** |

### Patterns That Work
- [21/APR/2026] (S015) **Cross-PC + collaborator sync via git, not OneDrive.** OneDrive is convenient for personal working files but corrupts `.git/` periodically and can't be shared with collaborators. Migration to `C:/Users/UNHOEC03/FFC/` + pushing to GitHub gives: deterministic diffs (no silent sync conflicts), time-travel via commit history, `git clone` onboarding for collaborators, a single source of truth. Discipline cost: `git pull` at start, `git push` at end of each session on each PC. **Why worth remembering:** moving the workspace felt like a big step but inverted the risk model — silent OneDrive corruption → explicit git operations.
- [21/APR/2026] (S015) **`vercel env add --value "<v>" --yes` is the only clean non-interactive way** to set Vercel env vars on Windows. Three-arg positional variant with empty string is required for preview environment + all preview branches: `vercel env add <NAME> preview "" --value "<v>" --yes`. **Why worth remembering:** the help output suggests `--value --yes` alone works for preview, but that's misleading — the CLI errors out asking for a branch. Empty-string positional arg is the documented "all preview branches" signifier and must be passed even with `--yes`.
- [21/APR/2026] (S015) **Log env-var value lengths alongside prefixes as a runtime canary.** `console.log(..., '(len:', value.length, ')')` gives you an instant visual tell for newline drift: an extra `\n` shows as length = expected+1, which is impossible to miss. This caught zero drift on the re-acceptance but would have caught newline pollution had it existed. **Why worth remembering:** invisible chars (`\n`, `\r`, zero-width space) are notorious for passing string inspection. Length is a deterministic check that doesn't depend on how console.log renders.
- [21/APR/2026] (S015) **Publishable key vs. legacy JWT anon key — swap early.** Both work; supabase-js supports both. But the publishable key is forward-compatible with Supabase's rotation story (per-key rotation; JWT anon is rotated by regenerating project's JWT secret which breaks everything). Swapping while no code yet depends on the key is nearly free (6 CLI commands, 1 redeploy). Swapping later means auditing every runtime caller of `createClient`. **Why worth remembering:** "will work for now" is a debt trap when the migration cost grows linearly with app size and the debt has zero upside.
- [21/APR/2026] (S015) **Hardcode a one-line acceptance test for each infrastructure milestone.** Step 0 acceptance was: "DevTools console shows correct URL and anon key prefix with exact lengths." Not: "deploy works." The latter is necessary but insufficient — env vars might not resolve, build might use wrong Node version, Root Directory might be mis-set. A concrete post-condition you can verify in 10 seconds post-deploy closes the loop. **Why worth remembering:** milestone drift ("the thing deployed, let's move on") costs 3× more to diagnose later when a symptom surfaces downstream.

---

## Next Actions (S016 plan)
- [ ] **Logo rollout** — unblocks when user exports transparent PNG/SVG from `shared/FF_LOGO_FINAL.pdf` (512/192/180/32 PNG + SVG master + WhatsApp OG 1200×630). Wire into welcome + mockups + PWA manifest.
- [ ] **Step 1 — Elaborate Vite scaffold with PadelHub boot patterns**:
  - `vite-plugin-pwa` + `manifest.webmanifest`
  - Supabase client singleton (`src/lib/supabase.ts` — consume `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`)
  - `ErrorBoundary` at route layout level
  - Global safe-area CSS (reference `docs/platform/iphone-safe-area.md`)
  - Inline splash HTML (kills cold-start flash)
  - Plain-object React Context (Rule #8)
  - Route skeleton: auth-aware layouts, 4-tab player / 5-tab admin / anon ref shells
  - `onAuthStateChange` subscription
  - **Acceptance (Step 1):** welcome screen renders; mock auth state change flips route layouts.
- [ ] **Step 2 — Write & run the 11 migration files**:
  - Reconnect Supabase MCP in Claude settings with PAT scoped to FFC org (optional — `npx supabase db push` works too).
  - Write SQL across `0001_enums.sql` → `0011_seed_super_admin.sql` per V2.8 §2.9 order (enums → base → match data → poll/ref → operational → views → helpers → RPCs → RLS → grants → seed super-admin).
  - `npx supabase link --project-ref hylarwwsedjxwavuwjrn` + `npx supabase db push`.
  - Seed `m.muwahid@gmail.com` as super_admin.
  - Verify on Studio: 20 tables · 20 RPCs · RLS enabled on all · 7 `app_settings` rows · super-admin row.
  - Smoke-test a hello-world Edge Function deploy.
  - **Acceptance (Step 2):** `SELECT * FROM seasons` returns one row; `SELECT * FROM profiles WHERE role='super_admin'` returns `m.muwahid@gmail.com`.
- [ ] **CLAUDE.md Stack line bump** from "React 18" to "React 19" (done at S015 close as part of this log).
- [ ] **Brand palette re-alignment** — still deferred. Revisit when user ready.

---

## Commits and Deploy
- **Commit 1:** `1c03b7b` — Initial commit — FFC Phase 1 approved design (52 files, 20,746 lines)
- **Commit 2:** `caa3e0a` — Step 1 (minimal) — scaffold Vite + React + TypeScript in ffc/
- **Commit 3:** `9f6fb76` — Step 0 acceptance — log env vars at boot to verify resolution
- **Commit 4:** `b0579d8` — Exclude .vercel/ (added by `vercel link`)
- **Commit 5:** `22a3209` — Step 0 re-acceptance — log env var lengths to detect newline drift
- **Live:** https://ffc-gilt.vercel.app (prod, auto-deploys from `main`)
- **Vercel project:** `prj_2NszuyOepArCTUAJCOxH8NsAAeSv` (`ffc` on team `team_HYo81T72HYGzt54bLoeLYkZx`)
- **Supabase project:** `hylarwwsedjxwavuwjrn` (`ffc` on new FFC org, region `ap-south-1`, status Healthy)

---
_Session logged: 21/APR/2026 | Logged by: Claude (session-log skill) | Session S015_
