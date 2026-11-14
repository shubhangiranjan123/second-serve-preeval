import { useEffect, useMemo } from 'react'
import { ArrowUpRight, Bike, Clock, MapPin, PackageCheck, Route, Snowflake, Undo2, Users, X } from 'lucide-react'
import type { AppState, Donation } from '../types'
import {
  assessFeasibility,
  evaluateNgo,
  formatClock,
  formatDuration,
  matchNgos,
  minutesBetween,
  runnerOptions,
} from '../lib/engine'
import type { RescueStore } from '../lib/useRescueStore'
import { CategoryToken } from './Art'
import { FeasibilityMeter } from './FeasibilityMeter'
import { MatchPanel } from './MatchPanel'
import { RescueTimeline } from './RescueTimeline'
import { StatusPill, cx } from './ui'
import { Receipt } from './Receipt'

type Props = {
  donation: Donation
  state: AppState
  now: number
  store: RescueStore
  toast: (msg: string, tone?: 'ok' | 'info' | 'warn') => void
  onClose: () => void
  onOpenImpact: () => void
}

export function RescueFile({ donation: d, state, now, store, toast, onClose, onOpenImpact }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ngo = state.ngos.find((n) => n.id === d.ngoId) ?? null
  const runner = state.runners.find((r) => r.id === d.runnerId) ?? null

  const matchEval = useMemo(
    () => (ngo ? evaluateNgo(d, ngo, state.donations, state.history, now) : null),
    [d, ngo, state.donations, state.history, now],
  )

  const feasibility = useMemo(() => {
    if (d.stage === 'Picked Up' && matchEval) {
      // Already collected: only the remaining leg matters.
      return assessFeasibility({ ...d, readyAt: now }, now, Math.ceil(matchEval.travelMin / 2))
    }
    return assessFeasibility(d, now, matchEval?.travelMin)
  }, [d, now, matchEval])

  const match = useMemo(
    () => (d.status === 'Available' ? matchNgos(d, state.ngos, state.donations, state.history, now) : null),
    [d, state.ngos, state.donations, state.history, now],
  )

  const runners = useMemo(() => runnerOptions(d, state.runners, state.donations), [d, state.runners, state.donations])

  const safeLeft = minutesBetween(now, d.safeUntil)
  const deliveredEv = d.timeline.find((t) => t.key === 'delivered')
  const record = state.history.find((r) => r.donationId === d.id) ?? null

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Rescue file: ${d.name}`} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <CategoryToken category={d.category} size={56} />
          <div className="drawer-title">
            <span className="drawer-kicker">Rescue file · #{String(d.id).padStart(3, '0')}</span>
            <h2>{d.name}</h2>
            <span className="drawer-sub">
              {d.donor} · {d.area}
            </span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close rescue file">
            <X size={20} />
          </button>
        </header>

        <div className="drawer-facts">
          <StatusPill status={d.status} stage={d.stage} />
          <span className="fact"><Users size={14} /> {d.servings} servings</span>
          <span className={cx('fact', d.diet === 'Non-veg' ? 'fact-nonveg' : 'fact-veg')}>
            <i className="diet-mark" /> {d.diet}
          </span>
          <span className="fact">
            {d.storage === 'Ambient' ? <Clock size={14} /> : <Snowflake size={14} />} {d.storage}
          </span>
          <span className="fact"><MapPin size={14} /> {d.address}</span>
        </div>
        {d.description && <p className="drawer-desc">{d.description}</p>}

        <div className="drawer-body">
          {/* 01 — Feasibility */}
          <section className="step">
            <div className="step-label"><span>01</span> Rescue feasibility</div>
            {d.status === 'Delivered' ? (
              <div className="delivered-banner">
                <PackageCheck size={22} />
                <div>
                  <strong>Delivered at {deliveredEv ? formatClock(deliveredEv.at) : '—'}</strong>
                  <span>
                    {deliveredEv && d.safeUntil > deliveredEv.at
                      ? `${formatDuration(minutesBetween(deliveredEv.at, d.safeUntil))} inside the safe window.`
                      : 'Recorded in lifetime rescues.'}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <FeasibilityMeter f={feasibility} />
                <p className="step-note">
                  {matchEval
                    ? `Travel uses the route estimate to ${ngo?.name} (${matchEval.travelMin} min), not the donor’s guess.`
                    : `Travel uses the donor’s estimate (${d.travelEstimate} min). Matching recomputes it for each organisation.`}
                </p>
              </>
            )}
          </section>

          {/* 02 — Matching */}
          <section className="step">
            <div className="step-label"><span>02</span> Smart NGO matching</div>
            {match ? (
              safeLeft <= 0 ? (
                <p className="step-muted">Safe window closed — matching is switched off for this listing.</p>
              ) : (
                <MatchPanel
                  result={match}
                  scanKey={d.id}
                  onReserve={(e) => {
                    store.reserve(d.id, e.ngo.id, e.score)
                    toast(`Reserved for ${e.ngo.name}. Now assign a runner.`)
                  }}
                />
              )
            ) : ngo ? (
              <div className="matched-ngo">
                <div>
                  <strong>{ngo.name}</strong>
                  <span>
                    {ngo.type} · {ngo.area}
                    {matchEval && ` · ${matchEval.km.toFixed(1)} km`}
                  </span>
                </div>
                {d.stage === 'Pending' && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      store.releaseMatch(d.id)
                      toast('Match released. The listing is back on the board.', 'info')
                    }}
                  >
                    <Undo2 size={14} /> Release
                  </button>
                )}
              </div>
            ) : null}
          </section>

          {/* 03 — Dispatch */}
          <section className={cx('step', d.status === 'Available' && 'step-locked')}>
            <div className="step-label"><span>03</span> Runner dispatch</div>
            {d.status === 'Available' && <p className="step-muted">Reserve an organisation first.</p>}
            {d.status !== 'Available' && runner && (
              <div className="runner-chosen">
                <span className="avatar">{runner.initials}</span>
                <div>
                  <strong>{runner.name}</strong>
                  <span>{runner.vehicle} · from {runner.area}</span>
                </div>
              </div>
            )}
            {d.status === 'Reserved' && d.stage === 'Pending' && (
              <div className="runner-list">
                {runners.map((o, i) => {
                  const unavailable = !o.runner.onShift || o.busy
                  return (
                    <div key={o.runner.id} className={cx('runner-opt', unavailable && 'runner-off')}>
                      <span className="avatar">{o.runner.initials}</span>
                      <div className="runner-meta">
                        <strong>
                          {o.runner.name}
                          {i === 0 && !unavailable && <em className="tag-suggest">Suggested</em>}
                        </strong>
                        <span>
                          {o.runner.vehicle} · {o.km.toFixed(1)} km from pickup ·{' '}
                          {!o.runner.onShift ? 'Off shift' : o.busy ? 'On another run' : `≈ ${o.etaMin} min away`}
                        </span>
                      </div>
                      <button
                        className="btn btn-dark btn-sm"
                        disabled={unavailable}
                        onClick={() => {
                          store.assignRunner(d.id, o.runner.id)
                          toast(`${o.runner.name} is on the way to ${d.donor}.`)
                        }}
                      >
                        <Bike size={14} /> Assign
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* 04 — Tracking */}
          <section className="step">
            <div className="step-label"><span>04</span> Rescue tracking</div>
            <RescueTimeline donation={d} />
            {d.status === 'Reserved' && d.stage !== 'Pending' && (
              <button
                className="btn btn-primary btn-block btn-lg"
                onClick={() => {
                  store.advance(d.id)
                  if (d.stage === 'Assigned') toast(`Picked up from ${d.donor}. Keep it moving.`, 'info')
                  else toast(`Delivered! ${d.servings} servings added to lifetime rescues.`)
                }}
              >
                {d.stage === 'Assigned' ? (
                  <>
                    <Route size={18} /> Mark picked up
                  </>
                ) : (
                  <>
                    <PackageCheck size={18} /> Mark delivered
                  </>
                )}
              </button>
            )}
            {d.status === 'Delivered' && record && (
              <Receipt
                no={d.id}
                record={record}
                pickedAt={d.timeline.find((t) => t.key === 'picked')?.at}
                minutesSpare={deliveredEv ? Math.max(0, minutesBetween(deliveredEv.at, d.safeUntil)) : undefined}
                onDownloaded={() => toast('Receipt saved as PNG — share it anywhere.')}
              />
            )}
            {d.status === 'Delivered' && (
              <button className="btn btn-ghost btn-block" onClick={onOpenImpact}>
                See it in the Impact report <ArrowUpRight size={16} />
              </button>
            )}
            <p className="sim-note">Simulated workflow — statuses are updated by a coordinator in this browser. No live GPS.</p>
          </section>
        </div>
      </aside>
    </div>
  )
}
