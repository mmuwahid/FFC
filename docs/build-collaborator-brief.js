// Builds FFC-Collaborator-Brief.docx — a shareable Word document summarising
// the FFC project for a new collaborator. Includes all 10 approved mockups as
// embedded screenshots.
//
// Usage: node docs/build-collaborator-brief.js

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat, PageBreak, PageOrientation
} = require('docx');

const DOCS_DIR = __dirname; // docs/
const SHOTS_DIR = path.join(DOCS_DIR, 'brief-screenshots');
const OUT = path.join(DOCS_DIR, 'FFC-Collaborator-Brief.docx');

// ----------------------- helpers ------------------------

function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 120 },
    ...(opts.paraOpts || {})
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text })],
    spacing: { before: 360, after: 180 }
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text })],
    spacing: { before: 240, after: 120 }
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text })],
    spacing: { before: 180, after: 100 }
  });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun({ text })],
    spacing: { after: 80 }
  });
}

function bulletBold(bold, rest) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: [
      new TextRun({ text: bold, bold: true }),
      new TextRun({ text: rest })
    ],
    spacing: { after: 80 }
  });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function tCell(text, opts = {}) {
  const { bold = false, shading = null, widthDxa = 4680, align = AlignmentType.LEFT } = opts;
  const cellOpts = {
    borders,
    width: { size: widthDxa, type: WidthType.DXA },
    margins: cellMargins,
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text, bold })]
    })]
  };
  if (shading) cellOpts.shading = { fill: shading, type: ShadingType.CLEAR };
  return new TableCell(cellOpts);
}

function twoColTable(rows, opts = {}) {
  const { col1Width = 2800, col2Width = 6560, headerShading = 'E8E8E8' } = opts;
  const total = col1Width + col2Width;
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: [col1Width, col2Width],
    rows: rows.map((r, i) => new TableRow({
      children: [
        tCell(r[0], {
          bold: i === 0,
          widthDxa: col1Width,
          shading: i === 0 ? headerShading : null
        }),
        tCell(r[1], {
          bold: i === 0,
          widthDxa: col2Width,
          shading: i === 0 ? headerShading : null
        })
      ]
    }))
  });
}

// Load an image (PNG) and embed at the given width (inches). Height scales
// proportionally based on intrinsic pixel dimensions.
function imageAt(filename, widthInches) {
  const filePath = path.join(SHOTS_DIR, filename);
  const data = fs.readFileSync(filePath);

  // Read PNG dimensions from IHDR (bytes 16-23).
  const w = data.readUInt32BE(16);
  const h = data.readUInt32BE(20);
  const targetPxWidth = widthInches * 96;
  const scale = targetPxWidth / w;
  const targetPxHeight = h * scale;

  const caption = filename.replace('.png', '');
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 100, after: 100 },
    children: [new ImageRun({
      type: 'png',
      data,
      transformation: { width: targetPxWidth, height: targetPxHeight },
      altText: {
        title: caption,
        description: `Screenshot of ${caption} mockup`,
        name: caption
      }
    })]
  });
}

// Render one mockup page: title, caption, image, notes, page break.
function mockupPage({ title, file, purpose, highlights }) {
  const blocks = [
    h2(title),
    new Paragraph({
      children: [new TextRun({ text: 'Purpose. ', bold: true }), new TextRun({ text: purpose })],
      spacing: { after: 120 }
    }),
    imageAt(file, 4.0)
  ];
  blocks.push(new Paragraph({
    children: [new TextRun({ text: 'Highlights:', bold: true })],
    spacing: { after: 80 }
  }));
  highlights.forEach(h => blocks.push(bullet(h)));
  blocks.push(pageBreak());
  return blocks;
}

// --------------------- content blocks -------------------

// Cover
const cover = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 2400, after: 240 },
    children: [new TextRun({ text: 'FFC', bold: true, size: 96 })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text: 'Collaborator Brief', size: 48 })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
    children: [new TextRun({ text: 'Mobile-first PWA for a weekly 7v7 football league', italics: true, size: 28 })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: 'Date: 21 APR 2026', size: 24 })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: 'Status: Design Phase 1 APPROVED — implementation ready', size: 24, bold: true })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: 'Owner: Mohammed Muwahid', size: 24 })]
  }),
  pageBreak()
];

