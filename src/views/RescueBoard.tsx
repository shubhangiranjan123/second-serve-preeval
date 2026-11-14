import { useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import type { AppState, Category, Donation } from '../types'
import { CATEGORIES } from '../data/demoData'
import { assessFeasibility } from '../lib/engine'
import { DonationCard } from '../components/DonationCard'
import { Eyebrow, cx } from '../components/ui'

type StatusFilter = 'All' | 'Available' | 'In rescue' | 'Delivered'

export function RescueBoard({
  state,
  now,
  onAdd,
  onOpen,
}: {
  state: AppState
  now: number
  onAdd: () => void
  onOpen: (d: Donation) => void
}) {
  const [cat, setCat] = useState<Category | 'All food'>('All food')
  const [status, setStatus] = useState<StatusFilter>('All')
  const [q, setQ] = useState('')

  const list = useMemo(() => {
    const order = { Available: 0, Reserved: 1, Delivered: 2 }
    return state.donations
      .filter((d) => cat === 'All food' || d.category === cat)
      .filter((d) =>
        status === 'All'
          ? true
          : status === 'Available'
            ? d.status === 'Available'
            : status === 'In rescue'
              ? d.status === 'Reserved'
              : d.status === 'Delivered',
      )
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

  const count = (s: StatusFilter) =>
    state.donations.filter((d) =>
      s === 'All' ? true : s === 'Available' ? d.status === 'Available' : s === 'In rescue' ? d.status === 'Reserved' : d.status === 'Delivered',
    ).length

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <Eyebrow>The rescue board</Eyebrow>
          <h1>
            Surplus, <em>sorted by urgency.</em>
          </h1>
          <p className="view-lede">Every listing carries a live safe-time countdown and a feasibility verdict. Most urgent first.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={onAdd}>
          <Plus size={18} /> List surplus food
        </button>
      </header>

      <div className="filters">
        <div className="chips" role="group" aria-label="Category">
          {(['All food', ...CATEGORIES] as const).map((c) => (
            <button key={c} className={cx('chip', cat === c && 'on')} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="filters-right">
          <div className="segmented small" role="group" aria-label="Status">
            {(['All', 'Available', 'In rescue', 'Delivered'] as const).map((s) => (
              <button key={s} className={cx(status === s && 'on')} onClick={() => setStatus(s)}>
                {s} <em>{count(s)}</em>
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search food, donor, area" aria-label="Search listings" />
          </label>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="empty-board">
          <p>No listings match these filters.</p>
          <button className="btn btn-ghost" onClick={() => { setCat('All food'); setStatus('All'); setQ('') }}>
            Clear filters
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
