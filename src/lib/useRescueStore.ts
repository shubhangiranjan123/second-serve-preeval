import { useCallback, useEffect, useState } from 'react'
import type { AppState, Category, Diet, Donation, MatchWeights, Packaging, Screening, StorageType, TrustApplication, TrustCheckRecord } from '../types'
import { createInitialApplications, nextStatus, syncNgo, type ReviewAction } from './trust'
import { createInitialState, findArea } from '../data/demoData'
import { MIN, estimateWeightKg } from './engine'

export const STORAGE_KEY = 'second-serve-preeval-v2'

export type NewDonationInput = {
  name: string
  donor: string
  category: Category
  servings: number
  quantity: number
  unit: string
  area: string
  address: string
  storage: StorageType
  diet: Diet
  description: string
  prepMinutes: number
  travelEstimate: number
  safeHours: number
}

// Extra fields from the AI Food Scan flow (Engine 1). All optional, so the
// existing manual listing form keeps working exactly as before.
export type ScreenedExtras = {
  preparedAt?: number
  packaging?: Packaging
  screening?: Screening
}

function isState(value: unknown): value is AppState {
  if (!value || typeof value !== 'object') return false
  const s = value as Partial<AppState>
  return (
    s.version === 1 &&
    Array.isArray(s.donations) &&
    Array.isArray(s.ngos) &&
    Array.isArray(s.runners) &&
    Array.isArray(s.history)
  )
}

// Older saves have no TrustCheck data: add the demo applications and make
// each NGO's verification match its application, without touching anything else.
export function withTrust(s: AppState, now = Date.now()): AppState {
  if (Array.isArray(s.applications)) return s
  const applications = createInitialApplications(now, s.ngos)
  const ngos = s.ngos.map((n) => {
    const app = applications.find((a) => a.role === 'recipient' && a.ngoId === n.id)
    return app ? { ...n, verification: app.status } : n
  })
  return { ...s, ngos, applications }
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isState(parsed)) return withTrust(parsed)
    }
  } catch {
    /* fall through to fresh demo data */
  }
  return withTrust(createInitialState(Date.now()))
}

