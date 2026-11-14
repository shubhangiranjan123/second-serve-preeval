import { useMemo, useState } from 'react'
import { ScanLine, Search } from 'lucide-react'
import type { AppState, Category, Donation } from '../types'
import { CATEGORIES } from '../data/demoData'
import { assessFeasibility } from '../lib/engine'
import { DonationCard } from '../components/DonationCard'
import { Eyebrow, cx } from '../components/ui'
import { useT } from '../lib/i18n'

type StatusFilter = 'All' | 'In review' | 'Available' | 'In rescue' | 'Delivered'

const FILTERS: StatusFilter[] = ['All', 'In review', 'Available', 'In rescue', 'Delivered']

function statusMatches(s: StatusFilter, d: Donation) {
  if (s === 'All') return true
  if (s === 'In rescue') return d.status === 'Reserved'
  return d.status === s
}

export function RescueBoard({
  state,
  now,
  onScan,
  onOpen,
}: {
  state: AppState
  now: number
  onScan: () => void
  onOpen: (d: Donation) => void
}) {
  const { t } = useT()
  const [cat, setCat] = useState<Category | 'All food'>('All food')
  const [status, setStatus] = useState<StatusFilter>('All')
  const [q, setQ] = useState('')

  const list = useMemo(() => {
    const order: Record<Donation['status'], number> = { 'In review': 0, Available: 1, Reserved: 2, Delivered: 3 }
    return state.donations
      .filter((d) => cat === 'All food' || d.category === cat)
      .filter((d) => statusMatches(status, d))
      .filter((d) => {
        const s = q.trim().toLowerCase()
        return !s || `${d.name} ${d.donor} ${d.area}`.toLowerCase().includes(s)
      })
      .sort(
        (a, b) =>
          order[a.status] - order[b.status] ||
          assessFeasibility(a, now).spareMin - assessFeasibility(b, now).spareMin,
      )
  }, [state.donations, cat, status, q, now])

  const count = (s: StatusFilter) => state.donations.filter((d) => statusMatches(s, d)).length

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <Eyebrow>{t('The rescue board')}</Eyebrow>
          <h1>
            {t('Surplus,')} <em>{t('sorted by urgency.')}</em>
          </h1>
          <p className="view-lede">{t('Every listing carries a live safe-time countdown, a feasibility verdict and a bud that wilts as time runs out. Most urgent first.')}</p>
        </div>
        <div className="view-head-actions">
          <button className="btn btn-primary btn-lg" onClick={onScan}>
            <ScanLine size={18} /> {t('Scan & donate')}
          </button>
        </div>
      </header>

      <div className="filters">
        <div className="chips" role="group" aria-label="Category">
          {(['All food', ...CATEGORIES] as const).map((c) => (
            <button key={c} className={cx('chip', cat === c && 'on')} onClick={() => setCat(c)}>
              {t(c)}
            </button>
          ))}
        </div>
        <div className="filters-right">
          <div className="segmented small" role="group" aria-label="Status">
            {FILTERS.filter((s) => s !== 'In review' || count(s) > 0).map((s) => (
              <button key={s} className={cx(status === s && 'on')} onClick={() => setStatus(s)}>
                {t(s)} <em>{count(s)}</em>
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search food, donor, area')} aria-label={t('Search food, donor, area')} />
          </label>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="empty-board">
          <p>{t('No listings match these filters.')}</p>
          <button className="btn btn-ghost" onClick={() => { setCat('All food'); setStatus('All'); setQ('') }}>
            {t('Clear filters')}
          </button>
        </div>
      ) : (
        <div className="board-grid">
          {list.map((d, i) => (
            <DonationCard key={d.id} d={d} state={state} now={now} onOpen={() => onOpen(d)} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}
