import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, ArrowUpRight, Bike, Building2, ClipboardList, PackageCheck, Plus, Route, Tv } from 'lucide-react'
import type { AppState, Donation, TimelineKey } from '../types'
import { assessFeasibility, formatClock, impactTotals, sameLocalDay } from '../lib/engine'
import { DripUnderline, FallingDrop, Squiggle } from '../components/Art'
import { CountUp, VerdictPill } from '../components/ui'
import type { View } from '../components/Sidebar'

// UNEP Food Waste Index Report 2024: India ≈ 78.1 million tonnes of food waste a year (2022 data).
const INDIA_KG_PER_SECOND = 78.1e9 / (365.25 * 24 * 3600)

function WasteCounter() {
  const [start] = useState(() => performance.now())
  const [kg, setKg] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setKg(((performance.now() - start) / 1000) * INDIA_KG_PER_SECOND), 90)
    return () => clearInterval(t)
  }, [start])
  return <>{Math.floor(kg).toLocaleString('en-IN')}</>
}

const eventIcon: Record<TimelineKey, typeof Bike> = {
  created: ClipboardList,
  matched: Building2,
  assigned: Bike,
  picked: Route,
  delivered: PackageCheck,
}

function relTime(at: number, now: number) {
  const m = Math.max(0, Math.round((now - at) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h} h ago` : formatClock(at)
}

export function Home({
  state,
  now,
  onAdd,
  onOpen,
  onNavigate,
}: {
  state: AppState
  now: number
  onAdd: () => void
  onOpen: (d: Donation) => void
  onNavigate: (v: View) => void
}) {
  const { donations, history } = state
  const today = history.filter((r) => sameLocalDay(r.deliveredAt, now))
  const todayMeals = today.reduce((s, r) => s + r.servings, 0)
  const totals = impactTotals(history)
  const recentDeliveries = [...history].sort((a, b) => b.deliveredAt - a.deliveredAt).slice(0, 3)

  const pipeline = [
    { label: 'Listed', value: donations.filter((d) => d.status === 'Available').length, Icon: ClipboardList },
    { label: 'NGO matched', value: donations.filter((d) => d.status === 'Reserved' && d.stage === 'Pending').length, Icon: Building2 },
    { label: 'Runner assigned', value: donations.filter((d) => d.stage === 'Assigned').length, Icon: Bike },
    { label: 'Picked up', value: donations.filter((d) => d.stage === 'Picked Up').length, Icon: Route },
    { label: 'Delivered today', value: today.length, Icon: PackageCheck },
  ]

  const attention = donations
    .filter((d) => d.status === 'Available')
    .map((d) => ({ d, f: assessFeasibility(d, now) }))
    .filter((x) => x.f.verdict !== 'Feasible')
    .sort((a, b) => a.f.spareMin - b.f.spareMin)

  const activity = donations
    .flatMap((d) => d.timeline.map((t) => ({ ...t, d })))
    .sort((a, b) => b.at - a.at)
    .slice(0, 6)

  const ticker = [...history]
    .sort((a, b) => b.deliveredAt - a.deliveredAt)
    .slice(0, 8)
    .map((r) => `${r.servings} meals · ${r.food} → ${r.ngoName}`)

  return (
    <div className="home">
      <section className="waste-hero">
        <p className="waste-lead">Since you opened this page, India has thrown away</p>
        <div className="waste-number">
          <strong>
            <WasteCounter /> kg
          </strong>
          <DripUnderline />
          <FallingDrop />
          <FallingDrop className="fd-2" delay={1.3} />
        </div>
        <p className="waste-tail">
          of food. About <b>2.5 tonnes every second</b> — while a few streets away, someone is waiting for a meal.
        </p>
        <span className="source">Estimate from UNEP Food Waste Index Report 2024: India ≈ 78.1 million tonnes/yr (2022).</span>
      </section>

      {ticker.length > 0 && (
        <div className="marquee" aria-label="Recent rescues">
          <div className="marquee-track">
            {[...ticker, ...ticker].map((t, i) => (
              <span key={i}>
                {t} <i>●</i>
              </span>
            ))}
          </div>
        </div>
      )}

      <section className="room-band">
        <div className="room-copy">
          <span className="kicker kicker-dark">Meanwhile, here</span>
          <h2>
            <span className="room-num">
              <CountUp value={todayMeals} />
            </span>{' '}
            meals got a <em>second serve</em> today.
          </h2>
          <p>
            {totals.meals.toLocaleString('en-IN')} meals across {totals.deliveries} delivered rescues so far. Counted only
            when a runner hands the food over — never on listing.
          </p>
          <div className="room-actions">
            <button className="btn btn-ink btn-lg" onClick={onAdd}>
              <Plus size={18} /> List surplus food
            </button>
            <button className="btn btn-outline-ink btn-lg" onClick={() => onNavigate('live')}>
              <Tv size={18} /> Put it on the big screen
            </button>
          </div>
        </div>
        <ul className="room-feed">
          {recentDeliveries.map((r, i) => (
            <li key={r.donationId} style={{ transform: `rotate(${[-2, 1.5, -1][i]}deg)` }}>
              <span className="feed-dot" />
              <div>
                <strong>
                  {r.food} · {r.servings} meals
                </strong>
                <span>
                  → {r.ngoName} · {sameLocalDay(r.deliveredAt, now) ? formatClock(r.deliveredAt) : new Date(r.deliveredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="manifesto">
        <h2>
          Not a listing site.
          <br />
          <span>A rescue system.</span>
        </h2>
        <p>Four steps, every one explained on screen. Rule-based and transparent — no black box.</p>
      </section>

      <ol className="steps">
        {[
          ['Check the clock', 'Packing + travel + a 15-minute buffer against the safe window. Feasible, at risk, or too late.'],
          ['Pick the right NGO', 'Six safety gates, then a 0–100 score. Everyone ruled out gets a reason.'],
          ['Send a runner', 'Nearest free volunteer suggested. Assigned → picked up → delivered, every step timestamped.'],
          ['Print the receipt', 'Every delivered meal gets a receipt you can download and share. Counted once.'],
        ].map(([t, d], i) => (
          <li key={t}>
            <span className="step-no">0{i + 1}</span>
            <strong>{t}</strong>
            <p>{d}</p>
          </li>
        ))}
      </ol>

      <section className="pipeline">
        {pipeline.map(({ label, value, Icon }, i) => (
          <div key={label} className="pipe">
            <Icon size={18} />
            <strong>{value}</strong>
            <span>{label}</span>
            {i < pipeline.length - 1 && <ArrowRight className="pipe-arrow" size={18} />}
          </div>
        ))}
      </section>

      <section className="split">
        <div className="panel panel-blush">
          <div className="panel-head">
            <h3>Needs attention</h3>
            <button className="text-link dark" onClick={() => onNavigate('board')}>
              Rescue board <ArrowUpRight size={15} />
            </button>
          </div>
          {attention.length === 0 ? (
            <p className="empty">Every open listing has comfortable safe time.</p>
          ) : (
            <ul className="attention">
              {attention.map(({ d, f }) => (
                <li key={d.id}>
                  <button onClick={() => onOpen(d)}>
                    <AlertTriangle size={17} />
                    <div>
                      <strong>{d.name}</strong>
                      <span>
                        {d.donor} · {f.headline}
                      </span>
                    </div>
                    <VerdictPill verdict={f.verdict} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {attention.length > 0 && (
            <span className="annotation">
              <Squiggle /> the clock decides, not the queue
            </span>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Recent activity</h3>
          </div>
          <ul className="activity">
            {activity.map((a) => {
              const Icon = eventIcon[a.key]
              return (
                <li key={`${a.d.id}-${a.key}`} className={`act-${a.key}`}>
                  <span className="act-icon">
                    <Icon size={14} />
                  </span>
                  <button onClick={() => onOpen(a.d)}>
                    <strong>{a.d.name}</strong>
                    <span>{a.note}</span>
                  </button>
                  <time>{relTime(a.at, now)}</time>
                </li>
              )
            })}
          </ul>
        </div>
      </section>
    </div>
  )
}
