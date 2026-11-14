import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, Check, CircleDashed, Loader2, Sparkles, X, XCircle } from 'lucide-react'
import type { AppState, Category, Diet, Donation, Packaging, RuleCheck, Screening, StorageType } from '../types'
import { AREAS, CATEGORIES, defaultsFor, findArea } from '../data/demoData'
import { MIN, assessFeasibility, matchNgos } from '../lib/engine'
import type { NewDonationInput, ScreenedExtras } from '../lib/useRescueStore'
import { OUTCOME_COPY, editedFields, verifyDonation, type ScanInput, type Suggestion } from '../lib/verification'
import type { ScanHandoff } from './FoodScan'
import { FeasibilityMeter } from './FeasibilityMeter'
import { cx } from './ui'
import { useT } from '../lib/i18n'

type FormState = {
  name: string
  donor: string
  category: Category
  servings: string
  quantity: string
  unit: string
  area: string
  address: string
  storage: StorageType
  diet: Diet
  description: string
  prepMinutes: string
  travelEstimate: string
  safeHours: string
  cookedAgo: string // minutes since cooking / preparation (new, optional for manual listings)
  packaging: Packaging | ''
}

const EMPTY: FormState = {
  name: '',
  donor: '',
  category: 'Meals',
  servings: '20',
  quantity: '20',
  unit: 'servings',
  area: 'Sector 17',
  address: '',
  storage: 'Chilled',
  diet: 'Veg',
  description: '',
  prepMinutes: '15',
  travelEstimate: '20',
  safeHours: '3',
  cookedAgo: '',
  packaging: '',
}

const CHECKLIST = [
  'Kept hot or chilled since cooking — never left out at room temperature',
  'Packed in clean, covered, food-grade containers',
  'Not served to guests or plated before',
  'Allergens (nuts, dairy, gluten) noted in the description',
]

const CHECKS_KEY = 'second-serve-checklist-draft'

const PACKAGING_FROM_AI: Record<string, Packaging | ''> = { sealed: 'Sealed', covered: 'Covered', open: 'Open', unclear: '' }

// Turn the AI reading into starting values for the form. Only fields the
// model actually gave are filled; everything else keeps its normal default.
function prefillFrom(h: ScanHandoff | undefined): { form: FormState; suggested: Suggestion } {
  if (!h || h.kind !== 'scan') return { form: EMPTY, suggested: {} }
  const s = h.scan
  const category: Category = s.category !== 'Unknown' ? s.category : EMPTY.category
  const d = defaultsFor(category)
  const form: FormState = { ...EMPTY, category, unit: d.unit, storage: d.storage, packaging: PACKAGING_FROM_AI[s.packaging] }
  const suggested: Suggestion = {}
  if (s.dishName) form.name = suggested.name = s.dishName
  if (s.category !== 'Unknown') suggested.category = category
  if (s.dietGuess !== 'Unknown') form.diet = suggested.diet = s.dietGuess
  if (s.quantity.inferable) {
    if (s.quantity.servings) form.servings = suggested.servings = String(s.quantity.servings)
    if (s.quantity.amount && s.quantity.unit) {
      form.quantity = suggested.quantity = String(s.quantity.amount)
      form.unit = suggested.unit = s.quantity.unit
    } else if (s.quantity.servings) {
      form.quantity = String(s.quantity.servings)
      form.unit = 'servings'
    }
  }
  if (s.description) form.description = suggested.description = s.description
  return { form, suggested }
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  name,
}: {
  value: T
  options: readonly T[]
  onChange: (v: T) => void
  name: string
}) {
  const { t } = useT()
  return (
    <div className="segmented" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === o}
          key={o}
          className={cx(value === o && 'on')}
          onClick={() => onChange(o)}
        >
          {t(o)}
        </button>
      ))}
    </div>
  )
}

const RULE_ICON: Record<RuleCheck['status'], ReactNode> = {
  pass: <Check size={14} strokeWidth={3} />,
  warn: <AlertTriangle size={14} />,
  fail: <XCircle size={14} />,
  missing: <CircleDashed size={14} />,
}

