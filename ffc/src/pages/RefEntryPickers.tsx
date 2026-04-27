import { useState } from 'react'
import type { RefMatchdayPayload } from '../lib/useMatchSession'

/* §3.4-v2 Slice 2B-D — Live console pickers (extracted from RefEntry.tsx).
 *
 * Five bottom-sheet pickers + helpers. All props-driven and dialog-roled.
 * Kept together because they share visual language (`.ref-picker-*` styles)
 * and lifecycle (open/onPick/onClose).
 */

export interface ScorerPickerProps {
  team: 'white' | 'black'
  payload: RefMatchdayPayload
  onPick: (participant: { profile_id: string | null; guest_id: string | null }, isOwnGoal: boolean) => void
  onClose: () => void
}

export function ScorerPicker({ team, payload, onPick, onClose }: ScorerPickerProps) {
  const [isOwnGoal, setIsOwnGoal] = useState(false)
  // When own-goal mode is active, show the OPPOSITE team's roster (the player
  // who put it in their own net).
  const rosterTeam: 'white' | 'black' = isOwnGoal ? (team === 'white' ? 'black' : 'white') : team
  const players = rosterTeam === 'white' ? payload.white : payload.black
  const titleTeam = team === 'white' ? 'White' : 'Black'

  return (
    <>
      <div className="ref-picker-backdrop" onClick={onClose} />
      <div className="ref-picker-sheet" role="dialog" aria-modal="true">
        <div className="ref-picker-grabber" />
        <h3 className="ref-picker-title">
          {isOwnGoal ? `Own goal — who put it in their own net?` : `Who scored for ${titleTeam}?`}
        </h3>
        <p className="ref-picker-sub">
          {isOwnGoal
            ? `Goal credits ${titleTeam}.`
            : `Auto-stamps the current match minute. Tap player.`}
        </p>
        <div className="ref-picker-toggle-row">
          <button
            type="button"
            className={'ref-picker-toggle' + (!isOwnGoal ? ' ref-picker-toggle--active' : '')}
            onClick={() => setIsOwnGoal(false)}
          >
            Goal
          </button>
          <button
            type="button"
            className={'ref-picker-toggle' + (isOwnGoal ? ' ref-picker-toggle--active' : '')}
            onClick={() => setIsOwnGoal(true)}
          >
            Own Goal
          </button>
        </div>
        <div className="ref-picker-grid">
          {players.map((p) => (
            <button
              key={(p.profile_id ?? p.guest_id ?? 'p') + ':' + p.display_name}
              type="button"
              className="ref-picker-row"
              onClick={() => {
                onPick({ profile_id: p.profile_id, guest_id: p.guest_id }, isOwnGoal)
                onClose()
              }}
            >
              <span>{p.display_name}{p.is_captain ? ' (C)' : ''}</span>
              {p.primary_position && (
                <span className="ref-picker-pos">{p.primary_position.toUpperCase()}</span>
              )}
            </button>
          ))}
        </div>
        <button type="button" className="ref-picker-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- stable const, no HMR concern
export const PAUSE_REASONS = ['Foul', 'Injury', 'Ref decision', 'Other'] as const

export interface PauseReasonPickerProps {
  onPick: (reason: string) => void
  onClose: () => void
}

export function PauseReasonPicker({ onPick, onClose }: PauseReasonPickerProps) {
  return (
    <>
      <div className="ref-picker-backdrop" onClick={onClose} />
      <div className="ref-picker-sheet" role="dialog" aria-modal="true">
        <div className="ref-picker-grabber" />
        <h3 className="ref-picker-title">Pause — why?</h3>
        <p className="ref-picker-sub">Optional. Choose to log it; skip to pause without a reason.</p>
        <div className="ref-picker-grid">
          {PAUSE_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              className="ref-picker-row"
              onClick={() => onPick(reason)}
            >
              <span>{reason}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ref-picker-cancel"
          onClick={() => onPick('')}
        >
          Pause without reason
        </button>
      </div>
    </>
  )
}

export interface CardPlayerPickerProps {
  payload: RefMatchdayPayload
  onPick: (team: 'white' | 'black', participant: { profile_id: string | null; guest_id: string | null; display_name: string }) => void
  onClose: () => void
}

export function CardPlayerPicker({ payload, onPick, onClose }: CardPlayerPickerProps) {
  return (
    <>
      <div className="ref-picker-backdrop" onClick={onClose} />
      <div className="ref-picker-sheet" role="dialog" aria-modal="true">
        <div className="ref-picker-grabber" />
        <h3 className="ref-picker-title">Card — who?</h3>
        <p className="ref-picker-sub">Pick the player. Yellow / Red comes next.</p>
        {(['white', 'black'] as const).map((team) => {
          const players = team === 'white' ? payload.white : payload.black
          return (
            <div key={team} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--rf-text-muted)', textTransform: 'uppercase', margin: '8px 0 6px' }}>
                {team === 'white' ? 'White' : 'Black'}
              </div>
              <div className="ref-picker-grid">
                {players.map((p) => (
                  <button
                    key={(p.profile_id ?? p.guest_id ?? 'p') + ':' + p.display_name}
                    type="button"
                    className="ref-picker-row"
                    onClick={() => onPick(team, { profile_id: p.profile_id, guest_id: p.guest_id, display_name: p.display_name })}
                  >
                    <span>{p.display_name}</span>
                    {p.primary_position && (
                      <span className="ref-picker-pos">{p.primary_position.toUpperCase()}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        <button type="button" className="ref-picker-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  )
}

export interface CardKindPickerProps {
  playerName: string
  team: 'white' | 'black'
  onPick: (kind: 'yellow' | 'red') => void
  onClose: () => void
}

export function CardKindPicker({ playerName, team, onPick, onClose }: CardKindPickerProps) {
  return (
    <>
      <div className="ref-picker-backdrop" onClick={onClose} />
      <div className="ref-picker-sheet" role="dialog" aria-modal="true">
        <div className="ref-picker-grabber" />
        <h3 className="ref-picker-title">Card for {playerName} ({team[0].toUpperCase()})</h3>
        <p className="ref-picker-sub">Yellow or Red?</p>
        <div className="ref-picker-grid">
          <button
            type="button"
            className="ref-picker-row"
            onClick={() => onPick('yellow')}
            style={{ background: 'rgba(229,186,91,0.18)', borderColor: 'var(--rf-accent)' }}
          >
            <span>🟨 Yellow</span>
          </button>
          <button
            type="button"
            className="ref-picker-row"
            onClick={() => onPick('red')}
            style={{ background: 'rgba(230,51,73,0.18)', borderColor: 'var(--rf-danger)' }}
          >
            <span>🟥 Red</span>
          </button>
        </div>
        <button type="button" className="ref-picker-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  )
}

export interface MotmPickerProps {
  payload: RefMatchdayPayload
  current: { profile_id: string | null; guest_id: string | null; display_name: string; team: 'white' | 'black' } | null
  onPick: (selection: { profile_id: string | null; guest_id: string | null; display_name: string; team: 'white' | 'black' } | null) => void
  onClose: () => void
}

export function MotmPicker({ payload, current, onPick, onClose }: MotmPickerProps) {
  const allPlayers: Array<{
    profile_id: string | null
    guest_id: string | null
    display_name: string
    team: 'white' | 'black'
    primary_position: string | null
  }> = [
    ...payload.white.map((p) => ({
      profile_id: p.profile_id,
      guest_id: p.guest_id,
      display_name: p.display_name,
      team: 'white' as const,
      primary_position: p.primary_position,
    })),
    ...payload.black.map((p) => ({
      profile_id: p.profile_id,
      guest_id: p.guest_id,
      display_name: p.display_name,
      team: 'black' as const,
      primary_position: p.primary_position,
    })),
  ]

  function isCurrent(p: { profile_id: string | null; guest_id: string | null }): boolean {
    if (!current) return false
    return current.profile_id === p.profile_id && current.guest_id === p.guest_id
  }

  return (
    <>
      <div className="ref-picker-backdrop" onClick={onClose} />
      <div className="ref-picker-sheet" role="dialog" aria-modal="true">
        <div className="ref-picker-grabber" />
        <h3 className="ref-picker-title">Set MOTM</h3>
        <p className="ref-picker-sub">Combined roster · can be changed before submit.</p>
        <div className="ref-picker-grid">
          {allPlayers.map((p) => (
            <button
              key={(p.profile_id ?? p.guest_id ?? 'p') + ':' + p.display_name}
              type="button"
              className={'ref-picker-row' + (isCurrent(p) ? ' ref-picker-toggle--active' : '')}
              onClick={() => onPick({
                profile_id: p.profile_id,
                guest_id: p.guest_id,
                display_name: p.display_name,
                team: p.team,
              })}
            >
              <span>{p.display_name} <span style={{ color: 'var(--rf-text-muted)', fontWeight: 600 }}>({p.team[0].toUpperCase()})</span></span>
              {p.primary_position && (
                <span className="ref-picker-pos">{p.primary_position.toUpperCase()}</span>
              )}
            </button>
          ))}
        </div>
        {current && (
          <button
            type="button"
            className="ref-picker-cancel"
            onClick={() => onPick(null)}
          >
            Clear MOTM
          </button>
        )}
        <button type="button" className="ref-picker-cancel" onClick={onClose} style={{ marginTop: 8 }}>
          Close
        </button>
      </div>
    </>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- pure helper, no HMR concern
export function truncateName(name: string): string {
  if (name.length <= 14) return name
  return name.slice(0, 12) + '…'
}

export interface EventDeletePickerProps {
  /** Pre-formatted minute label (e.g. "12'", "35+1'"). */
  minuteLabel: string
  /** Human-readable description of the event being deleted. */
  description: string
  onConfirm: () => void
  onClose: () => void
}

export function EventDeletePicker({ minuteLabel, description, onConfirm, onClose }: EventDeletePickerProps) {
  return (
    <>
      <div className="ref-picker-backdrop" onClick={onClose} />
      <div className="ref-picker-sheet" role="dialog" aria-modal="true">
        <div className="ref-picker-grabber" />
        <h3 className="ref-picker-title">Delete this event?</h3>
        <p className="ref-picker-sub">
          <strong>{minuteLabel}</strong> — {description}
        </p>
        <p className="ref-picker-sub" style={{ marginTop: 4 }}>
          The score will adjust automatically. This can&apos;t be undone.
        </p>
        <div className="ref-picker-grid">
          <button
            type="button"
            className="ref-picker-row"
            onClick={() => {
              onConfirm()
              onClose()
            }}
            style={{ background: 'rgba(230,51,73,0.18)', borderColor: 'var(--rf-danger)' }}
          >
            <span>🗑 Delete event</span>
          </button>
        </div>
        <button type="button" className="ref-picker-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  )
}
