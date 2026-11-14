// Tests for the final upgrade: multi-photo rules, configurable weights,
// gate matrix, TOPSIS explanation, hints, TrustCheck → matching.
import { describe, expect, test } from 'vitest'
import { MIN, matchNgos } from '../src/lib/engine'
import {
  GATES,
  compareRankings,
  gateResults,
  normalizeWeights,
  runMatchingPipeline,
  topsisDetail,
  weightedScore,
} from '../src/lib/pipeline'
import { verifyDonation } from '../src/lib/verification'
import { CHECKLIST, blankApplication, canApprove, createInitialApplications, syncNgo, validateApplication } from '../src/lib/trust'
import { rescueGuide } from '../src/lib/guide'
import { operationalAlerts } from '../src/lib/alerts'
import type { AppState, TrustApplication } from '../src/types'
import { NOW, demo, donation, facts, scan } from './fixtures'

function withApps(): AppState {
  const s = demo()
  const applications = createInitialApplications(NOW, s.ngos)
  return { ...s, applications, ngos: s.ngos.map((n) => ({ ...n, verification: applications.find((a) => a.ngoId === n.id)?.status ?? n.verification })) }
}

describe('Engine 1: multi-photo rules', () => {
  test('several photos that agree and are clear → pass', () => {
    const v = verifyDonation({ kind: 'scan', scan: scan(), photoCount: 3 }, facts())
    expect(v.outcome).toBe('pass')
    expect(v.rules.find((r) => r.id === 'ai-photo-set')?.status).toBe('pass')
  })
  test('photos that show different food → review, with the AI’s reason', () => {
    const v = verifyDonation({ kind: 'scan', scan: scan({ samePhotoSet: false, inconsistencies: ['photo 1 rice, photo 2 bread'] }), photoCount: 2 }, facts())
    expect(v.outcome).toBe('review')
    expect(v.reviewReasons.join(' ')).toMatch(/photo 1 rice/)
  })
  test('poor photo quality (blurry/dark) → review', () => {
    const v = verifyDonation({ kind: 'scan', scan: scan({ photoQuality: 'poor', qualityIssues: ['blurry', 'too dark'] }), photoCount: 2 }, facts())
    expect(v.outcome).toBe('review')
    expect(v.reviewReasons.join(' ')).toMatch(/blurry, too dark/)
  })
  test('a single photo passes without the same-donation check', () => {
    const v = verifyDonation({ kind: 'scan', scan: scan({ samePhotoSet: false }), photoCount: 1 }, facts())
    expect(v.outcome).toBe('pass')
    expect(v.rules.some((r) => r.id === 'ai-photo-set')).toBe(false)
  })
  test('fair quality is advisory only', () => {
    const v = verifyDonation({ kind: 'scan', scan: scan({ photoQuality: 'fair', qualityIssues: ['glare'] }), photoCount: 2 }, facts())
    expect(v.outcome).toBe('pass')
    expect(v.advisories.join(' ')).toMatch(/glare/)
  })
})

