// Real road routes from OpenStreetMap data (OSRM public router), cached in the
// browser. If the router can't be reached (offline venue, rate limit), a soft
// arc is drawn instead and marked as "straight-line estimate".

import { useEffect, useRef, useState } from 'react'

export type LL = { lat: number; lng: number }
export type Route = { points: LL[]; km: number; minutes: number; real: boolean }

const STORE_KEY = 'second-serve-routes-v1'
const OSRM = 'https://router.project-osrm.org/route/v1/driving'

const cache = new Map<string, Route>()
const pending = new Set<string>()
const failedAt = { t: 0 }

try {
  const raw = localStorage.getItem(STORE_KEY)
  if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, Route>)) cache.set(k, v)
} catch {
  /* no storage */
}

function persist() {
  try {
    const real = [...cache.entries()].filter(([, r]) => r.real).slice(-120)
    localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(real)))
  } catch {
    /* storage full or blocked */
  }
}

export const routeKey = (a: LL, b: LL) => `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}`

export function haversineKm(a: LL, b: LL) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

/** A gentle arc between two points: the fallback when no road route is known. */
export function arc(a: LL, b: LL, steps = 24): Route {
  const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
  const dx = b.lng - a.lng
  const dy = b.lat - a.lat
  const c = { lat: mid.lat + dx * 0.18, lng: mid.lng - dy * 0.18 }
  const points: LL[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    points.push({ lat: u * u * a.lat + 2 * u * t * c.lat + t * t * b.lat, lng: u * u * a.lng + 2 * u * t * c.lng + t * t * b.lng })
  }
  const km = haversineKm(a, b) * 1.3
  return { points, km, minutes: (km / 18) * 60, real: false }
}

/** Point at fraction t (0–1) along a polyline, by distance. */
export function along(points: LL[], t: number): LL {
  if (points.length === 0) return { lat: 0, lng: 0 }
  if (points.length === 1 || t <= 0) return points[0]
  if (t >= 1) return points[points.length - 1]
  const seg: number[] = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const d = haversineKm(points[i - 1], points[i])
    seg.push(d)
    total += d
  }
  let want = total * t
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i]) {
      const f = seg[i] === 0 ? 0 : want / seg[i]
      const a = points[i]
      const b = points[i + 1]
      return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f }
    }
    want -= seg[i]
  }
  return points[points.length - 1]
}

async function fetchRoute(a: LL, b: LL): Promise<Route | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(`${OSRM}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`, { signal: ctrl.signal })
    if (!res.ok) return null
    const j = (await res.json()) as { routes?: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] } }> }
    const r = j.routes?.[0]
    if (!r) return null
    const km = r.distance / 1000
    // The public router plans for cars; city bikes and scooters average ~18 km/h.
    return { points: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })), km, minutes: Math.max((km / 18) * 60, r.duration / 60), real: true }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Road routes for the given pairs. Starts with arcs, upgrades to real routes as they arrive. */
export function useRoutes(pairs: Array<[LL, LL]>): (a: LL, b: LL) => Route {
  const [, bump] = useState(0)
  const alive = useRef(true)
  const keys = pairs.map(([a, b]) => routeKey(a, b)).join('|')

  useEffect(() => {
    alive.current = true
    const todo = pairs.filter(([a, b]) => {
      const k = routeKey(a, b)
      return !cache.get(k)?.real && !pending.has(k)
    })
    if (todo.length === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
    if (Date.now() - failedAt.t < 60_000) return // the router failed recently: don't hammer it
    ;(async () => {
      for (const [a, b] of todo.slice(0, 12)) {
        const k = routeKey(a, b)
        pending.add(k)
        const r = await fetchRoute(a, b)
        pending.delete(k)
        if (!r) {
          failedAt.t = Date.now()
          break
        }
        cache.set(k, r)
        persist()
        if (alive.current) bump((n) => n + 1)
        await new Promise((ok) => setTimeout(ok, 220)) // be polite to the public router
      }
    })()
    return () => {
      alive.current = false
    }
  }, [keys]) // eslint-disable-line react-hooks/exhaustive-deps

  return (a, b) => cache.get(routeKey(a, b)) ?? arc(a, b)
}
