// Runner board (phone-first): go on shift, take a run, pick up, deliver.

import { Bike, CheckCircle2, MapPin, Navigation, PackageCheck, Route } from 'lucide-react'
import type { AppState, Donation } from '../../types'
import type { RescueStore, User } from '../../lib/useRescueStore'
import { formatClock, haversineKm, runnerOptions, sameLocalDay, travelMinutes } from '../../lib/engine'
import { useNow } from '../../App'
import { useT } from '../../lib/i18n'
import { cx } from '../../components/ui'
import { BoardShell, SafeClock, Stat, Steps, photoOf, type Toast } from './shared'

const directions = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=bicycling`

export function RunnerBoard({ store, state, user, toast }: { store: RescueStore; state: AppState; user: User; toast: Toast }) {
  const { t } = useT()
  const now = useNow(state)
  const me = state.runners.find((r) => r.id === user.runnerId)
  if (!me) return <BoardShell store={store} user={user} toast={toast} kind={t('Runner board')}><p className="bempty">{t('This account isn’t linked to a runner.')}</p></BoardShell>

  const current = state.donations.find((d) => d.runnerId === me.id && d.status === 'Reserved') ?? null
  const ngoOf = (d: Donation) => state.ngos.find((n) => n.id === d.ngoId)
  const waiting = state.donations
    .filter((d) => d.status === 'Reserved' && d.stage === 'Pending' && d.safeUntil > now)
    .map((d) => {
      const o = runnerOptions(d, [me], state.donations)[0]
      const ngo = ngoOf(d)
      const legKm = ngo ? haversineKm(d, ngo) : 0
      return { d, toPickupMin: o.etaMin, km: o.km, legMin: travelMinutes(legKm) }
    })
    .sort((a, b) => a.toPickupMin - b.toPickupMin)
  const doneToday = state.history.filter((h) => h.runnerName === me.name && sameLocalDay(h.deliveredAt, now))

  return (
    <BoardShell store={store} user={user} toast={toast} kind={t('Runner board')}>
      <section className="bhero runner-hero">
        <div>
          <h1>{me.name}</h1>
          <p>
            {t(me.vehicle)} · {me.area} · {t('{n} runs completed', { n: me.completed })}
          </p>
        </div>
        <label className={cx('big-switch', me.onShift && 'on')}>
          <input
            type="checkbox"
            checked={me.onShift}
            onChange={() => store.toggleShift(me.id).then((r) => r.ok && toast(me.onShift ? t('You’re off shift. Thanks!') : t('You’re on shift. Runs near you appear below.'), 'info'))}
          />
          <span className="big-switch-track">
            <i />
          </span>
          <span>{me.onShift ? t('On shift') : t('Off shift')}</span>
        </label>
      </section>

      {current ? (
        <section className="bcard run-now">
          <span className="run-kicker">{t('Your run')}</span>
          <div className="dcard-b-top">
            {photoOf(current) ? <img src={photoOf(current)} alt="" /> : <span className="dthumb-empty" />}
            <div>
              <strong>
                {current.servings} × {current.name}
              </strong>
              <SafeClock d={current} now={now} />
            </div>
          </div>
          <Steps d={current} />
          <div className="legs">
            <div className={cx('leg', current.stage === 'Assigned' && 'leg-now')}>
              <span>
                <MapPin size={15} /> {t('Pick up')}
              </span>
              <strong>{current.donor}</strong>
              <em>
                {current.address} · {current.area}
              </em>
              <a className="btn btn-ghost btn-sm" href={directions(current.lat, current.lng)} target="_blank" rel="noreferrer noopener">
                <Navigation size={14} /> {t('Directions')}
              </a>
            </div>
            <div className={cx('leg', current.stage === 'Picked Up' && 'leg-now')}>
              <span>
                <Route size={15} /> {t('Deliver to')}
              </span>
              <strong>{ngoOf(current)?.name}</strong>
              <em>{ngoOf(current)?.area}</em>
              {ngoOf(current) && (
                <a className="btn btn-ghost btn-sm" href={directions(ngoOf(current)!.lat, ngoOf(current)!.lng)} target="_blank" rel="noreferrer noopener">
                  <Navigation size={14} /> {t('Directions')}
                </a>
              )}
            </div>
          </div>
          <button
            className="btn btn-pink btn-xl btn-block"
            onClick={() => {
              const stage = current.stage
              store.advance(current.id).then((r) => {
                if (!r.ok) return
                toast(stage === 'Assigned' ? t('Picked up. Ride safe!') : t('Delivered! {n} meals rescued.', { n: current.servings }))
              })
            }}
          >
            {current.stage === 'Assigned' ? (
              <>
                <Bike size={22} /> {t('I’ve picked it up')}
              </>
            ) : (
              <>
                <PackageCheck size={22} /> {t('Delivered')}
              </>
            )}
          </button>
        </section>
      ) : (
        <section className="bstats">
          <Stat value={doneToday.length} label={t('runs today')} />
          <Stat value={doneToday.reduce((s, h) => s + h.servings, 0)} label={t('meals delivered today')} />
          <Stat value={waiting.length} label={t('runs waiting')} />
        </section>
      )}

      <h2 className="bsec">{t('Runs waiting for a runner')}</h2>
      {!me.onShift && <p className="bwarn">{t('Go on shift to take a run.')}</p>}
      {waiting.length === 0 && <p className="bempty">{t('No runs waiting. You’ll see new ones here instantly.')}</p>}
      <div className="run-list">
        {waiting.map(({ d, toPickupMin, km, legMin }) => (
          <article key={d.id} className="bcard run-card">
            <div>
              <strong>
                {d.servings} × {d.name}
              </strong>
              <span>
                {d.donor} → {ngoOf(d)?.name}
              </span>
              <span>
                {t('{min} min to pickup ({km} km) · then about {leg} min', { min: toPickupMin, km: km.toFixed(1), leg: legMin })}
              </span>
              <SafeClock d={d} now={now} />
            </div>
            <button
              className="btn btn-dark"
              disabled={!me.onShift || !!current}
              title={current ? t('Finish your current run first') : !me.onShift ? t('Go on shift first') : ''}
              onClick={() => store.assignRunner(d.id, me.id).then((r) => r.ok && toast(t('Run taken. Head to {donor}.', { donor: d.donor })))}
            >
              <Bike size={16} /> {t('Take this run')}
            </button>
          </article>
        ))}
      </div>

      {doneToday.length > 0 && (
        <section className="bcard">
          <h3>{t('Done today')}</h3>
          <ul className="done-list">
            {doneToday.map((h) => (
              <li key={h.donationId}>
                <CheckCircle2 size={16} />
                <span>
                  <b>{h.servings}</b> {h.food} → {h.ngoName}
                </span>
                <small>{formatClock(h.deliveredAt)}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </BoardShell>
  )
}
