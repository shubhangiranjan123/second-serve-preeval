import { useEffect, useMemo } from 'react'
import { ArrowUpRight, Bike, Clock, MapPin, PackageCheck, Route, ShieldCheck, Snowflake, Sparkles, Trash2, Undo2, Users, X } from 'lucide-react'
import type { AppState, Donation } from '../types'
import {
  assessFeasibility,
  evaluateNgo,
  formatClock,
  formatDuration,
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
import { useT } from '../lib/i18n'
import { Bud } from './Bud'
import { runMatchingPipeline } from '../lib/pipeline'
import { rescueGuide } from '../lib/guide'
import { PipelineTrack, trackFor } from './PipelineTrack'
import { RuleList } from './DonationForm'

type Props = {
  donation: Donation
  state: AppState
  now: number
  store: RescueStore
  toast: (msg: string, tone?: 'ok' | 'info' | 'warn') => void
  onClose: () => void
  onOpenImpact: () => void
  onApprove?: (d: Donation) => void
  onNavigate?: (v: 'dispatch' | 'trust') => void
}

export function RescueFile({ donation: d, state, now, store, toast, onClose, onOpenImpact, onApprove, onNavigate }: Props) {
  const { t } = useT()
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

  // Engine 2 (4-stage pipeline). Runs only for listings that are on the board.
  const pipeline = useMemo(
    () => (d.status === 'Available' ? runMatchingPipeline(d, state, now, state.weights) : null),
    [d, state, now],
  )
  const sc = d.screening

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
            <span className="drawer-kicker">{t('Rescue file')} · #{String(d.id).padStart(3, '0')}</span>
            <h2>{d.name}</h2>
            <span className="drawer-sub">
              {d.donor} · {d.area}
            </span>
          </div>
          <Bud d={d} now={now} size={58} />
          <button className="icon-btn" onClick={onClose} aria-label="Close rescue file">
            <X size={20} />
          </button>
        </header>

        <div className="drawer-facts">
          <StatusPill status={d.status} stage={d.stage} />
          <span className="fact"><Users size={14} /> {t('{n} servings', { n: d.servings })}</span>
          <span className={cx('fact', d.diet === 'Non-veg' ? 'fact-nonveg' : 'fact-veg')}>
            <i className="diet-mark" /> {t(d.diet)}
          </span>
          <span className="fact">
            {d.storage === 'Ambient' ? <Clock size={14} /> : <Snowflake size={14} />} {t(d.storage)}
          </span>
          <span className="fact"><MapPin size={14} /> {d.address}</span>
          {(() => {
            const donorApp = (state.applications ?? []).find((a) => a.role === 'donor' && a.orgName.trim().toLowerCase() === d.donor.trim().toLowerCase())
            return donorApp ? (
              <span className={cx('fact', 'donor-trust')} title={t('TrustCheck status of this donor')}>
                <ShieldCheck size={14} /> {donorApp.status === 'Verified' ? t('Verified donor') : t('Donor: {s}', { s: t(donorApp.status) })}
              </span>
            ) : null
          })()}
        </div>
        {d.description && <p className="drawer-desc">{d.description}</p>}

        <div className="drawer-body">
          {(() => {
            const g = rescueGuide(d, state, now, pipeline)
            return (
              <section className={cx('guide', `guide-${g.tone}`)} aria-live="polite">
                <span className="guide-kicker">{t('Next step')} · {t('rescue guide (rules, not AI)')}</span>
                <strong>{g.next}</strong>
                {g.why && <p>{g.why}</p>}
                {g.warnings.length > 0 && (
                  <ul>
                    {g.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })()}

          {(sc || d.status === 'In review') && <PipelineTrack states={trackFor(d, pipeline)} compact />}

          {/* 00 — AI verification (Engine 1), only for scanned listings */}
          {sc && (
            <section className={cx('step', 'step-ai', d.status === 'In review' && 'step-review')}>
              <div className="step-label"><span>00</span> {t('AI food check')}</div>
              <div className="ai-summary">
                {(() => {
                  const imgs = sc.photos?.length ? sc.photos : sc.photo ? [sc.photo] : []
                  return (
                    <div className={cx('ai-thumbs', `n${Math.max(1, Math.min(4, imgs.length))}`)}>
                      {imgs.length ? imgs.map((src, i) => <img key={i} src={src} alt={t('Donor photo {n}', { n: i + 1 })} />) : <span className="ai-thumb-empty" />}
                    </div>
                  )
                })()}
                <div>
                  <span className={cx('visual-verdict', `vv-${sc.visual.replace(/\s/g, '-').toLowerCase()}`)}>{t(sc.visual)}</span>
                  <strong>
                    {d.status === 'In review'
                      ? t('Held for a human check')
                      : sc.review
                        ? t('Approved by a coordinator')
                        : t('Passed screening')}
                  </strong>
                  <span>
                    {sc.ai ? (
                      <>
                        <Sparkles size={12} /> {sc.ai.dishName} · {sc.ai.model} · {Math.round(sc.ai.confidence.overall * 100)}% {t('confident')}
                      </>
                    ) : (
                      t('No AI reading: {why}', { why: sc.aiError ?? 'not scanned' })
                    )}
                  </span>
                  {sc.edited.length > 0 && <span>{t('Donor corrected')}: {sc.edited.join(', ')}</span>}
                </div>
              </div>
              {d.status === 'In review' && sc.reviewReasons.length > 0 && (
                <ul className="review-reasons">
                  {sc.reviewReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              <details className="rule-details" open={d.status === 'In review'}>
                <summary>{t('All {n} checks', { n: sc.rules.length })}</summary>
                <RuleList rules={sc.rules} />
              </details>
              {d.status === 'In review' && (
                <div className="review-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => onApprove?.(d)}
                  >
                    <ShieldCheck size={16} /> {t('I inspected it: approve & match')}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      store.withdraw(d.id).then((r) => {
                        if (!r.ok) return
                        toast(t('Listing rejected and removed.'), 'warn')
                        onClose()
                      })
                    }}
                  >
                    <Trash2 size={16} /> {t('Reject')}
                  </button>
                </div>
              )}
              <p className="feas-disclaimer">{t('Screening aid only — a photo cannot show temperature history, germs or allergens. Not a food-safety certification.')}</p>
            </section>
          )}

          {/* 01 — Feasibility */}
          <section className="step">
            <div className="step-label"><span>01</span> {t('Rescue feasibility')}</div>
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
            <div className="step-label"><span>02</span> {t('Smart NGO matching')}</div>
            {d.status === 'In review' ? (
              <p className="step-muted">{t('Locked until a coordinator approves the food check above.')}</p>
            ) : pipeline ? (
              safeLeft <= 0 ? (
                <p className="step-muted">{t('Safe window closed — matching is switched off for this listing.')}</p>
              ) : (
                <MatchPanel
                  pipeline={pipeline}
                  scanKey={d.id}
                  onReserve={(c) => {
                    store.reserve(d.id, c.e.ngo.id, c.score).then((r) => r.ok && toast(t('Reserved for {name}. Now assign a runner.', { name: c.e.ngo.name })))
                  }}
                  onWeights={(w) => {
                    store.setWeights(w).then((r) => r.ok && toast(w ? t('Custom weights applied to all matching.') : t('Default weights restored.'), 'info'))
                  }}
                  onHint={(h) => {
                    if (!h.action) return
                    if (h.action.kind === 'runners') return onNavigate?.('dispatch')
                    if (h.action.kind === 'trust') return onNavigate?.('trust')
                    const n = h.action.servings
                    store.splitDonation(d.id, n, true).then((r) => {
                      if (!r.ok) return
                      toast(
                        r.result.matchedTo
                          ? t('Split {n} servings into a new listing. Published and matched to {name}. Now assign a runner.', { n, name: r.result.matchedTo })
                          : t('Split {n} servings into a new listing.', { n }),
                        'info',
                      )
                    })
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
                      store.releaseMatch(d.id).then((r) => r.ok && toast(t('Match released. The listing is back on the board.'), 'info'))
                    }}
                  >
                    <Undo2 size={14} /> {t('Release')}
                  </button>
                )}
              </div>
            ) : null}
          </section>

          {/* 03 — Dispatch */}
          <section className={cx('step', (d.status === 'Available' || d.status === 'In review') && 'step-locked')}>
            <div className="step-label"><span>03</span> {t('Runner dispatch')}</div>
            {(d.status === 'Available' || d.status === 'In review') && <p className="step-muted">{t('Reserve an organisation first.')}</p>}
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
                          {i === 0 && !unavailable && <em className="tag-suggest">{t('Suggested')}</em>}
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
                          store.assignRunner(d.id, o.runner.id).then((r) => r.ok && toast(t('{name} is on the way to {donor}.', { name: o.runner.name, donor: d.donor })))
                        }}
                      >
                        <Bike size={14} /> {t('Assign')}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* 04 — Tracking */}
          <section className="step">
            <div className="step-label"><span>04</span> {t('Rescue tracking')}</div>
            <RescueTimeline donation={d} />
            {d.status === 'Reserved' && d.stage !== 'Pending' && (
              <button
                className="btn btn-primary btn-block btn-lg"
                onClick={() => {
                  const stage = d.stage
                  store.advance(d.id).then((r) => {
                    if (!r.ok) return
                    if (stage === 'Assigned') toast(t('Picked up from {donor}. Keep it moving.', { donor: d.donor }), 'info')
                    else toast(t('Delivered! {n} servings added to lifetime rescues.', { n: d.servings }))
                  })
                }}
              >
                {d.stage === 'Assigned' ? (
                  <>
                    <Route size={18} /> {t('Mark picked up')}
                  </>
                ) : (
                  <>
                    <PackageCheck size={18} /> {t('Mark delivered')}
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
                onDownloaded={() => toast(t('Receipt saved as PNG — share it anywhere.'))}
              />
            )}
            {d.status === 'Delivered' && (
              <button className="btn btn-ghost btn-block" onClick={onOpenImpact}>
                {t('See it bloom in the garden')} <ArrowUpRight size={16} />
              </button>
            )}
            <p className="sim-note">{t('Simulated workflow — statuses are updated by a coordinator in this browser. No live GPS.')}</p>
          </section>
        </div>
      </aside>
    </div>
  )
}
