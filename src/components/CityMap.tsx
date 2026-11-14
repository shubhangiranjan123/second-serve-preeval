import { useId, useMemo, useState } from 'react'
import type { AppState, Donation, Ngo, RescueRecord } from '../types'
import { assessFeasibility, formatClock, minutesBetween, sameLocalDay } from '../lib/engine'
import { AREAS } from '../data/demoData'
import { SPECIES, seeded } from '../lib/garden'
import { useT } from '../lib/i18n'
import { cx } from './ui'

export const MAP_W = 1000
export const MAP_H = 600
const MIN_LNG = 76.735
const MAX_LNG = 76.85
const MAX_LAT = 30.7648
const MIN_LAT = 30.7055

export type XY = { x: number; y: number }

export function project(p: { lat: number; lng: number }): XY {
  return {
    x: ((p.lng - MIN_LNG) / (MAX_LNG - MIN_LNG)) * MAP_W,
    y: ((MAX_LAT - p.lat) / (MAX_LAT - MIN_LAT)) * MAP_H,
  }
}

export function control(a: XY, b: XY): XY {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  return { x: mx - dy * 0.22, y: my + dx * 0.22 }
}

export function routeD(a: XY, b: XY) {
  const c = control(a, b)
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
}

export function along(a: XY, b: XY, t: number): XY {
  const c = control(a, b)
  const u = 1 - t
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y }
}

export type ReplayItem = {
  rec: RescueRecord
  from: XY
  to: XY
  phase: 'listed' | 'moving' | 'done'
  progress: number
  burst: boolean
}

export type ReplayFrame = { clock: number; start: number; end: number; items: ReplayItem[] }

function Blocks() {
  const blocks: Array<{ x: number; y: number; w: number; h: number; park: boolean; key: string }> = []
  const bw = 78
  const bh = 104
  const gap = 16
  for (let gx = -4; gx < 16; gx++) {
    for (let gy = -3; gy < 9; gy++) {
      const key = `${gx}-${gy}`
      blocks.push({ x: gx * (bw + gap), y: gy * (bh + gap), w: bw, h: bh, park: seeded(key, 7) < 0.12, key })
    }
  }
  return (
    <g transform={`rotate(-14 ${MAP_W / 2} ${MAP_H / 2})`}>
      {blocks.map((b) => (
        <g key={b.key}>
          <rect className={cx('m-block', b.park && 'm-block-park')} x={b.x} y={b.y} width={b.w} height={b.h} rx="10" />
          {!b.park &&
            [0, 1, 2, 3].map((i) => (
              <rect
                key={i}
                x={b.x + 8 + (i % 2) * 34}
                y={b.y + 10 + Math.floor(i / 2) * 46}
                width={28 - seeded(b.key, i) * 8}
                height={36 - seeded(b.key, i + 4) * 12}
                rx="4"
                fill="#1b2722"
              />
            ))}
          {b.park &&
            [0, 1, 2, 3, 4].map((i) => (
              <circle key={i} cx={b.x + 14 + seeded(b.key, i) * 50} cy={b.y + 14 + seeded(b.key, i + 9) * 76} r={4 + seeded(b.key, i + 3) * 5} fill="#22392d" />
            ))}
        </g>
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <line key={`v${i}`} className="m-road m-road-major" x1={-300 + i * 3 * (bw + gap) - gap / 2} y1={-400} x2={-300 + i * 3 * (bw + gap) - gap / 2} y2={1100} strokeWidth="6" />
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <line key={`h${i}`} className="m-road m-road-major" x1={-500} y1={-360 + i * 2 * (bh + gap) - gap / 2} x2={1600} y2={-360 + i * 2 * (bh + gap) - gap / 2} strokeWidth="6" />
      ))}
    </g>
  )
}

