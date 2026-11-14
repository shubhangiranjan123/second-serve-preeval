// Engine 2: Intelligent NGO matching & rescue feasibility.
//
// This file does NOT replace engine.ts. It runs the existing engine as
// Stage 1 + 2 and adds two things around it:
//
//   Stage 1  Hard eligibility   → engine.matchNgos(): the existing 7 gates
//                                  (verified, accepting, storage type + free
//                                  unit space, diet, capacity, open on
//                                  arrival, arrives before deadline − 15 min)
//   Stage 2  Multi-criteria rank → engine's existing weighted score
//                                  (compat 30 · travel 25 · need 20 ·
//                                  safety 15 · hours 10). Cross-checked with
//                                  TOPSIS and a weight-sensitivity test.
//   Stage 3  Rescue feasibility  → re-times every ranked NGO with the REAL
//                                  pickup: the nearest free runner's ETA to
//                                  the donor (Stage 1 assumed a flat 10 min).
//                                  Reuses engine.assessFeasibility().
//   Stage 4  Recommendation      → first NGO in score order that survives
//                                  Stage 3, plus alternatives and reasons.
//
// Everything here is deterministic optimisation, not machine learning.

import type { Donation, Ngo, RescueRecord, Runner } from '../types'
import {
  MATCH_WEIGHTS,
  MIN,
  POLICY,
  assessFeasibility,
  formatClock,
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

export const CRITERIA: Array<{ key: Criterion; label: string; type: 'benefit' | 'cost' }> = [
  { key: 'compat', label: 'Compatibility', type: 'benefit' },
  { key: 'travel', label: 'Travel time', type: 'cost' },
  { key: 'need', label: 'Unused capacity', type: 'benefit' },
  { key: 'safety', label: 'Safety margin', type: 'benefit' },
  { key: 'hours', label: 'Opening hours', type: 'benefit' },
]

// The seven existing eligibility gates, in the order engine.evaluateNgo checks them.
export const GATES = [
  { id: 'verified', label: 'Verified partner', test: /verified partner/i },
  { id: 'accepting', label: 'Accepting donations', test: /not accepting/i },
  { id: 'storage', label: 'Storage type & free space', test: /refrigeration|freezer; organisation|has .* free; this needs/i },
  { id: 'diet', label: 'Dietary fit', test: /vegetarian food only/i },
  { id: 'capacity', label: 'Capacity today', test: /servings of capacity left/i },
  { id: 'open', label: 'Open on arrival', test: /closed at estimated arrival/i },
  { id: 'time', label: 'Arrives in time', test: /too late for safe use/i },
] as const

export type GateId = (typeof GATES)[number]['id']

export function gateOf(failure: string): GateId | 'other' {
  return GATES.find((g) => g.test.test(failure))?.id ?? 'other'
}

// ---------------------------------------------------------------- Stage 2 helpers

/** Points each criterion contributes to the 0–100 score (they sum to the score ± rounding). */
export function contributions(e: NgoEvaluation): Record<Criterion, number> {
  const out = {} as Record<Criterion, number>
  for (const { key } of CRITERIA) out[key] = Math.round(e.breakdown[key] * MATCH_WEIGHTS[key] * 1000) / 10
  return out
}

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

/**
 * TOPSIS (Technique for Order of Preference by Similarity to Ideal Solution).
 * Vector-normalises each criterion across the candidate set, weights it,
 * and measures each NGO's distance to the best and worst possible options.
 * Returns closeness in [0, 1] per evaluation, same order as the input.
 */
export function topsis(evals: NgoEvaluation[], weights: Record<Criterion, number> = MATCH_WEIGHTS): number[] {
  if (evals.length === 0) return []
  if (evals.length === 1) return [1]
  const rows = evals.map(rawCriteria)
  const v = rows.map(() => ({}) as Record<Criterion, number>)
  const best = {} as Record<Criterion, number>
  const worst = {} as Record<Criterion, number>
  for (const { key, type } of CRITERIA) {
    const norm = Math.sqrt(rows.reduce((s, r) => s + r[key] ** 2, 0))
    rows.forEach((r, i) => (v[i][key] = norm === 0 ? 0 : (r[key] / norm) * weights[key]))
    const col = v.map((x) => x[key])
    best[key] = type === 'benefit' ? Math.max(...col) : Math.min(...col)
    worst[key] = type === 'benefit' ? Math.min(...col) : Math.max(...col)
  }
  return v.map((x) => {
    const dPlus = Math.sqrt(CRITERIA.reduce((s, { key }) => s + (x[key] - best[key]) ** 2, 0))
    const dMinus = Math.sqrt(CRITERIA.reduce((s, { key }) => s + (x[key] - worst[key]) ** 2, 0))
    return dPlus + dMinus === 0 ? 1 : dMinus / (dPlus + dMinus)
  })
}

export type Stability = { agree: number; trials: number; share: number; margin: number; label: 'Robust' | 'Likely' | 'Close call' | 'Only option' }

/**
 * Weight-sensitivity test: nudge each weight up and down by 25 % (then
 * renormalise) and check whether the same NGO stays on top. 10 trials.
 */
export function weightStability(evals: NgoEvaluation[], delta = 0.25): Stability {
  if (evals.length <= 1) return { agree: 1, trials: 1, share: 1, margin: 100, label: 'Only option' }
  const scoreWith = (e: NgoEvaluation, w: Record<Criterion, number>) => CRITERIA.reduce((s, { key }) => s + e.breakdown[key] * w[key], 0)
  const topId = evals[0].ngo.id
  let agree = 0
  let trials = 0
  for (const { key } of CRITERIA) {
    for (const dir of [1 + delta, 1 - delta]) {
      const w = { ...MATCH_WEIGHTS, [key]: MATCH_WEIGHTS[key] * dir }
      const sum = CRITERIA.reduce((s, c) => s + w[c.key], 0)
      for (const c of CRITERIA) w[c.key] /= sum
      const winner = [...evals].sort((a, b) => scoreWith(b, w) - scoreWith(a, w) || a.travelMin - b.travelMin)[0]
      trials++
      if (winner.ngo.id === topId) agree++
    }
  }
  const share = agree / trials
  const margin = evals[0].score - evals[1].score
  const label = share >= 0.9 && margin >= 5 ? 'Robust' : share >= 0.6 ? 'Likely' : 'Close call'
  return { agree, trials, share, margin, label }
}

// ---------------------------------------------------------------- Stage 3

export type Candidate = {
  e: NgoEvaluation
  rank: number // 1-based, by existing weighted score
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

function stage3(e: NgoEvaluation, donation: Donation, now: number, leadMin: number) {
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

// ---------------------------------------------------------------- Stage 4

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
  status: 'matched' | 'unmatched' | 'not-ready'
  headline: string
  explanation: string[]
}

export function runMatchingPipeline(
  donation: Donation,
  state: { ngos: Ngo[]; donations: Donation[]; history: RescueRecord[]; runners: Runner[] },
  now: number,
): PipelineResult {
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
  }

  // Engine 1 gate: matching never runs on unverified or expired food.
  if (donation.status === 'In review')
    return { ...base, checked: 0, eligible: [], excluded: [], status: 'not-ready', headline: 'Waiting for manual review', explanation: ['Engine 1 held this listing for a human check, so no NGO is matched yet.'] }
  if (donation.safeUntil <= now)
    return { ...base, checked: 0, eligible: [], excluded: [], status: 'not-ready', headline: 'Safe window has closed', explanation: ['The food is past its safe-use time and must not be redistributed.'] }

  // Stage 1 + 2 (existing engine, unchanged).
  const m = matchNgos(donation, state.ngos, state.donations, state.history, now)
  const checked = m.eligible.length + m.excluded.length

  // Pickup: the nearest free runner sets the real departure time.
  const runners = runnerOptions(donation, state.runners, state.donations)
  const free = runners.find((o) => o.runner.onShift && !o.busy) ?? null
  const pickupLeadMin = free ? Math.max(free.etaMin, 1) : POLICY.dispatchLeadMinutes

  const closeness = topsis(m.eligible)
  const topsisOrder = [...closeness.keys()].sort((a, b) => closeness[b] - closeness[a])
  const ranked: Candidate[] = m.eligible.map((e, i) => ({
    e,
    rank: i + 1,
    topsis: Math.round(closeness[i] * 1000) / 1000,
    topsisRank: topsisOrder.indexOf(i) + 1,
    points: contributions(e),
    ...stage3(e, donation, now, pickupLeadMin),
  }))

  const feasibleList = ranked.filter((c) => c.feasible)
  const recommended = feasibleList[0] ?? null
  const alternatives = feasibleList.slice(1)
  const infeasible = ranked.filter((c) => !c.feasible)
  const stability = m.eligible.length ? weightStability(m.eligible) : null
  const topsisAgrees = ranked.length ? ranked[0].topsisRank === 1 : null

  const explanation: string[] = []
  let headline: string
  let status: PipelineResult['status']

  if (m.eligible.length === 0) {
    status = 'unmatched'
    headline = 'No organisation can safely take this'
    explanation.push(`All ${checked} organisations fail at least one eligibility gate (see exclusions). The listing stays on the board, unmatched.`)
  } else if (!recommended) {
    status = 'unmatched'
    headline = 'Eligible, but nobody can be reached in time'
    explanation.push(
      `${m.eligible.length} organisation${m.eligible.length === 1 ? '' : 's'} passed the gates, but once the real pickup time is added (${free ? `${free.runner.name} is ${pickupLeadMin} min from the donor` : `no free runner; assumed ${pickupLeadMin} min`}), none can receive it before the safe window closes.`,
    )
    explanation.push('The listing stays on the board, unmatched, rather than being assigned to a rescue that would fail.')
  } else {
    status = 'matched'
    const c = recommended
    headline = `Recommended: ${c.e.ngo.name}`
    explanation.push(`Passed all 7 eligibility gates (${m.eligible.length} of ${checked} organisations did).`)
    const top = CRITERIA.map(({ key, label }) => ({ label, pts: c.points[key] }))
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 2)
    explanation.push(`Score ${c.e.score}/100, rank #${c.rank} of ${ranked.length}. Biggest contributors: ${top.map((x) => `${x.label} ${x.pts.toFixed(0)} pts`).join(', ')}.`)
    for (const skipped of infeasible.filter((x) => x.rank < c.rank))
      explanation.push(`Skipped higher-scoring ${skipped.e.ngo.name} (${skipped.e.score}): ${skipped.feasibilityNote}.`)
    explanation.push(`${c.feasibilityNote}.`)
    explanation.push(
      free
        ? `Pickup by ${free.runner.name} (${free.runner.vehicle.toLowerCase()}, ≈ ${free.etaMin} min to the donor).`
        : `No runner is free right now; timing assumes one reaches the donor within ${POLICY.dispatchLeadMinutes} min. Assign one quickly.`,
    )
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
  }

  return {
    checked,
    eligible: m.eligible,
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
    status,
    headline,
    explanation,
  }
}
