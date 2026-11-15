// The app's data connection.
//
// SERVER mode (normal): data lives in the SECOND-SERVE backend (SQLite).
//   Every change is sent to POST /api/action and checked there; every open
//   screen receives the new state over /api/stream within about a second.
// LOCAL mode (fallback): if no backend answers (e.g. the static site was
//   opened on its own), the same rules run in this browser and data stays in
//   localStorage, exactly like the original demo.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppState, MatchWeights, TrustApplication, TrustCheckRecord } from '../types'
import { ActionError, applyAction, freshState, isState, withTrust, type Action, type ActionResult, type Actor, type NewDonationInput, type Role, type ScreenedExtras } from './actions'
import type { ReviewAction } from './trust'

export type { NewDonationInput, ScreenedExtras } from './actions'
export { withTrust } from './actions'

export const STORAGE_KEY = 'second-serve-preeval-v2'
const LOCAL_ACTOR_KEY = 'second-serve-local-actor'

export type User = {
  id: number
  role: Role
  name: string
  donorName?: string | null
  ngoId?: number | null
  runnerId?: number | null
  applicationId?: number | null
  demo?: boolean
}
export type Account = { id: number; role: Role; name: string }
export type Mode = 'loading' | 'server' | 'local'
export type Conn = 'live' | 'reconnecting' | 'offline'
export type Outcome = { ok: true; result: ActionResult } | { ok: false; error: { code: string; message: string } }

function loadLocal(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isState(parsed)) return withTrust(parsed)
    }
  } catch {
    /* fall through to fresh demo data */
  }
  return freshState(Date.now())
}

function loadLocalUser(): User | null {
  try {
    const u: unknown = JSON.parse(sessionStorage.getItem(LOCAL_ACTOR_KEY) ?? 'null')
    if (u && typeof u === 'object' && 'role' in u) return u as User
  } catch {
    /* ignore */
  }
  return null
}

const toActor = (u: User): Actor => ({
  role: u.role,
  name: u.name,
  userId: u.id,
  donorName: u.donorName ?? undefined,
  ngoId: u.ngoId ?? null,
  runnerId: u.runnerId ?? undefined,
  applicationId: u.applicationId ?? null,
})

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  const body = await res.json().catch(() => null)
  if (!body) throw new Error(`HTTP ${res.status}`)
  return body as T
}

