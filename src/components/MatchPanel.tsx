import { useEffect, useState } from 'react'
import { AlertTriangle, Ban, Bike, Check, ChevronDown, Clock, Scale, Snowflake, X } from 'lucide-react'
import {
  COMPAT_LABELS,
  MATCH_WEIGHTS,
  formatClock,
  type CompatKey,
  type NgoEvaluation,
} from '../lib/engine'
import { CRITERIA, GATES, gateOf, type Candidate, type PipelineResult } from '../lib/pipeline'
import { useT } from '../lib/i18n'
import { ScoreRing, VerdictPill, cx } from './ui'

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

function MatchCard({
  c,
  recommended,
  index,
  onReserve,
}: {
  c: Candidate
  recommended: boolean
  index: number
  onReserve: () => void
}) {
  const { t } = useT()
  const e = c.e
  const [open, setOpen] = useState(recommended)
  return (
    <article className={cx('match', recommended && 'match-best', !c.feasible && 'match-infeasible')} style={{ animationDelay: `${index * 80}ms` }}>
      <header className="match-head">
        <ScoreRing score={e.score} />
        <div className="match-title">
          {recommended && <span className="match-flag">{t('Recommended')}</span>}
          <h4>
            {e.ngo.name}
            <span className="compat-chip">{t('{n}% compatible', { n: e.compat })}</span>
          </h4>
          <span className="match-sub">
            #{c.rank} {t('by score')} · {e.ngo.type} · {e.ngo.area} · {t('arrives')} ≈ {formatClock(c.arrival)}
          </span>
        </div>
        <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Toggle details">
          <ChevronDown size={18} className={cx('chev', open && 'chev-open')} />
        </button>
      </header>

      <div className="feas-line">
        {c.feasible ? <VerdictPill verdict={c.feasibility.verdict} /> : <span className="verdict verdict-bad"><Ban size={13} /> {t('Can’t make it')}</span>}
        <span>{c.feasibilityNote}</span>
      </div>

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
            {CRITERIA.map(({ key, label, type }) => (
              <div className="factor" key={key}>
                <span>
                  {t(label)}
                  {type === 'cost' && <small> · {t('lower is better')}</small>}
                </span>
                <div className="factor-bar">
                  <i style={{ width: `${Math.round(e.breakdown[key] * 100)}%` }} />
                </div>
                <em>
                  {c.points[key].toFixed(0)}/{Math.round(MATCH_WEIGHTS[key] * 100)}
                </em>
              </div>
            ))}
            <div className="factor factor-topsis">
              <span>{t('TOPSIS cross-check')}</span>
              <div className="factor-bar">
                <i style={{ width: `${Math.round(c.topsis * 100)}%` }} />
              </div>
              <em>#{c.topsisRank}</em>
            </div>
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

      <button className="btn btn-primary btn-block" onClick={onReserve} disabled={!c.feasible}>
        {c.feasible ? t('Reserve for {name}', { name: e.ngo.name.split(' ')[0] }) : t('Not reachable in time')}
      </button>
    </article>
  )
}

export function MatchPanel({
  pipeline,
  scanKey,
  onReserve,
}: {
  pipeline: PipelineResult
  scanKey: number
  onReserve: (e: NgoEvaluation) => void
}) {
  const { t } = useT()
  const [scanning, setScanning] = useState(true)
  const [showExcluded, setShowExcluded] = useState(true)
  const p = pipeline

  useEffect(() => {
    setScanning(true)
    const tm = setTimeout(() => setScanning(false), 650)
    return () => clearTimeout(tm)
  }, [scanKey])

  if (scanning) {
    return (
      <div className="match-scan" aria-live="polite">
        <span className="spinner" /> {t('Checking {n} organisations against 7 safety gates and 6 compatibility factors…', { n: p.checked })}
        <div className="skeleton" />
        <div className="skeleton short" />
      </div>
    )
  }

  // Score order, with the recommendation surfaced first if a higher score was skipped.
  const order = p.recommended ? [p.recommended, ...p.ranked.filter((c) => c !== p.recommended)] : p.ranked

  return (
    <div className="match-panel">
      <div className={cx('reco', p.status === 'matched' ? 'reco-ok' : 'reco-none')}>
        <div className="reco-head">
          {p.status === 'matched' ? <Scale size={20} /> : <Ban size={20} />}
          <strong>{p.headline}</strong>
          {p.stability && p.stability.label !== 'Only option' && p.status === 'matched' && (
            <span className={cx('stab', `stab-${p.stability.label.replace(' ', '-').toLowerCase()}`)}>{t(p.stability.label)}</span>
          )}
        </div>
        <ul>
          {p.explanation.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {p.status === 'matched' && (
          <p className="reco-runner">
            {p.runnerConfirmed ? <Bike size={14} /> : <Clock size={14} />}
            {p.runnerConfirmed ? t('Pickup timed with the nearest free runner') : t('Pickup time is an assumption: no free runner')}
          </p>
        )}
      </div>

      <p className="match-summary">
        {t('{a} of {b} organisations pass every gate', { a: p.eligible.length, b: p.checked })}
        {p.infeasible.length > 0 && <> · {t('{n} fail the real-pickup check', { n: p.infeasible.length })}</>}
        {p.excluded.length > 0 && <> · {t('{n} excluded with reasons', { n: p.excluded.length })}</>}
      </p>

      {p.eligible.length === 0 && (
        <div className="empty-match">
          <Ban size={20} />
          <div>
            <strong>{t('No safe match right now.')}</strong>
            <span>{t('Nobody can receive this in time without breaking a safety gate. Don’t redistribute it.')}</span>
          </div>
        </div>
      )}

      <div className="match-list">
        {order.map((c, i) => (
          <MatchCard key={c.e.ngo.id} c={c} index={i} recommended={c === p.recommended} onReserve={() => onReserve(c.e)} />
        ))}
      </div>

      {p.excluded.length > 0 && (
        <div className="excluded">
          <button className="excluded-toggle" onClick={() => setShowExcluded((s) => !s)}>
            {t('Excluded by safety gates ({n})', { n: p.excluded.length })}
            <ChevronDown size={16} className={cx('chev', showExcluded && 'chev-open')} />
          </button>
          {showExcluded && (
            <ul>
              {p.excluded.map((e) => (
                <li key={e.ngo.id}>
                  <strong>{e.ngo.name}</strong>
                  {e.failures.map((f) => {
                    const g = GATES.find((x) => x.id === gateOf(f))
                    return (
                      <span key={f}>
                        <X size={13} /> {g && <b className="gate-tag">{t(g.label)}</b>} {f}
                      </span>
                    )
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
