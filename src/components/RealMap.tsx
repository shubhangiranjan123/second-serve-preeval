// The real map: OpenStreetMap streets (free tiles, no key), real road routes (OSRM),
// live runner GPS when a runner shares it, estimated positions otherwise.
// Everything drawn on it comes from the same live state as the rest of the app.

import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { AppState, Donation, Runner } from '../types'
import type { ReplayFrame } from './CityMap'
import { DONOR_AREAS, findArea } from '../data/demoData'
import { along, haversineKm, useRoutes, type LL } from '../lib/routing'
import { useT } from '../lib/i18n'

export const CITY: LL = { lat: 30.735, lng: 76.782 }
const GPS_FRESH_MS = 3 * 60_000
const nearCity = (p: LL) => haversineKm(p, CITY) < 60

export type RunnerSpot = { pos: LL; kind: 'live' | 'est' | 'base'; accuracy?: number }

const evAt = (d: Donation, key: string) => d.timeline.find((e) => e.key === key)?.at

function clockLeft(min: number) {
  if (min <= 0) return '0:00'
  return `${Math.floor(min / 60)}:${String(Math.floor(min % 60)).padStart(2, '0')}`
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export function RealMap({
  state,
  now,
  onOpen,
  replay,
  focusDonationId,
  variant = 'full',
}: {
  state: AppState
  now: number
  onOpen?: (d: Donation) => void
  replay?: ReplayFrame | null
  focusDonationId?: number
  variant?: 'full' | 'mini'
}) {
  const { t } = useT()
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const fitted = useRef(false)
  const [tilesOk, setTilesOk] = useState<boolean | null>(null)

  const ngoOf = (d: Donation) => state.ngos.find((n) => n.id === d.ngoId)
  const active = useMemo(
    () => state.donations.filter((d) => d.status === 'Reserved' && (focusDonationId === undefined || d.id === focusDonationId)),
    [state.donations, focusDonationId],
  )
  const waiting = useMemo(
    () => (focusDonationId === undefined ? state.donations.filter((d) => d.status === 'Available' && d.safeUntil > now) : []),
    [state.donations, now, focusDonationId],
  )

  // Road routes we need: pickup → NGO for every active rescue, runner → pickup while heading there.
  const pairs = useMemo(() => {
    const out: Array<[LL, LL]> = []
    for (const d of active) {
      const n = ngoOf(d)
      if (n) out.push([d, n])
      const r = state.runners.find((x) => x.id === d.runnerId)
      if (r && d.stage === 'Assigned') out.push([leadStart(r, now), d])
    }
    return out
  }, [active, state.runners, Math.floor(now / 30_000)]) // eslint-disable-line react-hooks/exhaustive-deps
  const route = useRoutes(pairs)

  // ---- create the map once
  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, {
      center: [CITY.lat, CITY.lng],
      zoom: variant === 'mini' ? 14 : 13,
      zoomControl: variant === 'full',
      scrollWheelZoom: variant === 'full',
      attributionControl: true,
      preferCanvas: false,
    })
    let loads = 0
    let errors = 0
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Free OpenStreetMap tiles, no API key. Darkened with a CSS filter to match the app.
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    })
    tiles.on('tileload', () => {
      loads++
      if (loads === 1) setTilesOk(true)
    })
    tiles.on('tileerror', () => {
      errors++
      if (errors >= 4 && loads === 0) setTilesOk(false)
    })
    tiles.addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
  }, [variant])

  // ---- where each runner is right now
  const spots = useMemo(() => {
    const out = new Map<number, RunnerSpot>()
    for (const r of state.runners) out.set(r.id, runnerSpot(r, state, now, route))
    return out
  }, [state, now, route])

  // ---- draw
  useEffect(() => {
    const m = map.current
    const g = layer.current
    if (!m || !g) return
    g.clearLayers()
    const bounds: L.LatLngExpression[] = []
    const line = (pts: LL[], opts: L.PolylineOptions) => L.polyline(pts.map((p) => [p.lat, p.lng] as [number, number]), opts).addTo(g)

    // NGOs
    const incoming = new Set(active.map((d) => d.ngoId))
    for (const n of state.ngos) {
      if (focusDonationId !== undefined && !incoming.has(n.id)) continue
      const today = state.history.filter((h) => h.ngoId === n.id && h.deliveredAt > now - 86_400_000).length
      const verified = n.verification === 'Verified'
      const html = `<div class="rm-ngo${verified ? '' : ' unverified'}${incoming.has(n.id) ? ' incoming' : ''}"><svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7v9H3z"/></svg>${today ? `<b>${today}</b>` : ''}</div>`
      L.marker([n.lat, n.lng], { icon: L.divIcon({ html, className: 'rm-icon', iconSize: [34, 34], iconAnchor: [17, 17] }), keyboard: false })
        .bindTooltip(`<strong>${esc(n.name)}</strong><br>${esc(n.area)} · ${verified ? t('verified') : t(n.verification)}${today ? ` · ${t('{n} rescues today', { n: today })}` : ''}`, { direction: 'top', offset: [0, -14], className: 'rm-tip' })
        .addTo(g)
      bounds.push([n.lat, n.lng])
    }

    // Food waiting for a match
    for (const d of waiting) {
      const left = (d.safeUntil - now) / 60_000
      const tone = left > 90 ? 'ok' : left > 30 ? 'tight' : 'over'
      const html = `<div class="rm-food ${tone}"><span>${clockLeft(left)}</span></div>`
      const mk = L.marker([d.lat, d.lng], { icon: L.divIcon({ html, className: 'rm-icon', iconSize: [52, 30], iconAnchor: [26, 34] }) })
        .bindTooltip(`<strong>${esc(d.name)}</strong><br>${d.servings} ${t('servings')} · ${esc(d.donor)}`, { direction: 'top', offset: [0, -30], className: 'rm-tip' })
        .addTo(g)
      if (onOpen) mk.on('click', () => onOpen(d))
      bounds.push([d.lat, d.lng])
    }

    // Rescues in progress: the road route, flowing, plus where the food is now
    for (const d of active) {
      const n = ngoOf(d)
      if (!n) continue
      const main = route(d, n)
      line(main.points, { color: '#ff5c9a', weight: 9, opacity: 0.18, className: 'rm-glow' })
      line(main.points, { color: '#ff5c9a', weight: 3.5, opacity: 0.95, dashArray: main.real ? undefined : '2 9', className: 'rm-route' })
      line(main.points, { color: '#ffe3ef', weight: 3, opacity: 0.9, dashArray: '1 16', className: 'rm-flow' })
      const r = state.runners.find((x) => x.id === d.runnerId)
      if (r && d.stage === 'Assigned') {
        const lead = route(leadStart(r, now), d)
        line(lead.points, { color: '#ffc94d', weight: 3, opacity: 0.9, dashArray: '6 8', className: 'rm-lead' })
      }
      const pickHtml = `<div class="rm-pick${d.stage === 'Picked Up' ? ' done' : ''}"><svg viewBox="0 0 64 64"><path d="M32 4c11 15 22 23 22 36a22 22 0 0 1-44 0C10 27 21 19 32 4Z"/></svg></div>`
      const mk = L.marker([d.lat, d.lng], { icon: L.divIcon({ html: pickHtml, className: 'rm-icon', iconSize: [26, 26], iconAnchor: [13, 22] }) })
        .bindTooltip(`<strong>${esc(d.name)}</strong> → ${esc(n.name)}<br>${t(d.stage === 'Pending' ? 'needs a runner' : d.stage)} · ${main.real ? `${main.km.toFixed(1)} km ${t('by road')}` : t('straight-line estimate')}`, { direction: 'top', offset: [0, -20], className: 'rm-tip' })
        .addTo(g)
      if (onOpen) mk.on('click', () => onOpen(d))
      bounds.push([d.lat, d.lng], [n.lat, n.lng])
    }

    // Runners
    for (const r of state.runners) {
      const busy = active.some((d) => d.runnerId === r.id)
      if (focusDonationId !== undefined && !busy) continue
      if (!r.onShift && !busy) continue
      const s = spots.get(r.id)!
      if (s.kind === 'live' && s.accuracy && s.accuracy > 25) L.circle([s.pos.lat, s.pos.lng], { radius: Math.min(s.accuracy, 400), color: '#ffc94d', weight: 1, opacity: 0.4, fillOpacity: 0.08 }).addTo(g)
      const html = `<div class="rm-runner rm-${s.kind}${busy ? ' rm-busy' : ''}"><b>${esc(r.initials)}</b>${s.kind === 'live' ? '<i>LIVE</i>' : ''}</div>`
      L.marker([s.pos.lat, s.pos.lng], { icon: L.divIcon({ html, className: 'rm-icon', iconSize: [34, 34], iconAnchor: [17, 17] }), zIndexOffset: 500 })
        .bindTooltip(
          `<strong>${esc(r.name)}</strong> · ${t(r.vehicle)}<br>${s.kind === 'live' ? t('Live GPS from their phone') : s.kind === 'est' ? t('Estimated from route and time') : t('Home base (not sharing location)')}`,
          { direction: 'top', offset: [0, -16], className: 'rm-tip' },
        )
        .addTo(g)
      bounds.push([s.pos.lat, s.pos.lng])
    }

    // Replay of the last 24 h, drawn on the real streets
    if (replay) {
      for (const it of replay.items) {
        const from = donorLL(state, it.rec.donationId, it.rec.donor)
        const n = state.ngos.find((x) => x.id === it.rec.ngoId)
        if (!n) continue
        const r = route(from, n)
        if (it.phase === 'done') line(r.points, { color: '#8fe3b9', weight: 2.5, opacity: 0.55 })
        if (it.phase === 'moving') {
          line(r.points.slice(0, Math.max(2, Math.ceil(r.points.length * it.progress))), { color: '#ff5c9a', weight: 3.5, opacity: 0.9 })
          const p = along(r.points, it.progress)
          L.circleMarker([p.lat, p.lng], { radius: 7, color: '#ffe3ef', weight: 2, fillColor: '#ff5c9a', fillOpacity: 1, className: 'rm-firefly' }).addTo(g)
        }
        if (it.burst) L.circleMarker([n.lat, n.lng], { radius: 22, color: '#8fe3b9', weight: 2, fillOpacity: 0, className: 'rm-burst' }).addTo(g)
      }
    }

    if (!fitted.current && bounds.length) {
      fitted.current = true
      m.fitBounds(L.latLngBounds(bounds as L.LatLngTuple[]).pad(variant === 'mini' ? 0.35 : 0.12), { maxZoom: variant === 'mini' ? 15 : 14 })
    }
  })

  return (
    <div className={`rm rm-${variant}`}>
      <div ref={el} className="rm-map" role="application" aria-label={t('Live map of rescues in Chandigarh')} />
      {tilesOk === false && <span className="rm-offline">{t('Street map needs internet. Live markers still update.')}</span>}
      {variant === 'full' && (
        <button
          className="rm-recenter"
          onClick={() => {
            fitted.current = false
            map.current?.setView([CITY.lat, CITY.lng], 13)
          }}
        >
          {t('Recenter')}
        </button>
      )}
    </div>
  )
}

