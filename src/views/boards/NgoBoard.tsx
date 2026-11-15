// NGO board: food coming your way, accept or decline, confirm it arrived.

import { useState } from 'react'
import { CheckCircle2, MapPin, PackageCheck, Snowflake, Truck, X } from 'lucide-react'
import type { AppState, Donation } from '../../types'
import type { RescueStore, User } from '../../lib/useRescueStore'
import { capacityUsage, formatClock, hoursLabel, impactTotals } from '../../lib/engine'
import { useNow } from '../../App'
import { useT } from '../../lib/i18n'
import { cx } from '../../components/ui'
import { BoardShell, SafeClock, Stat, Steps, TrustCard, photoOf, type Toast } from './shared'

const REASONS = ['No fridge space left today', 'We close before it would arrive', 'Can’t use this kind of food', 'Too much for us today']

export function NgoBoard({ store, state, user, toast }: { store: RescueStore; state: AppState; user: User; toast: Toast }) {
  const { t } = useT()
  const now = useNow(state)
  const ngo = state.ngos.find((n) => n.id === user.ngoId) ?? null
  const [declining, setDeclining] = useState<Donation | null>(null)
  const [reason, setReason] = useState('')

  if (!ngo) {
    return (
      <BoardShell store={store} user={user} toast={toast} kind={t('NGO board')}>
        <section className="bhero">
          <div>
            <h1>{user.name}</h1>
            <p>{t('Welcome. Food is only matched to verified organisations, so start with your TrustCheck application.')}</p>
          </div>
        </section>
        <div className="bgrid one">
          <TrustCard store={store} state={state} user={user} toast={toast} role="recipient" />
        </div>
      </BoardShell>
    )
  }

  const incoming = state.donations.filter((d) => d.ngoId === ngo.id && d.status === 'Reserved').sort((a, b) => a.safeUntil - b.safeUntil)
  const received = state.donations.filter((d) => d.ngoId === ngo.id && d.status === 'Delivered').sort((a, b) => b.createdAt - a.createdAt)
  const cap = capacityUsage(ngo, state.donations, state.history, now)
  const used = ngo.dailyCapacity - cap.remaining
  const impact = impactTotals(state.history.filter((h) => h.ngoId === ngo.id))
  const runnerName = (id: number | null) => state.runners.find((r) => r.id === id)?.name ?? null
  const verified = ngo.verification === 'Verified'

  return (
    <BoardShell store={store} user={user} toast={toast} kind={t('NGO board')}>
      <section className="bhero">
        <div>
          <h1>{ngo.name}</h1>
          <p>
            {ngo.type} · {ngo.area} · {hoursLabel(ngo)}
          </p>
        </div>
        <label className={cx('big-switch', ngo.accepting && 'on')}>
          <input
            type="checkbox"
            checked={ngo.accepting}
            onChange={() =>
              store.setAccepting(ngo.id, !ngo.accepting).then((r) => r.ok && toast(ngo.accepting ? t('Paused: no new food will be matched to you.') : t('Open: you can receive food again.'), 'info'))
            }
          />
          <span className="big-switch-track">
            <i />
          </span>
          <span>{ngo.accepting ? t('Accepting food') : t('Paused')}</span>
        </label>
      </section>

      {!verified && (
        <p className="bwarn">{t('Not verified ({s}): the matching engine won’t send you food until TrustCheck approves you.', { s: t(ngo.verification) })}</p>
      )}

      <section className="bstats">
        <Stat value={incoming.length} label={t('rescues on the way')} />
        <Stat value={`${cap.remaining}/${ngo.dailyCapacity}`} label={t('servings of room left today')} />
        <Stat value={impact.meals} label={t('meals received so far')} />
        <Stat value={ngo.refrigeration ? `${ngo.fridgeLitres} L` : t('none')} label={t('fridge')} />
      </section>
      <div className="cap-bar" aria-label={t('Capacity used today')}>
        <i style={{ width: `${Math.min(100, (used / Math.max(1, ngo.dailyCapacity)) * 100)}%` }} />
      </div>

      <div className="bgrid">
        <section className="bcol">
          <h2 className="bsec">{t('Coming your way')}</h2>
          {incoming.length === 0 && <p className="bempty">{ngo.accepting ? t('Nothing on the way yet. You’ll see it here the moment you’re matched.') : t('Paused. Switch “Accepting food” back on to receive food.')}</p>}
          {incoming.map((d) => (
            <article key={d.id} className="bcard dcard-b">
              <div className="dcard-b-top">
                {photoOf(d) ? <img src={photoOf(d)} alt="" /> : <span className="dthumb-empty" />}
                <div>
                  <strong>
                    {d.servings} × {d.name}
                  </strong>
                  <span>
                    {t('from')} {d.donor} · {t(d.diet)} · {d.storage === 'Ambient' ? t('room temperature') : <><Snowflake size={12} /> {t(d.storage)}</>}
                  </span>
                  <SafeClock d={d} now={now} />
                </div>
              </div>
              <Steps d={d} />
              <p className="dcard-b-line">
                {d.stage === 'Pending'
                  ? t('Reserved for you. Waiting for a runner.')
                  : d.stage === 'Assigned'
                    ? t('{runner} is collecting it from {donor}.', { runner: runnerName(d.runnerId) ?? '', donor: d.donor })
                    : t('{runner} is bringing it to you now.', { runner: runnerName(d.runnerId) ?? '' })}
              </p>
              <div className="dcard-b-actions">
                {d.stage === 'Picked Up' && (
                  <button className="btn btn-primary" onClick={() => store.ngoConfirmReceipt(d.id).then((r) => r.ok && toast(t('Received. {n} meals added to your count.', { n: d.servings })))}>
                    <PackageCheck size={16} /> {t('Confirm it arrived')}
                  </button>
                )}
                {(d.stage === 'Pending' || d.stage === 'Assigned') && (
                  <button className="btn btn-ghost" onClick={() => (setDeclining(d), setReason(''))}>
                    <X size={16} /> {t('Can’t take it')}
                  </button>
                )}
                <a className="btn btn-ghost btn-sm" href={`https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}`} target="_blank" rel="noreferrer noopener">
                  <MapPin size={14} /> {t('Donor on map')}
                </a>
              </div>
            </article>
          ))}
        </section>

        <aside className="bcol">
          <TrustCard store={store} state={state} user={user} toast={toast} role="recipient" />
          <section className="bcard">
            <h3>{t('Received')}</h3>
            {received.length === 0 ? (
              <p className="bempty">{t('Nothing received yet.')}</p>
            ) : (
              <ul className="done-list">
                {received.slice(0, 8).map((d) => (
                  <li key={d.id}>
                    <CheckCircle2 size={16} />
                    <span>
                      <b>{d.servings}</b> {d.name} {t('from')} {d.donor}
                    </span>
                    {d.receivedBy ? (
                      <small>
                        {t('confirmed')} {formatClock(d.receivedBy.at)}
                      </small>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => store.ngoConfirmReceipt(d.id).then((r) => r.ok && toast(t('Receipt confirmed.'), 'info'))}>
                        {t('Confirm receipt')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {declining && (
        <div className="modal-scrim" onClick={() => setDeclining(null)}>
          <form
            className="modal confirm"
            role="dialog"
            aria-modal="true"
            aria-label={t('Decline this rescue')}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              const d = declining
              store.ngoDecline(d.id, reason).then((r) => {
                if (!r.ok) return
                setDeclining(null)
                toast(r.result.matchedTo ? t('Declined. It was passed on to {name}.', { name: r.result.matchedTo }) : t('Declined. The coordinator will find another home for it.'), 'info')
              })
            }}
          >
            <h2>{t('Can’t take {food}?', { food: declining.name })}</h2>
            <p>{t('It goes straight to the next best organisation. Tell the coordinator why:')}</p>
            <div className="chips">
              {REASONS.map((r) => (
                <button type="button" key={r} className={cx('chip-mini', reason === t(r) && 'on')} onClick={() => setReason(t(r))}>
                  {t(r)}
                </button>
              ))}
            </div>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('Or write your own reason')} aria-label={t('Reason')} />
            <div className="confirm-actions">
              <button type="button" className="btn btn-outline-ink" onClick={() => setDeclining(null)}>
                {t('Keep it')}
              </button>
              <button type="submit" className="btn btn-ink" disabled={reason.trim().length < 3}>
                <Truck size={15} /> {t('Pass it on')}
              </button>
            </div>
          </form>
        </div>
      )}
    </BoardShell>
  )
}
