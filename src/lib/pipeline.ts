// Engine 2: Intelligent NGO matching & rescue feasibility.
//
// This file does NOT replace engine.ts. It runs the existing engine as
// Stage 1 + 2 and adds explainability and timing around it:
//
//   Stage 1  Hard eligibility     → engine.evaluateNgo(): the 7 gates below.
//                                    Any failure excludes the NGO, whatever
//                                    its score would have been.
//   Stage 2  Weighted ranking      → S = Σ wₖ·xₖ over the 5 criteria from
//                                    engine.evaluateNgo().breakdown (each 0–1).
//                                    Default weights = engine.MATCH_WEIGHTS;
//                                    a coordinator can change them.
//   Stage 3  TOPSIS comparison     → an independent ranking of the same NGOs,
//                                    plus a weight-sensitivity test. Shown
//                                    side by side; never overrides Stage 2.
//   Stage 4  Rescue feasibility    → each ranked NGO is re-timed with the REAL
//                                    pickup (nearest free runner's ETA) using
//                                    engine.assessFeasibility().
//   Stage 5  Recommendation        → first NGO in score order that is
//                                    feasible, with alternatives, exclusions,
//                                    reasons, and hints when nothing fits.
//
// Everything here is deterministic optimisation, not machine learning.

import type { Donation, Ngo, RescueRecord, Runner } from '../types'
import {
  MATCH_WEIGHTS,
  MIN,
  POLICY,
  assessFeasibility,
  formatClock,
  formatDuration,
  hoursLabel,
  matchNgos,
  openingCheck,
  runnerOptions,
  type Feasibility,
  type NgoEvaluation,
  type RunnerOption,
  type ScoreBreakdown,
} from './engine'

export type Criterion = keyof ScoreBreakdown
export type Weights = Record<Criterion, number>

export const CRITERIA: Array<{ key: Criterion; label: string; type: 'benefit' | 'cost'; letter: string; means: string }> = [
  { key: 'compat', label: 'Compatibility', type: 'benefit', letter: 'C', means: 'Kitchen fit from 6 factors: storage room, cold chain, diet fit, asked for it, meal timing, can reheat (0–100 → 0–1).' },
  { key: 'travel', label: 'Travel time', type: 'cost', letter: 'T', means: 'Road-estimate minutes from donor to NGO. 1 at 0 min, falls linearly to 0 at 45 min: 1 − min/45.' },
  { key: 'need', label: 'Unused capacity', type: 'benefit', letter: 'N', means: 'Share of today’s capacity still free (remaining ÷ daily capacity). Spreads food fairly.' },
  { key: 'safety', label: 'Safety margin', type: 'benefit', letter: 'F', means: 'Spare safe-use minutes on arrival after the 15-min buffer, capped at 120: margin ÷ 120.' },
  { key: 'hours', label: 'Opening hours', type: 'benefit', letter: 'H', means: 'Minutes the NGO stays open after arrival, capped at 120: minutes ÷ 120 (24-hour NGOs score 1).' },
]

