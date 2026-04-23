// Formation presets — §3.19 Phase 1
//
// Coordinates are percent-based on a portrait pitch (viewBox 0 0 100 150):
//   x ∈ [0, 100]  — left→right (22% / 50% / 78% is the canonical three-across row)
//   y ∈ [0, 150]  — captain's goal at y=0 (top), opponent's goal at y=150 (bottom)
//
// Each preset ships an ordered list of slots. A slot is { pos: positionLabel, x, y }.
// The first slot is always GK. The caller assigns match_players to slots in order.
// `positionLabel` is the tactical label rendered on the token ("GK" | "DEF" | "CDM" |
// "W" | "ST"); it is distinct from player `primary_position` (used only as a hint for
// the auto-slot step in later slices).
//
// 7v7 preset set per V2.7 §13: six named patterns + Custom.
// 5v5 preset set per V2.8 §16.E: three named patterns + Custom.
// Custom is a sentinel — caller owns the layout and drag state.

export type FormationMatchFormat = '7v7' | '5v5'

export type FormationPositionLabel = 'GK' | 'DEF' | 'CDM' | 'W' | 'ST'

export interface FormationSlot {
  pos: FormationPositionLabel
  /** x percent on viewBox 0..100 */
  x: number
  /** y percent on viewBox 0..150 */
  y: number
}

export interface FormationPreset {
  pattern: string
  label: string
  /** Short descriptor shown under the chip label */
  tag: string
  format: FormationMatchFormat
  slots: FormationSlot[]
}

// ───────────────────────────────────────────────────────────────
// 7v7 — 7 slots (1 GK + 6 outfield)
// ───────────────────────────────────────────────────────────────

const SEVEN_V_SEVEN: FormationPreset[] = [
  {
    pattern: '2-3-1',
    label: '2-3-1',
    tag: 'Defensive',
    format: '7v7',
    slots: [
      { pos: 'GK', x: 50, y: 12 },
      { pos: 'DEF', x: 30, y: 45 },
      { pos: 'DEF', x: 70, y: 45 },
      { pos: 'W', x: 22, y: 78 },
      { pos: 'CDM', x: 50, y: 78 },
      { pos: 'W', x: 78, y: 78 },
      { pos: 'ST', x: 50, y: 120 },
    ],
  },
  {
    pattern: '3-2-1',
    label: '3-2-1',
    tag: 'Balanced def',
    format: '7v7',
    slots: [
      { pos: 'GK', x: 50, y: 12 },
      { pos: 'DEF', x: 22, y: 42 },
      { pos: 'DEF', x: 50, y: 42 },
      { pos: 'DEF', x: 78, y: 42 },
      { pos: 'CDM', x: 35, y: 78 },
      { pos: 'W', x: 65, y: 78 },
      { pos: 'ST', x: 50, y: 117 },
    ],
  },
  {
    pattern: '2-2-2',
    label: '2-2-2',
    tag: 'Balanced',
    format: '7v7',
    slots: [
      { pos: 'GK', x: 50, y: 12 },
      { pos: 'DEF', x: 30, y: 42 },
      { pos: 'DEF', x: 70, y: 42 },
      { pos: 'CDM', x: 35, y: 78 },
      { pos: 'W', x: 65, y: 78 },
      { pos: 'ST', x: 35, y: 117 },
      { pos: 'ST', x: 65, y: 117 },
    ],
  },
  {
    pattern: '3-1-2',
    label: '3-1-2',
    tag: 'Attack',
    format: '7v7',
    slots: [
      { pos: 'GK', x: 50, y: 12 },
      { pos: 'DEF', x: 22, y: 42 },
      { pos: 'DEF', x: 50, y: 42 },
      { pos: 'DEF', x: 78, y: 42 },
      { pos: 'CDM', x: 50, y: 78 },
      { pos: 'ST', x: 35, y: 117 },
      { pos: 'ST', x: 65, y: 117 },
    ],
  },
  {
    pattern: '2-1-3',
    label: '2-1-3',
    tag: 'Offensive',
    format: '7v7',
    slots: [
      { pos: 'GK', x: 50, y: 12 },
      { pos: 'DEF', x: 30, y: 42 },
      { pos: 'DEF', x: 70, y: 42 },
      { pos: 'CDM', x: 50, y: 78 },
      { pos: 'W', x: 22, y: 117 },
      { pos: 'ST', x: 50, y: 117 },
      { pos: 'W', x: 78, y: 117 },
    ],
  },
  {
    pattern: '1-3-2',
    label: '1-3-2',
    tag: 'Wingers',
    format: '7v7',
    slots: [
      { pos: 'GK', x: 50, y: 12 },
      { pos: 'DEF', x: 50, y: 42 },
      { pos: 'W', x: 22, y: 78 },
      { pos: 'CDM', x: 50, y: 78 },
      { pos: 'W', x: 78, y: 78 },
      { pos: 'ST', x: 35, y: 117 },
      { pos: 'ST', x: 65, y: 117 },
    ],
  },
]

// ───────────────────────────────────────────────────────────────
// 5v5 — 5 slots (1 GK + 4 outfield)
// ───────────────────────────────────────────────────────────────

const FIVE_V_FIVE: FormationPreset[] = [
  {
    pattern: '1-2-1',
    label: '1-2-1',
    tag: 'Diamond',
    format: '5v5',
    slots: [
      { pos: 'GK', x: 50, y: 12 },
      { pos: 'DEF', x: 50, y: 45 },
      { pos: 'W', x: 25, y: 78 },
      { pos: 'W', x: 75, y: 78 },
      { pos: 'ST', x: 50, y: 120 },
    ],
  },
  {
    pattern: '2-1-1',
    label: '2-1-1',
    tag: 'Defensive',
    format: '5v5',
    slots: [
      { pos: 'GK', x: 50, y: 12 },
      { pos: 'DEF', x: 30, y: 45 },
      { pos: 'DEF', x: 70, y: 45 },
      { pos: 'CDM', x: 50, y: 85 },
      { pos: 'ST', x: 50, y: 120 },
    ],
  },
  {
    pattern: '1-1-2',
    label: '1-1-2',
    tag: 'Attacking',
    format: '5v5',
    slots: [
      { pos: 'GK', x: 50, y: 12 },
      { pos: 'DEF', x: 50, y: 45 },
      { pos: 'CDM', x: 50, y: 85 },
      { pos: 'ST', x: 30, y: 120 },
      { pos: 'ST', x: 70, y: 120 },
    ],
  },
]

export const CUSTOM_PATTERN = 'custom'

export function presetsForFormat(format: FormationMatchFormat): FormationPreset[] {
  return format === '5v5' ? FIVE_V_FIVE : SEVEN_V_SEVEN
}

export function getPreset(pattern: string, format: FormationMatchFormat): FormationPreset | null {
  return presetsForFormat(format).find((p) => p.pattern === pattern) ?? null
}

export function rosterSizeForFormat(format: FormationMatchFormat): number {
  // Same value roster_cap() returns on the DB side, divided by 2 (per-team).
  return format === '5v5' ? 5 : 7
}
