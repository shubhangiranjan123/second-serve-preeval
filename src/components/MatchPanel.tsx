import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Ban, Bike, Check, ChevronDown, Clock, Lightbulb, RotateCcw, Scale, Snowflake, X } from 'lucide-react'
import { COMPAT_LABELS, MATCH_WEIGHTS, formatClock, type CompatKey, type NgoEvaluation } from '../lib/engine'
import {
  CRITERIA,
  GATES,
  gateOf,
  gateResults,
  normalizeWeights,
  type Candidate,
  type Hint,
  type PipelineResult,
  type Weights,
} from '../lib/pipeline'
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
  weights,
  onReserve,
}: {
  c: Candidate
  recommended: boolean
  index: number
  weights: Weights
  onReserve: () => void
}) {
  const { t } = useT()
  const e = c.e
  const [open, setOpen] = useState(recommended)
  return (
    <article className={cx('match', recommended && 'match-best', !c.feasible && 'match-infeasible')} style={{ animationDelay: `${index * 80}ms` }}>
      <header className="match-head">
        <ScoreRing score={c.score} />
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
                  {c.points[key].toFixed(0)}/{Math.round(weights[key] * 100)}
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

type Tab = 'reco' | 'gates' | 'compare' | 'weights'

const pct = (v: number) => `${Math.round(v * 100)}%`

function Hints({ hints, onHint }: { hints: Hint[]; onHint?: (h: Hint) => void }) {
  const { t } = useT()
  if (!hints.length) return null
  return (
    <div className="hints">
      <strong>
        <Lightbulb size={16} /> {t('How this rescue could still happen')}
      </strong>
      <ul>
        {hints.map((h) => (
          <li key={h.text}>
            <span>{h.text}</span>
            {h.action && onHint && (
              <button className="btn btn-dark btn-sm" onClick={() => onHint(h)}>
                {h.action.kind === 'split'
                  ? t('Split {n} servings & match', { n: h.action.servings })
                  : h.action.kind === 'runners'
                    ? t('Open runner dispatch')
                    : t('Open TrustCheck')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <small>{t('Suggestions come from the gate results above (rules, not AI).')}</small>
    </div>
  )
}

function GateMatrix({ p }: { p: PipelineResult }) {
  const { t } = useT()
  const rows = [...p.eligible, ...p.excluded]
  const [open, setOpen] = useState(false)
  return (
    <div className="gates">
      <p className="tab-lede">
        {t('Every organisation is checked against all 7 gates. Failing any one excludes it, however well it would score. A high score can never make up for a failed safety gate.')}
      </p>
      <div className="gate-table" role="table" aria-label={t('Eligibility gates')}>
        <div className="gate-row gate-headrow" role="row">
          <span role="columnheader">{t('Organisation')}</span>
          {GATES.map((g, i) => (
            <span key={g.id} role="columnheader" title={g.label}>
              <b>{i + 1}</b>
              <em>{t(g.label)}</em>
            </span>
          ))}
        </div>
        {rows.map((e) => {
          const r = gateResults(e)
          return (
            <div className="gate-row" role="row" key={e.ngo.id}>
              <span role="cell" className={e.eligible ? 'gate-org ok' : 'gate-org'}>
                {e.ngo.name}
                <small>{e.eligible ? t('eligible') : t('excluded')}</small>
              </span>
              {GATES.map((g) => (
                <span key={g.id} role="cell" className={r[g.id].ok ? 'gate-cell pass' : 'gate-cell fail'} title={r[g.id].reason ?? t('Passed')}>
                  {r[g.id].ok ? <Check size={15} strokeWidth={3} /> : <X size={15} strokeWidth={3} />}
                </span>
              ))}
            </div>
          )
        })}
      </div>
      <button className="excluded-toggle" onClick={() => setOpen((o) => !o)}>
        {t('What each gate checks')}
        <ChevronDown size={16} className={cx('chev', open && 'chev-open')} />
      </button>
      {open && (
        <ol className="gate-defs">
          {GATES.map((g) => (
            <li key={g.id}>
              <strong>{t(g.label)}</strong>
              <span>
                <b>{t('Data')}:</b> {g.data}
              </span>
              <span>
                <b>{t('Passes')}:</b> {g.pass}
              </span>
              <span>
                <b>{t('Fails')}:</b> {g.fail}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Compare({ p }: { p: PipelineResult }) {
  const { t } = useT()
  if (p.ranked.length === 0) return <p className="step-muted">{t('No eligible organisations to compare.')}</p>
  const formula = CRITERIA.map((c) => `${p.weights[c.key].toFixed(2)}·${c.letter}`).join(' + ')
  return (
    <div className="compare">
      <p className="tab-lede">
        {t('Two independent ways to rank the same eligible organisations. The weighted score decides; TOPSIS is a cross-check that shows whether the choice depends on how the criteria are scaled. Neither guarantees the best outcome.')}
      </p>
      <div className={cx('agree', p.comparison?.agrees ? 'agree-yes' : 'agree-no')}>
        <strong>{p.comparison?.agrees ? t('Both methods agree') : t('The methods disagree')}</strong>
        <span>{p.comparison?.reason}</span>
      </div>
      <div className="cmp-table" role="table">
        <div className="cmp-row cmp-head" role="row">
          <span>{t('Organisation')}</span>
          <span>{t('Weighted score')}</span>
          <span>{t('TOPSIS closeness')}</span>
          <span>{t('Feasible?')}</span>
        </div>
        {p.ranked.map((c) => (
          <div className="cmp-row" role="row" key={c.e.ngo.id}>
            <span>{c.e.ngo.name}</span>
            <span>
              <b>#{c.rank}</b> {c.score}/100
            </span>
            <span>
              <b>#{c.topsisRank}</b> {c.topsis.toFixed(3)}
            </span>
            <span className={c.feasible ? 'ok' : 'bad'}>{c.feasible ? t(c.feasibility.verdict) : t('No')}</span>
          </div>
        ))}
      </div>
      <p className="formula">
        S = {formula} <em>· {t('each criterion scored 0–1; S shown out of 100')}</em>
      </p>
      {p.stability && p.stability.detail.length > 0 && (
        <>
          <h5>
            {t('Sensitivity: does the winner change if one weight moves ±25%?')}{' '}
            <span className={cx('stab', `stab-${p.stability.label.replace(' ', '-').toLowerCase()}`)}>
              {t(p.stability.label)} · {p.stability.agree}/{p.stability.trials}
            </span>
          </h5>
          <div className="sens">
            {CRITERIA.map((c) => {
              const up = p.stability!.detail.find((d) => d.criterion === c.key && d.change === '+25%')
              const down = p.stability!.detail.find((d) => d.criterion === c.key && d.change === '−25%')
              return (
                <div key={c.key} className="sens-row">
                  <span>{t(c.label)}</span>
                  <span className={up?.same ? 'same' : 'diff'}>+25% → {up?.winnerName}</span>
                  <span className={down?.same ? 'same' : 'diff'}>−25% → {down?.winnerName}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function WeightsTab({ p, onWeights }: { p: PipelineResult; onWeights?: (w: Weights | null) => void }) {
  const { t } = useT()
  const [draft, setDraft] = useState<Record<string, number>>(() =>
    Object.fromEntries(CRITERIA.map((c) => [c.key, Math.round(p.weights[c.key] * 100)])),
  )
  const norm = useMemo(() => normalizeWeights(draft as Partial<Weights>), [draft])
  const sum = CRITERIA.reduce((s, c) => s + (draft[c.key] ?? 0), 0)
  return (
    <div className="weights">
      <p className="tab-lede">
        {t('The default weights are SECOND-SERVE’s policy choice, not a universal truth. Change them to see how the ranking responds. Safety-critical checks stay hard gates whatever the weights.')}
      </p>
      {CRITERIA.map((c) => (
        <label key={c.key} className="wslider">
          <span>
            <b>{c.letter}</b> {t(c.label)}
            <small>{c.means}</small>
          </span>
          <input
            type="range"
            min={0}
            max={60}
            step={1}
            value={draft[c.key]}
            onChange={(e) => setDraft((d) => ({ ...d, [c.key]: Number(e.target.value) }))}
            aria-label={t(c.label)}
          />
          <em>{pct(norm[c.key])}</em>
        </label>
      ))}
      <p className="formula">
        S = {CRITERIA.map((c) => `${norm[c.key].toFixed(2)}·${c.letter}`).join(' + ')}
        {sum !== 100 && <em> · {t('rescaled to add up to 100%')}</em>}
      </p>
      <div className="weights-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => { setDraft(Object.fromEntries(CRITERIA.map((c) => [c.key, Math.round(MATCH_WEIGHTS[c.key] * 100)]))); onWeights?.(null) }}>
          <RotateCcw size={14} /> {t('Reset to defaults (30/25/20/15/10)')}
        </button>
        <button className="btn btn-primary btn-sm" disabled={sum === 0} onClick={() => onWeights?.(norm)}>
          {t('Apply weights')}
        </button>
      </div>
      {p.customWeights && <small>{t('Custom weights are active for all matching, including automatic matching after a scan.')}</small>}
    </div>
  )
}

export function MatchPanel({
  pipeline,
  scanKey,
  onReserve,
  onWeights,
  onHint,
}: {
  pipeline: PipelineResult
  scanKey: number
  onReserve: (c: Candidate) => void
  onWeights?: (w: Weights | null) => void
  onHint?: (h: Hint) => void
}) {
  const { t } = useT()
  const [scanning, setScanning] = useState(true)
  const [showExcluded, setShowExcluded] = useState(true)
  const [tab, setTab] = useState<Tab>('reco')
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
  const tabs: Array<[Tab, string]> = [
    ['reco', t('Recommendation')],
    ['gates', t('Gates ({n} excluded)', { n: p.excluded.length })],
    ['compare', t('Score vs TOPSIS')],
    ['weights', p.customWeights ? t('Weights · custom') : t('Weights')],
  ]

  return (
    <div className="match-panel">
      <div className="mtabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={cx(tab === id && 'on')} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'gates' && <GateMatrix p={p} />}
      {tab === 'compare' && <Compare p={p} />}
      {tab === 'weights' && <WeightsTab key={JSON.stringify(p.weights)} p={p} onWeights={onWeights} />}

      {tab === 'reco' && (
        <>
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

          <Hints hints={p.hints} onHint={onHint} />

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
              <MatchCard key={c.e.ngo.id} c={c} index={i} weights={p.weights} recommended={c === p.recommended} onReserve={() => onReserve(c)} />
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
                  {p.excluded.map((e: NgoEvaluation) => (
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
        </>
      )}
    </div>
  )
}