// Exec summary
const execSummary = [
  h1('1. Executive Summary'),
  p('FFC is a mobile-first Progressive Web App that replaces our current Excel + WhatsApp workflow for running a weekly 7v7 friends football league. It handles the full Monday-poll to Thursday-match cycle — voting, self-signup, guest invites, captain selection, team drafts, match results, leaderboards, seasons, and awards — with WhatsApp share integration for the parts players already do on the group chat.'),
  p('Phase 1 design is complete and formally approved as of 21 APR 2026. The full design spec (~3,100 lines) is drift-free and ready for implementation. Ten phone-frame mockups are approved; the data model is fully specified (20 tables, 20 RPCs, 18 enums); migration order and implementation sequencing are documented.'),
  p('We are NOT starting from zero code-wise, but NOT yet coding either. Next step is creating the GitHub repo, provisioning Supabase, scaffolding the Vite React PWA, and running the first migration.'),
  h2('Quick stats at approval'),
  twoColTable([
    ['Metric', 'Value'],
    ['Design spec size', '~3,100 lines'],
    ['Approved phone-frame mockups', '9 screens + welcome = 10 total'],
    ['Database tables', '20'],
    ['SECURITY DEFINER RPCs', '20'],
    ['Custom enum types', '18'],
    ['Notification kinds', '19'],
    ['Seeded app_settings keys', '7'],
    ['Sessions logged so far', 'S001–S014 (14)'],
    ['Masterplan revisions', 'V1.0 → V2.8']
  ]),
  pageBreak()
];

// What we're building
const whatBuilding = [
  h1('2. What We\'re Building'),
  h2('2.1 The problem'),
  p('A 40+ player friends football league runs every Thursday. Players currently vote on a WhatsApp poll, the admin copies names into Excel, picks captains manually, posts team lists back to the chat, and tracks scores in a spreadsheet. Mid-week cancellations break the roster, guest invites are ad-hoc, and the leaderboard is rebuilt from memory.'),
  p('This workflow works but doesn\'t scale, doesn\'t track stats properly, and loses the history. Players want to see their W-D-L record, goal tallies, and head-to-head stats. Admins want to stop reconstructing the roster every week.'),
  h2('2.2 The solution'),
  p('FFC is the PWA replacement. Mobile-first (everyone uses it on their phone), installable from the browser, pushes notifications for poll reminders and matchday updates, and integrates with WhatsApp via the native share sheet where that\'s still the best UX.'),
  p('Design principles that shape the whole app:'),
  bulletBold('Monday-poll → Thursday-match rhythm. ', 'The app is organised around a weekly cycle, not a generic event-management UX. Every screen assumes this rhythm.'),
  bulletBold('Mobile-first and installable. ', 'PWA via Vite + service worker. Inline splash to kill cold-start flash. Safe-area CSS for iPhone notch and Dynamic Island across all fixed-position UI.'),
  bulletBold('7v7 default, 5v5 fallback. ', 'Season has a default format; admin can override per matchday. Roster size, waitlist boundary, poll caps, and formation patterns all parameterise from match format.'),
  bulletBold('Dark-mode default. ', 'Evening football + WhatsApp-first culture — the app looks right in low-ambient rooms. Users can switch.'),
  bulletBold('WhatsApp-share integration, not WhatsApp bot. ', 'We use the native share sheet to push to the existing group chat; we don\'t replicate the group chat in-app.'),
  bulletBold('No data without explanation. ', 'Every stats surface pairs numbers with context (W-D-L triplet coloured, last-5 strip, narratives).'),
  bulletBold('Phased rollout. ', 'Phase 1 = core weekly cycle. Phases 2–4 add captain auto-pick, seasons/awards, and extras.'),
  pageBreak()
];

