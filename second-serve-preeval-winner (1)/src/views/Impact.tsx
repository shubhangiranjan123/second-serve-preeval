import { useState } from 'react'
import { Info, Leaf } from 'lucide-react'
import type { AppState, Category } from '../types'
import { IMPACT, formatClock, impactTotals, sameLocalDay } from '../lib/engine'
import { CATEGORIES } from '../data/demoData'
import { CountUp, Eyebrow } from '../components/ui'
import { Garden } from '../components/Garden'
import { useT } from '../lib/i18n'

const DAY = 24 * 60 * 60 * 1000

function WeekChart({ state, now }: { state: AppState; now: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const days = Array.from({ length: 7 }, (_, i) => {
    const at = now - (6 - i) * DAY
    const recs = state.history.filter((r) => sameLocalDay(r.deliveredAt, at))
    return {
      at,
      label: i === 6 ? 'Today' : new Date(at).toLocaleDateString('en-IN', { weekday: 'short' }),
      meals: recs.reduce((s, r) => s + r.servings, 0),
      count: recs.length,
    }
  })
  const max = Math.max(40, ...days.map((d) => d.meals))
  const W = 560
  const H = 220
  const pad = { t: 16, b: 28, l: 32, r: 8 }
  const bw = (W - pad.l - pad.r) / 7
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  const ticks = [0, Math.round(max / 2), max]

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Meals rescued per day over the last 7 days">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 8} y={y(t) + 4} className="axis" textAnchor="end">{t}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = pad.l + i * bw + bw * 0.22
          const w = bw * 0.56
          const top = y(d.meals)
          const h = Math.max(0, H - pad.b - top)
          const r = Math.min(4, h)
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              {h > 0 && (
                <path
                  className={i === 6 ? 'bar bar-today' : 'bar'}
                  d={`M${x},${H - pad.b} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${H - pad.b} Z`}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              <text x={x + w / 2} y={H - 8} className="axis" textAnchor="middle">{d.label}</text>
              {i === 6 && d.meals > 0 && (
                <text x={x + w / 2} y={top - 6} className="bar-label" textAnchor="middle">{d.meals}</text>
              )}
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${((pad.l + hover * bw + bw / 2) / W) * 100}%` }}>
          <strong>{days[hover].meals} meals</strong>
          <span>{days[hover].count} {days[hover].count === 1 ? 'rescue' : 'rescues'} · {new Date(days[hover].at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
        </div>
      )}
    </div>
  )
}

export function Impact({ state, now }: { state: AppState; now: number }) {
  const { t: tr } = useT()
  const t = impactTotals(state.history)
  const wilted = state.donations.filter((d) => d.status === 'Available' && d.safeUntil <= now)
  const orgs = new Set(state.history.map((r) => r.ngoId)).size
  const seeded = state.history.filter((r) => r.seeded).length
  const live = state.history.length - seeded
  const byCat = CATEGORIES.map((c: Category) => ({
    c,
    kg: Math.round(state.history.filter((r) => r.category === c).reduce((s, r) => s + r.weightKg, 0) * 10) / 10,
  }))
  const maxKg = Math.max(1, ...byCat.map((b) => b.kg))
  const log = [...state.history].sort((a, b) => b.deliveredAt - a.deliveredAt).slice(0, 6)

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <Eyebrow>{tr('Impact report')}</Eyebrow>
          <h1>
            {tr('Measured on')} <em>{tr('delivery,')}</em> {tr('not on listing.')}
          </h1>
          <p className="view-lede">
            {tr('A rescue only counts once a runner marks it delivered. Each record is written once, keyed to its donation, so nothing is ever double counted.')}
          </p>
        </div>
        <span className="sdg-tag"><Leaf size={14} /> {tr('Supports SDG 13 · Climate Action')}</span>
      </header>

      <section className="impact-hero">
        <div className="impact-big">
          <span>{tr('Meals rescued')}</span>
          <strong><CountUp value={t.meals} /></strong>
          <em>{tr('servings delivered to partner organisations')}</em>
        </div>
        <div className="impact-grid">
          <div>
            <span>{tr('Food rescued · waste avoided')} <sup>est.</sup></span>
            <strong><CountUp value={t.kg} decimals={1} /> <small>kg</small></strong>
          </div>
          <div>
            <span>{tr('Successful deliveries')}</span>
            <strong><CountUp value={t.deliveries} /></strong>
          </div>
          <div>
            <span>{tr('Organisations served')}</span>
            <strong><CountUp value={orgs} /></strong>
          </div>
          <div className="impact-co2">
            <span>{tr('Emissions avoided')} <sup>est.</sup></span>
            <strong>≈ <CountUp value={t.co2e} /> <small>kg CO₂e</small></strong>
          </div>
        </div>
      </section>

      <Garden history={state.history} wilted={wilted} now={now} />

      <section className="split">
        <div className="panel">
          <div className="panel-head">
            <h2>{tr('Meals rescued, last 7 days')}</h2>
            <span className="panel-sub">{tr('Hover a day for detail')}</span>
          </div>
          <WeekChart state={state} now={now} />
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>{tr('Food rescued by category')}</h2>
            <span className="panel-sub">{tr('kilograms, estimated')}</span>
          </div>
          <ul className="hbars">
            {byCat.map((b) => (
              <li key={b.c}>
                <span>{tr(b.c)}</span>
                <div><i style={{ width: `${(b.kg / maxKg) * 100}%` }} /></div>
                <strong>{b.kg} kg</strong>
              </li>
            ))}
          </ul>
          <div className="assumptions">
            <Info size={15} />
            <p>
              <strong>How these estimates work.</strong> Listings measured in kg use their weight; others assume{' '}
              {IMPACT.kgPerServing} kg per serving. Emissions use an illustrative {IMPACT.co2ePerKgFood} kg CO₂e per kg
              of food kept out of waste — published factors vary widely by food type and disposal route. These are
              indicators, not verified carbon reductions.
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{tr('Rescue log')}</h2>
          <span className="panel-sub">
            {tr('{a} completed in this browser · {b} pre-loaded demonstration records', { a: live, b: seeded })}
          </span>
        </div>
        <div className="table-wrap">
          <table className="log">
            <thead>
              <tr><th>{tr('Food')}</th><th>{tr('From')}</th><th>{tr('To')}</th><th>{tr('Runner')}</th><th className="num">{tr('Servings')}</th><th>{tr('Delivered')}</th></tr>
            </thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.donationId}>
                  <td>{r.food}{r.seeded && <em className="seed">demo</em>}</td>
                  <td>{r.donor}</td>
                  <td>{r.ngoName}</td>
                  <td>{r.runnerName}</td>
                  <td className="num">{r.servings}</td>
                  <td>{sameLocalDay(r.deliveredAt, now) ? `Today ${formatClock(r.deliveredAt)}` : new Date(r.deliveredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