function Scenery() {
  const lake = project({ lat: 30.7495, lng: 76.8205 })
  const valley = [
    project({ lat: 30.762, lng: 76.775 }),
    project({ lat: 30.745, lng: 76.79 }),
    project({ lat: 30.72, lng: 76.79 }),
  ]
  return (
    <g>
      <path
        d={`M${valley[0].x} ${valley[0].y} Q${valley[1].x + 30} ${valley[1].y} ${valley[2].x} ${valley[2].y}`}
        stroke="#1d3328"
        strokeWidth="26"
        fill="none"
        strokeLinecap="round"
        opacity="0.9"
      />
      <path
        className="m-lake"
        d={`M${lake.x - 46} ${lake.y} C${lake.x - 50} ${lake.y - 36} ${lake.x + 10} ${lake.y - 44} ${lake.x + 40} ${lake.y - 22} C${lake.x + 66} ${lake.y - 4} ${lake.x + 50} ${lake.y + 28} ${lake.x + 6} ${lake.y + 24} C${lake.x - 20} ${lake.y + 22} ${lake.x - 42} ${lake.y + 18} ${lake.x - 46} ${lake.y} Z`}
      />
      <text className="m-label" x={lake.x - 26} y={lake.y + 4}>SUKHNA LAKE</text>
      <text className="m-label" x={valley[1].x - 8} y={valley[1].y - 20} transform={`rotate(-62 ${valley[1].x} ${valley[1].y})`}>LEISURE VALLEY</text>
    </g>
  )
}

function House({ ngo, active, onHover }: { ngo: Ngo; active: number; onHover: (h: Hover | null) => void }) {
  const { t } = useT()
  const p = project(ngo)
  const pending = ngo.verification !== 'Verified'
  return (
    <g
      className={cx('m-house', pending && 'm-house-pending')}
      transform={`translate(${p.x} ${p.y})`}
      onMouseEnter={() => onHover({ x: p.x, y: p.y - 16, title: ngo.name, lines: [ngo.type, pending ? t('Pending review') : t('Verified partner'), t('{n} rescues today', { n: active })] })}
      onMouseLeave={() => onHover(null)}
    >
      <circle r="26" fill="rgba(255, 138, 181, 0.08)" />
      <path d="M-13 4 L-13 -8 L0 -19 L13 -8 L13 4 Z" fill={pending ? 'transparent' : '#fcf0f5'} stroke="#fcf0f5" strokeWidth="2" strokeLinejoin="round" />
      <rect x="-3.5" y="-5" width="7" height="9" rx="1.5" fill={pending ? '#fcf0f5' : '#e8457f'} />
      {Array.from({ length: Math.min(active, 6) }, (_, i) => (
        <g key={i} className="m-sprout" transform={`translate(${-16 + i * 6.5} 14)`} style={{ animationDelay: `${i * 80}ms` }}>
          <line x1="0" y1="0" x2="0" y2="-6" stroke="#4fc27e" strokeWidth="1.5" />
          <circle cy="-7.5" r="2.4" fill={['#ff5c9a', '#ffc94d', '#8fe3b9', '#c9b8ff'][i % 4]} />
        </g>
      ))}
      <text className="m-label m-label-area" y="32" textAnchor="middle">{ngo.name.split(' ')[0]}</text>
    </g>
  )
}

type Hover = { x: number; y: number; title: string; lines: string[] }

