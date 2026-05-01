# NumberInput component — design spec

**Date:** 2026-05-01
**Session:** S063
**Status:** Draft → awaiting user review
**Scope:** Global fix for the "backspace does nothing" UX bug in every numeric input across the app. Replace ad-hoc `<input type="number">` usages with a shared `<NumberInput>` primitive.

## Problem

All current numeric inputs in the app follow this pattern:

```tsx
<input
  type="number"
  min={0}
  value={n}
  onChange={(e) => setN(Math.max(0, Number(e.target.value) || 0))}
/>
```

`Number('') === 0`, so `Number(e.target.value) || 0` returns `0` the moment the field becomes empty. The controlled input snaps back to `"0"` on the next render, before the user can type the replacement digit. From the user's perspective: backspace appears to do nothing, and the only way to change the value is to long-press / double-click to highlight the existing digits and overtype them.

The desired behavior matches a normal text input: tap into the field, cursor positions where you tapped, backspace deletes the digit, type the new digit. Empty-while-typing is allowed; on blur, the field coerces to a valid value.

## Goal

Ship a small, reusable `<NumberInput>` component and migrate every call-site so the bug is fixed everywhere with one place to maintain.

## Non-goals

- Stepper buttons (`−` / `+`). The component reserves a `stepper` prop for a follow-up (Scorer Picker, item #1 in the S063 plan), but the visuals/behavior of stepper buttons are out of scope for this spec.
- Decimal / float values. No current call-site needs them.
- Negative values. No current call-site needs them.
- Unit tests. FFC has no test infrastructure (per `tasks/lessons.md`); verification is manual via the dev preview.
- New CSS. The component renders an underlying `<input>` and forwards `className`; existing classes (`auth-input`, scorer-row inline styles) remain unchanged.

## Component

**Location:** `ffc/src/components/NumberInput.tsx`

**Public API**

```ts
interface NumberInputProps {
  value: number;
  onChange: (n: number) => void;
  min?: number;            // default 0
  max?: number;            // default Number.POSITIVE_INFINITY
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  stepper?: boolean;       // default false; reserved for #1 Scorer Picker
}
```

**Internal state**

- `displayValue: string` — what the input is rendering right now. Initialized from `String(value)`.
- `isFocused: boolean` — used to decide whether external `value` changes should overwrite the local string.

**Behavior**

| Event | Behavior |
|---|---|
| `value` prop changes while NOT focused | Sync `displayValue` to `String(value)`. (Covers parent-driven resets.) |
| `value` prop changes while focused | Do nothing — the user is editing; their string wins. |
| `onChange` of `<input>` | If new string is empty or all-digits: update `displayValue`. If it's a valid finite number, call `props.onChange(clamp(parsed))`. If it's empty, **do not** call `props.onChange`. (Empty-as-zero would re-introduce the snap-back bug.) |
| `onFocus` | Set `isFocused = true`. No auto-select. |
| `onBlur` | Set `isFocused = false`. If `displayValue` is empty or NaN, set `displayValue = String(min)` and call `props.onChange(min)`. Otherwise clamp parsed value to `[min, max]`, sync `displayValue` to clamped, call `props.onChange(clamped)` if it differs. |
| Keyboard | Use `inputMode="numeric"` + `pattern="[0-9]*"` so iOS / Android show the numeric keypad. `type="text"` (not `"number"`) — `type="number"` has historic quirks (scroll changes value, locale-dependent decimal parsing, inconsistent caret behavior); `inputMode` covers the mobile keyboard need. |

**Clamp helper**

```ts
const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(n, min), max);
```

**Sketch**

```tsx
export function NumberInput({
  value, onChange, min = 0, max = Number.POSITIVE_INFINITY,
  className, ariaLabel, disabled,
}: NumberInputProps) {
  const [displayValue, setDisplayValue] = useState(() => String(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) setDisplayValue(String(value));
  }, [value, isFocused]);

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      className={className}
      aria-label={ariaLabel}
      disabled={disabled}
      value={displayValue}
      onChange={(e) => {
        const next = e.target.value;
        if (next === '' || /^\d+$/.test(next)) {
          setDisplayValue(next);
          if (next !== '') {
            const parsed = Number(next);
            if (Number.isFinite(parsed)) onChange(clamp(parsed, min, max));
          }
        }
      }}
      onFocus={() => setIsFocused(true)}
      onBlur={() => {
        setIsFocused(false);
        if (displayValue === '' || Number.isNaN(Number(displayValue))) {
          setDisplayValue(String(min));
          onChange(min);
          return;
        }
        const parsed = Number(displayValue);
        const clamped = clamp(parsed, min, max);
        if (clamped !== parsed) {
          setDisplayValue(String(clamped));
          onChange(clamped);
        }
      }}
    />
  );
}
```

(Final implementation may differ in style; the spec is the contract, not the listing.)

## Call-site migration

| File | Lines | Inputs |
|---|---|---|
| `ffc/src/pages/admin/AdminMatches.tsx` | ~1238, ~1243 | `scoreWhite`, `scoreBlack` (ResultEntrySheet, primary) — `min={0}` |
| `ffc/src/pages/admin/AdminMatches.tsx` | ~1311, ~1312, ~1313 | per-row scorer goals (`min={0}`), yellow_cards (`min={0} max={2}`), red_cards (`min={0} max={1}`) |
| `ffc/src/pages/admin/AdminMatches.tsx` | ~1507, ~1511 | `scoreWhite`, `scoreBlack` (EditResultSheet) — `min={0}` |
| `ffc/src/pages/admin/AdminMatches.tsx` | ~1638, ~1649, ~1660 | per-row goals / yellow / red (post-match path) |
| `ffc/src/pages/admin/AdminPlayers.tsx` | ~841 | ban-days picker — `min={1} max={365}` |
| `ffc/src/pages/admin/MatchEntryReview.tsx` | ~446, ~460 | review-screen numeric inputs |

Each migration replaces:

```tsx
<input
  type="number"
  min={M}
  max={X}
  className="auth-input"
  value={n}
  onChange={(e) => setN(Math.max(M, Math.min(X, Number(e.target.value) || M)))}
/>
```

with:

```tsx
<NumberInput
  value={n}
  onChange={setN}
  min={M}
  max={X}
  className="auth-input"
/>
```

The `Math.min(X, …)` clamp is now inside `NumberInput`. Where the call-site only had `Math.max(M, …)` (no max), omit the `max` prop.

## Edge cases

- **Pasted text with non-digits** (e.g. user pastes "12abc") — `onChange` regex rejects the whole string, `displayValue` does not update. The browser's controlled-input contract restores the prior text. Acceptable; users almost never paste into goals fields.
- **External reset to 0 while focused** — focused-state guard means the user keeps typing their string until blur. On blur the parent's `0` will not have changed (we never fired `onChange` for empty), and the blur handler will commit the user's typed value. This is intentional.
- **`min` greater than `max`** — caller bug, not handled. Component clamps using `Math.min(Math.max(n, min), max)`; the result is `max` when `min > max`. Acceptable; we don't enforce contract checks.
- **Decimal point typed on a numeric mobile keyboard** — regex `^\d+$` rejects, displayValue doesn't change. Acceptable for current call-sites (all are integer counts).

## Risks

- **Behavior diverges subtly between focused-typing and parent-pushed value.** A parent that resets the value while the user has the field focused will *not* see the field reset until blur. Today's call-sites only push values from the user's own typing or from initial-load fetches; no concurrent push-while-focused is known. Mitigation: documented in the table above; revisit if a Scorer Picker stepper button pushes async.
- **`type="text"` vs `type="number"` accessibility difference.** Some screen readers announce `type="number"` as "spin button". `type="text" inputMode="numeric"` is announced as a text input. Acceptable trade-off given `type="number"` quirks; `aria-label` on the input gives screen readers the same naming hint.

## Verification

Manual. After migrating all 9 sites, on the dev preview server (`npm run dev` in `ffc/`):

1. **AdminMatches → ResultEntrySheet → score boxes**: tap each score box → cursor positions → backspace clears digit → numeric keypad on iOS sim / mobile preview → blur empty → coerces to `0`.
2. **AdminMatches → ResultEntrySheet → scorer rows**: same on goals / yellow / red. Yellow clamps to 2 on blur if user types "5". Red clamps to 1 on blur if user types "5".
3. **AdminPlayers → ban-days picker**: blur empty → coerces to `1` (min). Type "9999" → clamps to `365` on blur.
4. **MatchEntryReview**: same backspace + clamp behavior on its 2 numeric inputs.
5. **Visual regression**: confirm the inputs still pick up `auth-input` styling (border, focus-visible ring from S062, padding) — no layout shift.
6. **`tsc -b` exits 0** — strict project-refs build per CLAUDE.md rule 12.

## Out-of-scope follow-ups

- **Scorer Picker (#1, next sub-spec).** Will use `<NumberInput>` directly, optionally with the `stepper` prop wired up.
- **Slot reorder (#2, third sub-spec).** Independent of this work.
