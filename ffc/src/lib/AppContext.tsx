import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

/* Plain-object Context per CLAUDE.md Rule #8 — no useMemo cascade.
 * The provider rebuilds the value object on each render; consumers that
 * only need a subset can destructure or select to limit re-renders.
 *
 * Phase 1 scope: session + role (derived from a stub profile fetch).
 * Real profile + display_name come online with Step 2 migrations.
 */

export type UserRole = 'player' | 'admin' | 'super_admin' | 'rejected' | null

export interface AppContextValue {
  /** Null = signed-out. Otherwise the current Supabase session. */
  session: Session | null
  /** Role derived from the `profiles` table. Null until Step 2 / fetch completes. */
  role: UserRole
  /** True while the first session resolution is in flight (mounts / refresh). */
  loading: boolean
  /** Fire-and-forget sign out. Swallows errors (surface via AppError elsewhere). */
  signOut: () => Promise<void>
}

const defaultValue: AppContextValue = {
  session: null,
  role: null,
  loading: true,
  signOut: async () => {},
}

const AppContext = createContext<AppContextValue>(defaultValue)

interface AppProviderProps {
  children: ReactNode
}

export function AppProvider({ children }: AppProviderProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<UserRole>(null)
  const [loading, setLoading] = useState(true)

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

  useEffect(() => {
    if (!session) {
      setRole(null)
      return
    }
    /* Step 2 placeholder — resolve role from `profiles` once migrations land.
     * For now keep `role=null` until the profiles table exists; guards against
     * false-positive admin layouts before the DB is ready. */
    setRole(null)
  }, [session])

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const value: AppContextValue = {
    session,
    role,
    loading,
    signOut,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  return useContext(AppContext)
}
