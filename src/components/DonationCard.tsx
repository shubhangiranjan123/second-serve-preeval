import { ArrowUpRight, Clock, MapPin, Snowflake, Users } from 'lucide-react'
import type { AppState, Donation } from '../types'
import { assessFeasibility, formatClock, minutesBetween } from '../lib/engine'
import { streakFor } from '../lib/streaks'
import { useT } from '../lib/i18n'
import { ClockRing, Stamp } from './Art'
import { Bud } from './Bud'
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
  const { t } = useT()
  const left = minutesBetween(now, d.safeUntil)
  const feas = assessFeasibility(d, now)
  const ngo = state.ngos.find((n) => n.id === d.ngoId)
  const delivered = d.status === 'Delivered'
  const tone = delivered ? 'done' : feas.verdict === 'Feasible' ? 'ok' : feas.verdict === 'At risk' ? 'warn' : 'bad'
  const stamp = delivered ? null : d.status === 'Reserved' ? null : feas.verdict === 'Feasible' ? t('SAFE TO GO') : feas.verdict === 'At risk' ? t('HURRY') : t('TOO LATE')
  const streak = streakFor(state.history, d.donor, now)

  return (
    <article className={cx('dcard', `dcard-${tone}`, d.status === 'Reserved' && 'dcard-moving')} style={{ animationDelay: `${index * 55}ms` }}>
      <div className="dcard-top">
        <div className="dcard-ring">
          <ClockRing minutesLeft={left} tone={tone} />
          <Bud d={d} now={now} size={50} />
        </div>
        <div className="dcard-tags">
          <StatusPill status={d.status} stage={d.stage} />
          {stamp && <Stamp tone={tone === 'bad' ? 'ink' : 'pink'}>{stamp}</Stamp>}
        </div>
      </div>
      <h3>{d.name}</h3>
      <p className="dcard-donor">
        {d.donor}
        {streak >= 2 && <span className="streak-chip" title={t('{n}-day rescue streak', { n: streak })}>🔥 {streak}</span>}
        <span>·</span> <MapPin size={13} /> {d.area}
      </p>
      <div className="dcard-meta">
        <span>
          <Users size={14} /> {d.servings}
        </span>
        <span className={cx('diet', d.diet === 'Non-veg' ? 'diet-nv' : 'diet-v')}>
          <i /> {t(d.diet)}
        </span>
        <span>
          {d.storage === 'Ambient' ? <Clock size={14} /> : <Snowflake size={14} />} {t(d.storage)}
        </span>
      </div>
      <p className="dcard-line">
        {delivered
          ? t('Delivered to {name}', { name: ngo?.name ?? '—' })
          : d.status === 'Reserved'
            ? `${t('On its way')} → ${ngo?.name ?? '—'} · ${d.stage === 'Pending' ? t('needs a runner') : t(d.stage).toLowerCase()}`
            : `${feas.headline} · ${t('safe until {time}', { time: formatClock(d.safeUntil) })}`}
      </p>
      <button className="dcard-open" onClick={onOpen}>
        {t('Open rescue file')} <ArrowUpRight size={16} />
      </button>
    </article>
  )
}