// Core features
const coreFeatures = [
  h1('3. Core Features (Phase 1 — what you\'ll be building)'),
  h2('3.1 Player-side features'),
  bulletBold('Self-signup + admin approval. ', 'New players submit a pending signup; super-admin approves/rejects. Rejected accounts retain a ghost profile with reason for audit.'),
  bulletBold('Weekly poll. ', 'Monday: the next matchday poll opens. Every confirmed member gets a push; players tap YES / NO / +1 (bring a guest). Voting order matters — the first 14 YES commitments form the confirmed roster; the rest waitlist.'),
  bulletBold('Guest player mechanic. ', 'Each member can bring one +1 per matchday. Guest rating (weak / avg / strong), position, and a short description are collected on invite. Stats persist across matchdays.'),
  bulletBold('Ref entry (anonymous). ', 'Each referee gets a one-time token URL to submit the final score. No login required. Token consumed on first use.'),
  bulletBold('Captain helper. ', 'Formula-based suggestion of two balanced captains using 3 per-player criteria (rank, last-5 form, season activity). Early-season fallback to randomizer if nobody has 5+ matches. Admin still picks manually in Phase 1; auto-pick is Phase 2.'),
  bulletBold('Live captain draft visibility. ', 'When admin starts team selection, every player watching the poll screen sees picks flow in real-time via Supabase realtime on draft_sessions + draft_picks.'),
  bulletBold('Post-lock substitution + captain reroll. ', 'If a player cancels within 24h of kickoff, the first waitlisted player auto-promotes. Losing-side captain gets a modal — Accept substitute or Request reroll. Reroll restarts team selection. Cutoff is 12h pre-kickoff.'),
  bulletBold('Formation planner. ', 'Captain picks a formation pattern (7 × 7v7 patterns + 3 × 5v5 patterns + Custom), drags player tokens onto a top-down pitch. Rotating-GK toggle: dedicated GK or rotate every 10 min. Non-captains see read-only live view after captain shares.'),
  bulletBold('Leaderboard. ', 'Unified across 7v7 and 5v5. Points = 3W + 1D + penalties. Persistent sort preference per user. W-D-L triplet rendered green / grey / red app-wide.'),
  bulletBold('Player profile. ', 'Own and others\' profiles. Live rank, last-5 strip, season stats, career stats, Achievements card (MOTMs, W-streak, goals, yellows, reds, L-streak).'),
  bulletBold('Match-detail sheet. ', 'Tap any match from profile or leaderboard — read-only bottom sheet shows score, rosters, scorers, cards, MOTM, penalties. W/D/L chip is from the profile-owner\'s perspective.'),
  bulletBold('Settings. ', 'Six rows: Theme · Push notifications · Leaderboard sort · Positions re-entry · Display name · Account. iOS-style pill switches (no checkboxes).'),
  h2('3.2 Admin-side features'),
  bulletBold('Player management. ', 'Approve pending signups, edit roles, deactivate, override positions, set custom display name.'),
  bulletBold('Matchday management. ', 'Create matchday (with Format chip to override season default), monitor vote flow, lock roster, start captain draft, accept/abandon drafts, enter final results, approve pending ref entries, correct guest stats post-approval, edit match results with audit trail.'),
  bulletBold('Admin audit log. ', 'Every admin-role RPC writes an audit row via log_admin_action helper. admin_audit_log has admin-only SELECT.'),
  bulletBold('Phase 5.5 — Draft in progress. ', 'Admin can force-complete or abandon a stuck captain draft after a 6h threshold.'),
  h2('3.3 Cross-cutting'),
  bulletBold('Auth. ', 'Email/password + Google OAuth (Supabase Auth).'),
  bulletBold('Push notifications. ', '19 notification kinds. User-configurable subset (6 keys) via Settings pill switches.'),
  bulletBold('WhatsApp share templates. ', 'Rendered via native share sheet with parameterised placeholders (e.g. {{roster_cap}} to swap 14/10 between 7v7/5v5).'),
  bulletBold('RLS. ', 'Every table has row-level security policies. Three roles: anon, authenticated, admin/super_admin (functional distinction via helpers).'),
  pageBreak()
];

