## §3.16 amendment (S009 round 2)

> Copy-paste replacement blocks for the design-spec master file
> `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` — §3.16 rows 1 & 2
> plus updated acceptance criteria + a Section-5 notification-wiring stub.
>
> Scope of this round: (1) Theme default flipped from `system` to `dark`;
> (2) `position_changed` removed from user-facing settings entirely;
> (3) `poll_reminder` timing re-specified as `poll_close_at - 2 minutes`;
> (4) new `dropout_after_lock` notification added. All other §3.16 content
> (rows 3–6, state tiles 1–2, layout frame, Phase-2 deferrals) unchanged.
> Today: 20/APR/2026. FFC · Phase 1.

---

### Row 1 REPLACEMENT (Theme)

**Row 1 — Theme**

- **Purpose.** Pick light, dark, or system-follow for this device.
- **Storage key.** `profiles.theme_preference` enum `('light','dark','system')`.
- **Default at signup.** `'dark'`. The app paints dark on first render and every subsequent cold start until the user changes it. This is a deliberate choice — FFC's visual direction skews low-ambient (evening football, WhatsApp-first culture), and dark-first matches the anticipated use context.
- **Interaction.** Three-chip row (Light · **Dark** · System). Tapping any chip writes to storage and repaints the app immediately. No save button — auto-saves.
- **Row hint (right-aligned).** `auto-saves · default = Dark` (the hint doubles as discoverability for the default, which matters when the value has already been overridden).
- **'System' behaviour.** Reads `prefers-color-scheme` on every navigation. If the OS switches while the app is foregrounded, the paint updates on the next user interaction (not on media-query change mid-scroll — avoids flicker).
- **Persistence.** Written to `profiles` row (cross-device) AND mirrored to `localStorage.ffc_theme` so the first paint after cold start doesn't flash-of-wrong-theme while auth hydrates.

---

### Row 2 REPLACEMENT (Push notifications)

**Row 2 — Push notifications**

- **Purpose.** Master opt-in for push, plus six per-event sub-toggles.
- **Storage key.** `profiles.push_prefs jsonb`. Shape:

  ```json
  {
    "master": true,
    "poll_open": true,
    "poll_reminder": true,
    "roster_locked": true,
    "plus_one_unlocked": true,
    "match_result_posted": true,
    "dropout_after_lock": true
  }
  ```

  Defaults above are applied at signup. `position_changed` is **not** present — admin-approval events are notified via the admin channel only and are not user-configurable in Phase 1 (see §3.3).

- **Master toggle (iOS-style).**
  - `master: false` → all six child checkboxes render greyed-out but retain stored values. Re-enabling master restores them (no reset).
  - `master: true` while `Notification.permission === 'default'` → fires `Notification.requestPermission()`. Grant → register push subscription, persist. Deny → revert `master` to `false` and render State tile 2 (push-denied fallback).
  - `master: true` while `Notification.permission === 'denied'` → toggle is non-interactive, State tile 2 is persistently rendered above the row-group.

- **Six child checkboxes (top-to-bottom, visible when master ON):**

  | Label in UI | JSON key | Default | Trigger (Section-5 stub) |
  |---|---|---|---|
  | Poll opens | `poll_open` | ☑ | Monday `create_matchday` RPC completes successfully |
  | Poll reminder (2 min before close) | `poll_reminder` | ☑ | Scheduler fires at `matchday.poll_close_at - 2 minutes` |
  | Roster locked | `roster_locked` | ☑ | `lock_roster` RPC / auto-lock at `roster_lock_at` completes |
  | +1 slot unlocked | `plus_one_unlocked` | ☑ | Roster lock reveals a `+1` guest seat the member holds |
  | Match result posted | `match_result_posted` | ☑ | Admin publishes match via `publish_match_result` RPC |
  | Dropout after lock | `dropout_after_lock` | ☑ | Player cancels post-lock AND substitute is promoted from waitlist |

  Each checkbox writes to the jsonb key above immediately on tap — no save button.

- **`dropout_after_lock` recipient set.** All confirmed-roster players of the affected matchday + all admins. Excludes the cancelling player themselves. Message copy: `"{Canceller} dropped out · {Substitute} is now on the roster"`.

- **`poll_reminder` timing rationale.** 2 minutes before close is intentionally very tight — this is the "last call to vote" nudge, designed to rescue players who saw the Monday "poll opens" notification, meant to vote, and forgot. The vote-or-skip trade-off for someone who's been silent all week is considered acceptable at 2 min (they had ~72h of prior notice). If post-launch feedback shows this is too aggressive, Section 5 can widen the window or expose timing as a Phase-2 user preference (see acceptance criterion §3.16-AC7 below).

- **Row hint copy.** No right-aligned hint on this row (the master toggle occupies that position).