describe('Engine 2: weights, gates, comparison, hints', () => {
  test('default weights reproduce the engine score exactly', () => {
    const s = demo()
    for (const d of s.donations.filter((x) => x.status === 'Available')) {
      for (const e of matchNgos(d, s.ngos, s.donations, s.history, NOW).eligible) expect(weightedScore(e)).toBe(e.score)
    }
  })
  test('weights are normalised; invalid weights fall back to defaults', () => {
    const w = normalizeWeights({ compat: 2, travel: 2, need: 0, safety: 0, hours: 0 })
    expect(w.compat).toBeCloseTo(0.5)
    expect(normalizeWeights({ compat: -1, travel: NaN } as never)).toEqual({ travel: 0.25, compat: 0.3, need: 0.2, safety: 0.15, hours: 0.1 })
  })
  test('custom weights re-rank (travel-only → nearest first) but never re-admit an excluded NGO', () => {
    const s = demo()
    const bakery = s.donations.find((d) => d.id === 2)!
    const p = runMatchingPipeline(bakery, s, NOW, { travel: 1, compat: 0, need: 0, safety: 0, hours: 0 })
    const travel = p.ranked.map((c) => c.e.travelMin)
    expect(travel).toEqual([...travel].sort((a, b) => a - b))
    expect(p.customWeights).toBe(true)
    expect(p.ranked.some((c) => c.e.ngo.name === 'Roti Bank Manimajra')).toBe(false) // gate 1 still applies
  })
  test('gate matrix: every NGO gets a result for all 7 gates; multiple failures are all shown', () => {
    const s = demo()
    const biryani = s.donations.find((d) => d.id === 4)!
    const p = runMatchingPipeline(biryani, s, NOW)
    const saathi = p.excluded.find((e) => e.ngo.name.startsWith('Saathi'))!
    const r = gateResults(saathi)
    expect(Object.keys(r)).toHaveLength(GATES.length)
    expect(r.diet.ok).toBe(false)
    expect(r.time.ok).toBe(false)
    expect(r.verified.ok).toBe(true)
  })
  test('TOPSIS disagreement is explained in words', () => {
    const s = demo()
    const p = runMatchingPipeline(s.donations.find((d) => d.id === 2)!, s, NOW)
    expect(p.comparison?.agrees).toBe(false)
    expect(p.comparison?.reason).toMatch(/TOPSIS prefers .* mainly for/)
    const again = compareRankings(p.ranked, topsisDetail(p.eligible), p.eligible)
    expect(again.reason).toBe(p.comparison?.reason)
  })
  test('sensitivity reports a winner for each of the 10 weight changes', () => {
    const s = demo()
    const p = runMatchingPipeline(s.donations.find((d) => d.id === 2)!, s, NOW)
    expect(p.stability?.detail).toHaveLength(10)
  })
  test('capacity-only failure → split hint with the exact servings that fit', () => {
    const s = demo()
    // Ambient bakery, 40 servings: Haven (18 left) passes every gate except capacity.
    const d = donation({ category: 'Bakery', storage: 'Ambient', unit: 'items', servings: 400, quantity: 400, safeUntil: NOW + 6 * 60 * MIN })
    const p = runMatchingPipeline(d, s, NOW)
    expect(p.status).toBe('unmatched')
    const split = p.hints.find((h) => h.action?.kind === 'split')
    expect(split?.action).toMatchObject({ kind: 'split' })
  })
  test('unverified-only failure → TrustCheck hint', () => {
    const s = demo()
    s.ngos = s.ngos.map((n) => ({ ...n, verification: 'Under Review' as const }))
    const p = runMatchingPipeline(donation(), s, NOW)
    expect(p.status).toBe('unmatched')
    expect(p.hints.some((h) => h.action?.kind === 'trust')).toBe(true)
  })
})

