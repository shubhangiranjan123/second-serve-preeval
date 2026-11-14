import { ShieldCheck } from 'lucide-react'
import { formatDuration, type Feasibility } from '../lib/engine'
import { VerdictPill, cx } from './ui'

// Visual: the safe-consumption window as a track, with preparation, travel
// and the safety buffer laid inside it. Whatever is left is spare time;
// anything that spills past the end of the window is shown as overflow.
export function FeasibilityMeter({ f, compact }: { f: Feasibility; compact?: boolean }) {
  const needed = f.totalMin + f.bufferMin
  const span = Math.max(f.availableMin, needed, 1)
  const pct = (m: number) => `${(Math.max(0, m) / span) * 100}%`
  const overflow = Math.max(0, needed - f.availableMin)
  const tone = f.verdict === 'Feasible' ? 'ok' : f.verdict === 'At risk' ? 'warn' : 'bad'

  return (
    <div className={cx('feas', `feas-${tone}`, compact && 'feas-compact')}>
      <div className="feas-head">
        <VerdictPill verdict={f.verdict} large={!compact} />
        <strong className="feas-headline">{f.headline}</strong>
      </div>

      <div className="feas-track" role="img" aria-label={`Rescue needs ${f.totalMin} minutes plus ${f.bufferMin} minute buffer; ${f.availableMin} minutes of safe time remain.`}>
        <div className="feas-window" style={{ width: pct(f.availableMin) }} />
        <div className="feas-seg seg-prep" style={{ width: pct(f.prepMin) }} />
        <div className="feas-seg seg-travel" style={{ width: pct(f.travelMin) }} />
        <div className="feas-seg seg-buffer" style={{ width: pct(f.bufferMin) }} />
        {overflow > 0 && <div className="feas-overflow" style={{ left: pct(f.availableMin), width: pct(overflow) }} />}
        <div className="feas-deadline" style={{ left: pct(f.availableMin) }}>
          <span>safe until</span>
        </div>
      </div>

      <dl className="feas-legend">
        <div>
          <dt><i className="dot seg-prep" />Preparation</dt>
          <dd>{formatDuration(f.prepMin)}</dd>
        </div>
        <div>
          <dt><i className="dot seg-travel" />Travel</dt>
          <dd>{formatDuration(f.travelMin)}</dd>
        </div>
        <div>
          <dt><i className="dot seg-buffer" />Safety buffer</dt>
          <dd>{f.bufferMin} min</dd>
        </div>
        <div>
          <dt><i className="dot seg-window" />Safe time left</dt>
          <dd>{formatDuration(f.availableMin)}</dd>
        </div>
      </dl>

      {!compact && (
        <>
          <p className="feas-explain">{f.explanation}</p>
          <p className="feas-disclaimer">
            <ShieldCheck size={14} /> Initial screening aid only — not a food-safety certification. Handling must
            follow applicable food-safety rules and the donor’s own judgement.
          </p>
        </>
      )}
    </div>
  )
}
