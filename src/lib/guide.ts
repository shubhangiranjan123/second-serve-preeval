// Rescue guide: the single most useful next action for a listing, plus
// warnings. Deterministic rules over the same engine outputs the rest of
// the app shows. It is NOT AI and is never labelled as such.

import type { AppState, Donation } from '../types'
import { assessFeasibility, formatClock, formatDuration, minutesBetween, runnerOptions } from './engine'
import type { PipelineResult } from './pipeline'

export type Guide = { tone: 'ok' | 'warn' | 'bad' | 'info'; next: string; why: string; warnings: string[] }

export function rescueGuide(d: Donation, state: AppState, now: number, p: PipelineResult | null): Guide {
  const left = minutesBetween(now, d.safeUntil)
  const warnings: string[] = []
  const freeRunners = state.runners.filter((r) => r.onShift && !state.donations.some((x) => x.runnerId === r.id && x.status === 'Reserved' && x.id !== d.id))
  if (d.status !== 'Delivered' && left > 0 && left <= 45) warnings.push(`Only ${formatDuration(left)} of safe time left (until ${formatClock(d.safeUntil)}).`)
  if (d.status !== 'Delivered' && d.status !== 'In review' && freeRunners.length === 0) warnings.push('No runner is free: everyone on shift is on a run or off shift.')

  if (d.status === 'Delivered')
    return { tone: 'ok', next: 'Rescue complete.', why: 'It is counted once in lifetime rescues. Share the receipt below if you like.', warnings: [] }
  if (left <= 0)
    return { tone: 'bad', next: 'Don’t redistribute this food.', why: `Its safe window ended at ${formatClock(d.safeUntil)}.`, warnings: [] }

  if (d.status === 'In review') {
    const reasons = d.screening?.reviewReasons ?? []
    return {
      tone: 'warn',
      next: 'Inspect the food, then approve or reject it.',
      why: reasons.length ? `Held because: ${reasons.join(' ')}` : 'The AI scan was unavailable, so a person must look at the food first.',
      warnings,
    }
  }

  if (d.status === 'Available') {
    if (!p || p.status === 'not-ready') return { tone: 'info', next: 'Matching is not ready yet.', why: p?.explanation[0] ?? '', warnings }
    if (p.recommended)
      return {
        tone: p.recommended.feasibility.verdict === 'At risk' ? 'warn' : 'ok',
        next: `Reserve ${p.recommended.e.ngo.name}.`,
        why: `${p.recommended.feasibilityNote}. ${p.runner ? `${p.runner.runner.name} can collect it in about ${p.runner.etaMin} min.` : 'Then put a runner on shift.'}`,
        warnings,
      }
    return {
      tone: 'bad',
      next: p.hints[0]?.text ?? 'No organisation can take this safely right now.',
      why: p.headline + '.',
      warnings,
    }
  }

  // Reserved
  const ngo = state.ngos.find((n) => n.id === d.ngoId)
  if (d.stage === 'Pending') {
    const best = runnerOptions(d, state.runners, state.donations).find((o) => o.runner.onShift && !o.busy)
    return {
      tone: best ? 'ok' : 'bad',
      next: best ? `Assign ${best.runner.name} (≈ ${best.etaMin} min away).` : 'Put a runner on shift and assign them.',
      why: `Reserved for ${ngo?.name ?? 'the organisation'}. The clock is running.`,
      warnings,
    }
  }
  const feas = assessFeasibility(d.stage === 'Picked Up' ? { ...d, readyAt: now } : d, now)
  if (d.stage === 'Assigned')
    return { tone: feas.verdict === 'Feasible' ? 'ok' : 'warn', next: 'Mark it picked up when the runner collects it.', why: feas.headline + '.', warnings }
  return { tone: feas.verdict === 'Not feasible' ? 'bad' : 'ok', next: `Deliver to ${ngo?.name ?? 'the organisation'} and mark it delivered.`, why: `Safe until ${formatClock(d.safeUntil)}.`, warnings }
}