describe('TrustCheck', () => {
  test('demo seeds cover every reviewable status and match the NGO records', () => {
    const s = withApps()
    const statuses = new Set(s.applications!.map((a) => a.status))
    for (const st of ['Submitted', 'Under Review', 'Verified', 'Rejected', 'Resubmission Required']) expect(statuses.has(st as never)).toBe(true)
    expect(s.ngos.find((n) => n.name === 'Roti Bank Manimajra')?.verification).toBe('Under Review')
    expect(s.applications!.every((a) => a.demo)).toBe(true)
  })
  test('validation catches bad formats and missing documents', () => {
    const d = { ...blankApplication('donor'), orgName: 'X', phone: '12345', email: 'nope', fssai: '123', gstin: 'ABC' }
    const e = validateApplication(d)
    expect(Object.keys(e)).toEqual(expect.arrayContaining(['orgName', 'phone', 'email', 'fssai', 'gstin', 'docs', 'orgType', 'contactName', 'address']))
    const ok: TrustApplication = {
      ...blankApplication('donor'),
      orgName: 'Good Food Co',
      orgType: 'Restaurant',
      contactName: 'Asha',
      phone: '9876543210',
      email: 'a@b.in',
      address: 'SCO 1, Sector 17-C',
      fssai: '12345678901234',
      gstin: '04ABCDE1234F1Z5',
      docs: [{ id: 1, kind: 'FSSAI licence', name: 'f.pdf', size: 1, type: 'application/pdf' }],
    }
    expect(validateApplication(ok)).toEqual({})
  })
  test('unregistered community kitchen can apply with alternative evidence', () => {
    const r: TrustApplication = {
      ...blankApplication('recipient'),
      orgName: 'Gurdwara langar seva',
      orgType: 'Gurdwara / temple langar',
      contactName: 'Harpreet',
      phone: '9814012345',
      email: 'seva@example.org',
      address: 'Near main road, Sector 22',
      registrationType: 'Community kitchen (unregistered)',
      accepts: ['Meals'],
      serviceArea: 'Sector 22',
      docs: [{ id: 1, kind: 'Alternative evidence', name: 'letter.pdf', size: 1, type: 'application/pdf' }],
    }
    expect(validateApplication(r)).toEqual({})
  })
  test('approval needs the full checklist and a matching check', () => {
    const app = { ...blankApplication('recipient'), checks: [] }
    expect(canApprove(app)).toMatch(/checklist/)
    const ticked = { ...app, checklist: Object.fromEntries(CHECKLIST.recipient.map((c) => [c.key, true])) }
    expect(canApprove(ticked)).toMatch(/Match/)
  })
  test('approving Roti Bank makes it matchable; suspending Annapurna excludes it', () => {
    let s = withApps()
    const d = donation({ servings: 20 })
    const before = runMatchingPipeline(d, s, NOW)
    expect(before.excluded.some((e) => e.ngo.name === 'Roti Bank Manimajra')).toBe(true)

    const roti = { ...s.applications!.find((a) => a.orgName === 'Roti Bank Manimajra')!, status: 'Verified' as const }
    s = { ...s, ngos: syncNgo(s, roti).ngos }
    const after = runMatchingPipeline(d, s, NOW)
    expect(after.excluded.some((e) => e.ngo.name === 'Roti Bank Manimajra' && e.failures.some((f) => /verified partner/.test(f)))).toBe(false)

    const anna = { ...s.applications!.find((a) => a.orgName === 'Annapurna Community Kitchen')!, status: 'Resubmission Required' as const }
    s = { ...s, ngos: syncNgo(s, anna).ngos }
    const suspended = runMatchingPipeline(d, s, NOW)
    const ex = suspended.excluded.find((e) => e.ngo.name === 'Annapurna Community Kitchen')
    expect(ex?.failures[0]).toMatch(/Not a verified partner \(resubmission required\)/)
  })
  test('first approval of a new recipient creates a matchable NGO', () => {
    const s = withApps()
    const app: TrustApplication = { ...blankApplication('recipient'), orgName: 'New Shelter', orgType: 'NGO', area: 'Sector 22', status: 'Verified', dailyCapacity: 80, accepts: ['Meals'], refrigeration: true, fridgeLitres: 100, acceptsNonVeg: true }
    const { ngos, ngoId } = syncNgo(s, app)
    expect(ngoId).not.toBeNull()
    const n = ngos.find((x) => x.id === ngoId)!
    expect(n.verification).toBe('Verified')
    const p = runMatchingPipeline(donation({ area: 'Sector 22', lat: 30.734, lng: 76.775 }), { ...s, ngos }, NOW)
    expect([...p.eligible, ...p.excluded].some((e) => e.ngo.name === 'New Shelter')).toBe(true)
  })
})

describe('Guide and alerts (rules, not AI)', () => {
  test('in-review listing → inspect first, with the hold reasons', () => {
    const s = demo()
    const d = donation({ status: 'In review', screening: { outcome: 'review', visual: 'Uncertain', rules: [], reviewReasons: ['Photo too dark.'], screenedAt: NOW, ai: null, edited: [] } })
    const g = rescueGuide(d, s, NOW, null)
    expect(g.next).toMatch(/Inspect the food/)
    expect(g.why).toMatch(/Photo too dark/)
  })
  test('alerts: no free runner with a reserved rescue waiting', () => {
    const s = demo()
    s.runners = s.runners.map((r) => ({ ...r, onShift: false }))
    s.donations = [donation({ status: 'Reserved', ngoId: 101, stage: 'Pending' }), ...s.donations]
    expect(operationalAlerts(s, NOW).some((a) => a.id === 'runners' && a.tone === 'bad')).toBe(true)
  })
})
