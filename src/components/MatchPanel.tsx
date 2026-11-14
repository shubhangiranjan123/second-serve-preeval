import { useEffect, useState } from 'react'
import { AlertTriangle, Ban, Check, ChevronDown, Snowflake, X } from 'lucide-react'
import { MATCH_WEIGHTS, formatClock, type MatchResult, type NgoEvaluation } from '../lib/engine'
import { ScoreRing, cx } from './ui'

const factorLabels: Array<[keyof typeof MATCH_WEIGHTS, string]> = [
  ['travel', 'Travel time'],
  ['need', 'Unused capacity'],
  ['safety', 'Safety margin'],
  ['hours', 'Opening hours'],
]

function MatchCard({ e, rank, onReserve }: { e: NgoEvaluation; rank: number; onReserve: () => void }) {
  const [open, setOpen] = useState(rank === 0)
  return (
    <article className={cx('match', rank === 0 && 'match-best')} style={{ animationDelay: `${rank * 80}ms` }}>
      <header className="match-head">
        <ScoreRing score={e.score} />
        <div className="match-title">
          {rank === 0 && <span className="match-flag">Best match</span>}
          <h4>{e.ngo.name}</h4>
          <span className="match-sub">
            {e.ngo.type} · {e.ngo.area} · arrives ≈ {formatClock(e.arrival)}
          </span>
        </div>
        <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Toggle details">
          <ChevronDown size={18} className={cx('chev', open && 'chev-open')} />
        </button>
      </header>

      {open && (
        <div className="match-body">
          <div className="factors">
            {factorLabels.map(([k, label]) => (
              <div className="factor" key={k}>
                <span>{label}</span>
                <div className="factor-bar">
                  <i style={{ width: `${Math.round(e.breakdown[k] * 100)}%` }} />
                </div>
                <em>{Math.round(e.breakdown[k] * MATCH_WEIGHTS[k] * 100)}/{MATCH_WEIGHTS[k] * 100}</em>
              </div>
            ))}
          </div>
          <ul className="reasons">
            {e.reasons.map((r) => (
              <li key={r}>
                <Check size={14} /> {r}
              </li>
            ))}
            {e.warnings.map((w) => (
              <li key={w} className="warn">
                {w.startsWith('Keep the food cold') ? <Snowflake size={14} /> : <AlertTriangle size={14} />} {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button className="btn btn-primary btn-block" onClick={onReserve}>
        Reserve for {e.ngo.name.split(' ')[0]}
      </button>
    </article>
  )
}

export function MatchPanel({
  result,
  scanKey,
  onReserve,
}: {
  result: MatchResult
  scanKey: number
  onReserve: (e: NgoEvaluation) => void
}) {
  const [scanning, setScanning] = useState(true)
  const [showExcluded, setShowExcluded] = useState(true)
  const total = result.eligible.length + result.excluded.length

  useEffect(() => {
    setScanning(true)
    const t = setTimeout(() => setScanning(false), 650)
    return () => clearTimeout(t)
  }, [scanKey])

  if (scanning) {
    return (
      <div className="match-scan" aria-live="polite">
        <span className="spinner" /> Checking {total} organisations against 6 safety gates…
        <div className="skeleton" />
        <div className="skeleton short" />
      </div>
    )
  }

  return (
    <div className="match-panel">
      <p className="match-summary">
        <strong>{result.eligible.length}</strong> of {total} organisations pass every gate
        {result.excluded.length > 0 && <> · {result.excluded.length} excluded with reasons</>}
      </p>

      {result.eligible.length === 0 && (
        <div className="empty-match">
          <Ban size={20} />
          <div>
            <strong>No safe match right now.</strong>
            <span>Nobody can receive this in time without breaking a safety gate. Don’t redistribute it.</span>
          </div>
        </div>
      )}

      <div className="match-list">
        {result.eligible.map((e, i) => (
          <MatchCard key={e.ngo.id} e={e} rank={i} onReserve={() => onReserve(e)} />
        ))}
      </div>

      {result.excluded.length > 0 && (
        <div className="excluded">
          <button className="excluded-toggle" onClick={() => setShowExcluded((s) => !s)}>
            Excluded by safety gates ({result.excluded.length})
            <ChevronDown size={16} className={cx('chev', showExcluded && 'chev-open')} />
          </button>
          {showExcluded && (
            <ul>
              {result.excluded.map((e) => (
                <li key={e.ngo.id}>
                  <strong>{e.ngo.name}</strong>
                  {e.failures.map((f) => (
                    <span key={f}>
                      <X size={13} /> {f}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