// The seven existing eligibility gates, in the order engine.evaluateNgo checks them.
// Text below describes what the code does; it is shown in the app.
export const GATES = [
  { id: 'verified', label: 'Verified partner', test: /verified partner/i, data: 'ngo.verification (set by TrustCheck)', pass: 'Status is Verified', fail: 'Any other status: not submitted, submitted, under review, rejected, resubmission required' },
  { id: 'accepting', label: 'Accepting donations', test: /not accepting/i, data: 'ngo.accepting', pass: 'The NGO has intake switched on', fail: 'Intake paused' },
  { id: 'storage', label: 'Storage type & free space', test: /refrigeration|freezer; organisation|has .* free; this needs/i, data: 'donation.storage, ngo.refrigeration / freezer, fridge L, freezer L, dry-store kg, reserved donations', pass: 'Chilled → has a fridge, frozen → has a freezer, and the right unit has room for this donation', fail: 'No fridge/freezer for cold food, or the unit would overflow' },
  { id: 'diet', label: 'Dietary fit', test: /vegetarian food only/i, data: 'donation.diet, ngo.acceptsNonVeg', pass: 'Veg/Jain food anywhere; non-veg only to kitchens that accept it', fail: 'Non-veg food to a veg-only kitchen' },
  { id: 'capacity', label: 'Capacity today', test: /servings of capacity left/i, data: 'ngo.dailyCapacity − reserved − delivered today', pass: 'Remaining servings ≥ donation servings', fail: 'Not enough servings of capacity left today' },
  { id: 'open', label: 'Open on arrival', test: /closed at estimated arrival/i, data: 'ngo.opensHour / closesHour, estimated arrival', pass: 'Open at the estimated arrival time', fail: 'Closed when the food would arrive' },
  { id: 'time', label: 'Arrives in time', test: /too late for safe use/i, data: 'arrival + 15-min buffer vs donation.safeUntil', pass: 'Arrives at least 15 min before the safe-use deadline', fail: 'Would arrive too late to be served safely' },
] as const

export type GateId = (typeof GATES)[number]['id']

export function gateOf(failure: string): GateId | 'other' {
  return GATES.find((g) => g.test.test(failure))?.id ?? 'other'
}

/** Pass/fail for each of the 7 gates for one NGO (all gates are always evaluated). */
export function gateResults(e: NgoEvaluation): Record<GateId, { ok: boolean; reason: string | null }> {
  const out = {} as Record<GateId, { ok: boolean; reason: string | null }>
  for (const g of GATES) {
    const f = e.failures.find((x) => g.test.test(x)) ?? null
    out[g.id] = { ok: f === null, reason: f }
  }
  return out
}

// ---------------------------------------------------------------- weights

/** Keep weights valid: non-negative, finite, summing to 1. Falls back to the defaults. */
export function normalizeWeights(w: Partial<Weights> | null | undefined): Weights {
  const raw = {} as Weights
  for (const { key } of CRITERIA) {
    const v = Number(w?.[key])
    raw[key] = Number.isFinite(v) && v >= 0 ? v : 0
  }
  const sum = CRITERIA.reduce((s, c) => s + raw[c.key], 0)
  if (sum <= 0) return { ...MATCH_WEIGHTS }
  for (const { key } of CRITERIA) raw[key] = raw[key] / sum
  return raw
}

export function sameWeights(a: Weights, b: Weights) {
  return CRITERIA.every((c) => Math.abs(a[c.key] - b[c.key]) < 0.0005)
}

/** S = Σ wₖ·xₖ, as a 0–100 integer. With the default weights this equals engine's score. */
export function weightedScore(e: NgoEvaluation, w: Weights = MATCH_WEIGHTS): number {
  return Math.round(100 * CRITERIA.reduce((s, { key }) => s + e.breakdown[key] * w[key], 0))
}

/** Points each criterion contributes to the 0–100 score (they sum to the score ± rounding). */
export function contributions(e: NgoEvaluation, w: Weights = MATCH_WEIGHTS): Record<Criterion, number> {
  const out = {} as Record<Criterion, number>
  for (const { key } of CRITERIA) out[key] = Math.round(e.breakdown[key] * w[key] * 1000) / 10
  return out
}

// ---------------------------------------------------------------- TOPSIS

/** Raw (un-normalised) criterion values used by TOPSIS. */
function rawCriteria(e: NgoEvaluation): Record<Criterion, number> {
  return {
    compat: e.compat,
    travel: e.travelMin,
    need: e.breakdown.need,
    safety: Math.max(0, e.safetyMarginMin),
    hours: e.breakdown.hours,
  }
}

export type TopsisDetail = { closeness: number[]; weighted: Array<Record<Criterion, number>>; raw: Array<Record<Criterion, number>> }