- **Disabled-children explanatory hint.** When `master: false` is user-set (not denied-by-browser), render below the six checkboxes: `"Turn the master on to receive per-event notifications. Your selections are preserved."`

---

### Layout ASCII REPLACEMENT (push notifications section)

Replace the §3.16 layout ASCII block for row 2 with:

```
┌─────────────────────────────────────────────────────┐
│ PUSH NOTIFICATIONS                      [ ●━━ ON  ] │
├─────────────────────────────────────────────────────┤
│  ☑ Poll opens                                       │
│  ☑ Poll reminder (2 min before close)               │
│  ☑ Roster locked                                    │
│  ☑ +1 slot unlocked                                 │
│  ☑ Match result posted                              │
│  ☑ Dropout after lock                               │
└─────────────────────────────────────────────────────┘
```

Six checkboxes exactly. `position_changed` is NOT rendered.

When master is OFF, render identical layout with all checkbox boxes desaturated (opacity 0.4, pointer-events: none) and append an explanatory hint row below the checklist: `Turn the master on to receive per-event notifications. Your selections are preserved.`

---

### Acceptance criteria ADDITIONS / REPLACEMENTS

Replace the §3.16 acceptance criteria list with the following seven-item set. Items flagged `[NEW]` are round-2; unflagged items carry from v1 with wording tightened.

- **§3.16-AC1.** Theme row renders three chips in the fixed order Light · Dark · System. On first launch after signup the **Dark** chip is active; the app is painted with the dark token set (`.dark` scope variables resolve).
- **§3.16-AC2.** Tapping any Theme chip writes `profiles.theme_preference` and repaints the app in the same frame. Chip active-state updates immediately. No save button is rendered on this row.
- **§3.16-AC3.** `[NEW]` Push-prefs row renders exactly **six** child checkboxes when master is ON, in the exact order: Poll opens · Poll reminder (2 min before close) · Roster locked · +1 slot unlocked · Match result posted · Dropout after lock. No seventh row. `position_changed` is not present on this screen and cannot be toggled by the user.
- **§3.16-AC4.** `[NEW]` At signup, `profiles.push_prefs` jsonb is inserted with every listed key set to `true` and the `master` key set to `true`. The old `position_changed` key is not written.
- **§3.16-AC5.** Toggling master OFF preserves the six child values in storage. Toggling master back ON restores the UI to the previously-stored values (not all-true, not all-false). No migration is required when upgrading profiles that still have a legacy `position_changed` key — the key is simply ignored on read and stripped on next write.
- **§3.16-AC6.** `[NEW]` `poll_reminder` notifications are scheduled at `matchday.poll_close_at - 2 minutes` and cancelled if `poll_close_at` is moved forward by an admin. Players whose `push_prefs.poll_reminder === false` OR `push_prefs.master === false` are excluded from the send fan-out.
- **§3.16-AC7.** `[NEW]` `dropout_after_lock` notifications fire exactly once per substitution event, to (confirmed-roster ∪ admins) minus the cancelling player, and only to recipients whose `push_prefs.dropout_after_lock === true` AND `push_prefs.master === true`. If no substitute is promoted (e.g. roster drops below 14 without a waitlist), this notification does NOT fire — `roster_locked` already covered the previous state and the admin WhatsApp channel handles the shortfall.

---

### Notification-wiring note for Section 5

> **Stub — flag for Section 5 notifications spec.**
>
> - **`poll_reminder`** — fires at `matchday.poll_close_at - 2 minutes`. Implement as a scheduled Edge Function invocation pinned to the matchday row, cancelled on `poll_close_at` update. Fan-out filter: `push_prefs.master === true AND push_prefs.poll_reminder === true`.
> - **`dropout_after_lock`** — fires on `cancel_after_lock` RPC trigger, ONLY when the same transaction promotes a waitlist substitute. Recipient set: `confirmed_roster_player_ids ∪ admin_profile_ids` minus the cancelling player. Fan-out filter: `push_prefs.master === true AND push_prefs.dropout_after_lock === true`. Payload carries canceller display_name, substitute display_name, matchday date (DD/MMM/YYYY).
> - **`position_changed`** — **no longer a user-facing notification.** Admin approval/denial of position-change requests is surfaced via the admin-only channel (see §3.3). The legacy `push_prefs.position_changed` key is not read or written; if encountered on read (old rows) it is ignored and stripped on next write.
> - **Section 5 cross-ref.** Tabulate the 6 event types with triggering RPC/job, recipient-set expression, fan-out filter, and payload schema. Add migration note: "No DDL change required — `push_prefs` is jsonb; new keys auto-default via app-layer read (`?? true`); removed key is passively dropped."

---

**End of §3.16 round-2 amendment block.** Apply rows 1 + 2 + layout ASCII + acceptance criteria as direct replacements in the master spec. Append the Section-5 stub to the existing §5 placeholder (do not create a new section).
