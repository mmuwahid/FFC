import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

/* Plain-object Context per CLAUDE.md Rule #8 — no useMemo cascade.
 *
 * Phase 1 Step 3 scope: after Supabase reports a session we look up the caller's
 * `profiles` row by auth_user_id and expose id + role. Signed-in users without
 * a profile (pending/rejected) surface as `session != null, role === null`.
 */

export type UserRole = 'player' | 'admin' | 'super_admin' | 'rejected' | null

export interface AppContextValue {
  /** Null = signed-out. Otherwise the current Supabase session. */
  session: Session | null
  /** Approved user's profile id. Null until profile fetch resolves / no profile exists. */
  profileId: string | null
  /** Role derived from the profiles table. Null while loading, between states, or for pending users. */
  role: UserRole
  /** True during the first session resolution (mount / refresh). */
  loading: boolean
  /** True while the profiles row lookup is in flight after a session appears. */
  profileLoading: boolean
  /** Fire-and-forget sign out. */
  signOut: () => Promise<void>
}

const defaultValue: AppContextValue = {
  session: null,
  profileId: null,
  role: null,
  loading: true,
  profileLoading: false,
  signOut: async () => {},
}

const AppContext = createContext<AppContextValue>(defaultValue)

interface AppProviderProps {
  children: ReactNode
}

export function AppProvider({ children }: AppProviderProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [role, setRole] = useState<UserRole>(null)
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  /* Resolve profile row whenever the signed-in user changes.
   * Depend on user.id specifically — Supabase can emit new session objects
   * for the same user on token refresh, and we don't want to re-fetch then. */
  const userId = session?.user?.id ?? null
  useEffect(() => {
    let cancelled = false
    if (!userId) {
      setProfileId(null)
      setRole(null)
      setProfileLoading(false)
      return
    }
    setProfileLoading(true)
    supabase
      .from('profiles')
      .select('id, role')
      .eq('auth_user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.warn('[FFC] profile lookup failed', error.message)
          setProfileId(null)
          setRole(null)
        } else if (data) {
          setProfileId(data.id)
          setRole(data.role as UserRole)
        } else {
          setProfileId(null)
          setRole(null)
        }
        setProfileLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const value: AppContextValue = {
    session,
    profileId,
    role,
    loading,
    profileLoading,
    signOut,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  return useContext(AppContext)
}