/**
 * TOPSIS (Technique for Order of Preference by Similarity to Ideal Solution).
 *  1. Vector-normalise each criterion across THIS candidate set: rᵢₖ = xᵢₖ / √Σᵢ xᵢₖ²
 *  2. Weight it: vᵢₖ = wₖ · rᵢₖ
 *  3. Ideal best A⁺ = best value per criterion (max for benefit, min for travel); ideal worst A⁻ = the opposite
 *  4. Closeness Cᵢ = Dᵢ⁻ / (Dᵢ⁺ + Dᵢ⁻), with D = Euclidean distance to A⁺ / A⁻
 */
export function topsisDetail(evals: NgoEvaluation[], weights: Weights = MATCH_WEIGHTS): TopsisDetail {
  const raw = evals.map(rawCriteria)
  if (evals.length === 0) return { closeness: [], weighted: [], raw }
  if (evals.length === 1) return { closeness: [1], weighted: raw.map(() => ({ ...weights })), raw }
  const v = raw.map(() => ({}) as Record<Criterion, number>)
  const best = {} as Record<Criterion, number>
  const worst = {} as Record<Criterion, number>
  for (const { key, type } of CRITERIA) {
    const norm = Math.sqrt(raw.reduce((s, r) => s + r[key] ** 2, 0))
    raw.forEach((r, i) => (v[i][key] = norm === 0 ? 0 : (r[key] / norm) * weights[key]))
    const col = v.map((x) => x[key])
    best[key] = type === 'benefit' ? Math.max(...col) : Math.min(...col)
    worst[key] = type === 'benefit' ? Math.min(...col) : Math.max(...col)
  }
  const closeness = v.map((x) => {
    const dPlus = Math.sqrt(CRITERIA.reduce((s, { key }) => s + (x[key] - best[key]) ** 2, 0))
    const dMinus = Math.sqrt(CRITERIA.reduce((s, { key }) => s + (x[key] - worst[key]) ** 2, 0))
    return dPlus + dMinus === 0 ? 1 : dMinus / (dPlus + dMinus)
  })
  return { closeness, weighted: v, raw }
}

export function topsis(evals: NgoEvaluation[], weights: Weights = MATCH_WEIGHTS): number[] {
  return topsisDetail(evals, weights).closeness
}

// ---------------------------------------------------------------- sensitivity

export type Trial = { criterion: Criterion; change: '+25%' | '−25%'; winnerId: number; winnerName: string; same: boolean }
export type Stability = { agree: number; trials: number; share: number; margin: number; label: 'Robust' | 'Likely' | 'Close call' | 'Only option'; detail: Trial[] }

/**
 * Weight-sensitivity test: nudge each weight up and down by 25 % (then
 * renormalise) and check whether the same NGO stays on top. 10 trials.
 * `evals` must already be sorted by the current ranking.
 */
export function weightStability(evals: NgoEvaluation[], delta = 0.25, base: Weights = MATCH_WEIGHTS): Stability {
  if (evals.length <= 1) return { agree: 1, trials: 1, share: 1, margin: 100, label: 'Only option', detail: [] }
  const top = evals[0]
  let agree = 0
  const detail: Trial[] = []
  for (const { key } of CRITERIA) {
    for (const dir of [1 + delta, 1 - delta]) {
      const w = normalizeWeights({ ...base, [key]: base[key] * dir })
      const winner = [...evals].sort((a, b) => weightedScore(b, w) - weightedScore(a, w) || a.travelMin - b.travelMin)[0]
      const same = winner.ngo.id === top.ngo.id
      if (same) agree++
      detail.push({ criterion: key, change: dir > 1 ? '+25%' : '−25%', winnerId: winner.ngo.id, winnerName: winner.ngo.name, same })
    }
  }
  const trials = detail.length
  const share = agree / trials
  const margin = weightedScore(evals[0], base) - weightedScore(evals[1], base)
  const label = share >= 0.9 && margin >= 5 ? 'Robust' : share >= 0.6 ? 'Likely' : 'Close call'
  return { agree, trials, share, margin, label, detail }
}

