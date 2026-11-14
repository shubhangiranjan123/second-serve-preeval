import { X } from 'lucide-react'
import type { AppState } from '../types'
import { formatClock, impactTotals, sameLocalDay } from '../lib/engine'
import { DripUnderline, FallingDrop, Wordmark } from '../components/Art'
import { CountUp } from '../components/ui'

// Projector view. Open it in a second tab: it updates live whenever
// a rescue is delivered in any other tab of this browser.
export function Live({ state, now, onExit }: { state: AppState; now: number; onExit: () => void }) {
  const today = state.history.filter((r) => sameLocalDay(r.deliveredAt, now))
  const meals = today.reduce((s, r) => s + r.servings, 0)
  const totals = impactTotals(today)
  const last = [...state.history].sort((a, b) => b.deliveredAt - a.deliveredAt)[0]
  const inFlight = state.donations.filter((d) => d.status === 'Reserved').length

  return (
    <div className="live">
      <header className="live-head">
        <Wordmark />
        <span className="live-dot">● Live · {formatClock(now)}</span>
        <button className="icon-btn light" onClick={onExit} aria-label="Leave room wall">
          <X size={20} />
        </button>
      </header>
      <div className="live-center">
        <span className="live-lead">Meals rescued today</span>
        <div className="waste-number live-number" key={meals}>
          <strong>
            <CountUp value={meals} duration={1600} />
          </strong>
          <DripUnderline />
          <FallingDrop />
        </div>
        <div className="live-stats">
          <span>
            <b>{totals.deliveries}</b> deliveries
          </span>
          <span>
            <b>{totals.kg}</b> kg kept out of the bin <small>est.</small>
          </span>
          <span>
            <b>{inFlight}</b> rescues on the move
          </span>
        </div>
      </div>
      {last && (
        <div className="live-last" key={last.donationId}>
          <span className="kicker">Latest</span>
          <strong>
            {last.servings} meals of {last.food.toLowerCase()}
          </strong>
          <span>
            {last.donor} → {last.ngoName} · runner {last.runnerName}
          </span>
        </div>
      )}
      <footer className="live-foot">Demonstration data · counted only on delivery · supports SDG 13</footer>
    </div>
  )
}
