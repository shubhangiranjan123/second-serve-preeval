import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, ArrowUpRight, Bike, Building2, ClipboardList, PackageCheck, Plus, Route, Tv } from 'lucide-react'
import type { AppState, Donation, TimelineKey } from '../types'
import { assessFeasibility, formatClock, impactTotals, sameLocalDay } from '../lib/engine'
import { DripUnderline, FallingDrop, Squiggle } from '../components/Art'
import { CountUp, VerdictPill } from '../components/ui'
import type { View } from '../components/Sidebar'
import { Garden } from '../components/Garden'
import { CityMap } from '../components/CityMap'
import { donorStreaks } from '../lib/streaks'
import { useT } from '../lib/i18n'

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

function relTime(at: number, now: number, t: (k: string, v?: Record<string, string | number>) => string) {
  const m = Math.max(0, Math.round((now - at) / 60000))
  if (m < 1) return t('just now')
  if (m < 60) return t('{n} min ago', { n: m })
  const h = Math.floor(m / 60)
  return h < 24 ? t('{n} h ago', { n: h }) : formatClock(at)
}

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

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
  const { t } = useT()
  const { donations, history } = state
  const streaks = donorStreaks(history, now).slice(0, 4)
  const wilted = donations.filter((d) => d.status === 'Available' && d.safeUntil <= now)
  const today = history.filter((r) => sameLocalDay(r.deliveredAt, now))
  const todayMeals = today.reduce((s, r) => s + r.servings, 0)
  const totals = impactTotals(history)
  const recentDeliveries = [...history].sort((a, b) => b.deliveredAt - a.deliveredAt).slice(0, 3)

  const pipeline = [
    { label: t('Listed'), value: donations.filter((d) => d.status === 'Available').length, Icon: ClipboardList },
    { label: t('NGO matched'), value: donations.filter((d) => d.status === 'Reserved' && d.stage === 'Pending').length, Icon: Building2 },
    { label: t('Runner assigned'), value: donations.filter((d) => d.stage === 'Assigned').length, Icon: Bike },
    { label: t('Picked up'), value: donations.filter((d) => d.stage === 'Picked Up').length, Icon: Route },
    { label: t('Delivered today'), value: today.length, Icon: PackageCheck },
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
    .map((r) => `${t('{n} meals', { n: r.servings })} · ${r.food} → ${r.ngoName}`)

  return (
    <div className="home">
      <section className="waste-hero">
        <p className="waste-lead">{t('Since you opened this page, India has thrown away')}</p>
        <div className="waste-number">
          <strong>
            <WasteCounter /> kg
          </strong>
          <DripUnderline />
          <FallingDrop />
          <FallingDrop className="fd-2" delay={1.3} />
        </div>
        <p className="waste-tail">
          {t('of food. About')} <b>{t('2.5 tonnes every second')}</b> {t('— while a few streets away, someone is waiting for a meal.')}
        </p>
        <span className="source">{t('Estimate from UNEP Food Waste Index Report 2024: India ≈ 78.1 million tonnes/yr (2022).')}</span>
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
          <span className="kicker kicker-dark">{t('Meanwhile, here')}</span>
          <h2>
            <span className="room-num">
              <CountUp value={todayMeals} />
            </span>{' '}
            {t('meals got a')} <em>{t('second serve')}</em> {t('today.')}
          </h2>
          <p>
            {t('{meals} meals across {n} delivered rescues so far. Counted only when a runner hands the food over — never on listing.', { meals: totals.meals.toLocaleString('en-IN'), n: totals.deliveries })}
          </p>
          <div className="room-actions">
            <button className="btn btn-ink btn-lg" onClick={onAdd}>
              <Plus size={18} /> {t('List surplus food')}
            </button>
            <button className="btn btn-outline-ink btn-lg" onClick={() => onNavigate('live')}>
              <Tv size={18} /> {t('Put it on the big screen')}
            </button>
          </div>
        </div>
        <ul className="room-feed">
          {recentDeliveries.map((r, i) => (
            <li key={r.donationId} style={{ transform: `rotate(${[-2, 1.5, -1][i]}deg)` }}>
              <span className="feed-dot" />
              <div>
                <strong>
                  {r.food} · {t('{n} meals', { n: r.servings })}
                </strong>
                <span>
                  → {r.ngoName} · {sameLocalDay(r.deliveredAt, now) ? formatClock(r.deliveredAt) : new Date(r.deliveredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="home-garden">
        <Garden history={history} wilted={wilted} now={now} />
      </div>

      <section className="manifesto">
        <h2>
          {t('Not a listing site.')}
          <br />
          <span>{t('A rescue system.')}</span>
        </h2>
        <p>{t('Four steps, every one explained on screen. Rule-based and transparent — no black box.')}</p>
      </section>

      <ol className="steps">
        {[
          ['Check the clock', 'Packing + travel + a 15-minute buffer against the safe window. Feasible, at risk, or too late.'],
          ['Pick the right NGO', 'Seven safety gates, a kitchen-compatibility radar for fridge space, diet and meal times, then a 0–100 score.'],
          ['Send a runner', 'Nearest free volunteer suggested. Assigned → picked up → delivered, every step timestamped.'],
          ['Grow the garden', 'Every delivery blooms a flower and prints a receipt you can share. Counted once, never on listing.'],
        ].map(([title, d], i) => (
          <li key={title}>
            <span className="step-no">0{i + 1}</span>
            <strong>{t(title)}</strong>
            <p>{t(d)}</p>
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

      <section className="home-map">
        <div className="home-map-head">
          <div>
            <span className="kicker">{t('Live map')}</span>
            <h2>{t('Watch the city rescue itself.')}</h2>
          </div>
          <button className="btn btn-ghost-light" onClick={() => onNavigate('map')}>
            {t('Open the live map')} <ArrowUpRight size={16} />
          </button>
        </div>
        <CityMap state={state} now={now} replay={null} onOpen={onOpen} />
      </section>

      <section className="split">
        <div className="panel panel-blush">
          <div className="panel-head">
            <h3>{t('Needs attention')}</h3>
            <button className="text-link dark" onClick={() => onNavigate('board')}>
              {t('Rescue board')} <ArrowUpRight size={15} />
            </button>
          </div>
          {attention.length === 0 ? (
            <p className="empty">{t('Every open listing has comfortable safe time.')}</p>
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
              <Squiggle /> {t('the clock decides, not the queue')}
            </span>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>{t('Recent activity')}</h3>
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
                  <time>{relTime(a.at, now, t)}</time>
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      {streaks.length > 0 && (
        <section className="streaks">
          <div className="streaks-head">
            <div>
              <span className="kicker">{t('Rescue streaks')}</span>
              <h2>{t('Donors who keep showing up.')}</h2>
            </div>
            <p>{t('A streak counts every day in a row a donor’s food was actually delivered. Miss a day and it resets.')}</p>
          </div>
          <div className="streak-grid">
            {streaks.map((s, i) => (
              <article key={s.donor} className={`streak-card${s.days >= 3 ? ' hot' : ''}`} style={{ animationDelay: `${i * 70}ms` }}>
                <strong>{s.donor}</strong>
                <span className="streak-num">
                  {s.days >= 2 ? '🔥' : '🌱'} {s.days} <small>{t('day streak')}</small>
                </span>
                <div className="streak-week">
                  {s.week.map((on, k) => (
                    <span key={k} className={on ? 'on' : ''}>
                      {DAYS[new Date(now - (6 - k) * 86400000).getDay()]}
                    </span>
                  ))}
                </div>
                <span className="streak-meta">
                  {t('{n} rescues · {m} meals', { n: s.total, m: s.meals })}
                </span>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