// ---------------------------------------------------------------- Stage 4

export type Candidate = {
  e: NgoEvaluation
  score: number // weighted score with the weights in use
  rank: number // 1-based, by weighted score
  topsis: number // closeness 0–1
  topsisRank: number
  points: Record<Criterion, number>
  departure: number
  arrival: number
  feasibility: Feasibility
  open: boolean
  feasible: boolean
  feasibilityNote: string
}

function stage4(e: NgoEvaluation, donation: Donation, now: number, leadMin: number) {
  const departure = Math.max(now + leadMin * MIN, donation.readyAt)
  const arrival = departure + e.travelMin * MIN
  // Same formula as the existing feasibility meter: prep (incl. pickup) + travel + 15-min buffer.
  const feasibility = assessFeasibility({ readyAt: departure, safeUntil: donation.safeUntil, travelEstimate: e.travelMin }, now)
  const open = openingCheck(e.ngo, arrival).open
  const feasible = open && feasibility.verdict !== 'Not feasible'
  const feasibilityNote = !open
    ? `Closed when the food would arrive (${formatClock(arrival)}; ${hoursLabel(e.ngo)})`
    : feasibility.verdict === 'Not feasible'
      ? `With real pickup time it arrives ${formatClock(arrival)}: ${feasibility.headline.toLowerCase()} of the safe window`
      : `Arrives ${formatClock(arrival)} · ${feasibility.headline.toLowerCase()}`
  return { departure, arrival, feasibility, open, feasible, feasibilityNote }
}

// ---------------------------------------------------------------- comparison

export type Comparison = {
  agrees: boolean
  weightedTop: Candidate | null
  topsisTop: Candidate | null
  reason: string
}

/** Why TOPSIS and the weighted score pick different NGOs, in plain words. */
export function compareRankings(ranked: Candidate[], detail: TopsisDetail, evals: NgoEvaluation[]): Comparison {
  const weightedTop = ranked[0] ?? null
  const topsisTop = ranked.find((c) => c.topsisRank === 1) ?? null
  if (!weightedTop || !topsisTop || ranked.length < 2)
    return { agrees: true, weightedTop, topsisTop, reason: ranked.length < 2 ? 'Only one eligible organisation, so there is nothing to compare.' : '' }
  if (weightedTop === topsisTop)
    return { agrees: true, weightedTop, topsisTop, reason: `Both methods rank ${weightedTop.e.ngo.name} first.` }
  const ia = evals.indexOf(weightedTop.e)
  const ib = evals.indexOf(topsisTop.e)
  // Where TOPSIS sees the biggest advantage for its pick (in its own relative scale)…
  const dir = (key: Criterion) => (CRITERIA.find((c) => c.key === key)!.type === 'cost' ? -1 : 1)
  const gainB = CRITERIA.map(({ key, label }) => ({ key, label, d: dir(key) * (detail.weighted[ib][key] - detail.weighted[ia][key]) })).sort((x, y) => y.d - x.d)[0]
  // …and where the weighted score gives the weighted winner its biggest lead (absolute points).
  const lead = CRITERIA.map(({ key, label }) => ({ key, label, d: weightedTop.points[key] - topsisTop.points[key] })).sort((x, y) => y.d - x.d)[0]
  const fmt = (c: Candidate, key: Criterion) =>
    key === 'travel' ? `${c.e.travelMin} min` : key === 'compat' ? `${c.e.compat}/100` : key === 'safety' ? `${Math.max(0, c.e.safetyMarginMin)} min spare` : `${Math.round(c.e.breakdown[key] * 100)}%`
  return {
    agrees: false,
    weightedTop,
    topsisTop,
    reason:
      `TOPSIS prefers ${topsisTop.e.ngo.name} mainly for ${gainB.label.toLowerCase()} (${fmt(topsisTop, gainB.key)} vs ${fmt(weightedTop, gainB.key)}). ` +
      `It scales each criterion against the other candidates, so small gaps between close options can look large. ` +
      `The weighted score measures against fixed anchors (e.g. 0–45 min travel) and keeps ${weightedTop.e.ngo.name} ahead on ${lead.label.toLowerCase()} (+${lead.d.toFixed(0)} pts). ` +
      `The weighted score is used for the decision because its points mean the same thing every time.`,
  }
}

