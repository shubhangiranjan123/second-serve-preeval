// "City pulse": an anonymous summary of where food moved, for the public
// start screen. Coordinates and counts only — no organisation names, no food
// photos, nothing a signed-out visitor shouldn't see.

import type { AppState } from '../types'
import { DONOR_AREAS, findArea } from '../data/demoData'

export type LatLng = { lat: number; lng: number }
export type CityPulse = {
  ngos: LatLng[]
  routes: Array<{ from: LatLng; to: LatLng; servings: number; at: number }>
  waiting: Array<LatLng & { minutesLeft: number }>
  moving: Array<{ from: LatLng; to: LatLng }>
  mealsToday: number
  mealsTotal: number
}

const DAY = 24 * 60 * 60 * 1000

export function cityPulse(state: AppState, now: number): CityPulse {
  const ll = (p: { lat: number; lng: number }): LatLng => ({ lat: p.lat, lng: p.lng })
  const donorLL = (donationId: number, donor: string): LatLng => {
    const d = state.donations.find((x) => x.id === donationId)
    return d ? ll(d) : ll(findArea(DONOR_AREAS[donor] ?? 'Sector 17'))
  }
  const ngo = (id: number | null) => state.ngos.find((n) => n.id === id)

  const today = state.history.filter((h) => h.deliveredAt > now - DAY && h.deliveredAt <= now)
  return {
    ngos: state.ngos.filter((n) => n.verification === 'Verified').map(ll),
    routes: today
      .map((h) => {
        const n = ngo(h.ngoId)
        return n ? { from: donorLL(h.donationId, h.donor), to: ll(n), servings: h.servings, at: h.deliveredAt } : null
      })
      .filter((r): r is NonNullable<typeof r> => r !== null),
    waiting: state.donations
      .filter((d) => d.status === 'Available' && d.safeUntil > now)
      .map((d) => ({ ...ll(d), minutesLeft: Math.round((d.safeUntil - now) / 60_000) })),
    moving: state.donations
      .filter((d) => d.status === 'Reserved' && ngo(d.ngoId))
      .map((d) => ({ from: ll(d), to: ll(ngo(d.ngoId)!) })),
    mealsToday: today.reduce((t, h) => t + h.servings, 0),
    mealsTotal: state.history.reduce((t, h) => t + h.servings, 0),
  }
}
