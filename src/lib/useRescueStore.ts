import { useCallback, useEffect, useState } from 'react'
import type { AppState, Category, Diet, Donation, Packaging, Screening, StorageType } from '../types'
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

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isState(parsed)) return parsed
    }
  } catch {
    /* fall through to fresh demo data */
  }
  return createInitialState(Date.now())
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
    (input: NewDonationInput, extras: ScreenedExtras = {}): Donation => {
      const now = Date.now()
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

  const toggleShift = useCallback((runnerId: number) => {
    setState((s) => ({
      ...s,
      runners: s.runners.map((r) => (r.id === runnerId ? { ...r, onShift: !r.onShift } : r)),
    }))
  }, [])

  const reset = useCallback(() => {
    setState(createInitialState(Date.now()))
  }, [])

  return { state, addDonation, approveReview, reserve, releaseMatch, assignRunner, advance, withdraw, toggleShift, reset }
}

export type RescueStore = ReturnType<typeof useRescueStore>