// ---------------------------------------------------------------- hints

export type Hint = { text: string; action?: { kind: 'split'; servings: number; ngoName: string } | { kind: 'runners' } | { kind: 'trust' } }

/** Practical ways to make an unmatched rescue possible, from the actual gate failures. */
export function improvementHints(
  donation: Donation,
  excluded: NgoEvaluation[],
  infeasible: Candidate[],
  runnerFree: boolean,
): Hint[] {
  const hints: Hint[] = []
  const byGate = (g: GateId) => excluded.filter((e) => e.failures.some((f) => gateOf(f) === g))
  const onlyFails = (e: NgoEvaluation, g: GateId) => e.failures.every((f) => gateOf(f) === g)

  // Capacity is the only blocker somewhere → offer a split.
  const capOnly = byGate('capacity').filter((e) => onlyFails(e, 'capacity') && e.remaining > 0)
  if (capOnly.length) {
    const best = [...capOnly].sort((a, b) => b.remaining - a.remaining)[0]
    hints.push({
      text: `${best.ngo.name} passes every other gate but has room for only ${best.remaining} of ${donation.servings} servings today. Split the donation: send ${best.remaining} there and keep the rest listed.`,
      action: { kind: 'split', servings: best.remaining, ngoName: best.ngo.name },
    })
  }
  const timeOnly = byGate('time').filter((e) => onlyFails(e, 'time'))
  if (timeOnly.length) {
    const closest = [...timeOnly].sort((a, b) => b.safetyMarginMin - a.safetyMarginMin)[0]
    hints.push({
      text: `${closest.ngo.name} misses the deadline by ${Math.abs(closest.safetyMarginMin)} min. Cutting packing time (now ${donation.prepMinutes} min) or a faster pickup would make it. Only extend the safe window if the food genuinely allows it.`,
    })
  }
  const unverifiedOnly = byGate('verified').filter((e) => onlyFails(e, 'verified'))
  if (unverifiedOnly.length)
    hints.push({ text: `${unverifiedOnly.map((e) => e.ngo.name).join(', ')} would qualify once verified. Review their TrustCheck application.`, action: { kind: 'trust' } })
  const storageOnly = byGate('storage').filter((e) => onlyFails(e, 'storage'))
  if (storageOnly.length && donation.storage !== 'Ambient')
    hints.push({ text: `${storageOnly.map((e) => e.ngo.name).join(', ')} can’t store ${donation.storage.toLowerCase()} food right now. A kitchen with free fridge/freezer space is needed.` })
  const closedOnly = byGate('open').filter((e) => onlyFails(e, 'open'))
  if (closedOnly.length) hints.push({ text: `${closedOnly.map((e) => `${e.ngo.name} (${hoursLabel(e.ngo)})`).join(', ')} would qualify if open on arrival.` })
  if (infeasible.length)
    hints.push(
      runnerFree
        ? { text: `${infeasible[0].e.ngo.name} is eligible, but the nearest free runner is too far to make it in time. Putting a runner closer to the donor on shift would help.`, action: { kind: 'runners' } }
        : { text: 'No runner is on shift. Put a runner on shift in Runner dispatch, then re-check.', action: { kind: 'runners' } },
    )
  if (!hints.length && excluded.length) hints.push({ text: 'Every organisation fails more than one gate, so no single change would make this rescue safe. Don’t redistribute it.' })
  return hints
}

