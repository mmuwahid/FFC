# FFC

Mobile-first PWA for managing a weekly 7v7 friends football league.
Monday poll → Thursday game cycle, with match history, leaderboard, seasons,
awards, and WhatsApp share integration. Phase 1 adds multi-format support
(7v7 default, per-matchday override to 5v5).

**Status:** Design Phase 1 APPROVED — implementation kickoff (S015).

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite, PWA |
| Backend | Supabase (Postgres + RLS + Auth + Edge Functions + Storage) |
| Auth | Email/password + Google OAuth |
| Hosting | Vercel (GitHub auto-deploy) |
| Region | `ap-south-1` (Mumbai) |

## Folder layout

```
FFC/
├── CLAUDE.md                  ← project working-memory for Claude Code
├── README.md                  ← this file
├── archive/                   ← retired docs / code
├── docs/
│   ├── FFC-Collaborator-Brief.docx
│   └── superpowers/specs/     ← Phase 1 design spec
├── ffc/                       ← Vite app (scaffolded in S015)
├── mockups/                   ← HTML mockups before implementing screens
├── planning/                  ← masterplan V1 → V2.8
├── sessions/                  ← per-session logs (S001…)
├── shared/                    ← shared assets (brand, logo, palette)
├── supabase/                  ← SQL migrations, Edge Function source
└── tasks/
    ├── todo.md                ← running todo
    └── lessons.md             ← FFC-specific lessons (inherits PadelHub's)
```

## Getting started (once scaffolded)

```bash
# clone
git clone https://github.com/mmuwahid/FFC.git
cd FFC/ffc

# install
npm install

# dev
npm run dev
```

## Collaborator brief

A one-stop context pack is at `docs/FFC-Collaborator-Brief.docx` — cover,
exec summary, tech stack, data model, and all 10 approved mockups inline.

## Key design artifacts

- **Master plan:** `planning/FFC-masterplan-V2.8.md` (latest)
- **Phase 1 design spec:** `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md`
- **Mockups (approved):** `mockups/` — 10 screens + welcome + logo

## License

Private. All rights reserved.
