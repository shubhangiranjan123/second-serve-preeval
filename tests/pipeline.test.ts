// Engine 2 — matching & feasibility (scenarios 6–9, 12 of the brief).
import { describe, expect, test } from 'vitest'
import { MATCH_WEIGHTS, MIN, matchNgos } from '../src/lib/engine'
import { CRITERIA, GATES, gateOf, runMatchingPipeline, topsis, weightStability } from '../src/lib/pipeline'
import type { AppState } from '../src/types'
import { NOW, demo, donation } from './fixtures'

describe('Engine 2: existing parameters are preserved', () => {
  test('weights are untouched and sum to 1', () => {
    expect(MATCH_WEIGHTS).toEqual({ travel: 0.25, compat: 0.3, need: 0.2, safety: 0.15, hours: 0.1 })
    expect(CRITERIA.reduce((s, c) => s + MATCH_WEIGHTS[c.key], 0)).toBeCloseTo(1)
  })

  test('Stage 1/2 rankings equal the original engine.matchNgos output', () => {
    const s = demo()
    for (const d of s.donations.filter((x) => x.status === 'Available')) {
      const orig = matchNgos(d, s.ngos, s.donations, s.history, NOW)
      const p = runMatchingPipeline(d, s, NOW)
      expect(p.ranked.map((c) => [c.e.ngo.id, c.e.score])).toEqual(orig.eligible.map((e) => [e.ngo.id, e.score]))
      expect(p.excluded.map((e) => e.ngo.id)).toEqual(orig.excluded.map((e) => e.ngo.id))
    }
  })

  test('every exclusion reason maps to one of the 7 gates', () => {
    const s = demo()
    for (const d of s.donations) {
      for (const e of runMatchingPipeline(d, s, NOW).excluded) for (const f of e.failures) expect(gateOf(f), f).not.toBe('other')
    }
    expect(GATES).toHaveLength(7)
  })

  test('contribution points add up to the score', () => {
    const s = demo()
    const p = runMatchingPipeline(s.donations.find((d) => d.id === 2)!, s, NOW)
    for (const c of p.ranked) {
      const sum = Object.values(c.points).reduce((a, b) => a + b, 0)
      expect(Math.abs(sum - c.e.score)).toBeLessThanOrEqual(1)
    }
  })
})