export function useRescueStore() {
  const [state, setState] = useState<AppState>(load)

  // Keep every open tab in sync (e.g. the projector's Room wall + the laptop).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return
      try {
        const parsed: unknown = JSON.parse(e.newValue)
        if (isState(parsed)) setState(parsed)
      } catch {
        /* ignore malformed writes */
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === JSON.stringify(state)) return
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* storage full or blocked: the demo keeps working in memory */
    }
  }, [state])

  const addDonation = useCallback(
    (input: NewDonationInput, extras: ScreenedExtras = {}): Donation | null => {
      const now = Date.now()
      // Duplicate guard: the same food from the same donor listed again within
      // 10 minutes (double click, resubmitted form) is ignored.
      const dup = state.donations.find(
        (d) =>
          d.status !== 'Delivered' &&
          d.donor.trim().toLowerCase() === input.donor.trim().toLowerCase() &&
          d.name.trim().toLowerCase() === input.name.trim().toLowerCase() &&
          now - d.createdAt < 10 * MIN,
      )
      if (dup) return null
      const held = extras.screening?.outcome === 'review'
      const area = findArea(input.area)
      const { safeHours, ...fields } = input
      const created: Donation = {
        id: Math.max(0, ...state.donations.map((d) => d.id)) + 1,
        ...fields,
        lat: area.lat,
        lng: area.lng,
        createdAt: now,
        readyAt: now + input.prepMinutes * MIN,
        safeUntil: now + Math.round(safeHours * 60) * MIN,
        status: held ? 'In review' : 'Available',
        ngoId: null,
        runnerId: null,
        stage: 'Pending',
        timeline: [
          {
            key: 'created',
            at: now,
            note: extras.screening
              ? `Listed by ${input.donor} · AI-screened${held ? ', held for review' : ''}`
              : `Listed by ${input.donor}`,
          },
        ],
        ...extras,
      }
      setState((s) => ({ ...s, donations: [created, ...s.donations] }))
      return created
    },
    [state.donations],
  )

  const reserve = useCallback((donationId: number, ngoId: number, score: number) => {
    setState((s) => {
      const ngo = s.ngos.find((n) => n.id === ngoId)
      return {
        ...s,
        donations: s.donations.map((d) =>
          d.id === donationId && d.status === 'Available'
            ? {
                ...d,
                status: 'Reserved',
                ngoId,
                stage: 'Pending',
                timeline: [
                  ...d.timeline,
                  { key: 'matched', at: Date.now(), note: `Matched to ${ngo?.name ?? 'organisation'} · score ${score}` },
                ],
              }
            : d,
        ),
      }
    })
  }, [])

  // Manual review (Engine 1 → human). Only a coordinator's approval moves an
  // 'In review' listing onto the board where matching can see it.
  const approveReview = useCallback((donationId: number, note?: string) => {
    setState((s) => ({
      ...s,
      donations: s.donations.map((d) =>
        d.id === donationId && d.status === 'In review'
          ? {
              ...d,
              status: 'Available',
              screening: d.screening
                ? { ...d.screening, review: { decision: 'approved', at: Date.now(), by: 'Coordinator', note } }
                : d.screening,
            }
          : d,
      ),
    }))
  }, [])

  const releaseMatch = useCallback((donationId: number) => {
    setState((s) => ({
      ...s,
      donations: s.donations.map((d) =>
        d.id === donationId && d.status === 'Reserved' && d.stage === 'Pending'
          ? { ...d, status: 'Available', ngoId: null, timeline: d.timeline.filter((t) => t.key === 'created') }
          : d,
      ),
    }))
  }, [])

  const assignRunner = useCallback((donationId: number, runnerId: number) => {
    setState((s) => {
      const runner = s.runners.find((r) => r.id === runnerId)
      // Never double-book: a runner on another live run, or off shift, can't be assigned.
      const busy = s.donations.some((d) => d.id !== donationId && d.runnerId === runnerId && d.status === 'Reserved' && d.stage !== 'Delivered')
      if (!runner || !runner.onShift || busy) return s
      return {
        ...s,
        donations: s.donations.map((d) =>
          d.id === donationId && d.status === 'Reserved' && d.stage === 'Pending'
            ? {
                ...d,
                runnerId,
                stage: 'Assigned',
                timeline: [
                  ...d.timeline,
                  { key: 'assigned', at: Date.now(), note: `${runner?.name ?? 'Runner'} accepted the run` },
                ],
              }
            : d,
        ),
      }
    })
  }, [])

  // Assigned → Picked Up → Delivered. Delivered writes the permanent record.
  const advance = useCallback((donationId: number) => {
    setState((s) => {
      const d = s.donations.find((x) => x.id === donationId)
      if (!d || d.status !== 'Reserved') return s
      const now = Date.now()
      const ngo = s.ngos.find((n) => n.id === d.ngoId)
      const runner = s.runners.find((r) => r.id === d.runnerId)

      if (d.stage === 'Assigned') {
        return {
          ...s,
          donations: s.donations.map((x) =>
            x.id === donationId
              ? {
                  ...x,
                  stage: 'Picked Up',
                  timeline: [...x.timeline, { key: 'picked', at: now, note: `Collected from ${x.donor}` }],
                }
              : x,
          ),
        }
      }

      if (d.stage === 'Picked Up') {
        const already = s.history.some((r) => r.donationId === donationId)
        return {
          ...s,
          donations: s.donations.map((x) =>
            x.id === donationId
              ? {
                  ...x,
                  stage: 'Delivered',
                  status: 'Delivered',
                  timeline: [
                    ...x.timeline,
                    { key: 'delivered', at: now, note: `Handed over at ${ngo?.name ?? 'organisation'}` },
                  ],
                }
              : x,
          ),
          runners: already
            ? s.runners
            : s.runners.map((r) => (r.id === d.runnerId ? { ...r, completed: r.completed + 1 } : r)),
          history: already
            ? s.history
            : [
                ...s.history,
                {
                  donationId,
                  food: d.name,
                  donor: d.donor,
                  category: d.category,
                  ngoId: d.ngoId,
                  ngoName: ngo?.name ?? 'Organisation',
                  runnerName: runner?.name ?? 'Runner',
                  servings: d.servings,
                  weightKg: estimateWeightKg(d),
                  deliveredAt: now,
                },
              ],
        }
      }
      return s
    })
  }, [])

  const withdraw = useCallback((donationId: number) => {
    setState((s) => ({
      ...s,
      donations: s.donations.filter((d) => !(d.id === donationId && (d.status === 'Available' || d.status === 'In review'))),
    }))
  }, [])

  const setWeights = useCallback((weights: MatchWeights | null) => {
    setState((s) => {
      const next = { ...s }
      if (weights) next.weights = weights
      else delete next.weights
      return next
    })
  }, [])

  // Quantity-aware allocation: carve `servings` off an available listing into
  // a new listing (same food, same deadline) so it can go to an NGO that only
  // has room for part of it. The original keeps the rest.
  const splitDonation = useCallback(
    (donationId: number, servings: number): Donation | null => {
      const d = state.donations.find((x) => x.id === donationId)
      if (!d || d.status !== 'Available' || servings < 1 || servings >= d.servings) return null
      const ratio = servings / d.servings
      const now = Date.now()
      const child: Donation = {
        ...d,
        id: Math.max(0, ...state.donations.map((x) => x.id)) + 1,
        servings,
        quantity: d.unit === 'servings' ? servings : Math.max(0.1, Math.round(d.quantity * ratio * 10) / 10),
        ngoId: null,
        runnerId: null,
        stage: 'Pending',
        status: 'Available',
        timeline: [...d.timeline.filter((t) => t.key === 'created'), { key: 'created', at: now, note: `Split ${servings} of ${d.servings} servings from listing #${String(d.id).padStart(3, '0')}` }],
      }
      setState((s) => ({
        ...s,
        donations: [
          child,
          ...s.donations.map((x) =>
            x.id === donationId
              ? {
                  ...x,
                  servings: x.servings - servings,
                  quantity: x.unit === 'servings' ? x.servings - servings : Math.max(0.1, Math.round(x.quantity * (1 - ratio) * 10) / 10),
                }
              : x,
          ),
        ],
      }))
      return child
    },
    [state.donations],
  )

  const toggleShift = useCallback((runnerId: number) => {
    setState((s) => ({
      ...s,
      runners: s.runners.map((r) => (r.id === runnerId ? { ...r, onShift: !r.onShift } : r)),
    }))
  }, [])

  const reset = useCallback(() => {
    setState(withTrust(createInitialState(Date.now())))
  }, [])

  // ---------------- TrustCheck ----------------
  const submitApplication = useCallback(
    (draft: TrustApplication, asDraft = false): TrustApplication => {
      const now = Date.now()
      const apps = state.applications ?? []
      const isNew = !apps.some((a) => a.id === draft.id)
      const saved: TrustApplication = {
        ...draft,
        id: isNew ? Math.max(0, ...apps.map((a) => a.id)) + 1 : draft.id,
        status: asDraft ? 'Not Submitted' : 'Submitted',
        demo: false,
        submittedAt: asDraft ? null : now,
        history: asDraft
          ? draft.history
          : [...draft.history, { at: now, by: 'Applicant', action: draft.status === 'Resubmission Required' ? 'Resubmitted' : 'Submitted' }],
      }
      setState((s) => {
        const list = s.applications ?? []
        const next = list.some((a) => a.id === saved.id) ? list.map((a) => (a.id === saved.id ? saved : a)) : [saved, ...list]
        const { ngos, ngoId } = syncNgo(s, saved)
        return { ...s, ngos, applications: next.map((a) => (a.id === saved.id ? { ...saved, ngoId } : a)) }
      })
      return saved
    },
    [state.applications],
  )

  const reviewApplication = useCallback((id: number, action: ReviewAction, note?: string) => {
    setState((s) => {
      const app = (s.applications ?? []).find((a) => a.id === id)
      if (!app) return s
      const status = nextStatus(action)
      const updated: TrustApplication = {
        ...app,
        status,
        decisionNote: action === 'reject' || action === 'resubmit' ? note : app.decisionNote,
        history: [...app.history, { at: Date.now(), by: 'Coordinator', action: status, note }],
      }
      const { ngos, ngoId } = syncNgo(s, updated)
      const final = { ...updated, ngoId }
      return { ...s, ngos, applications: (s.applications ?? []).map((a) => (a.id === id ? final : a)) }
    })
  }, [])

  const addTrustCheck = useCallback((id: number, check: Omit<TrustCheckRecord, 'id' | 'at' | 'by'>) => {
    setState((s) => ({
      ...s,
      applications: (s.applications ?? []).map((a) =>
        a.id === id
          ? {
              ...a,
              checks: [...a.checks, { ...check, id: Math.max(0, ...a.checks.map((c) => c.id)) + 1, at: Date.now(), by: 'Coordinator' }],
              history: [...a.history, { at: Date.now(), by: 'Coordinator', action: `Checked ${check.portal}`, note: `${check.result}${check.reference ? ` · ${check.reference}` : ''}` }],
            }
          : a,
      ),
    }))
  }, [])

  const toggleTrustItem = useCallback((id: number, key: string) => {
    setState((s) => ({
      ...s,
      applications: (s.applications ?? []).map((a) => (a.id === id ? { ...a, checklist: { ...a.checklist, [key]: !a.checklist[key] } } : a)),
    }))
  }, [])

  return { state, addDonation, approveReview, setWeights, splitDonation, submitApplication, reviewApplication, addTrustCheck, toggleTrustItem, reserve, releaseMatch, assignRunner, advance, withdraw, toggleShift, reset }
}

export type RescueStore = ReturnType<typeof useRescueStore>
