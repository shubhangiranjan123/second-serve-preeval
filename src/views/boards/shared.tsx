// Building blocks shared by the donor, NGO and runner boards.

import { useState, type ReactNode } from 'react'
import { BadgeCheck, ShieldAlert } from 'lucide-react'
import type { AppState, Donation, TrustApplication, TrustRole } from '../../types'
import type { RescueStore, User } from '../../lib/useRescueStore'
import { formatClock, formatDuration, minutesBetween } from '../../lib/engine'
import { blankApplication } from '../../lib/trust'
import { Drop, Grain, Wordmark } from '../../components/Art'
import { WasteBar } from '../../components/WasteCounter'
import { AccountMenu } from '../../components/AccountMenu'
import { LangToggle } from '../../components/Sidebar'
import { ApplicationForm, StatusChip } from '../Trust'
import { useT } from '../../lib/i18n'
import { cx } from '../../components/ui'

export type Toast = (msg: string, tone?: 'ok' | 'info' | 'warn') => void

export function BoardShell({ store, user, toast, kind, children }: { store: RescueStore; user: User; toast: Toast; kind: string; children: ReactNode }) {
  const { t } = useT()
  const history = store.state?.history ?? []
  const ticker = [...history]
    .sort((a, b) => b.deliveredAt - a.deliveredAt)
    .slice(0, 8)
    .map((r) => `${t('{n} meals', { n: r.servings })} · ${r.food} → ${r.ngoName}`)
  return (
    <div className={cx('board-shell', `board-${user.role}`)}>
      <Grain />
      <header className="board-top">
        <Wordmark />
        <span className="board-kind">{kind}</span>
        <div className="board-top-right">
          <LangToggle />
          <AccountMenu store={store} user={user} toast={toast} />
        </div>
      </header>
      <WasteBar />
      <main className="board-main">{children}</main>
      {ticker.length > 0 && (
        <div className="marquee board-marquee" aria-label={t('Recent rescues across the city')}>
          <div className="marquee-track">
            {[...ticker, ...ticker].map((x, i) => (
              <span key={i}>
                {x} <i>●</i>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Decoration for the coloured hero panel on each board. */
export function HeroArt() {
  return (
    <span className="bhero-art" aria-hidden>
      <Drop className="bhero-drop" size={210} />
    </span>
  )
}

const STEPS = ['Listed', 'Checked', 'Matched', 'Picked up', 'Delivered'] as const

/** Where a donation is on its way from kitchen to plate. */
export function stepOf(d: Donation): number {
  if (d.status === 'Delivered') return 4
  if (d.status === 'Reserved') return d.stage === 'Picked Up' ? 3 : 2
  if (d.status === 'Available') return 1
  return 0
}

export function Steps({ d }: { d: Donation }) {
  const { t } = useT()
  const at = stepOf(d)
  return (
    <ol className="track" aria-label={t('Progress')}>
      {STEPS.map((s, i) => (
        <li key={s} className={cx(i < at && 'done', i === at && 'now')}>
          <i />
          <span>{t(s)}</span>
        </li>
      ))}
    </ol>
  )
}

export function SafeClock({ d, now }: { d: Donation; now: number }) {
  const { t } = useT()
  const left = minutesBetween(now, d.safeUntil)
  if (d.status === 'Delivered') return null
  return (
    <span className={cx('safe-clock', left <= 0 ? 'over' : left <= 45 ? 'tight' : 'ok')}>
      {left <= 0 ? t('Safe window closed') : t('Safe for {d} · until {c}', { d: formatDuration(left), c: formatClock(d.safeUntil) })}
    </span>
  )
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="bstat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

/** TrustCheck status for donor / NGO accounts, with apply / fix / view. */
export function TrustCard({ store, state, user, toast, role }: { store: RescueStore; state: AppState; user: User; toast: Toast; role: TrustRole }) {
  const { t } = useT()
  const app = (state.applications ?? []).find((a) => a.id === user.applicationId) ?? null
  const [editing, setEditing] = useState<TrustApplication | null>(null)
  const verified = app?.status === 'Verified'
  return (
    <section className={cx('bcard trust-card', verified ? 'tc-ok' : 'tc-todo')}>
      <div className="bcard-head">
        {verified ? <BadgeCheck size={22} /> : <ShieldAlert size={22} />}
        <h3>TrustCheck</h3>
        {app ? <StatusChip status={app.status} /> : <span className="tstatus ts-not-submitted">{t('Not Submitted')}</span>}
      </div>
      <p>
        {verified
          ? role === 'recipient'
            ? t('You’re a verified recipient. The matching engine can send you food.')
            : t('You’re a verified donor. NGOs see a verified badge on your listings.')
          : !app || app.status === 'Not Submitted'
            ? role === 'recipient'
              ? t('Apply so a coordinator can verify you. Until then, no food is matched to you.')
              : t('Apply with your FSSAI licence so NGOs know your kitchen has been checked.')
            : app.status === 'Resubmission Required'
              ? `${t('The reviewer asked for changes')}: ${app.decisionNote ?? ''}`
              : app.status === 'Rejected'
                ? `${t('Not approved')}: ${app.decisionNote ?? ''}`
                : t('A coordinator is checking your details on the official portals.')}
      </p>
      {(!app || app.status === 'Not Submitted' || app.status === 'Resubmission Required') && (
        <button
          className="btn btn-dark"
          onClick={() =>
            setEditing(
              app ?? {
                ...blankApplication(role),
                orgName: user.donorName ?? user.name,
              },
            )
          }
        >
          {!app || app.status === 'Not Submitted' ? (app ? t('Continue application') : t('Apply now')) : t('Fix & resubmit')}
        </button>
      )}
      {editing && (
        <ApplicationForm
          store={store}
          draft={editing}
          onClose={() => setEditing(null)}
          onSave={(a, asDraft) =>
            store.submitApplication(a, asDraft).then((r) => {
              if (!r.ok) return
              setEditing(null)
              toast(asDraft ? t('Draft saved.') : t('Application submitted. A coordinator will review it.'), asDraft ? 'info' : 'ok')
            })
          }
        />
      )}
    </section>
  )
}

export function photoOf(d: Donation): string | undefined {
  return d.screening?.photos?.[0] ?? d.screening?.photo
}