describe('Engine 2: scenarios', () => {
  test('6 · multiple NGOs qualify → ranked list with alternatives and reasons', () => {
    const s = demo()
    const bakery = s.donations.find((d) => d.id === 2)! // room-temperature: Haven eligible too
    const p = runMatchingPipeline(bakery, s, NOW)
    expect(p.status).toBe('matched')
    expect(p.ranked.length).toBe(3)
    expect(p.alternatives.length).toBe(2)
    expect(p.recommended!.rank).toBe(1)
    expect(p.explanation[0]).toMatch(/Passed all 7 eligibility gates \(3 of 4/)
    expect(p.excluded.map((e) => e.ngo.name)).toEqual(['Roti Bank Manimajra'])
  })

  test('7 · only one NGO satisfies the conditions', () => {
    const s = demo()
    // Chilled non-veg: Saathi is veg-only, Haven has no fridge, Roti Bank is unverified.
    const d = donation({ diet: 'Non-veg', name: 'Chicken curry', safeUntil: NOW + 5 * 60 * MIN })
    const p = runMatchingPipeline(d, s, NOW)
    expect(p.ranked.map((c) => c.e.ngo.name)).toEqual(['Annapurna Community Kitchen'])
    expect(p.recommended?.e.ngo.name).toBe('Annapurna Community Kitchen')
    expect(p.stability?.label).toBe('Only option')
  })

  test('8 · highest-scoring NGO fails real-pickup feasibility → next feasible one is recommended', () => {
    const s: AppState = demo()
    // Only Kabir (Sector 8, far from a Sector 43 bakery) is on shift.
    s.runners = s.runners.map((r) => ({ ...r, onShift: r.name.startsWith('Kabir') }))
    // Annapurna (nearer) has already taken most of today's capacity, so the
    // farther Saathi wins clearly on "unused capacity".
    s.history.push({ donationId: 777, food: 'Earlier rescue', donor: 'X', category: 'Meals', ngoId: 101, ngoName: 'Annapurna Community Kitchen', runnerName: 'Aarav Sharma', servings: 40, weightKg: 14, deliveredAt: NOW - 60 * MIN })
    const base = donation({ area: 'Sector 43', lat: 30.719, lng: 76.75, category: 'Bakery', storage: 'Ambient', unit: 'items', servings: 20, quantity: 20 })
    const probe = runMatchingPipeline(base, s, NOW)
    const [top, second] = probe.ranked
    expect(top && second).toBeTruthy()
    expect(top.e.travelMin).toBeGreaterThan(second.e.travelMin) // precondition: #1 is the farther kitchen
    const lead = probe.pickupLeadMin
    expect(lead).toBeGreaterThan(10) // runner is further than the 10-min assumption Stage 1 uses

    // Window that the top NGO passes with a 10-min pickup but fails with the real one,
    // while the nearer #2 still makes it.
    const windowMin = lead + second.e.travelMin + 15 + 1
    expect(10 + top.e.travelMin + 15).toBeLessThanOrEqual(windowMin)
    expect(lead + top.e.travelMin + 15).toBeGreaterThan(windowMin)

    const p = runMatchingPipeline({ ...base, safeUntil: NOW + windowMin * MIN }, s, NOW)
    expect(p.ranked[0].e.ngo.id).toBe(top.e.ngo.id) // still passes Stage 1 and ranks first
    expect(p.ranked[0].feasible).toBe(false)
    expect(p.recommended?.e.ngo.id).toBe(second.e.ngo.id)
    expect(p.explanation.join(' ')).toMatch(new RegExp(`Skipped higher-scoring ${top.e.ngo.name}`))
  })

  test('9a · no NGO passes the gates in time → unmatched, nothing assigned', () => {
    const s = demo()
    const biryani = s.donations.find((d) => d.id === 4)!
    const p = runMatchingPipeline(biryani, s, NOW)
    expect(p.status).toBe('unmatched')
    expect(p.recommended).toBeNull()
    expect(p.excluded.every((e) => e.failures.some((f) => gateOf(f) === 'time'))).toBe(true)
  })

  test('9b · eligible on paper but no runner can get it there in time → unmatched', () => {
    const s: AppState = demo()
    s.runners = s.runners.map((r) => ({ ...r, onShift: r.name.startsWith('Kabir') }))
    const base = donation({ area: 'Sector 35', lat: 30.727, lng: 76.759 })
    const probe = runMatchingPipeline(base, s, NOW)
    const fastest = Math.min(...probe.ranked.map((c) => c.e.travelMin))
    const windowMin = 10 + Math.max(...probe.ranked.map((c) => c.e.travelMin)) + 15 + 1 // passes Stage 1 for all
    expect(probe.pickupLeadMin + fastest + 15).toBeGreaterThan(windowMin) // …but not Stage 3
    const p = runMatchingPipeline({ ...base, safeUntil: NOW + windowMin * MIN }, s, NOW)
    expect(p.eligible.length).toBeGreaterThan(0)
    expect(p.status).toBe('unmatched')
    expect(p.headline).toMatch(/nobody can be reached in time/)
  })

  test('verification gate: In-review listings are never matched', () => {
    const s = demo()
    const p = runMatchingPipeline(donation({ status: 'In review' }), s, NOW)
    expect(p.status).toBe('not-ready')
    expect(p.ranked).toEqual([])
  })

  test('expired food is never matched', () => {
    expect(runMatchingPipeline(donation({ safeUntil: NOW - MIN }), demo(), NOW).status).toBe('not-ready')
  })

  test('no runner on shift → still recommends, but flags timing as unconfirmed', () => {
    const s: AppState = demo()
    s.runners = s.runners.map((r) => ({ ...r, onShift: false }))
    const p = runMatchingPipeline(donation(), s, NOW)
    expect(p.status).toBe('matched')
    expect(p.runnerConfirmed).toBe(false)
    expect(p.explanation.join(' ')).toMatch(/No runner is free/)
  })
})

describe('Engine 2: MCDM cross-checks', () => {
  test('TOPSIS: single candidate → 1; dominant candidate → closeness 1', () => {
    const s = demo()
    const m = matchNgos(s.donations.find((d) => d.id === 2)!, s.ngos, s.donations, s.history, NOW)
    expect(topsis(m.eligible.slice(0, 1))).toEqual([1])
    const a = m.eligible[0]
    const dominated = { ...a, ngo: { ...a.ngo, id: 999 }, compat: a.compat - 20, travelMin: a.travelMin + 20, safetyMarginMin: a.safetyMarginMin - 30, breakdown: { ...a.breakdown, need: a.breakdown.need / 2, hours: a.breakdown.hours / 2 } }
    const c = topsis([a, dominated])
    expect(c[0]).toBeCloseTo(1)
    expect(c[1]).toBeCloseTo(0)
  })

  test('weight stability is reported for every multi-candidate ranking', () => {
    const s = demo()
    const m = matchNgos(s.donations.find((d) => d.id === 3)!, s.ngos, s.donations, s.history, NOW)
    const st = weightStability(m.eligible)
    expect(st.trials).toBe(10)
    expect(st.agree).toBeLessThanOrEqual(10)
  })
})