// Tech stack
const techStack = [
  h1('4. Tech Stack'),
  twoColTable([
    ['Layer', 'Choice'],
    ['Frontend framework', 'React 18'],
    ['Build tool', 'Vite + PWA plugin'],
    ['State management', 'Plain-object React Context (no useMemo cascades)'],
    ['Error handling', 'ErrorBoundary at route layout level'],
    ['Backend', 'Supabase (Postgres + RLS + Auth + Edge Functions + Storage)'],
    ['Auth methods', 'Email/password + Google OAuth'],
    ['Supabase CLI', 'npx supabase (global install is broken on work PC)'],
    ['Hosting', 'Vercel (auto-deploy from GitHub)'],
    ['Vercel team', 'team_HYo81T72HYGzt54bLoeLYkZx (new project, reuse team)'],
    ['Source control', 'GitHub — repo mmuwahid/FFC (not yet created)'],
    ['Supabase project', 'Separate org from an existing unrelated project (not yet created)'],
    ['Mobile pattern', 'PWA (no native iOS/Android binary in Phase 1)'],
    ['Offline-first', 'Service worker caches shell + poll; optimistic UI for vote']
  ]),
  h2('Design conventions (enforced)'),
  bullet('Date format: DD/MMM/YYYY uppercase on user-facing surfaces; ISO in storage.'),
  bullet('W-D-L triplet: green W (#16a34a) / grey D (#9ca3af) / red L (#dc2626) everywhere W-D-L appears.'),
  bullet('Safe-area: hardcoded CSS vars (--safe-top: 59px, --safe-bottom: 34px) on .phone + .statusbar { flex-shrink: 0 }. Defensive .phone-inner > * { flex-shrink: 0 } across all scroll containers.'),
  bullet('Sticky tabbar pattern (never position: absolute; bottom: 0).'),
  bullet('Fixed column widths over auto when a column can appear/disappear based on data.'),
  bullet('Green = safe-confirm, red = destructive-confirm in all action dialogs.'),
  bullet('Always-visible rosters: lists ≤ roster_cap items rendered inline — no tap-to-expand.'),
  bullet('Pill switches over checkboxes for toggles.'),
  bullet('CSS specificity collision is first suspect for sibling-inconsistency layout bugs.'),
  pageBreak()
];

// Current progress
const progress = [
  h1('5. Current Progress'),
  h2('5.1 What\'s done'),
  bulletBold('Design spec (~3,100 lines). ', 'Feature-complete, drift-free, formally approved 21 APR 2026. Covers §1 Concept + §2 full Data Model (9 subsections) + §3.0–§3.19 UI sections.'),
  bulletBold('Masterplan V2.8 (378 lines). ', 'Consolidation doc covering S009–S013 deltas on top of V2.7. Migration order and implementation sequencing notes included.'),
  bulletBold('10 approved mockups. ', 'See Section 7 below. All validated against: safe-area contract, DD/MMM/YYYY date format, W-D-L colour triplet, pill switches, always-visible rosters, sticky tabbar pattern.'),
  bulletBold('Brand assets discovered. ', 'FF_LOGO_FINAL.pdf in shared/ has the authoritative shield crest. COLORS.pdf defines black / white / khaki-gold / cream palette. Mockups currently use red + navy; palette re-alignment is deferred (owner\'s call).'),
  bulletBold('14 session logs. ', 'Every working session is logged in sessions/S###/session-log.md with a row in sessions/INDEX.md.'),
  bulletBold('Durable rules file. ', 'tasks/lessons.md carries session-by-session lessons. Inherits PadelHub (sibling project) critical rules.'),
  h2('5.2 What\'s NOT done'),
  bulletBold('GitHub repo. ', 'mmuwahid/FFC not yet created. Private until MVP.'),
  bulletBold('Supabase project. ', 'Not yet provisioned. Must be a separate org from the owner\'s existing Supabase project.'),
  bulletBold('Vercel project. ', 'Not yet created. Will reuse existing team.'),
  bulletBold('Vite scaffold. ', 'ffc/ directory is empty. Will use PadelHub\'s boot patterns as template (inline splash, safe-area CSS, service worker, plain-object Context).'),
  bulletBold('Any code. ', 'No implementation yet. Phase 1 approval was the gate.'),
  bulletBold('Logo rollout. ', 'Owner still to export transparent PNG/SVG from FF_LOGO_FINAL.pdf. Mockups use a JPG stopgap on one screen only. WhatsApp OG image 1200×630 also pending.'),
  bulletBold('Masterplan sections 4–6. ', 'Operational runbook, rollout plan, post-Phase-1 roadmap — all pending. Not blockers for Phase 1 implementation.'),
  h2('5.3 Key files a collaborator should read'),
  bulletBold('CLAUDE.md (project root) — ', 'Start here. Status, stack, operating rules, cross-PC protocol, latest-session summary.'),
  bulletBold('docs/superpowers/specs/2026-04-17-ffc-phase1-design.md — ', 'The authoritative design spec. ~3,100 lines. Read §1 for concept, §2 for data model, §3.0–§3.19 for UI.'),
  bulletBold('planning/FFC-masterplan-V2.8.md — ', 'Latest consolidation. Migration order + implementation sequencing. V2.7 and prior preserved.'),
  bulletBold('sessions/INDEX.md — ', 'Quick overview of all 14 sessions.'),
  bulletBold('tasks/lessons.md — ', 'Durable rules learned across sessions. Read before touching mockups or CSS.'),
  bulletBold('.superpowers/brainstorm/635-1776592878/content/ — ', 'All 10 approved HTML mockups. Live-previewable via python -m http.server.'),
  pageBreak()
];

