# Session S065 — NumberInput component

**Date:** 01/MAY/2026  
**PC:** Home (`User`)  
**Branch:** main  
**Start HEAD:** daae802  
**End HEAD:** b5046fe  
**Migrations applied:** 0  
**Open PRs closed:** 0  
**GH issues closed:** 0

---

## Goal

Execute the NumberInput plan (#3 from S063 backlog). Spec and plan written in S063; this session is purely execution. Fix the "backspace does nothing" UX bug on all 13 numeric inputs across 3 admin screens by replacing ad-hoc `<input type="number">` patterns with a shared `<NumberInput>` primitive.

---

## Work done

### Commit b5046fe — feat: NumberInput component — fix backspace UX on all numeric inputs

**Root cause of bug:** `Number('') === 0`, so the old pattern `Number(e.target.value) || 0` snapped back to `0` the moment the user cleared the field, making backspace feel like it does nothing.

**Fix:** New component at `ffc/src/components/NumberInput.tsx`:
- Uses `type="text"` + `inputMode="numeric"` + `pattern="[0-9]*"` (mobile numeric keypad, no `type="number"` quirks)
- Local `displayValue: string` decoupled from parent `value: number` while focused
- `onChange`: only fires `props.onChange` when non-empty; regex `^\d+$` rejects non-digits
- `onBlur`: coerces empty/NaN to `min`; clamps out-of-range to `[min, max]`
- External `value` prop changes only sync to display when NOT focused (covers parent-driven resets without fighting the user mid-edit)

**Call-sites migrated (13 inputs across 4 groups):**

| File | Group | Inputs replaced |
|---|---|---|
| `AdminMatches.tsx` | ResultEntrySheet score boxes | `scoreWhite`, `scoreBlack` (min=0) |
| `AdminMatches.tsx` | ResultEntrySheet scorer rows | goals (min=0), yellow (min=0 max=2), red (min=0 max=1) |
| `AdminMatches.tsx` | EditResultSheet score boxes | `scoreWhite`, `scoreBlack` (min=0) |
| `AdminMatches.tsx` | Post-match edit scorer rows | goals, yellow_cards, red_cards (same bounds) |
| `AdminPlayers.tsx` | Ban-days picker | `days` (min=1 max=365) |
| `MatchEntryReview.tsx` | Final score inline edit | `effectiveScoreWhite`, `effectiveScoreBlack` (min=0) |

`tsc -b` exits 0. No migrations needed.

---

## Verification pending

Manual verification on next admin session:
1. AdminMatches ResultEntrySheet: tap score box → backspace clears → blank then retype → blur coerces empty to 0
2. AdminMatches scorer rows: yellow clamps to 2, red clamps to 1 on blur
3. AdminPlayers ban-days: blur empty → coerces to 1; type 9999 → clamps to 365
4. MatchEntryReview score boxes: same backspace + clamp behavior

Visual regression: inputs still pick up `auth-input` / `mer-score-input` / `admin-mp-edit-num` CSS classes — no layout change expected.

---

## State at close

- **Live HEAD:** b5046fe (Vercel auto-deploy triggered)
- **DB migrations:** 69 (unchanged)
- **Open PRs:** 0
- **Open GH issues:** 0
