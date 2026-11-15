// Background map for the start screen: today's rescues across Chandigarh,
// drawn as glowing routes on real streets. Anonymous data only (no names).

import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { CityPulse } from '../lib/pulse'
import { CITY } from './RealMap'
import { useRoutes, type LL } from '../lib/routing'

export function PulseMap({ pulse }: { pulse: CityPulse | null }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const fitted = useRef(false)

  const pairs = useMemo<Array<[LL, LL]>>(() => (pulse ? [...pulse.moving, ...pulse.routes].slice(0, 12).map((r) => [r.from, r.to]) : []), [pulse])
  const route = useRoutes(pairs)

  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, {
      center: [CITY.lat, CITY.lng],
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
    })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    }).addTo(m)
    m.attributionControl.setPrefix(false)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    const g = layer.current
    if (!m || !g || !pulse) return
    g.clearLayers()
    const pts: L.LatLngTuple[] = []
    const draw = (from: LL, to: LL, live: boolean) => {
      const r = route(from, to)
      const ll = r.points.map((p) => [p.lat, p.lng] as L.LatLngTuple)
      L.polyline(ll, { color: live ? '#ff7a2f' : '#b9a6ff', weight: live ? 10 : 7, opacity: live ? 0.22 : 0.12, className: 'pm-glow', interactive: false }).addTo(g)
      L.polyline(ll, { color: live ? '#ff7a2f' : '#b9a6ff', weight: live ? 3 : 2, opacity: live ? 0.95 : 0.55, interactive: false }).addTo(g)
      L.polyline(ll, { color: '#fff3e8', weight: 2.4, opacity: live ? 0.9 : 0.5, dashArray: '1 18', className: 'pm-flow', interactive: false }).addTo(g)
      pts.push(ll[0], ll[ll.length - 1])
    }
    pulse.routes.forEach((r) => draw(r.from, r.to, false))
    pulse.moving.forEach((r) => draw(r.from, r.to, true))
    for (const n of pulse.ngos) {
      L.circleMarker([n.lat, n.lng], { radius: 6, color: '#6ec3ff', weight: 2, fillColor: '#17143a', fillOpacity: 1, interactive: false }).addTo(g)
      L.circleMarker([n.lat, n.lng], { radius: 14, color: '#6ec3ff', weight: 1.5, opacity: 0.6, fill: false, className: 'pm-ring', interactive: false }).addTo(g)
      pts.push([n.lat, n.lng])
    }
    for (const w of pulse.waiting) {
      L.circleMarker([w.lat, w.lng], { radius: 7, color: '#17143a', weight: 2, fillColor: w.minutesLeft > 60 ? '#ff7a2f' : '#ffd13d', fillOpacity: 1, interactive: false, className: 'pm-wait' }).addTo(g)
      pts.push([w.lat, w.lng])
    }
    if (!fitted.current && pts.length > 1) {
      fitted.current = true
      // keep the left side clear for the headline: push the action to the right half
      const wide = window.innerWidth > 900
      m.fitBounds(L.latLngBounds(pts), wide ? { paddingTopLeft: [Math.min(window.innerWidth * 0.46, 700), 90], paddingBottomRight: [50, 290], maxZoom: 14 } : { padding: [30, 30], maxZoom: 13 })
    }
  })

  return <div ref={el} className="pulse-map" aria-hidden />
}