// Data model + RPCs table
const dataModel = [
  h1('6. Data Model Snapshot'),
  p('Full schema in §2 of the design spec. This is the headline inventory — tables, enums, and the top-level RPC list.'),
  h2('6.1 Tables (20)'),
  twoColTable([
    ['Group', 'Tables'],
    ['Base entities', 'seasons, profiles, matchdays'],
    ['Match data', 'match_players, match_guests'],
    ['Poll + ref workflow', 'poll_votes, ref_tokens, pending_signups, pending_match_entries'],
    ['Operational', 'app_settings, admin_audit_log, draft_sessions, draft_picks, formations, notifications'],
    ['Views', 'v_match_commitments, v_season_standings, v_player_last5, v_captain_eligibility']
  ]),
  h2('6.2 Enums (18)'),
  p('user_role · notification_kind · draft_status · draft_reason · match_format · guest_rating · guest_trait · leaderboard_sort · player_position · theme_preference · team_color · + ref-token / signup / match-entry status enums.'),
  h2('6.3 RPCs (20)'),
  p('All SECURITY DEFINER. Admin-role RPCs call log_admin_action helper. Format-dependent RPCs resolve format via effective_format(matchday_id).'),
  bullet('#1–13: Original Phase 1 RPCs (commit_vote, cancel_vote, create_match_draft, invite_guest, confirm_guest, approve_signup, reject_signup, approve_match_entry, pick_captains_random, pick_captains_from_formula, set_matchday_captains, update_guest_stats)'),
  bullet('#14: edit_match_result — post-approval correction with audit trail'),
  bullet('#15: promote_from_waitlist — idempotent post-lock substitution'),
  bullet('#16: accept_substitute — captain acknowledges sub promotion'),
  bullet('#17: request_reroll — captain-triggered reroll, 12h-before-kickoff cutoff'),
  bullet('#18: submit_draft_pick — captain-turn pick in live draft, completes at roster_cap-th pick'),
  bullet('#19: upsert_formation — captain-only, validates layout pattern against effective_format'),
  bullet('#20: share_formation — fires formation_shared push to non-captain team members'),
  h2('6.4 Helpers'),
  bullet('current_profile_id() — current user\'s profile row'),
  bullet('is_admin() / is_super_admin() — role gate'),
  bullet('effective_format(matchday_id) — COALESCE of matchday override → season default'),
  bullet('roster_cap(format) — IMMUTABLE · 14 for 7v7, 10 for 5v5'),
  bullet('log_admin_action(target_entity, target_id, action, payload) — private, SECURITY DEFINER, writes admin_audit_log'),
  pageBreak()
];

// Mockups section
const mockupsIntro = [
  h1('7. Approved Mockups'),
  p('All 10 mockups below are formally approved and pass the FFC design contracts (safe-area, W-D-L colour triplet, sticky tabbar, flex-shrink defensive rule, etc.). Each mockup shows light and dark phone frames side-by-side, followed by state tiles demonstrating alternate states (loading, empty, error, etc.).'),
  p('All HTML files are self-contained and can be opened in any browser. To view the live mockups:'),
  bullet('Navigate to .superpowers/brainstorm/635-1776592878/content/ in the project folder.'),
  bullet('Open any .html file directly OR run: python -m http.server 5173 --directory .superpowers/brainstorm/635-1776592878/content and visit http://localhost:5173/'),
  pageBreak()
];

