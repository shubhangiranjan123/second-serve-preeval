import { useEffect, useState } from 'react'
import { AlertTriangle, Ban, Check, ChevronDown, Snowflake, X } from 'lucide-react'
import {
  COMPAT_LABELS,
  MATCH_WEIGHTS,
  formatClock,
  type CompatKey,
  type MatchResult,
  type NgoEvaluation,
} from '../lib/engine'
import { useT } from '../lib/i18n'
import { ScoreRing, cx } from './ui'

const factorLabels: Array<[keyof typeof MATCH_WEIGHTS, string]> = [
  ['compat', 'Compatibility'],
  ['travel', 'Travel time'],
  ['need', 'Unused capacity'],
  ['safety', 'Safety margin'],
  ['hours', 'Opening hours'],
]

const COMPAT_ORDER: CompatKey[] = ['storage', 'cold', 'diet', 'wants', 'timing', 'reheat']

function Radar({ values }: { values: Record<CompatKey, number> }) {
  const { t } = useT()
  const cx0 = 75
  const cy0 = 75
  const R = 52
  const pt = (i: number, v: number) => {
    const a = (Math.PI * 2 * i) / COMPAT_ORDER.length - Math.PI / 2
    return [cx0 + Math.cos(a) * R * v, cy0 + Math.sin(a) * R * v]
  }
  const shape = COMPAT_ORDER.map((k, i) => pt(i, Math.max(0.06, values[k])).join(',')).join(' ')
  return (
    <div className="compat-radar">
      <svg viewBox="0 0 150 150" aria-hidden>
        {[0.33, 0.66, 1].map((lv) => (
          <polygon key={lv} className="r-grid" points={COMPAT_ORDER.map((_, i) => pt(i, lv).join(',')).join(' ')} />
        ))}
        {COMPAT_ORDER.map((_, i) => {
          const [x, y] = pt(i, 1)
          return <line key={i} className="r-axis" x1={cx0} y1={cy0} x2={x} y2={y} />
        })}
        <polygon className="r-shape" points={shape} />
        {COMPAT_ORDER.map((k, i) => {
          const [x, y] = pt(i, Math.max(0.06, values[k]))
          return <circle key={k} className="r-dot" cx={x} cy={y} r="2.6" />
        })}
        {COMPAT_ORDER.map((k, i) => {
          const [x, y] = pt(i, 1.32)
          return (
            <text key={k} x={x} y={y + 3} textAnchor="middle">
              {t(COMPAT_LABELS[k])}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

function UnitGauge({ e }: { e: NgoEvaluation }) {
  const { t } = useT()
  const f = e.storageFit
  if (f.unit === 'shelf') {
    return (
      <div className="unit-gauge">
        <div className="unit-gauge-head">
          <span>{t('Storage')}</span>
          <span>{t('Room temperature, no unit needed')}</span>
        </div>
      </div>
    )
  }
  const name = f.unit === 'fridge' ? t('Fridge') : f.unit === 'freezer' ? t('Freezer') : t('Dry store')
  const used = f.capacity > 0 ? Math.min(100, (f.usedBefore / f.capacity) * 100) : 0
  const add = f.capacity > 0 ? Math.min(100 - used, (f.need / f.capacity) * 100) : 0
  return (
    <div className="unit-gauge">
      <div className="unit-gauge-head">
        <span>
          {name} · {f.capacity} {f.measure}
        </span>
        <span>
          +{f.need} {f.measure} → {Math.max(0, f.capacity - f.usedAfter)} {f.measure} {t('free')}
        </span>
      </div>
      <div className="unit-bar">
        <i className="u-used" style={{ width: `${used}%` }} />
        <i className="u-new" style={{ left: `${used}%`, width: `${add}%` }} />
      </div>
      <span>
        {t('Grey = already reserved · striped = this donation')}
        {e.nextMeal !== null && ` · ${t('next meal')} ${formatClock(e.nextMeal)}`}
      </span>
    </div>
  )
}

function MatchCard({ e, rank, onReserve }: { e: NgoEvaluation; rank: number; onReserve: () => void }) {
  const { t } = useT()
  const [open, setOpen] = useState(rank === 0)
  return (
    <article className={cx('match', rank === 0 && 'match-best')} style={{ animationDelay: `${rank * 80}ms` }}>
      <header className="match-head">
        <ScoreRing score={e.score} />
        <div className="match-title">
          {rank === 0 && <span className="match-flag">{t('Best match')}</span>}
          <h4>
            {e.ngo.name}
            <span className="compat-chip">{t('{n}% compatible', { n: e.compat })}</span>
          </h4>
          <span className="match-sub">
            {e.ngo.type} · {e.ngo.area} · {t('arrives')} ≈ {formatClock(e.arrival)}
          </span>
        </div>
        <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Toggle details">
          <ChevronDown size={18} className={cx('chev', open && 'chev-open')} />
        </button>
      </header>

      {open && (
        <div className="match-body">
          <div className="compat">
            <Radar values={e.compatFactors} />
            <div className="compat-side">
              <div className="compat-score">
                <strong>{e.compat}</strong>
                <span>/100 {t('kitchen compatibility')}</span>
              </div>
              <UnitGauge e={e} />
            </div>
          </div>
          <div className="factors">
            {factorLabels.map(([k, label]) => (
              <div className="factor" key={k}>
                <span>{t(label)}</span>
                <div className="factor-bar">
                  <i style={{ width: `${Math.round(e.breakdown[k] * 100)}%` }} />
                </div>
                <em>
                  {Math.round(e.breakdown[k] * MATCH_WEIGHTS[k] * 100)}/{Math.round(MATCH_WEIGHTS[k] * 100)}
                </em>
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
        {t('Reserve for {name}', { name: e.ngo.name.split(' ')[0] })}
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
  const { t } = useT()
  const [scanning, setScanning] = useState(true)
  const [showExcluded, setShowExcluded] = useState(true)
  const total = result.eligible.length + result.excluded.length

  useEffect(() => {
    setScanning(true)
    const tm = setTimeout(() => setScanning(false), 650)
    return () => clearTimeout(tm)
  }, [scanKey])

  if (scanning) {
    return (
      <div className="match-scan" aria-live="polite">
        <span className="spinner" /> {t('Checking {n} organisations against 7 safety gates and 6 compatibility factors…', { n: total })}
        <div className="skeleton" />
        <div className="skeleton short" />
      </div>
    )
  }

  return (
    <div className="match-panel">
      <p className="match-summary">
        {t('{a} of {b} organisations pass every gate', { a: result.eligible.length, b: total })}
        {result.excluded.length > 0 && <> · {t('{n} excluded with reasons', { n: result.excluded.length })}</>}
      </p>

      {result.eligible.length === 0 && (
        <div className="empty-match">
          <Ban size={20} />
          <div>
            <strong>{t('No safe match right now.')}</strong>
            <span>{t('Nobody can receive this in time without breaking a safety gate. Don’t redistribute it.')}</span>
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
            {t('Excluded by safety gates ({n})', { n: result.excluded.length })}
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