function Pin({ d, now, onOpen, onHover }: { d: Donation; now: number; onOpen: (d: Donation) => void; onHover: (h: Hover | null) => void }) {
  const { t } = useT()
  const p = project(d)
  const left = Math.max(0, minutesBetween(now, d.safeUntil))
  const f = assessFeasibility(d, now)
  const expired = left <= 0
  const tone = d.status === 'Reserved' ? 'moving' : expired || f.verdict === 'Not feasible' ? 'bad' : f.verdict === 'At risk' ? 'warn' : 'ok'
  const r = 15
  const c = 2 * Math.PI * r
  const frac = Math.min(1, left / 360)
  const label = expired ? '×' : left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : `${left}m`
  const jitter = (seeded(`p${d.id}`, 1) - 0.5) * 24
  return (
    <g
      className={cx('m-pin', `m-pin-${tone}`, 'm-pin-pop')}
      transform={`translate(${p.x + jitter} ${p.y + jitter * 0.6})`}
      onClick={() => onOpen(d)}
      onMouseEnter={() =>
        onHover({
          x: p.x + jitter,
          y: p.y + jitter * 0.6 - 18,
          title: d.name,
          lines: [`${d.donor} · ${t('{n} meals', { n: d.servings })}`, expired ? t('Safe window closed') : `${t(f.verdict)} · ${t('safe until {time}', { time: formatClock(d.safeUntil) })}`],
        })
      }
      onMouseLeave={() => onHover(null)}
    >
      {tone === 'warn' && <circle className="m-pin-ripple" r={r + 2} />}
      <circle className="m-pin-ring-track" r={r + 3} strokeWidth="1" />
      <circle r={r} stroke="#283a31" strokeWidth="4" fill="none" />
      <circle
        className="m-pin-ring"
        r={r}
        strokeWidth="4"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - frac)}
        transform="rotate(-90)"
      />
      <circle r="5" cy="-27" fill={SPECIES[d.category].petal} />
      <text textAnchor="middle" y="3.5">{label}</text>
    </g>
  )
}