const mockups = [
  {
    title: '7.1 Welcome screen',
    file: 'welcome.png',
    purpose: 'First-visit entry point. Two-mode sign-in (existing member vs new signup), Google OAuth + email/password, terms-of-use disclaimer.',
    highlights: [
      'Minimal — no auth context yet; unknown user state',
      'Crest placeholder until logo rollout completes',
      'Pre-auth safe-area CSS applied from moment-zero to avoid Dynamic Island overlap'
    ]
  },
  {
    title: '7.2 §3.7 Poll screen — the core weekly surface',
    file: '3-7-poll-screen.png',
    purpose: 'Every player lands here Monday morning. Shows matchday details, user\'s vote commitment, full confirmed roster, guest rows with stats pills, live captain draft state, and the post-reveal team split.',
    highlights: [
      'Nine key states (1 = pre-vote, 2 = voted YES, ... 6.5 = draft in progress, 7 = penalty sheet, 8 = teams revealed)',
      'State 6.5 shows LIVE draft picks flowing in real-time via Supabase realtime',
      'State 8 splits roster into WHITE TEAM + BLACK TEAM sections (not per-row W/B pills)',
      'Guest rows show: position pills + rating chip (weak/avg/strong) + italic "+1 · invited by Name" + description',
      'Green [Keep my spot] / red [Cancel anyway] CTAs (safe-confirm vs destructive-confirm rule)'
    ]
  },
  {
    title: '7.3 §3.1-v2 Captain helper',
    file: '3-1-v2-captain-helper.png',
    purpose: 'Admin-only. Suggests two balanced captains using a 3-criteria formula (rank, last-5, season activity). Shows a pair-confirmation sheet with White=weaker auto-assignment.',
    highlights: [
      'Auto-switches between formula mode (season ≥ 5 approved matchdays) and randomizer mode (early season)',
      'Three-section candidate list: Recommended · Eligible · Ineligible',
      'Guest subsection: read-only, visible for pair-balance context but cannot captain',
      'Rank-gap > 5 triggers amber warning + "Proceed anyway?" sub-modal (soft block, not hard)',
      'Full Depth-B spec + v1 mockup approved in session S007'
    ]
  },
  {
    title: '7.4 §3.13 Leaderboard',
    file: '3-13-leaderboard.png',
    purpose: 'League standings. Unified across 7v7 and 5v5 matches. Points = 3W + 1D + penalties. Persistent sort preference per user (stored on profiles.leaderboard_sort).',
    highlights: [
      'Medal icons for top 3 (🥇🥈🥉) with tinted row backgrounds',
      'W-D-L triplet rendered green/grey/red',
      'MP (matches-played) column present for context',
      'Fixed column widths — row-to-row alignment stable when rank or medal appears/disappears',
      'Separate "Not yet played this season" section below main table',
      'Tiebreak chain: points → wins → GD → goals for → last-5 form'
    ]
  },
  {
    title: '7.5 §3.14 Player profile',
    file: '3-14-player-profile.png',
    purpose: 'Per-player stats. Card-header shows live rank (1st 🥇) + season/career toggle. Body: last-5 circles, KPI grid, Achievements card, recent matches list.',
    highlights: [
      'Last-5 circles: W green / D grey / L red; newest on left',
      'KPI grid: MP · W · D · L · Points · Position colour-coded',
      'Achievements card (replaced the old Totals card after "no data without explanation" rule): ⭐ MOTMs · 🔥 W-streak · 🎯 Goals · 🟨 Yellows · 🟥 Reds · 📉 L-streak',
      'Zero-match career state: CTA replaces Achievements card',
      'Tap any recent match → slides up match-detail sheet (§3.15)'
    ]
  },
  {
    title: '7.6 §3.15 Match-detail sheet',
    file: '3-15-match-detail.png',
    purpose: 'Read-only bottom sheet (85% viewport) shown when tapping a match from profile or leaderboard. Full context: score, rosters, scorers, cards, MOTM, penalties.',
    highlights: [
      'W/D/L chip is from the profile-owner\'s perspective (so same match shows "W" on one profile and "L" on another)',
      'Guest rows rendered lighter (goals/cards only, no rating chip/description)',
      'Wide-viewport mode: max 640 × 80vh above 768px (centred modal instead of bottom sheet)',
      'Late-cancel penalties rendered here (not on leaderboard)'
    ]
  },
  {
    title: '7.7 §3.16 Settings',
    file: '3-16-settings.png',
    purpose: 'Six rows: Theme · Push notifications · Leaderboard sort · Positions re-entry · Display name · Account. Auth-gated (unauth users never see it).',
    highlights: [
      'Dark is the default theme at signup (changed from "system" after S010 — FFC culture is low-ambient)',
      'iOS-style pill switches replace all checkboxes (app-wide toggle UI)',
      'Push prefs: 6 keys (removed position_changed; added dropout_after_lock)',
      'poll_reminder timing: 2 minutes before poll close (tight last-call nudge)',
      'State tile: first-visit push-permission-prompt',
      'State tile: push-denied fallback (toggle row shows "Blocked in browser")'
    ]
  },
  {
    title: '7.8 §3.17 Admin Players',
    file: '3-17-admin-players.png',
    purpose: 'Super-admin screen. Pending signups tab + Active players tab + Rejected tab. Approve / reject / deactivate / edit role / override positions.',
    highlights: [
      'Rejected tab shows the ghost profile + reject_reason (audit trail)',
      'Every admin action writes an admin_audit_log row via log_admin_action helper',
      'Role badges colour-coded: super_admin (gold) · admin (red) · member (grey) · rejected (muted)',
      'Position override lets admin re-assign a player\'s primary/secondary positions'
    ]
  },
  {
    title: '7.9 §3.18 Admin Matches',
    file: '3-18-admin-matches.png',
    purpose: 'Full match lifecycle. Matchday card + phases ladder. Admin steps through: Poll open → Lock → Captain draft → Result entry → Approve pending ref entry → Post-approval edit.',
    highlights: [
      'Matchday creation card has a Format chip (7v7 / 5v5) — defaults to season default',
      'Mid-poll format change shows confirmation warning (shifts waitlist boundary)',
      'Phase 5.5 "Draft in progress" appears between Lock and Result Entry, with force-complete / abandon admin actions after 6h stuck threshold',
      'Always-visible 14-player roster (7 WHITE + 7 BLACK rendered inline, no tap-to-expand)',
      'Post-approval: edit_match_result RPC with audit trail'
    ]
  },
  {
    title: '7.10 §3.19 Formation planner',
    file: '3-19-formation.png',
    purpose: 'Captain-only pre-match tactical board. Pick a formation pattern, drag player tokens onto the pitch, set GK rotation, share with team.',
    highlights: [
      '7v7 patterns: 2-3-1 · 3-2-1 · 2-2-2 · 3-1-2 · 2-1-3 · 1-3-2 · Custom',
      '5v5 patterns: 1-2-1 · 2-1-1 · 1-1-2 · Custom (filtered by effective_format)',
      'Rotating-GK toggle: "Dedicated GK" vs "Rotate every 10 min"; rotating mode auto-assigns rotation numbers 1–6 (or 1–4 for 5v5)',
      'Native <select> GK picker (replaced an earlier radio-card list — 87px tall vs 180px saves vertical space)',
      'Team-colour header strip: "YOU\'RE ON WHITE/BLACK · DD/MMM/YYYY"',
      'Non-captains see read-only live-synced view after captain taps Share',
      'Entry window: kickoff − 24h to kickoff'
    ]
  }
];

