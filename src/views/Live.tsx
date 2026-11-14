import { useState } from 'react'
import { Volume2, X } from 'lucide-react'
import type { AppState } from '../types'
import { formatClock, impactTotals, sameLocalDay } from '../lib/engine'
import { DripUnderline, FallingDrop, Wordmark } from '../components/Art'
import { CountUp } from '../components/ui'
import { Garden } from '../components/Garden'
import { LangToggle } from '../components/Sidebar'
import { chime, unlockAudio } from '../lib/sound'
import { useT } from '../lib/i18n'

export function Live({ state, now, onExit }: { state: AppState; now: number; onExit: () => void }) {
  const { t } = useT()
  const [armed, setArmed] = useState(false)
  const today = state.history.filter((r) => sameLocalDay(r.deliveredAt, now))
  const meals = today.reduce((s, r) => s + r.servings, 0)
  const totals = impactTotals(today)
  const last = [...state.history].sort((a, b) => b.deliveredAt - a.deliveredAt)[0]
  const inFlight = state.donations.filter((d) => d.status === 'Reserved').length
  const wilted = state.donations.filter((d) => d.status === 'Available' && d.safeUntil <= now)

  return (
    <div className="live">
      <header className="live-head">
        <Wordmark />
        <span className="live-dot">● {t('Live')} · {formatClock(now)}</span>
        {!armed && (
          <button
            className="sound-hint"
            onClick={() => {
              unlockAudio()
              chime('tick')
              setArmed(true)
            }}
          >
            <Volume2 size={14} /> {t('Tap once to enable bloom sounds')}
          </button>
        )}
        <LangToggle />
        <button className="icon-btn light" onClick={onExit} aria-label="Leave room wall">
          <X size={20} />
        </button>
      </header>
      <div className="live-center">
        <span className="live-lead">{t('Meals rescued today')}</span>
        <div className="waste-number live-number" key={meals}>
          <strong>
            <CountUp value={meals} duration={1600} />
          </strong>
          <DripUnderline />
          <FallingDrop />
        </div>
        <div className="live-stats">
          <span>
            <b>{totals.deliveries}</b> {t('deliveries')}
          </span>
          <span>
            <b>{totals.kg}</b> {t('kg kept out of the bin')} <small>est.</small>
          </span>
          <span>
            <b>{inFlight}</b> {t('rescues on the move')}
          </span>
          <span>
            <b>{state.history.length}</b> {t('flowers in the garden')}
          </span>
        </div>
      </div>
      {last && (
        <div className="live-last" key={last.donationId}>
          <span className="kicker">{t('Latest')}</span>
          <strong>
            {t('{n} meals', { n: last.servings })} · {last.food.toLowerCase()}
          </strong>
          <span>
            {last.donor} → {last.ngoName} · {t('Runner')} {last.runnerName}
          </span>
        </div>
      )}
      <div className="live-garden">
        <Garden history={state.history} wilted={wilted} now={now} variant="wall" showHeader={false} />
      </div>
      <footer className="live-foot">{t('Demonstration data · counted only on delivery · supports SDG 13')}</footer>
    </div>
  )
}