export function RuleList({ rules }: { rules: RuleCheck[] }) {
  const { t } = useT()
  return (
    <ul className="rule-list">
      {rules.map((r) => (
        <li key={r.id} className={cx('rule', `rule-${r.status}`, r.blocking && 'rule-blocking')}>
          <span className="rule-icon">{RULE_ICON[r.status]}</span>
          <div>
            <strong>
              {t(r.label)} <em>{t(r.source)}</em>
            </strong>
            <span>{r.detail}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

function AiTag({ field, suggested, f }: { field: keyof Suggestion; suggested: Suggestion; f: FormState }) {
  const { t } = useT()
  if (suggested[field] === undefined) return null
  const edited = String(suggested[field]).trim() !== String(f[field] ?? '').trim()
  return <i className={cx('ai-tag', edited && 'ai-tag-edited')}>{edited ? t('edited') : t('AI')}</i>
}

export function DonationForm({
  state,
  now,
  onClose,
  onSubmit,
  scanned,
  onRescan,
}: {
  state: AppState
  now: number
  onClose: () => void
  onSubmit: (input: NewDonationInput, extras?: ScreenedExtras) => void
  scanned: ScanHandoff // every listing starts from a photo scan (or its no-AI fallback)
  onRescan?: () => void
}) {
  const { t } = useT()
  const initial = useMemo(() => prefillFrom(scanned), [scanned])
  const [f, setF] = useState<FormState>(initial.form)
  // Checklist ticks survive closing/reopening the form (cleared on publish).
  const [checks, setChecks] = useState<boolean[]>(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(CHECKS_KEY) ?? 'null')
      if (Array.isArray(saved) && saved.length === CHECKLIST.length && saved.every((v) => typeof v === 'boolean')) return saved
    } catch {
      /* corrupt or blocked storage: start unticked */
    }
    return CHECKLIST.map(() => false)
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(CHECKS_KEY, JSON.stringify(checks))
    } catch {
      /* storage blocked: ticks just won't persist */
    }
  }, [checks])
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const suggested = initial.suggested

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }))

  const num = (s: string) => (s.trim() === '' ? NaN : Number(s))
  const servings = num(f.servings)
  const quantity = num(f.quantity)
  const prep = num(f.prepMinutes)
  const travel = num(f.travelEstimate)
  const safeHours = num(f.safeHours)
  const cookedAgo = num(f.cookedAgo)

  const errors: Partial<Record<keyof FormState | 'checks', string>> = {}
  if (!f.name.trim()) errors.name = 'Name the food'
  if (!f.donor.trim()) errors.donor = 'Who is donating?'
  if (!(servings >= 1 && servings <= 2000)) errors.servings = '1–2000'
  if (!(quantity > 0)) errors.quantity = 'Above 0'
  if (!(prep >= 0 && prep <= 240)) errors.prepMinutes = '0–240 min'
  if (!(travel >= 1 && travel <= 180)) errors.travelEstimate = '1–180 min'
  if (!(safeHours > 0 && safeHours <= 48)) errors.safeHours = 'Up to 48 h'
  if (!f.address.trim()) errors.address = 'Where should the runner go?'
  if (f.cookedAgo.trim() !== '' && !(cookedAgo >= 0 && cookedAgo <= 72 * 60)) errors.cookedAgo = '0–4320 min'
  else if (f.cookedAgo.trim() === '') errors.cookedAgo = 'When was it cooked or prepared?'
  if (!f.packaging) errors.packaging = 'How is it packed?'
  if (!checks.every(Boolean)) errors.checks = 'Confirm every safe-handling point'

  // Engine 1, step 2: rules run live on every keystroke.
  const scanInput: ScanInput =
    scanned.kind === 'scan' ? { kind: 'scan', scan: scanned.scan, photoCount: scanned.thumbs.length } : { kind: 'error', message: scanned.message }
  const verification = verifyDonation(scanInput, {
    name: f.name,
    category: f.category,
    diet: f.diet,
    storage: f.storage,
    packaging: f.packaging || null,
    cookedMinutesAgo: f.cookedAgo.trim() === '' ? NaN : cookedAgo,
    prepMinutes: prep >= 0 ? prep : 0,
    safeHours: safeHours > 0 ? safeHours : 0,
    servings: servings > 0 ? servings : 0,
    checklistDone: checks.every(Boolean),
  })
  const blockedBySafety = verification.outcome === 'reject'
  const valid = Object.keys(errors).length === 0 && !blockedBySafety

  // Live preview: the same engine that runs after submission.
  const preview = useMemo(() => {
    if (!(prep >= 0) || !(travel >= 0) || !(safeHours > 0)) return null
    const readyAt = now + prep * MIN
    const safeUntil = now + Math.round(safeHours * 60) * MIN
    const feas = assessFeasibility({ readyAt, safeUntil, travelEstimate: travel }, now)
    const area = findArea(f.area)
    const temp: Donation = {
      id: -999,
      name: f.name,
      donor: f.donor,
      category: f.category,
      servings: servings > 0 ? servings : 1,
      quantity,
      unit: f.unit,
      area: f.area,
      address: f.address,
      lat: area.lat,
      lng: area.lng,
      storage: f.storage,
      diet: f.diet,
      description: '',
      createdAt: now,
      prepMinutes: prep,
      travelEstimate: travel,
      readyAt,
      safeUntil,
      status: 'Available',
      ngoId: null,
      runnerId: null,
      stage: 'Pending',
      timeline: [],
    }
    const m = matchNgos(temp, state.ngos, state.donations, state.history, now)
    return { feas, eligible: m.eligible.length, best: m.best?.ngo.name ?? null }
  }, [f, servings, quantity, prep, travel, safeHours, now, state])

  function changeCategory(c: Category) {
    const d = defaultsFor(c)
    setF((p) => ({ ...p, category: c, unit: d.unit, storage: d.storage }))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!valid || busy) return
    setBusy(true)
    const input: NewDonationInput = {
      name: f.name.trim(),
      donor: f.donor.trim(),
      category: f.category,
      servings,
      quantity,
      unit: f.unit,
      area: f.area,
      address: f.address.trim(),
      storage: f.storage,
      diet: f.diet,
      description: f.description.trim(),
      prepMinutes: prep,
      travelEstimate: travel,
      safeHours,
    }
    const extras: ScreenedExtras = {}
    if (f.cookedAgo.trim() !== '') extras.preparedAt = now - Math.round(cookedAgo) * MIN
    if (f.packaging) extras.packaging = f.packaging
    if (verification.outcome === 'pass' || verification.outcome === 'review') {
      const screening: Screening = {
        outcome: verification.outcome,
        visual: verification.visual,
        rules: verification.rules,
        reviewReasons: verification.reviewReasons,
        screenedAt: now,
        ai:
          scanned.kind === 'scan'
            ? {
                provider: scanned.meta.provider,
                model: scanned.meta.model,
                latencyMs: scanned.meta.latencyMs,
                dishName: scanned.scan.dishName,
                items: scanned.scan.items,
                category: scanned.scan.category,
                dietGuess: scanned.scan.dietGuess,
                packaging: scanned.scan.packaging,
                confidence: scanned.scan.confidence,
                concerns: scanned.scan.concerns,
                reviewNotes: scanned.scan.reviewNotes,
              }
            : null,
        aiError: scanned.kind === 'error' ? scanned.message : undefined,
        edited: editedFields(suggested, { ...f, servings: f.servings, quantity: f.quantity }),
        photo: scanned.thumbs[0],
        photos: scanned.thumbs,
      }
      extras.screening = screening
    }
    try {
      sessionStorage.removeItem(CHECKS_KEY)
    } catch {
      /* ignore */
    }
    setTimeout(() => onSubmit(input, extras), 450)
  }

  const err = (k: keyof typeof errors) => (touched && errors[k] ? <span className="field-err">{errors[k]}</span> : null)
  const outcome = OUTCOME_COPY[verification.outcome]
  const submitLabel =
    verification.outcome === 'review'
      ? t('Send for review')
      : verification.outcome === 'reject'
        ? t('Can’t publish')
        : t('Publish & match')

  const ai = scanned?.kind === 'scan' ? scanned : null

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form
        className="modal form-modal"
        role="dialog"
        aria-modal="true"
        aria-label="List surplus food"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        noValidate
      >
        <header className="modal-head">
          <div>
            <span className="drawer-kicker">{t('Scan & donate')}</span>
            <h2>
              {t('Check the details')}
            </h2>
          </div>
          <div className="modal-head-actions">
            {onRescan && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onRescan}>
                {t('Retake photo')}
              </button>
            )}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>
        </header>

        <div className="form-grid">
          <div className="form-fields">
            {(
              <section className={cx('ai-reading', !ai && 'ai-reading-off')} aria-label={t('AI reading')}>
                <div className={cx('ai-thumbs', `n${Math.min(4, scanned.thumbs.length)}`)}>
                  {scanned.thumbs.length ? scanned.thumbs.map((th, i) => <img key={i} src={th} alt={t('Photo {n}', { n: i + 1 })} />) : <span className="ai-thumb-empty" />}
                </div>
                {ai ? (
                  <div>
                    <span className="ai-reading-kicker">
                      <Sparkles size={13} /> {scanned.thumbs.length === 1 ? t('What the AI sees') : t('What the AI sees in {n} photos', { n: scanned.thumbs.length })} · {ai.meta.model}
                    </span>
                    <strong>{ai.scan.dishName || t('Unidentified food')}</strong>
                    {ai.scan.items.length > 0 && (
                      <div className="ai-items">
                        {ai.scan.items.map((i) => (
                          <span key={i}>{i}</span>
                        ))}
                      </div>
                    )}
                    <div className="ai-conf">
                      {(['identification', 'condition', 'overall'] as const).map((k) => (
                        <div key={k}>
                          <span>{t(k === 'identification' ? 'What it is' : k === 'condition' ? 'Condition' : 'Overall')}</span>
                          <i><b style={{ width: `${Math.round(ai.scan.confidence[k] * 100)}%` }} /></i>
                          <em>{Math.round(ai.scan.confidence[k] * 100)}%</em>
                        </div>
                      ))}
                    </div>
                    {ai.scan.quantity.inferable && ai.scan.quantity.basis && <small>{t('Quantity estimate')}: {ai.scan.quantity.basis}</small>}
                    {ai.scan.reviewNotes.length > 0 && <small>{t('To double-check')}: {ai.scan.reviewNotes.join(' · ')}</small>}
                  </div>
                ) : (
                  <div>
                    <span className="ai-reading-kicker">{t('No AI reading')}</span>
                    <strong>{t('Fill the details in yourself')}</strong>
                    <small>{scanned.kind === 'error' ? scanned.message : ''} {t('A coordinator will inspect this food before it can be matched.')}</small>
                  </div>
                )}
              </section>
            )}

            <fieldset>
              <legend>{t('What is it?')}</legend>
              <label className="field span-2">
                <span>{t('Food name')} <AiTag field="name" suggested={suggested} f={f} /></span>
                <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Veg pulao & dal tadka" />
                {err('name')}
              </label>
              <label className="field span-2">
                <span>{t('Donor / restaurant')}</span>
                <input value={f.donor} onChange={(e) => set('donor', e.target.value)} placeholder="e.g. The Green Kitchen" />
                {err('donor')}
              </label>
              <div className="field span-2">
                <span>{t('Category')} <AiTag field="category" suggested={suggested} f={f} /></span>
                <Segmented name="Category" value={f.category} options={CATEGORIES} onChange={changeCategory} />
              </div>
              <label className="field">
                <span>{t('Servings')} <AiTag field="servings" suggested={suggested} f={f} /></span>
                <input inputMode="numeric" value={f.servings} onChange={(e) => set('servings', e.target.value)} />
                {err('servings')}
              </label>
              <label className="field">
                <span>{t('Quantity')} <AiTag field="quantity" suggested={suggested} f={f} /></span>
                <div className="input-suffix">
                  <input inputMode="decimal" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />
                  <select value={f.unit} onChange={(e) => set('unit', e.target.value)} aria-label="Unit">
                    {['servings', 'boxes', 'items', 'kg'].map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </div>
                {err('quantity')}
              </label>
              <div className="field">
                <span>{t('Dietary')} <AiTag field="diet" suggested={suggested} f={f} /></span>
                <Segmented name="Dietary" value={f.diet} options={['Veg', 'Jain', 'Non-veg'] as const} onChange={(v) => set('diet', v)} />
                {ai && ai.scan.dietGuess === 'Unknown' && <small>{t('The AI couldn’t tell. Please confirm.')}</small>}
              </div>
              <div className="field">
                <span>{t('Storage')}</span>
                <Segmented name="Storage" value={f.storage} options={['Ambient', 'Chilled', 'Frozen'] as const} onChange={(v) => set('storage', v)} />
              </div>
              <div className="field span-2">
                <span>{t('Packaging')}</span>
                <Segmented name="Packaging" value={f.packaging as Packaging} options={['Sealed', 'Covered', 'Open'] as const} onChange={(v) => set('packaging', v)} />
                {err('packaging')}
              </div>
            </fieldset>

            <fieldset>
              <legend>{t('Timing')}</legend>
              <label className="field span-2">
                <span>{t('Cooked or prepared')}</span>
                <div className="cooked-row">
                  <div className="input-suffix narrow"><input inputMode="numeric" value={f.cookedAgo} onChange={(e) => set('cookedAgo', e.target.value)} placeholder="60" /><em>{t('min ago')}</em></div>
                  {[30, 60, 120, 180].map((m) => (
                    <button type="button" key={m} className={cx('chip-mini', f.cookedAgo === String(m) && 'on')} onClick={() => set('cookedAgo', String(m))}>
                      {m < 60 ? `${m} min` : `${m / 60} h`}
                    </button>
                  ))}
                </div>
                <small>{t('Used for the time-and-temperature rule')}</small>
                {err('cookedAgo')}
              </label>
              <label className="field">
                <span>{t('Preparation time')}</span>
                <div className="input-suffix"><input inputMode="numeric" value={f.prepMinutes} onChange={(e) => set('prepMinutes', e.target.value)} /><em>min</em></div>
                <small>{t('Time to pack and hand over')}</small>
                {err('prepMinutes')}
              </label>
              <label className="field">
                <span>{t('Travel time estimate')}</span>
                <div className="input-suffix"><input inputMode="numeric" value={f.travelEstimate} onChange={(e) => set('travelEstimate', e.target.value)} /><em>min</em></div>
                <small>{t('Your best guess')}</small>
                {err('travelEstimate')}
              </label>
              <label className="field span-2">
                <span>{t('Safe-consumption window')}</span>
                <div className="range-row">
                  <input
                    type="range"
                    min={0.5}
                    max={12}
                    step={0.25}
                    value={Number.isFinite(safeHours) ? Math.min(12, safeHours) : 3}
                    onChange={(e) => set('safeHours', e.target.value)}
                    aria-label="Safe window in hours"
                  />
                  <div className="input-suffix narrow"><input inputMode="decimal" value={f.safeHours} onChange={(e) => set('safeHours', e.target.value)} /><em>h</em></div>
                </div>
                <small>{t('How long from now the food stays safe to eat, in your judgement')}</small>
                {err('safeHours')}
              </label>
            </fieldset>

            <fieldset>
              <legend>{t('Pickup')}</legend>
              <label className="field">
                <span>{t('Area')}</span>
                <select value={f.area} onChange={(e) => set('area', e.target.value)}>
                  {AREAS.map((a) => (
                    <option key={a.name}>{a.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t('Pickup point')}</span>
                <input value={f.address} onChange={(e) => set('address', e.target.value)} placeholder="Shop / gate / landmark" />
                {err('address')}
              </label>
              <label className="field span-2">
                <span>{t('Description')} <AiTag field="description" suggested={suggested} f={f} /></span>
                <textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="When was it cooked? How is it packed? Any allergens?" />
              </label>
            </fieldset>

            <fieldset className="checklist">
              <legend>{t('Safe-handling checklist')}</legend>
              {CHECKLIST.map((c, i) => (
                <label key={c} className={cx('check', checks[i] && 'check-on')}>
                  <input
                    type="checkbox"
                    checked={checks[i]}
                    onChange={() => setChecks((p) => p.map((v, j) => (j === i ? !v : v)))}
                  />
                  <span className="check-box"><Check size={13} strokeWidth={3} /></span>
                  {t(c)}
                </label>
              ))}
              {err('checks')}
            </fieldset>
          </div>

          <aside className="form-preview">
            <div className="preview-sticky">
              {(
                <div className={cx('screen-card', `screen-${verification.outcome}`)} aria-live="polite">
                  <span className="preview-label">{t('Safety screening')}</span>
                  {(
                    <span className={cx('visual-verdict', `vv-${verification.visual.replace(/\s/g, '-').toLowerCase()}`)}>
                      {t(verification.visual)}
                    </span>
                  )}
                  <strong>{t(outcome.title)}</strong>
                  <p>{t(outcome.body)}</p>
                  <RuleList rules={verification.rules} />
                </div>
              )}
              <span className="preview-label">{t('Live feasibility check')}</span>
              {preview ? (
                <>
                  <FeasibilityMeter f={preview.feas} compact />
                  <p className="preview-explain">{preview.feas.explanation}</p>
                  <div className="preview-match">
                    <strong>{preview.eligible}</strong>
                    <span>
                      {preview.eligible === 1 ? 'organisation passes' : 'organisations pass'} every matching gate
                      {preview.best && (
                        <>
                          <br />{t('Likely best match:')} <b>{preview.best}</b>
                        </>
                      )}
                    </span>
                  </div>
                </>
              ) : (
                <p className="preview-explain">{t('Fill in timing to see whether this rescue can make it in time.')}</p>
              )}
              <p className="feas-disclaimer">{t('Screening aid only — not a food-safety certification.')}</p>
            </div>
          </aside>
        </div>

        <footer className="modal-foot">
          <span className="foot-hint">
            {blockedBySafety
              ? t('This food fails a safety rule (see the screening panel).')
              : touched && !valid
                ? t('A few details still need attention.')
                : t('Listings are saved in this browser.')}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('Cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || blockedBySafety}>
            {busy ? <><Loader2 size={16} className="spin" /> {t('Listing…')}</> : submitLabel}
          </button>
        </footer>
      </form>
    </div>
  )
}