export function useRescueStore() {
  const [mode, setMode] = useState<Mode>('loading')
  const [state, setState] = useState<AppState | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [conn, setConn] = useState<Conn>('offline')
  const [demoPins, setDemoPins] = useState<Record<string, string> | null>(null)
  const onError = useRef<(msg: string) => void>(() => {})
  const stateRef = useRef<AppState | null>(null)
  stateRef.current = state
  const userRef = useRef<User | null>(null)
  userRef.current = user

  // ---------------- decide the mode once
  useEffect(() => {
    let cancelled = false
    api<{ ok: boolean; mode?: string; user: User | null; demo?: boolean }>('/api/session')
      .then((s) => {
        if (cancelled) return
        if (s.ok && s.mode === 'server') {
          setMode('server')
          setUser(s.user)
        } else throw new Error('no backend')
      })
      .catch(() => {
        if (cancelled) return
        setMode('local')
        setState(loadLocal())
        setUser(loadLocalUser())
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ---------------- server: live stream while signed in
  useEffect(() => {
    if (mode !== 'server' || !user) return
    const es = new EventSource('/api/stream')
    es.addEventListener('state', (e) => {
      try {
        const msg = JSON.parse((e as MessageEvent).data) as { state: AppState; user: User }
        setState(msg.state)
        setUser((prev) => (prev && JSON.stringify(prev) === JSON.stringify(msg.user) ? prev : msg.user))
        setConn('live')
      } catch {
        /* ignore a malformed message */
      }
    })
    es.onerror = () => {
      setConn('reconnecting')
      // A 401 (session expired) closes the stream for good: go back to sign-in.
      fetch('/api/session')
        .then((r) => r.json())
        .then((s) => {
          if (s && s.mode === 'server' && !s.user) {
            es.close()
            setUser(null)
            setState(null)
          }
        })
        .catch(() => {})
    }
    return () => es.close()
  }, [mode, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------- local: persist + sync tabs
  useEffect(() => {
    if (mode !== 'local') return
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return
      try {
        const parsed: unknown = JSON.parse(e.newValue)
        if (isState(parsed)) setState(parsed)
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [mode])
  useEffect(() => {
    if (mode !== 'local' || !state) return
    try {
      const json = JSON.stringify(state)
      if (localStorage.getItem(STORAGE_KEY) !== json) localStorage.setItem(STORAGE_KEY, json)
    } catch {
      /* storage full or blocked */
    }
  }, [mode, state])

  // ---------------- the one way to change data
  const dispatch = useCallback(
    async (action: Action): Promise<Outcome> => {
      if (mode === 'server') {
        try {
          const r = await api<{ ok: boolean; result?: ActionResult; error?: { code: string; message: string } }>('/api/action', { method: 'POST', body: JSON.stringify({ action }) })
          if (r.ok) return { ok: true, result: r.result ?? {} }
          if (r.error?.code === 'SIGN_IN') setUser(null)
          onError.current(r.error?.message ?? 'Something went wrong.')
          return { ok: false, error: r.error ?? { code: 'ERROR', message: 'Something went wrong.' } }
        } catch {
          const error = { code: 'NETWORK', message: 'Couldn’t reach the SECOND-SERVE server. Is it still running?' }
          onError.current(error.message)
          return { ok: false, error }
        }
      }
      const s = stateRef.current
      const u = userRef.current
      if (!s || !u) return { ok: false, error: { code: 'SIGN_IN', message: 'Choose who you are first.' } }
      try {
        const out = applyAction(s, action, toActor(u), Date.now())
        setState(out.state)
        return { ok: true, result: out.result }
      } catch (e) {
        const error = e instanceof ActionError ? { code: e.code, message: e.message } : { code: 'ERROR', message: String(e) }
        onError.current(error.message)
        return { ok: false, error }
      }
    },
    [mode],
  )

  // ---------------- accounts
  const accounts = useCallback(async (): Promise<Account[]> => {
    if (mode === 'server') {
      const r = await api<{ accounts: Account[]; demoPins: Record<string, string> | null }>('/api/auth/accounts')
      setDemoPins(r.demoPins)
      return r.accounts
    }
    const s = stateRef.current ?? loadLocal()
    const donors = [...new Set([...s.donations.map((d) => d.donor), ...(s.applications ?? []).filter((a) => a.role === 'donor').map((a) => a.orgName)])]
    let id = 1
    return [
      { id: id++, role: 'coordinator', name: 'Coordinator' },
      ...donors.map((name) => ({ id: id++, role: 'donor' as const, name })),
      ...s.ngos.map((n) => ({ id: 1000 + n.id, role: 'ngo' as const, name: n.name })),
      ...s.runners.map((r) => ({ id: 2000 + r.id, role: 'runner' as const, name: r.name })),
    ]
  }, [mode])

  const login = useCallback(
    async (account: Account, pin: string): Promise<string | null> => {
      if (mode === 'server') {
        const r = await api<{ ok: boolean; user?: User; error?: { message: string } }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ userId: account.id, pin }) })
        if (!r.ok || !r.user) return r.error?.message ?? 'Sign-in failed.'
        setState(null)
        setUser(r.user)
        return null
      }
      // Offline demo: no PINs, the identity is just chosen.
      const s = stateRef.current ?? loadLocal()
      const app = (s.applications ?? []).find((a) => a.orgName === account.name)
      const u: User = {
        id: account.id,
        role: account.role,
        name: account.name,
        donorName: account.role === 'donor' ? account.name : null,
        ngoId: account.role === 'ngo' ? account.id - 1000 : null,
        runnerId: account.role === 'runner' ? account.id - 2000 : null,
        applicationId: app?.id ?? null,
      }
      sessionStorage.setItem(LOCAL_ACTOR_KEY, JSON.stringify(u))
      setUser(u)
      return null
    },
    [mode],
  )

  const signup = useCallback(
    async (role: 'donor' | 'ngo', name: string, pin: string): Promise<string | null> => {
      if (mode !== 'server') return 'Creating accounts needs the SECOND-SERVE server.'
      const r = await api<{ ok: boolean; user?: User; error?: { message: string } }>('/api/auth/signup', { method: 'POST', body: JSON.stringify({ role, name, pin }) })
      if (!r.ok || !r.user) return r.error?.message ?? 'Couldn’t create the account.'
      setUser(r.user)
      return null
    },
    [mode],
  )

  const logout = useCallback(async () => {
    if (mode === 'server') await api('/api/auth/logout', { method: 'POST' }).catch(() => null)
    else sessionStorage.removeItem(LOCAL_ACTOR_KEY)
    setUser(null)
    if (mode === 'server') setState(null)
  }, [mode])

  /** Upload a TrustCheck document to the server (server mode only). */
  const uploadDoc = useCallback(
    async (file: File, kind: string): Promise<string | null> => {
      if (mode !== 'server') return null
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
        r.onerror = () => reject(new Error('read failed'))
        r.readAsDataURL(file)
      })
      const res = await api<{ ok: boolean; url?: string; error?: { message: string } }>('/api/docs', { method: 'POST', body: JSON.stringify({ kind, name: file.name, type: file.type, data }) })
      if (!res.ok) throw new Error(res.error?.message ?? 'Upload failed')
      return res.url ?? null
    },
    [mode],
  )

  const importLocal = useCallback(async (): Promise<string> => {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!isState(parsed)) return 'This browser has no saved SECOND-SERVE data to import.'
    const r = await api<{ ok: boolean; error?: { message: string } }>('/api/admin/import', { method: 'POST', body: JSON.stringify({ state: parsed }) })
    return r.ok ? `Imported ${parsed.donations.length} listings from this browser.` : r.error?.message ?? 'Import failed.'
  }, [])

  const setErrorHandler = useCallback((fn: (msg: string) => void) => {
    onError.current = fn
  }, [])

  // ---------------- named actions (thin wrappers over dispatch)
  const a = dispatch
  return {
    mode,
    state,
    user,
    conn: mode === 'local' ? ('offline' as Conn) : conn,
    demoPins,
    dispatch,
    accounts,
    login,
    signup,
    logout,
    uploadDoc,
    importLocal,
    setErrorHandler,
    addDonation: (input: NewDonationInput, extras: ScreenedExtras = {}, autoMatch = true) => a({ type: 'addDonation', input, extras, autoMatch }),
    approveReview: (donationId: number, note?: string, autoMatch = true) => a({ type: 'approveReview', donationId, note, autoMatch }),
    reserve: (donationId: number, ngoId: number, score: number) => a({ type: 'reserve', donationId, ngoId, score }),
    autoMatch: (donationId: number) => a({ type: 'autoMatch', donationId }),
    releaseMatch: (donationId: number) => a({ type: 'releaseMatch', donationId }),
    assignRunner: (donationId: number, runnerId: number) => a({ type: 'assignRunner', donationId, runnerId }),
    advance: (donationId: number) => a({ type: 'advance', donationId }),
    withdraw: (donationId: number) => a({ type: 'withdraw', donationId }),
    splitDonation: (donationId: number, servings: number, autoMatch = true) => a({ type: 'splitDonation', donationId, servings, autoMatch }),
    ngoDecline: (donationId: number, reason: string) => a({ type: 'ngoDecline', donationId, reason }),
    ngoConfirmReceipt: (donationId: number) => a({ type: 'ngoConfirmReceipt', donationId }),
    setAccepting: (ngoId: number, accepting: boolean) => a({ type: 'setAccepting', ngoId, accepting }),
    toggleShift: (runnerId: number) => a({ type: 'toggleShift', runnerId }),
    shareLocation: (runnerId: number, lat: number, lng: number, accuracy: number) => a({ type: 'runnerLocation', runnerId, lat, lng, accuracy }),
    stopLocation: (runnerId: number) => a({ type: 'stopLocation', runnerId }),
    setWeights: (weights: MatchWeights | null) => a({ type: 'setWeights', weights }),
    submitApplication: (draft: TrustApplication, asDraft = false) => a({ type: 'submitApplication', draft, asDraft }),
    reviewApplication: (id: number, action: ReviewAction, note?: string) => a({ type: 'reviewApplication', id, action, note }),
    addTrustCheck: (id: number, check: Omit<TrustCheckRecord, 'id' | 'at' | 'by'>) => a({ type: 'addTrustCheck', id, check }),
    toggleTrustItem: (id: number, key: string) => a({ type: 'toggleTrustItem', id, key }),
    reset: () => a({ type: 'reset' }),
  }
}

export type RescueStore = ReturnType<typeof useRescueStore>
