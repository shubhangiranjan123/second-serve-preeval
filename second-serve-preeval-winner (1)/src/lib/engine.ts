// SECOND-SERVE rescue engine (pre-evaluation build).
//
// Every function here is PURE: same inputs give the same outputs. There is
// no React, no localStorage and no Date.now() inside; "now" is passed in.
//
// This is a rule-based, explainable scoring system. It is NOT machine
// learning: no model is trained anywhere.

import type { Category, Donation, Ngo, RescueRecord, Runner, StorageType } from '../types'

export const MIN = 60_000

// Platform policy: SECOND-SERVE's own operating assumptions, not food-safety
// regulations. Kept in one place so they can be explained to judges.
export const POLICY = {
  safetyBufferMinutes: 15, // food must arrive at least this long before its deadline
  atRiskMarginMinutes: 30, // spare time below this = "At risk"
  roadFactor: 1.3, // straight-line km x 1.3 ≈ road km in a city
  dispatchLeadMinutes: 10, // assumed time for a runner to reach the donor
  dispatchSpeedKmh: 18, // assumed average city speed
}

// Ranking weights (sum to 1.0). Same as the final build.
export const MATCH_WEIGHTS = { travel: 0.25, compat: 0.3, need: 0.2, safety: 0.15, hours: 0.1 }

// Impact assumptions. These are ILLUSTRATIVE estimates, not measurements.
export const IMPACT = {
  kgPerServing: 0.35, // used when a listing is not measured in kg
  co2ePerKgFood: 2.5, // kg CO2e per kg of food kept out of waste (published figures vary widely)
}

type Point = { lat: number; lng: number }

