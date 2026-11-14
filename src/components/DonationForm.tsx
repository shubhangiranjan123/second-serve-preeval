import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Loader2, Wand2, X } from 'lucide-react'
import type { AppState, Category, Diet, Donation, StorageType } from '../types'
import { AREAS, CATEGORIES, defaultsFor, findArea } from '../data/demoData'
import { MIN, assessFeasibility, matchNgos } from '../lib/engine'
import type { NewDonationInput } from '../lib/useRescueStore'
import { FeasibilityMeter } from './FeasibilityMeter'
import { cx } from './ui'

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
}

const SAMPLE: FormState = {
  name: 'Chole kulche & jeera rice',
  donor: 'Saffron Courtyard Hotel',
  category: 'Meals',
  servings: '35',
  quantity: '35',
  unit: 'servings',
  area: 'Sector 17',
  address: 'Service gate, SCO 61, Sector 17-C',
  storage: 'Chilled',
  diet: 'Veg',
  description: 'Conference-lunch surplus, untouched. Packed in sealed foil trays at 1:45 pm.',
  prepMinutes: '15',
  travelEstimate: '20',
  safeHours: '3',
}

const CHECKLIST = [
  'Kept hot or chilled since cooking — never left out at room temperature',
  'Packed in clean, covered, food-grade containers',
  'Not served to guests or plated before',
  'Allergens (nuts, dairy, gluten) noted in the description',
]

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
          {o}
        </button>
      ))}
    </div>
  )
}

export function DonationForm({
  state,
  now,
  onClose,
  onSubmit,
}: {
  state: AppState
  now: number
  onClose: () => void
  onSubmit: (input: NewDonationInput) => void
}) {
  const [f, setF] = useState<FormState>(EMPTY)
  const [checks, setChecks] = useState<boolean[]>(CHECKLIST.map(() => false))
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)

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

  const errors: Partial<Record<keyof FormState | 'checks', string>> = {}
  if (!f.name.trim()) errors.name = 'Name the food'
  if (!f.donor.trim()) errors.donor = 'Who is donating?'
  if (!(servings >= 1 && servings <= 2000)) errors.servings = '1–2000'
  if (!(quantity > 0)) errors.quantity = 'Above 0'
  if (!(prep >= 0 && prep <= 240)) errors.prepMinutes = '0–240 min'
  if (!(travel >= 1 && travel <= 180)) errors.travelEstimate = '1–180 min'
  if (!(safeHours > 0 && safeHours <= 48)) errors.safeHours = 'Up to 48 h'
  if (!f.address.trim()) errors.address = 'Where should the runner go?'
  if (!checks.every(Boolean)) errors.checks = 'Confirm every safe-handling point'
  const valid = Object.keys(errors).length === 0

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
    setTimeout(() => {
      onSubmit({
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
      })
    }, 450)
  }

  const err = (k: keyof typeof errors) => touched && errors[k] ? <span className="field-err">{errors[k]}</span> : null

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
            <span className="drawer-kicker">New listing</span>
            <h2>
              List surplus <em>food</em>
            </h2>
          </div>
          <div className="modal-head-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setF(SAMPLE)
                setChecks(CHECKLIST.map(() => true))
              }}
            >
              <Wand2 size={14} /> Fill sample
            </button>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>
        </header>

        <div className="form-grid">
          <div className="form-fields">
            <fieldset>
              <legend>What is it?</legend>
              <label className="field span-2">
                <span>Food name</span>
                <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Veg pulao & dal tadka" />
                {err('name')}
              </label>
              <label className="field span-2">
                <span>Donor / restaurant</span>
                <input value={f.donor} onChange={(e) => set('donor', e.target.value)} placeholder="e.g. The Green Kitchen" />
                {err('donor')}
              </label>
              <div className="field span-2">
                <span>Category</span>
                <Segmented name="Category" value={f.category} options={CATEGORIES} onChange={changeCategory} />
              </div>
              <label className="field">
                <span>Servings</span>
                <input inputMode="numeric" value={f.servings} onChange={(e) => set('servings', e.target.value)} />
                {err('servings')}
              </label>
              <label className="field">
                <span>Quantity</span>
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
                <span>Dietary</span>
                <Segmented name="Dietary" value={f.diet} options={['Veg', 'Jain', 'Non-veg'] as const} onChange={(v) => set('diet', v)} />
              </div>
              <div className="field">
                <span>Storage</span>
                <Segmented name="Storage" value={f.storage} options={['Ambient', 'Chilled', 'Frozen'] as const} onChange={(v) => set('storage', v)} />
              </div>
            </fieldset>

            <fieldset>
              <legend>Timing</legend>
              <label className="field">
                <span>Preparation time</span>
                <div className="input-suffix"><input inputMode="numeric" value={f.prepMinutes} onChange={(e) => set('prepMinutes', e.target.value)} /><em>min</em></div>
                <small>Time to pack and hand over</small>
                {err('prepMinutes')}
              </label>
              <label className="field">
                <span>Travel time estimate</span>
                <div className="input-suffix"><input inputMode="numeric" value={f.travelEstimate} onChange={(e) => set('travelEstimate', e.target.value)} /><em>min</em></div>
                <small>Your best guess</small>
                {err('travelEstimate')}
              </label>
              <label className="field span-2">
                <span>Safe-consumption window</span>
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
                <small>How long from now the food stays safe to eat, in your judgement</small>
                {err('safeHours')}
              </label>
            </fieldset>

            <fieldset>
              <legend>Pickup</legend>
              <label className="field">
                <span>Area</span>
                <select value={f.area} onChange={(e) => set('area', e.target.value)}>
                  {AREAS.map((a) => (
                    <option key={a.name}>{a.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Pickup point</span>
                <input value={f.address} onChange={(e) => set('address', e.target.value)} placeholder="Shop / gate / landmark" />
                {err('address')}
              </label>
              <label className="field span-2">
                <span>Description</span>
                <textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="When was it cooked? How is it packed? Any allergens?" />
              </label>
            </fieldset>

            <fieldset className="checklist">
              <legend>Safe-handling checklist</legend>
              {CHECKLIST.map((c, i) => (
                <label key={c} className={cx('check', checks[i] && 'check-on')}>
                  <input
                    type="checkbox"
                    checked={checks[i]}
                    onChange={() => setChecks((p) => p.map((v, j) => (j === i ? !v : v)))}
                  />
                  <span className="check-box"><Check size={13} strokeWidth={3} /></span>
                  {c}
                </label>
              ))}
              {err('checks')}
            </fieldset>
          </div>

          <aside className="form-preview">
            <div className="preview-sticky">
              <span className="preview-label">Live feasibility check</span>
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
                          <br />Likely best match: <b>{preview.best}</b>
                        </>
                      )}
                    </span>
                  </div>
                </>
              ) : (
                <p className="preview-explain">Fill in timing to see whether this rescue can make it in time.</p>
              )}
              <p className="feas-disclaimer">Screening aid only — not a food-safety certification.</p>
            </div>
          </aside>
        </div>

        <footer className="modal-foot">
          <span className="foot-hint">{touched && !valid ? 'A few details still need attention.' : 'Listings are saved in this browser.'}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <><Loader2 size={16} className="spin" /> Listing…</> : 'List & find matches'}
          </button>
        </footer>
      </form>
    </div>
  )
}