export function CityMap({
  state,
  now,
  replay,
  onOpen,
}: {
  state: AppState
  now: number
  replay: ReplayFrame | null
  onOpen: (d: Donation) => void
}) {
  const { t } = useT()
  const uid = useId().replace(/:/g, '')
  const glow = `m-glow-${uid}`
  const [hover, setHover] = useState<Hover | null>(null)

  const deliveredToday = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of state.history) if (r.ngoId !== null && sameLocalDay(r.deliveredAt, now)) m.set(r.ngoId, (m.get(r.ngoId) ?? 0) + 1)
    return m
  }, [state.history, now])

  const open = state.donations.filter((d) => d.status === 'Available')
  const moving = state.donations.filter((d) => d.status === 'Reserved' && d.ngoId !== null)

  return (
    <div className="map-frame">
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label={t('Live rescue map of Chandigarh')}>
        <defs>
          <filter id={glow} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id={`${glow}-v`} cx="50%" cy="50%" r="75%">
            <stop offset="0.6" stopColor="#0d1512" stopOpacity="0" />
            <stop offset="1" stopColor="#0d1512" stopOpacity="0.9" />
          </radialGradient>
        </defs>
        <rect width={MAP_W} height={MAP_H} fill="#111b17" />
        <Blocks />
        <Scenery />
        {AREAS.map((a) => {
          const p = project(a)
          return (
            <text key={a.name} className="m-label" x={p.x} y={p.y + 52} textAnchor="middle">
              {a.name.toUpperCase()}
            </text>
          )
        })}

        {!replay &&
          moving.map((d) => {
            const ngo = state.ngos.find((n) => n.id === d.ngoId)
            if (!ngo) return null
            const a = project(d)
            const b = project(ngo)
            const path = routeD(a, b)
            return (
              <g key={`r${d.id}`}>
                <path className={cx('m-route', d.stage === 'Picked Up' ? 'm-route-live' : 'm-route-pending')} d={path} />
                {d.stage === 'Picked Up' ? (
                  <g filter={`url(#${glow})`}>
                    <circle className="m-firefly" r="6">
                      <animateMotion dur="5s" repeatCount="indefinite" path={path} />
                    </circle>
                    <circle className="m-firefly" r="3" opacity="0.5">
                      <animateMotion dur="5s" begin="-0.25s" repeatCount="indefinite" path={path} />
                    </circle>
                  </g>
                ) : d.stage === 'Assigned' ? (
                  <g filter={`url(#${glow})`} transform={`translate(${a.x} ${a.y - 24})`}>
                    <circle className="m-firefly" r="5">
                      <animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite" />
                    </circle>
                  </g>
                ) : null}
              </g>
            )
          })}

        {replay &&
          replay.items.map((it) => {
            const path = routeD(it.from, it.to)
            const pos = along(it.from, it.to, it.progress)
            return (
              <g key={`rp${it.rec.donationId}-${it.rec.deliveredAt}`}>
                {it.phase !== 'listed' && <path className={cx('m-route', it.phase === 'done' ? 'm-route-done' : 'm-route-replay')} d={path} pathLength={1} />}
                {it.phase === 'listed' && (
                  <g className="m-pin-pop" transform={`translate(${it.from.x} ${it.from.y})`}>
                    <circle r="14" fill="rgba(22,33,28,0.9)" stroke="#ff5c9a" strokeWidth="4" />
                    <circle r="5" cy="-25" fill={SPECIES[it.rec.category].petal} />
                  </g>
                )}
                {it.phase === 'moving' && (
                  <g filter={`url(#${glow})`}>
                    <circle className="m-firefly" cx={pos.x} cy={pos.y} r="7" />
                  </g>
                )}
                {it.burst && <circle className="m-burst" cx={it.to.x} cy={it.to.y} r="18" />}
              </g>
            )
          })}

        {!replay && open.map((d) => <Pin key={d.id} d={d} now={now} onOpen={onOpen} onHover={setHover} />)}

        {state.ngos.map((n) => (
          <House
            key={n.id}
            ngo={n}
            active={
              replay
                ? replay.items.filter((it) => it.phase === 'done' && it.rec.ngoId === n.id).length
                : deliveredToday.get(n.id) ?? 0
            }
            onHover={setHover}
          />
        ))}

        {!replay &&
          state.runners.map((r, i) => {
            const job = state.donations.find((d) => d.runnerId === r.id && d.status === 'Reserved')
            if (job?.stage === 'Picked Up') return null
            const at = job ? project(job) : project(r)
            const off = job ? { x: 22, y: -8 } : { x: (i - 1) * 16, y: 22 }
            return (
              <g
                key={r.id}
                className={cx('m-runner', !r.onShift && 'm-runner-off')}
                transform={`translate(${at.x + off.x} ${at.y + off.y})`}
                onMouseEnter={() =>
                  setHover({
                    x: at.x + off.x,
                    y: at.y + off.y - 12,
                    title: r.name,
                    lines: [`${t(r.vehicle)} · ${job ? t('On run: {name}', { name: job.name }) : r.onShift ? t('Available') : t('Off shift')}`],
                  })
                }
                onMouseLeave={() => setHover(null)}
              >
                <circle r="10" />
                <text textAnchor="middle" y="3">{r.initials}</text>
              </g>
            )
          })}

        <rect width={MAP_W} height={MAP_H} fill={`url(#${glow}-v)`} pointerEvents="none" />
      </svg>

      {hover && (
        <div className="map-tip" style={{ left: `${(hover.x / MAP_W) * 100}%`, top: `${(hover.y / MAP_H) * 100}%` }}>
          <strong>{hover.title}</strong>
          {hover.lines.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      )}

      {replay ? (
        <div className="map-clock">
          <span>{t('Replaying the last 24 hours')}</span>
          <strong>{formatClock(replay.clock)}</strong>
          <div className="map-clock-bar">
            <i style={{ width: `${((replay.clock - replay.start) / (replay.end - replay.start)) * 100}%` }} />
          </div>
        </div>
      ) : (
        <div className="map-hud">
          <span>
            <b>{open.length}</b> {t('waiting for a home')}
          </span>
          <span>
            <b>{moving.length}</b> {t('rescues on the move')}
          </span>
          <span>
            <b>{state.runners.filter((r) => r.onShift).length}</b> {t('runners on shift')}
          </span>
        </div>
      )}
    </div>
  )
}
