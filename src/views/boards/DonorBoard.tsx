// Donor board: scan surplus, follow every listing to the plate, see impact.

import { useState } from 'react'
import { Bike, CheckCircle2, ScanLine, Trash2 } from 'lucide-react'
import type { AppState } from '../../types'
import type { RescueStore, User } from '../../lib/useRescueStore'
import { formatClock, impactTotals } from '../../lib/engine'
import { ScanFlow } from '../../components/ScanFlow'
import { useNow } from '../../App'
import { useT } from '../../lib/i18n'
import { BoardShell, HeroArt, SafeClock, Stat, Steps, TrustCard, photoOf, type Toast } from './shared'

export function DonorBoard({ store, state, user, toast }: { store: RescueStore; state: AppState; user: User; toast: Toast }) {
  const { t } = useT()
  const now = useNow(state)
  const [scan, setScan] = useState(false)
  const me = user.donorName ?? user.name
  const mine = state.donations.filter((d) => d.donor === me)
  const live = mine.filter((d) => d.status !== 'Delivered')
  const done = mine.filter((d) => d.status === 'Delivered').sort((a, b) => b.createdAt - a.createdAt)
  const impact = impactTotals(state.history.filter((h) => h.donor === me))
  const ngoName = (id: number | null) => state.ngos.find((n) => n.id === id)?.name ?? '—'
  const runnerName = (id: number | null) => state.runners.find((r) => r.id === id)?.name ?? '—'

  return (
    <BoardShell store={store} user={user} toast={toast} kind={t('Donor board')}>
      <section className="bhero">
        <HeroArt />
        <div>
          <h1>{me}</h1>
          <p>{live.length ? t('{n} listing(s) on their way. Updates arrive here live.', { n: live.length }) : t('Got surplus? Photograph it and we’ll find it a table.')}</p>
        </div>
        <button className="btn btn-pink btn-xl" onClick={() => setScan(true)}>
          <ScanLine size={22} /> {t('Scan & donate')}
        </button>
      </section>

      <section className="bstats">
        <Stat value={impact.meals} label={t('meals rescued from your kitchen')} />
        <Stat value={`${impact.kg} kg`} label={t('food kept out of the bin')} />
        <Stat value={`≈ ${impact.co2e} kg`} label={t('CO₂e avoided (estimate)')} />
        <Stat value={impact.deliveries} label={t('rescues completed')} />
      </section>

      <div className="bgrid">
        <section className="bcol">
          <h2 className="bsec">{t('On their way')}</h2>
          {live.length === 0 && <p className="bempty">{t('Nothing listed right now.')}</p>}
          {live.map((d) => (
            <article key={d.id} className="bcard dcard-b">
              <div className="dcard-b-top">
                {photoOf(d) ? <img src={photoOf(d)} alt="" /> : <span className="dthumb-empty" />}
                <div>
                  <strong>{d.name}</strong>
                  <span>
                    {d.servings} {t('servings')} · {t(d.category)} · {t('listed')} {formatClock(d.createdAt)}
                  </span>
                  <SafeClock d={d} now={now} />
                </div>
              </div>
              <Steps d={d} />
              <p className="dcard-b-line">
                {d.status === 'In review'
                  ? t('A coordinator is checking the food before it can be matched.')
                  : d.status === 'Available'
                    ? d.declinedBy?.length
                      ? t('An NGO couldn’t take it. Looking for another organisation…')
                      : t('On the board. No organisation can take it in time yet.')
                    : d.stage === 'Pending'
                      ? t('Matched to {ngo}. Waiting for a runner.', { ngo: ngoName(d.ngoId) })
                      : d.stage === 'Assigned'
                        ? t('{runner} is coming to collect it for {ngo}.', { runner: runnerName(d.runnerId), ngo: ngoName(d.ngoId) })
                        : t('{runner} has it and is heading to {ngo}.', { runner: runnerName(d.runnerId), ngo: ngoName(d.ngoId) })}
              </p>
              {(d.status === 'Available' || d.status === 'In review') && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => store.withdraw(d.id).then((r) => r.ok && toast(t('Listing withdrawn.'), 'info'))}
                >
                  <Trash2 size={14} /> {t('Withdraw')}
                </button>
              )}
            </article>
          ))}
        </section>

        <aside className="bcol">
          <TrustCard store={store} state={state} user={user} toast={toast} role="donor" />
          <section className="bcard">
            <h3>{t('Delivered')}</h3>
            {done.length === 0 ? (
              <p className="bempty">{t('Your first rescue will show up here.')}</p>
            ) : (
              <ul className="done-list">
                {done.slice(0, 8).map((d) => (
                  <li key={d.id}>
                    <CheckCircle2 size={16} />
                    <span>
                      <b>{d.servings}</b> {d.name} → {ngoName(d.ngoId)}
                      {d.receivedBy && <em> · {t('receipt confirmed')}</em>}
                    </span>
                    <small>
                      <Bike size={12} /> {runnerName(d.runnerId)}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <ScanFlow open={scan} onClose={() => setScan(false)} state={state} now={now} store={store} toast={toast} fixedDonor={me} />
    </BoardShell>
  )
}
