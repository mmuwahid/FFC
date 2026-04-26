import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * Ref console state machine for slice 2B-C onward.
 *
 * Modes:
 *   'loading' — fetching matchday from token
 *   'invalid' — token rejected by server (expired, consumed, or never existed)
 *   'pre'     — pre-match screen visible; admin tapped link, ref hasn't started
 *   'live'    — match clock running (slice 2B-D wires the actual UI)
 *   'post'    — match ended, awaiting submit (slice 2B-E)
 *
 * State persists per-token in localStorage so a refresh / backgrounding doesn't
 * lose context. Key is sha256(token) so multiple admins minting different tokens
 * for different matchdays don't clobber each other in the browser.
 */

export type MatchMode = 'loading' | 'invalid' | 'pre' | 'live' | 'post'

interface RosterPlayer {
  profile_id: string | null
  guest_id: string | null
  display_name: string
  primary_position: string | null
  is_captain: boolean
}

interface MatchdayInfo {
  id: string
  kickoff_at: string
  venue: string | null
  effective_format: '7v7' | '5v5'
  roster_locked_at: string | null
}

export interface RefMatchdayPayload {
  matchday: MatchdayInfo
  white: RosterPlayer[]
  black: RosterPlayer[]
  token_expires_at: string
  has_match_row: boolean
}

interface PersistedState {
  mode: MatchMode
  kickoff_started_at: string | null
}

const STORAGE_PREFIX = 'ffc_ref_'

async function tokenKey(token: string): Promise<string> {
  // Use the Web Crypto API for sha256 — same hash the server uses, so the
  // localStorage key is stable per-token across devices on the same browser.
  const buf = new TextEncoder().encode(token)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return STORAGE_PREFIX + Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

function readPersisted(key: string): PersistedState | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as PersistedState
  } catch {
    return null
  }
}

function writePersisted(key: string, state: PersistedState): void {
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    /* private mode / storage blocked — non-fatal */
  }
}

export function useMatchSession(token: string | undefined) {
  const [mode, setMode] = useState<MatchMode>('loading')
  const [payload, setPayload] = useState<RefMatchdayPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [storageKey, setStorageKey] = useState<string | null>(null)
  const [kickoffAt, setKickoffAt] = useState<string | null>(null)

  // Resolve storage key from token (async because Web Crypto is async).
  useEffect(() => {
    if (!token) {
      setMode('invalid')
      return
    }
    let cancelled = false
    void tokenKey(token).then((key) => {
      if (cancelled) return
      setStorageKey(key)
    })
    return () => { cancelled = true }
  }, [token])

  // Once we have the storage key, hydrate persisted state and fetch matchday.
  useEffect(() => {
    if (!storageKey || !token) return
    let cancelled = false
    const persisted = readPersisted(storageKey)

    void supabase
      .rpc('get_ref_matchday', { p_token: token })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          setError(err.message)
          setMode('invalid')
          return
        }
        if (!data) {
          setError('Empty matchday payload')
          setMode('invalid')
          return
        }
        setPayload(data as unknown as RefMatchdayPayload)
        // If we have persisted state, restore it; otherwise stay 'pre'.
        if (persisted) {
          setMode(persisted.mode)
          setKickoffAt(persisted.kickoff_started_at)
        } else {
          setMode('pre')
        }
      })
    return () => { cancelled = true }
  }, [storageKey, token])

  // Persist whenever mode or kickoffAt change (and we have a key).
  useEffect(() => {
    if (!storageKey) return
    if (mode === 'loading' || mode === 'invalid') return
    writePersisted(storageKey, { mode, kickoff_started_at: kickoffAt })
  }, [storageKey, mode, kickoffAt])

  const startMatch = async () => {
    setKickoffAt(new Date().toISOString())
    setMode('live')
    // Best-effort screen wake-lock. Some browsers reject without a recent
    // user gesture, but this is invoked from the KICK OFF button click,
    // which IS a user gesture.
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<unknown> }
      }
      if (nav.wakeLock) {
        await nav.wakeLock.request('screen')
      }
    } catch {
      /* wake-lock denied or unsupported — non-fatal */
    }
  }

  return { mode, payload, error, kickoffAt, startMatch, sessionStorageKey: storageKey }
}