// Next steps
const nextSteps = [
  h1('8. What\'s Next — For Your Collaborator'),
  h2('8.1 Before the first code commit'),
  p('The design gate is cleared. The next session (S015) kicks off implementation. Ordered steps from masterplan V2.8:'),
  new Paragraph({
    numbering: { reference: 'numbers', level: 0 },
    children: [new TextRun({ text: 'GitHub repo mmuwahid/FFC. Private until MVP. Enforce committer identity m.muwahid@gmail.com (Vercel Hobby rejects unknown committers).' })],
    spacing: { after: 80 }
  }),
  new Paragraph({
    numbering: { reference: 'numbers', level: 0 },
    children: [new TextRun({ text: 'Supabase project. Separate org from the owner\'s existing project. Record project_ref + anon key + service role key.' })],
    spacing: { after: 80 }
  }),
  new Paragraph({
    numbering: { reference: 'numbers', level: 0 },
    children: [new TextRun({ text: 'Vercel project on existing team. Wire env vars: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (Edge Function use only).' })],
    spacing: { after: 80 }
  }),
  new Paragraph({
    numbering: { reference: 'numbers', level: 0 },
    children: [new TextRun({ text: 'Vite React PWA scaffold inside ffc/ folder. Use PadelHub (sibling project) boot patterns: inline splash, safe-area CSS, service worker, ErrorBoundary, plain-object Context (no useMemo cascades).' })],
    spacing: { after: 80 }
  }),
  new Paragraph({
    numbering: { reference: 'numbers', level: 0 },
    children: [new TextRun({ text: 'Run 11 migration files in order (0001_enums.sql → 0011_seed_super_admin.sql per §2.9). Seed m.muwahid@gmail.com as super_admin. Verify 20 tables, 20 RPCs, RLS enabled on every table.' })],
    spacing: { after: 80 }
  }),
  new Paragraph({
    numbering: { reference: 'numbers', level: 0 },
    children: [new TextRun({ text: 'Smoke test: npx supabase CLI works + hello-world Edge Function deploys.' })],
    spacing: { after: 80 }
  }),
  h2('8.2 First feature slice'),
  p('Auth + welcome + self-signup pending flow → admin approval via approve_signup RPC → ref token unlock → §3.7 Poll screen state machine up to State 3 (voted, pre-lock). This slice exercises route layouts, RLS, and the happy-path weekly cycle.'),
  h2('8.3 Beyond Phase 1'),
  bulletBold('Phase 2: ', 'Captain auto-pick on lock, discipline tracking, repeat-dropout detection, snake-draft vs simple-alternate order.'),
  bulletBold('Phase 3: ', 'Seasons and awards — season archive, MVP / Top Scorer / Best Goalie awards, season transitions.'),
  bulletBold('Phase 4: ', 'Extras — advanced stats, head-to-head, social features, possibly native mobile.'),
  h2('8.4 How to contribute'),
  bullet('Read CLAUDE.md (project root) first. It has the latest session summary and all operating rules.'),
  bullet('Read docs/superpowers/specs/2026-04-17-ffc-phase1-design.md for the authoritative design (~3,100 lines).'),
  bullet('Check planning/FFC-masterplan-V2.8.md for migration order and implementation sequencing.'),
  bullet('Every working session ends with a log in sessions/S###/session-log.md and a row in sessions/INDEX.md.'),
  bullet('Before touching mockups or CSS, read tasks/lessons.md — 14 sessions of durable rules with root causes.'),
  bullet('Commit identity for FFC: m.muwahid@gmail.com. Never skip pre-commit hooks.'),
  h2('8.5 Open questions a collaborator might want to weigh in on'),
  bullet('Brand palette re-alignment — mockups use red + navy; brand spec has black + white + khaki-gold + cream. Owner chose to defer; worth revisiting before code.'),
  bullet('Logo rollout — transparent PNG/SVG export from shared/FF_LOGO_FINAL.pdf still pending from owner.'),
  bullet('Phase 2 "repeat dropout" threshold — how many cancellations before auto-ban?'),
  bullet('Phase 2 snake-draft vs simple-alternate order for captain auto-pick.'),
  bullet('Best Goalie mechanism for Phase 3 awards — voting? statistical? hybrid?')
];

// ---------------------- assemble doc --------------------

const children = [
  ...cover,
  ...execSummary,
  ...whatBuilding,
  ...coreFeatures,
  ...techStack,
  ...progress,
  ...dataModel,
  ...mockupsIntro,
  ...mockups.flatMap(m => mockupPage(m)),
  ...nextSteps
];

const doc = new Document({
  creator: 'Mohammed Muwahid',
  title: 'FFC Collaborator Brief',
  description: 'Project brief for a new FFC collaborator — purpose, features, progress, approved mockups',
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22 } } }, // 11pt default
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 36, bold: true, font: 'Calibri', color: '1F3A5F' },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 }
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 28, bold: true, font: 'Calibri', color: '2E5984' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 }
      },
      {
        id: 'Heading3',
        name: 'Heading 3',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 24, bold: true, font: 'Calibri', color: '4A7BA6' },
        paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 2 }
      }
    ]
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } }
        }]
      },
      {
        reference: 'numbers',
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } }
        }]
      }
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 }, // US Letter
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    children
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(OUT, buffer);
  console.log(`Wrote ${OUT} (${buffer.length} bytes)`);
});
