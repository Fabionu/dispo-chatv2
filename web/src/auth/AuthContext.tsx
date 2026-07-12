import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { clearUserDrafts } from '../lib/draftStorage'

export type User = {
  id: string
  email: string
  displayName: string
  role: 'admin' | 'dispatcher' | 'driver' | 'partner'
}

export type Workspace = {
  id: string
  name: string
  slug: string
}

type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; user: User; workspace: Workspace }

type AuthValue = AuthState & {
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' })
      if (!res.ok) {
        setState({ status: 'signed_out' })
        return
      }
      const body = (await res.json()) as { user: User; workspace: Workspace }
      setState({ status: 'signed_in', user: body.user, workspace: body.workspace })
    } catch {
      setState({ status: 'signed_out' })
    }
  }, [])

  const signOut = useCallback(async () => {
    await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' })
    // Drop this user's local drafts so nothing lingers on a shared device after
    // the account signs out (drafts are namespaced by user id regardless).
    setState((prev) => {
      if (prev.status === 'signed_in') clearUserDrafts(prev.user.id)
      return { status: 'signed_out' }
    })
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<AuthValue>(() => ({ ...state, refresh, signOut }), [state, refresh, signOut])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>')
  return v
}
