import { ArrowUpRight, Bike, PackageCheck, Route } from 'lucide-react'
import type { AppState, DispatchStage, Donation } from '../types'
import { formatClock, runnerOptions, sameLocalDay } from '../lib/engine'
import type { RescueStore } from '../lib/useRescueStore'
import { DemoBadge, Eyebrow, cx } from '../components/ui'
import { useT } from '../lib/i18n'

const LANES: Array<{ stage: DispatchStage; title: string; hint: string }> = [
  { stage: 'Pending', title: 'Pending', hint: 'Matched, needs a runner' },
  { stage: 'Assigned', title: 'Assigned', hint: 'Runner heading to donor' },
  { stage: 'Picked Up', title: 'Picked up', hint: 'Food in transit' },
  { stage: 'Delivered', title: 'Delivered', hint: 'Handed over today' },
]

export function Dispatch({
  state,
  now,
  store,
  toast,
  onOpen,
}: {
  state: AppState
  now: number
  store: RescueStore
  toast: (msg: string, tone?: 'ok' | 'info' | 'warn') => void
  onOpen: (d: Donation) => void
}) {
  const { t } = useT()
  const jobs = state.donations.filter(
    (d) =>
      d.status === 'Reserved' ||
      (d.status === 'Delivered' && sameLocalDay(d.timeline.find((t) => t.key === 'delivered')?.at ?? 0, now)),
  )

  function JobCard({ d }: { d: Donation }) {
    const ngo = state.ngos.find((n) => n.id === d.ngoId)
    const runner = state.runners.find((r) => r.id === d.runnerId)
    const suggestion = runnerOptions(d, state.runners, state.donations).find((o) => o.runner.onShift && !o.busy)
    return (
      <article className="job">
        <button className="job-title" onClick={() => onOpen(d)}>
          <strong>{d.name}</strong>
          <ArrowUpRight size={14} />
        </button>
        <div className="job-route">
          <span>{d.donor}</span>
          <i />
          <span>{ngo?.name ?? '—'}</span>
        </div>
        <div className="job-meta">
          <span>{t('{n} servings', { n: d.servings })}</span>
          <span>{t('safe until {time}', { time: formatClock(d.safeUntil) })}</span>
        </div>
        {runner && (
          <div className="job-runner">
            <span className="avatar sm">{runner.initials}</span> {runner.name}
          </div>
        )}
        {d.stage === 'Pending' &&
          (suggestion ? (
            <button
              className="btn btn-dark btn-sm btn-block"
              onClick={() => {
                store.assignRunner(d.id, suggestion.runner.id).then((r) => r.ok && toast(t('{name} assigned — {km} km from pickup.', { name: suggestion.runner.name, km: suggestion.km.toFixed(1) })))
              }}
            >
              <Bike size={14} /> {t('Assign {name} (nearest)', { name: suggestion.runner.name.split(' ')[0] })}
            </button>
          ) : (
            <span className="job-wait">{t('No runner free — bring someone on shift')}</span>
          ))}
        {d.stage === 'Assigned' && (
          <button
            className="btn btn-ghost btn-sm btn-block"
            onClick={() => {
              store.advance(d.id).then((r) => r.ok && toast(t('Picked up from {donor}.', { donor: d.donor }), 'info'))
            }}
          >
            <Route size={14} /> {t('Mark picked up')}
          </button>
        )}
        {d.stage === 'Picked Up' && (
          <button
            className="btn btn-primary btn-sm btn-block"
            onClick={() => {
              store.advance(d.id).then((r) => r.ok && toast(t('Delivered! {n} servings added to lifetime rescues.', { n: d.servings })))
            }}
          >
            <PackageCheck size={14} /> {t('Mark delivered')}
          </button>
        )}
      </article>
    )
  }

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <Eyebrow>{t('Runner dispatch')}</Eyebrow>
          <h1>
            {t('Coordinated,')} <em>{t('not just requested.')}</em>
          </h1>
          <p className="view-lede">
            {t('The nearest free runner is suggested for every matched rescue. Status moves Pending → Assigned → Picked up → Delivered, and only Delivered counts toward impact.')}
          </p>
        </div>
        <DemoBadge>{t('Simulated runners · no live GPS')}</DemoBadge>
      </header>

      <section className="runners">
        {state.runners.map((r) => {
          const active = state.donations.find((d) => d.runnerId === r.id && d.status === 'Reserved')
          return (
            <article key={r.id} className={cx('runner', !r.onShift && 'runner-offshift')}>
              <span className="avatar lg">{r.initials}</span>
              <div className="runner-info">
                <strong>{r.name}</strong>
                <span>
                  {t(r.vehicle)} · {r.area} · {t('{n} runs', { n: r.completed })}
                </span>
                <em className={cx('runner-state', active ? 'busy' : r.onShift ? 'free' : 'off')}>
                  {active ? t('On run: {name}', { name: active.name }) : r.onShift ? t('Available') : t('Off shift')}
                </em>
              </div>
              <button
                className={cx('switch', r.onShift && 'switch-on')}
                role="switch"
                aria-checked={r.onShift}
                aria-label={`${r.name} on shift`}
                disabled={!!active}
                onClick={() => store.toggleShift(r.id)}
              >
                <i />
              </button>
            </article>
          )
        })}
      </section>

      <section className="lanes">
        {LANES.map((l) => {
          const items = jobs.filter((d) => d.stage === l.stage)
          return (
            <div key={l.stage} className={`lane lane-${l.stage.replace(' ', '').toLowerCase()}`}>
              <header>
                <strong>{t(l.title)}</strong>
                <em>{items.length}</em>
                <span>{t(l.hint)}</span>
              </header>
              <div className="lane-body">
                {items.length === 0 ? <p className="lane-empty">{t('Nothing here')}</p> : items.map((d) => <JobCard key={d.id} d={d} />)}
              </div>
            </div>
          )
        })}
      </section>
    </div>
  )
}