/** Where a runner's trip to the pickup starts: their live GPS (rounded to ~100 m so routes aren't refetched on every step), else their base. */
function leadStart(r: Runner, now: number): LL {
  if (r.gps && now - r.gps.at < GPS_FRESH_MS && nearCity(r.gps)) return { lat: Math.round(r.gps.lat * 1000) / 1000, lng: Math.round(r.gps.lng * 1000) / 1000 }
  return { lat: r.lat, lng: r.lng }
}

export function donorLL(state: AppState, donationId: number, donor: string): LL {
  const d = state.donations.find((x) => x.id === donationId)
  if (d) return { lat: d.lat, lng: d.lng }
  const a = findArea(DONOR_AREAS[donor] ?? 'Sector 17')
  return { lat: a.lat, lng: a.lng }
}

/** Live GPS if the runner shares it, otherwise an estimate along their current route, otherwise their base. */
export function runnerSpot(r: Runner, state: AppState, now: number, route: (a: LL, b: LL) => { points: LL[]; minutes: number }): RunnerSpot {
  if (r.gps && now - r.gps.at < GPS_FRESH_MS && nearCity(r.gps)) return { pos: r.gps, kind: 'live', accuracy: r.gps.accuracy }
  const d = state.donations.find((x) => x.runnerId === r.id && x.status === 'Reserved')
  const n = d && state.ngos.find((x) => x.id === d.ngoId)
  if (d && n) {
    if (d.stage === 'Assigned') {
      const rt = route({ lat: r.lat, lng: r.lng }, d)
      const since = (now - (evAt(d, 'assigned') ?? now)) / 60_000
      return { pos: along(rt.points, Math.min(0.96, since / Math.max(3, rt.minutes))), kind: 'est' }
    }
    if (d.stage === 'Picked Up') {
      const rt = route(d, n)
      const since = (now - (evAt(d, 'picked') ?? now)) / 60_000
      return { pos: along(rt.points, Math.min(0.96, since / Math.max(3, rt.minutes))), kind: 'est' }
    }
  }
  return { pos: { lat: r.lat, lng: r.lng }, kind: 'base' }
}