export function haversineKm(a: Point, b: Point): number {
  const R = 6371
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function travelMinutes(km: number): number {
  const roadKm = km * POLICY.roadFactor
  return Math.max(1, Math.ceil((roadKm / POLICY.dispatchSpeedKmh) * 60))
}

export function minutesBetween(from: number, to: number): number {
  return Math.floor((to - from) / MIN)
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function sameLocalDay(a: number, b: number) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`
}

// ---------------------------------------------------------------------
// Food safety & rescue feasibility (initial screening aid only)
//
//   total rescue time  = remaining preparation time + travel time
//   available time     = minutes left in the safe-consumption window
//   spare time         = available - total - safety buffer
//
//   spare >= 30 min    → Feasible
//   0 <= spare < 30    → At risk
//   spare < 0          → Not feasible
// ---------------------------------------------------------------------
export type Verdict = 'Feasible' | 'At risk' | 'Not feasible'

export type Feasibility = {
  verdict: Verdict
  prepMin: number
  travelMin: number
  totalMin: number
  availableMin: number
  bufferMin: number
  spareMin: number
  expired: boolean
  headline: string
  explanation: string
}

export function assessFeasibility(
  input: { readyAt: number; safeUntil: number; travelEstimate: number },
  now: number,
  travelOverride?: number,
): Feasibility {
  const prepMin = Math.max(0, Math.ceil((input.readyAt - now) / MIN))
  const travelMin = Math.max(0, travelOverride ?? input.travelEstimate)
  const totalMin = prepMin + travelMin
  const availableMin = minutesBetween(now, input.safeUntil)
  const bufferMin = POLICY.safetyBufferMinutes
  const spareMin = availableMin - totalMin - bufferMin
  const expired = availableMin <= 0

  let verdict: Verdict
  let headline: string
  let explanation: string

  if (expired) {
    verdict = 'Not feasible'
    headline = 'Safe window has closed'
    explanation =
      'The donor’s safe-consumption window has already ended. This food should not be redistributed.'
  } else if (spareMin < 0) {
    verdict = 'Not feasible'
    headline = `Short by ${formatDuration(-spareMin)}`
    explanation = `Getting this food ready and across town takes about ${formatDuration(totalMin)}, but only ${formatDuration(availableMin)} of safe time is left once you keep a ${bufferMin}-minute buffer. It would arrive too late to be served safely.`
  } else if (spareMin < POLICY.atRiskMarginMinutes) {
    verdict = 'At risk'
    headline = `Only ${formatDuration(spareMin)} to spare`
    explanation = `The rescue fits inside the safe window, but with very little room. Any delay in packing or traffic could push it past the deadline, so it needs a runner right away.`
  } else {
    verdict = 'Feasible'
    headline = `${formatDuration(spareMin)} of safe time to spare`
    explanation = `Preparation and travel take about ${formatDuration(totalMin)}. Even after a ${bufferMin}-minute safety buffer, the food arrives with comfortable time left to be served.`
  }

  return {
    verdict,
    prepMin,
    travelMin,
    totalMin,
    availableMin: Math.max(0, availableMin),
    bufferMin,
    spareMin,
    expired,
    headline,
    explanation,
  }
}

// ---------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------
export function storageCheck(storage: StorageType, ngo: Ngo) {
  if (storage === 'Chilled' && !ngo.refrigeration)
    return { ok: false, reason: 'Food needs refrigeration; organisation has none' }
  if (storage === 'Frozen' && !ngo.freezer)
    return { ok: false, reason: 'Food needs a freezer; organisation has none' }
  return {
    ok: true,
    reason:
      storage === 'Ambient'
        ? 'Room-temperature food: no special storage needed'
        : storage === 'Chilled'
          ? 'Has refrigeration for chilled food'
          : 'Has a freezer for frozen food',
  }
}

// Capacity is derived every time, never stored as a running counter:
//   remaining = daily capacity − reserved (not yet delivered) − delivered today
export function capacityUsage(ngo: Ngo, donations: Donation[], history: RescueRecord[], now: number) {
  const committed = donations
    .filter((d) => d.status === 'Reserved' && d.ngoId === ngo.id)
    .reduce((s, d) => s + d.servings, 0)
  const deliveredToday = history
    .filter((r) => r.ngoId === ngo.id && sameLocalDay(r.deliveredAt, now))
    .reduce((s, r) => s + r.servings, 0)
  const remaining = Math.max(0, ngo.dailyCapacity - committed - deliveredToday)
  return { committed, deliveredToday, remaining }
}

export function openingCheck(ngo: Ngo, at: number) {
  if (ngo.opensHour <= 0 && ngo.closesHour >= 24) return { open: true, minutesToClose: Infinity }
  const opens = new Date(at)
  opens.setHours(ngo.opensHour, 0, 0, 0)
  const closes = new Date(at)
  closes.setHours(ngo.closesHour, 0, 0, 0)
  const open = at >= opens.getTime() && at < closes.getTime()
  return { open, minutesToClose: open ? minutesBetween(at, closes.getTime()) : 0 }
}

export function hoursLabel(ngo: Ngo) {
  if (ngo.opensHour <= 0 && ngo.closesHour >= 24) return 'Open 24 hours'
  const fmt = (h: number) => {
    const hh = h % 24
    const suffix = hh >= 12 ? 'pm' : 'am'
    return `${hh % 12 === 0 ? 12 : hh % 12}${suffix}`
  }
  return `${fmt(ngo.opensHour)} – ${fmt(ngo.closesHour)}`
}

export type StorageUnit = 'fridge' | 'freezer' | 'dry' | 'shelf'

export type StorageNeed = { unit: StorageUnit; amount: number; measure: 'L' | 'kg' | '' }

const LITRES_PER_SERVING: Record<Category, number> = { Meals: 0.6, Bakery: 0.4, Produce: 0.5, 'Dry rations': 0.3 }

export function storageNeed(d: Pick<Donation, 'storage' | 'category' | 'servings' | 'unit' | 'quantity'>): StorageNeed {
  const litres = d.unit === 'kg' ? Math.ceil(d.quantity * 2.2) : Math.ceil(d.servings * LITRES_PER_SERVING[d.category])
  if (d.storage === 'Chilled') return { unit: 'fridge', amount: litres, measure: 'L' }
  if (d.storage === 'Frozen') return { unit: 'freezer', amount: litres, measure: 'L' }
  if (d.category === 'Dry rations') return { unit: 'dry', amount: d.unit === 'kg' ? d.quantity : Math.ceil(d.servings * IMPACT.kgPerServing), measure: 'kg' }
  return { unit: 'shelf', amount: 0, measure: '' }
}

export function unitCapacity(ngo: Ngo, unit: StorageUnit) {
  if (unit === 'fridge') return ngo.refrigeration ? ngo.fridgeLitres : 0
  if (unit === 'freezer') return ngo.freezer ? ngo.freezerLitres : 0
  if (unit === 'dry') return ngo.dryStoreKg
  return Infinity
}

export function unitUsage(ngo: Ngo, unit: StorageUnit, donations: Donation[], exceptId?: number) {
  return donations
    .filter((d) => d.status === 'Reserved' && d.ngoId === ngo.id && d.id !== exceptId)
    .map(storageNeed)
    .filter((n) => n.unit === unit)
    .reduce((s, n) => s + n.amount, 0)
}

export type CompatKey = 'storage' | 'cold' | 'diet' | 'wants' | 'timing' | 'reheat'

export const COMPAT_WEIGHTS: Record<CompatKey, number> = {
  storage: 0.25,
  cold: 0.15,
  diet: 0.15,
  wants: 0.2,
  timing: 0.15,
  reheat: 0.1,
}

export const COMPAT_LABELS: Record<CompatKey, string> = {
  storage: 'Storage room',
  cold: 'Cold chain',
  diet: 'Diet fit',
  wants: 'Asked for it',
  timing: 'Meal timing',
  reheat: 'Can reheat',
}

export type StorageFit = {
  unit: StorageUnit
  need: number
  measure: 'L' | 'kg' | ''
  capacity: number
  usedBefore: number
  usedAfter: number
}

export function nextMealAfter(ngo: Ngo, at: number): number | null {
  if (ngo.mealHours.length === 0) return null
  const day = new Date(at)
  const candidates: number[] = []
  for (const offset of [0, 1]) {
    for (const h of ngo.mealHours) {
      const t = new Date(day)
      t.setDate(day.getDate() + offset)
      t.setHours(h, 0, 0, 0)
      if (t.getTime() >= at) candidates.push(t.getTime())
    }
  }
  return candidates.length ? Math.min(...candidates) : null
}

export function compatibility(donation: Donation, ngo: Ngo, donations: Donation[], arrival: number) {
  const need = storageNeed(donation)
  const capacity = unitCapacity(ngo, need.unit)
  const usedBefore = need.unit === 'shelf' ? 0 : unitUsage(ngo, need.unit, donations, donation.id)
  const usedAfter = usedBefore + need.amount
  const fit: StorageFit = { unit: need.unit, need: need.amount, measure: need.measure, capacity, usedBefore, usedAfter }

  const storage =
    need.unit === 'shelf' ? 1 : capacity <= 0 ? 0 : clamp01(0.45 + 0.55 * ((capacity - usedAfter) / capacity))

  const cold =
    donation.storage === 'Ambient'
      ? ngo.refrigeration
        ? 1
        : 0.75
      : ngo.refrigeration && ngo.freezer
        ? 1
        : 0.7

  const diet =
    donation.diet === 'Jain'
      ? ngo.jainKitchen
        ? 1
        : 0.45
      : donation.diet === 'Veg'
        ? ngo.acceptsNonVeg
          ? 0.85
          : 1
        : 1

  const wants = ngo.prefers.includes(donation.category) ? 1 : 0.4

  const meal = nextMealAfter(ngo, arrival)
  let timing = 1
  if (donation.category === 'Meals') {
    if (meal === null) timing = 0.5
    else if (meal <= donation.safeUntil) timing = clamp01(1 - (meal - arrival) / (6 * 60 * MIN) * 0.4)
    else timing = ngo.canReheat && ngo.refrigeration ? 0.55 : 0.2
  }

  const reheat = donation.category === 'Meals' ? (ngo.canReheat ? 1 : 0.55) : 1

  const factors: Record<CompatKey, number> = { storage, cold, diet, wants, timing, reheat }
  const score = Math.round(
    100 * (Object.keys(factors) as CompatKey[]).reduce((s, k) => s + factors[k] * COMPAT_WEIGHTS[k], 0),
  )
  return { score, factors, fit, nextMeal: meal }
}

// ---------------------------------------------------------------------
// Smart NGO matching
//   Step 1: hard eligibility gates; any failure excludes the NGO with a reason.
//   Step 2: a weighted 0–100 score ranks the eligible ones.
// ---------------------------------------------------------------------
export type ScoreBreakdown = { travel: number; compat: number; need: number; safety: number; hours: number }

export type NgoEvaluation = {
  ngo: Ngo
  eligible: boolean
  failures: string[]
  reasons: string[]
  warnings: string[]
  score: number
  breakdown: ScoreBreakdown
  km: number
  travelMin: number
  arrival: number
  safetyMarginMin: number
  remaining: number
  compat: number
  compatFactors: Record<CompatKey, number>
  storageFit: StorageFit
  nextMeal: number | null
}

export function evaluateNgo(
  donation: Donation,
  ngo: Ngo,
  donations: Donation[],
  history: RescueRecord[],
  now: number,
): NgoEvaluation {
  const failures: string[] = []
  const reasons: string[] = []
  const warnings: string[] = []

  if (ngo.verification !== 'Verified') failures.push('Not a verified partner yet (pending review)')
  if (!ngo.accepting) failures.push('Not accepting donations right now')

  const storage = storageCheck(donation.storage, ngo)
  if (!storage.ok) failures.push(storage.reason)
  else reasons.push(storage.reason)

  if (donation.diet === 'Non-veg' && !ngo.acceptsNonVeg) failures.push('Serves vegetarian food only')
  else if (donation.diet !== 'Non-veg' && !ngo.acceptsNonVeg) reasons.push('Vegetarian food fits their kitchen')

  const { remaining } = capacityUsage(ngo, donations, history, now)
  if (remaining < donation.servings)
    failures.push(`Only ${remaining} of ${donation.servings} servings of capacity left today`)

  const km = haversineKm(donation, ngo)
  const travelMin = travelMinutes(km)
  const departure = Math.max(now + POLICY.dispatchLeadMinutes * MIN, donation.readyAt)
  const arrival = departure + travelMin * MIN

  const c = compatibility(donation, ngo, donations, arrival)
  const unitName = c.fit.unit === 'fridge' ? 'Fridge' : c.fit.unit === 'freezer' ? 'Freezer' : 'Dry store'
  if (storage.ok && c.fit.unit !== 'shelf' && c.fit.usedAfter > c.fit.capacity)
    failures.push(
      `${unitName} has ${Math.max(0, c.fit.capacity - c.fit.usedBefore)} ${c.fit.measure} free; this needs about ${c.fit.need} ${c.fit.measure}`,
    )
  else if (c.fit.unit !== 'shelf')
    reasons.push(`${unitName}: ${c.fit.need} ${c.fit.measure} fits, ${c.fit.capacity - c.fit.usedAfter} ${c.fit.measure} still free after`)

  const opening = openingCheck(ngo, arrival)
  if (!opening.open) failures.push(`Closed at estimated arrival ${formatClock(arrival)} (${hoursLabel(ngo)})`)

  const safetyMarginMin = minutesBetween(arrival + POLICY.safetyBufferMinutes * MIN, donation.safeUntil)
  if (safetyMarginMin < 0)
    failures.push(
      `Would arrive ${Math.abs(safetyMarginMin)} min too late for safe use (includes ${POLICY.safetyBufferMinutes}-min buffer)`,
    )

  const breakdown: ScoreBreakdown = {
    travel: clamp01(1 - travelMin / 45),
    compat: c.score / 100,
    need: ngo.dailyCapacity > 0 ? clamp01(remaining / ngo.dailyCapacity) : 0,
    safety: clamp01(safetyMarginMin / 120),
    hours: opening.open ? clamp01(opening.minutesToClose / 120) : 0,
  }

  const score = Math.round(
    100 *
      (MATCH_WEIGHTS.travel * breakdown.travel +
        MATCH_WEIGHTS.compat * breakdown.compat +
        MATCH_WEIGHTS.need * breakdown.need +
        MATCH_WEIGHTS.safety * breakdown.safety +
        MATCH_WEIGHTS.hours * breakdown.hours),
  )

  reasons.push(`${km.toFixed(1)} km away, about ${travelMin} min by road (estimate)`)
  reasons.push(`${remaining} of ${ngo.dailyCapacity} servings of capacity left today`)
  if (safetyMarginMin >= 0) reasons.push(`Arrives with ${formatDuration(safetyMarginMin)} of safe time to spare`)
  if (opening.open)
    reasons.push(
      opening.minutesToClose === Infinity
        ? 'Open 24 hours'
        : `Open for ${formatDuration(opening.minutesToClose)} after arrival`,
    )
  if (ngo.prefers.includes(donation.category)) reasons.push(`They asked for ${donation.category.toLowerCase()}`)
  if (donation.category === 'Meals' && c.nextMeal !== null && c.nextMeal <= donation.safeUntil)
    reasons.push(`Served at their ${formatClock(c.nextMeal)} meal, inside the safe window`)

  if (safetyMarginMin >= 0 && safetyMarginMin < POLICY.atRiskMarginMinutes)
    warnings.push('Tight safety margin: assign a runner immediately')
  if (remaining >= donation.servings && remaining - donation.servings < ngo.dailyCapacity * 0.1)
    warnings.push("This will fill almost all of today's capacity")
  if (donation.category === 'Meals' && c.nextMeal !== null && c.nextMeal > donation.safeUntil)
    warnings.push(`Next meal service ${formatClock(c.nextMeal)} is after the safe window`)
  if (donation.diet === 'Jain' && !ngo.jainKitchen) warnings.push('Kitchen is not Jain-separated')
  if (donation.storage !== 'Ambient') warnings.push('Keep the food cold in transit')

  return {
    ngo,
    eligible: failures.length === 0,
    failures,
    reasons,
    warnings,
    score,
    breakdown,
    km,
    travelMin,
    arrival,
    safetyMarginMin,
    remaining,
    compat: c.score,
    compatFactors: c.factors,
    storageFit: c.fit,
    nextMeal: c.nextMeal,
  }
}

export type MatchResult = {
  eligible: NgoEvaluation[]
  excluded: NgoEvaluation[]
  best: NgoEvaluation | null
}

export function matchNgos(
  donation: Donation,
  ngos: Ngo[],
  donations: Donation[],
  history: RescueRecord[],
  now: number,
): MatchResult {
  const all = ngos.map((n) => evaluateNgo(donation, n, donations, history, now))
  const eligible = all
    .filter((e) => e.eligible)
    .sort((a, b) => b.score - a.score || a.travelMin - b.travelMin)
  const excluded = all.filter((e) => !e.eligible)
  return { eligible, excluded, best: eligible[0] ?? null }
}

// ---------------------------------------------------------------------
// Runner suggestion: nearest on-shift runner who is not already on a job.
// ---------------------------------------------------------------------
export type RunnerOption = { runner: Runner; km: number; busy: boolean; etaMin: number }

export function runnerOptions(donation: Donation, runners: Runner[], donations: Donation[]): RunnerOption[] {
  return runners
    .map((runner) => {
      const busy = donations.some(
        (d) => d.id !== donation.id && d.runnerId === runner.id && d.status === 'Reserved',
      )
      const km = haversineKm(runner, donation)
      return { runner, km, busy, etaMin: travelMinutes(km) }
    })
    .sort((a, b) => {
      const rank = (o: RunnerOption) => (o.runner.onShift && !o.busy ? 0 : 1)
      return rank(a) - rank(b) || a.km - b.km
    })
}

// ---------------------------------------------------------------------
// Impact (estimates)
// ---------------------------------------------------------------------
export function estimateWeightKg(d: Pick<Donation, 'unit' | 'quantity' | 'servings'>) {
  if (d.unit === 'kg') return d.quantity
  return Math.round(d.servings * IMPACT.kgPerServing * 10) / 10
}

export function impactTotals(history: RescueRecord[]) {
  const meals = history.reduce((s, r) => s + r.servings, 0)
  const kg = Math.round(history.reduce((s, r) => s + r.weightKg, 0) * 10) / 10
  const co2e = Math.round(kg * IMPACT.co2ePerKgFood)
  return { meals, kg, deliveries: history.length, co2e }
}
