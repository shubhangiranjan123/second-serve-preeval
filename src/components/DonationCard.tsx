import { ArrowUpRight, Clock, MapPin, Snowflake, Users } from 'lucide-react'
import type { AppState, Donation } from '../types'
import { assessFeasibility, formatClock, minutesBetween } from '../lib/engine'
import { ClockRing, Stamp } from './Art'
import { StatusPill, cx } from './ui'

export function DonationCard({
  d,
  state,
  now,
  onOpen,
  index,
}: {
  d: Donation
  state: AppState
  now: number
  onOpen: () => void
  index: number
}) {
  const left = minutesBetween(now, d.safeUntil)
  const feas = assessFeasibility(d, now)
  const ngo = state.ngos.find((n) => n.id === d.ngoId)
  const delivered = d.status === 'Delivered'
  const tone = delivered ? 'done' : feas.verdict === 'Feasible' ? 'ok' : feas.verdict === 'At risk' ? 'warn' : 'bad'
  const stamp = delivered ? null : d.status === 'Reserved' ? null : feas.verdict === 'Feasible' ? 'SAFE TO GO' : feas.verdict === 'At risk' ? 'HURRY' : 'TOO LATE'

  return (
    <article className={cx('dcard', `dcard-${tone}`, d.status === 'Reserved' && 'dcard-moving')} style={{ animationDelay: `${index * 55}ms` }}>
      <div className="dcard-top">
        <ClockRing minutesLeft={left} tone={tone} />
        <div className="dcard-tags">
          <StatusPill status={d.status} stage={d.stage} />
          {stamp && <Stamp tone={tone === 'bad' ? 'ink' : 'pink'}>{stamp}</Stamp>}
        </div>
      </div>
      <h3>{d.name}</h3>
      <p className="dcard-donor">
        {d.donor} <span>·</span> <MapPin size={13} /> {d.area}
      </p>
      <div className="dcard-meta">
        <span>
          <Users size={14} /> {d.servings}
        </span>
        <span className={cx('diet', d.diet === 'Non-veg' ? 'diet-nv' : 'diet-v')}>
          <i /> {d.diet}
        </span>
        <span>
          {d.storage === 'Ambient' ? <Clock size={14} /> : <Snowflake size={14} />} {d.storage}
        </span>
      </div>
      <p className="dcard-line">
        {delivered
          ? `Delivered to ${ngo?.name ?? '—'}`
          : d.status === 'Reserved'
            ? `On its way → ${ngo?.name ?? '—'} · ${d.stage === 'Pending' ? 'needs a runner' : d.stage.toLowerCase()}`
            : `${feas.headline} · safe until ${formatClock(d.safeUntil)}`}
      </p>
      <button className="dcard-open" onClick={onOpen}>
        Open rescue file <ArrowUpRight size={16} />
      </button>
    </article>
  )
}