// ---------------------------------------------------------------- Stage 5

export type PipelineResult = {
  checked: number
  eligible: NgoEvaluation[]
  excluded: NgoEvaluation[]
  ranked: Candidate[]
  recommended: Candidate | null
  alternatives: Candidate[]
  infeasible: Candidate[]
  runner: RunnerOption | null
  runnerConfirmed: boolean
  pickupLeadMin: number
  stability: Stability | null
  topsisAgrees: boolean | null
  comparison: Comparison | null
  weights: Weights
  customWeights: boolean
  hints: Hint[]
  status: 'matched' | 'unmatched' | 'not-ready'
  headline: string
  explanation: string[]
}

export function runMatchingPipeline(
  donation: Donation,
  state: { ngos: Ngo[]; donations: Donation[]; history: RescueRecord[]; runners: Runner[] },
  now: number,
  weightsIn?: Partial<Weights> | null,
): PipelineResult {
  const weights = weightsIn ? normalizeWeights(weightsIn) : { ...MATCH_WEIGHTS }
  const customWeights = !sameWeights(weights, MATCH_WEIGHTS)
  const base = {
    ranked: [],
    recommended: null,
    alternatives: [],
    infeasible: [],
    runner: null,
    runnerConfirmed: false,
    pickupLeadMin: POLICY.dispatchLeadMinutes,
    stability: null,
    topsisAgrees: null,
    comparison: null,
    weights,
    customWeights,
    hints: [],
  }

  // Engine 1 gate: matching never runs on unverified or expired food.
  if (donation.status === 'In review')
    return { ...base, checked: 0, eligible: [], excluded: [], status: 'not-ready', headline: 'Waiting for manual review', explanation: ['Engine 1 held this listing for a human check, so no NGO is matched yet.'] }
  if (donation.safeUntil <= now)
    return { ...base, checked: 0, eligible: [], excluded: [], status: 'not-ready', headline: 'Safe window has closed', explanation: ['The food is past its safe-use time and must not be redistributed.'] }

  // Stage 1 (existing engine, unchanged), then Stage 2 ordering with the weights in use.
  // NGOs that already declined this rescue are never offered it again.
  const declined = new Set(donation.declinedBy ?? [])
  const m = matchNgos(donation, state.ngos.filter((n) => !declined.has(n.id)), state.donations, state.history, now)
  const eligible = [...m.eligible].sort((a, b) => weightedScore(b, weights) - weightedScore(a, weights) || a.travelMin - b.travelMin)
  const checked = eligible.length + m.excluded.length

  // Pickup: the nearest free runner sets the real departure time.
  const runners = runnerOptions(donation, state.runners, state.donations)
  const free = runners.find((o) => o.runner.onShift && !o.busy) ?? null
  const pickupLeadMin = free ? Math.max(free.etaMin, 1) : POLICY.dispatchLeadMinutes

  const detail = topsisDetail(eligible, weights)
  const closeness = detail.closeness
  const topsisOrder = [...closeness.keys()].sort((a, b) => closeness[b] - closeness[a])
  const ranked: Candidate[] = eligible.map((e, i) => ({
    e,
    score: weightedScore(e, weights),
    rank: i + 1,
    topsis: Math.round(closeness[i] * 1000) / 1000,
    topsisRank: topsisOrder.indexOf(i) + 1,
    points: contributions(e, weights),
    ...stage4(e, donation, now, pickupLeadMin),
  }))

  const feasibleList = ranked.filter((c) => c.feasible)
  const recommended = feasibleList[0] ?? null
  const alternatives = feasibleList.slice(1)
  const infeasible = ranked.filter((c) => !c.feasible)
  const stability = eligible.length ? weightStability(eligible, 0.25, weights) : null
  const topsisAgrees = ranked.length ? ranked[0].topsisRank === 1 : null
  const comparison = ranked.length ? compareRankings(ranked, detail, eligible) : null

  const explanation: string[] = []
  let headline: string
  let status: PipelineResult['status']
  let hints: Hint[] = []

  if (eligible.length === 0) {
    status = 'unmatched'
    headline = 'No organisation can safely take this'
    explanation.push(`All ${checked} organisations fail at least one eligibility gate (see exclusions). The listing stays on the board, unmatched.`)
    hints = improvementHints(donation, m.excluded, [], free !== null)
  } else if (!recommended) {
    status = 'unmatched'
    headline = 'Eligible, but nobody can be reached in time'
    explanation.push(
      `${eligible.length} organisation${eligible.length === 1 ? '' : 's'} passed the gates, but once the real pickup time is added (${free ? `${free.runner.name} is ${pickupLeadMin} min from the donor` : `no free runner; assumed ${pickupLeadMin} min`}), none can receive it before the safe window closes.`,
    )
    explanation.push('The listing stays on the board, unmatched, rather than being assigned to a rescue that would fail.')
    hints = improvementHints(donation, m.excluded, infeasible, free !== null)
  } else {
    status = 'matched'
    const c = recommended
    headline = `Recommended: ${c.e.ngo.name}`
    explanation.push(`Passed all 7 eligibility gates (${eligible.length} of ${checked} organisations did).`)
    const top = CRITERIA.map(({ key, label }) => ({ label, pts: c.points[key] }))
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 2)
    explanation.push(`Score ${c.score}/100, rank #${c.rank} of ${ranked.length}. Biggest contributors: ${top.map((x) => `${x.label} ${x.pts.toFixed(0)} pts`).join(', ')}.`)
    for (const skipped of infeasible.filter((x) => x.rank < c.rank))
      explanation.push(`Skipped higher-scoring ${skipped.e.ngo.name} (${skipped.score}): ${skipped.feasibilityNote}.`)
    explanation.push(`${c.feasibilityNote}.`)
    explanation.push(
      free
        ? `Pickup by ${free.runner.name} (${free.runner.vehicle.toLowerCase()}, ≈ ${free.etaMin} min to the donor).`
        : `No runner is free right now; timing assumes one reaches the donor within ${POLICY.dispatchLeadMinutes} min. Assign one quickly.`,
    )
    if (alternatives.length) explanation.push(`If ${c.e.ngo.name} declines: ${alternatives.map((a) => `${a.e.ngo.name} (${a.score})`).join(', ')}.`)
    if (ranked.length > 1 && topsisAgrees !== null)
      explanation.push(
        topsisAgrees
          ? 'TOPSIS cross-check ranks the same organisation first.'
          : `TOPSIS cross-check would prefer ${ranked.find((x) => x.topsisRank === 1)?.e.ngo.name}; the weighted score is used because its points are absolute and explainable.`,
      )
    if (stability && stability.label !== 'Only option')
      explanation.push(
        `Weight sensitivity: stays #1 in ${stability.agree} of ${stability.trials} trials with any weight ±25 % (${stability.label.toLowerCase()}, lead ${stability.margin} pts).`,
      )
    if (customWeights) explanation.push('Custom weights are in use (see the Weights tab).')
    if (declined.size)
      explanation.push(`${state.ngos.filter((n) => declined.has(n.id)).map((n) => n.name).join(', ')} declined this rescue earlier, so ${declined.size === 1 ? 'it was' : 'they were'} left out.`)
  }

  return {
    checked,
    eligible,
    excluded: m.excluded,
    ranked,
    recommended,
    alternatives,
    infeasible,
    runner: free,
    runnerConfirmed: free !== null,
    pickupLeadMin,
    stability,
    topsisAgrees,
    comparison,
    weights,
    customWeights,
    hints,
    status,
    headline,
    explanation,
  }
}

export { formatDuration }
