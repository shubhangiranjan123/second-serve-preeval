// Engine 1 — rule-based safety validation (scenarios 1–5, 10, 11 of the brief).
import { describe, expect, test } from 'vitest'
import { editedFields, verifyDonation } from '../src/lib/verification'
import { facts, scan } from './fixtures'

describe('Engine 1: food verification rules', () => {
  test('1 · valid-looking image + complete information → pass, "Visually acceptable"', () => {
    const v = verifyDonation({ kind: 'scan', scan: scan() }, facts())
    expect(v.outcome).toBe('pass')
    expect(v.visual).toBe('Visually acceptable')
    expect(v.failReasons).toEqual([])
    expect(v.reviewReasons).toEqual([])
    // A pass is still never worded as a safety certificate.
    const cond = v.rules.find((r) => r.id === 'ai-condition')!
    expect(cond.detail).toMatch(/does not prove the food is safe/)
  })

  test('2 · AI cannot confidently identify the food → review, "Uncertain"', () => {
    const v = verifyDonation(
      { kind: 'scan', scan: scan({ visualAssessment: 'uncertain', confidence: { overall: 0.32, identification: 0.3, condition: 0.2 } }) },
      facts(),
    )
    expect(v.outcome).toBe('review')
    expect(v.visual).toBe('Uncertain')
    expect(v.reviewReasons.join(' ')).toMatch(/confident/)
  })

  test('3a · high-severity visible warning sign (mould) → reject', () => {
    const v = verifyDonation(
      { kind: 'scan', scan: scan({ visualAssessment: 'concerns', concerns: [{ kind: 'mould', detail: 'Green fuzzy patches on the bread', severity: 'high' }] }) },
      facts({ category: 'Bakery', storage: 'Ambient' }),
    )
    expect(v.outcome).toBe('reject')
    expect(v.visual).toBe('Potentially unsuitable')
    expect(v.failReasons[0]).toMatch(/mould|fuzzy/i)
  })

  test('3b · medium visible concern → review, never auto-published', () => {
    const v = verifyDonation(
      { kind: 'scan', scan: scan({ visualAssessment: 'concerns', concerns: [{ kind: 'discoloration', detail: 'Dark edges on rice', severity: 'medium' }] }) },
      facts(),
    )
    expect(v.outcome).toBe('review')
    expect(v.visual).toBe('Potentially unsuitable')
  })

  test('3c · model says "acceptable" but lists a medium concern → treated as concern', () => {
    const v = verifyDonation(
      { kind: 'scan', scan: scan({ visualAssessment: 'acceptable', concerns: [{ kind: 'spoilage', detail: 'Possible souring', severity: 'medium' }] }) },
      facts(),
    )
    expect(v.outcome).toBe('review')
  })

  test('3d · photo is not food → reject', () => {
    const v = verifyDonation({ kind: 'scan', scan: scan({ isFood: false, confidence: { overall: 0.9, identification: 0.92, condition: 0.5 } }) }, facts())
    expect(v.outcome).toBe('reject')
  })

  test('4 · essential safety information missing → incomplete (cannot submit)', () => {
    const v = verifyDonation({ kind: 'scan', scan: scan() }, facts({ cookedMinutesAgo: NaN, packaging: null }))
    expect(v.outcome).toBe('incomplete')
    expect(v.missing[0]).toMatch(/cooked\/prepared/)
    expect(v.missing[0]).toMatch(/packaging/)
  })

  test('4b · checklist unticked → incomplete', () => {
    expect(verifyDonation({ kind: 'scan', scan: scan() }, facts({ checklistDone: false })).outcome).toBe('incomplete')
  })

  test('5a · fails mandatory rule: cooked food at room temperature > 2 h → reject', () => {
    const v = verifyDonation({ kind: 'scan', scan: scan() }, facts({ storage: 'Ambient', cookedMinutesAgo: 150, safeHours: 1 }))
    expect(v.outcome).toBe('reject')
    expect(v.failReasons.join(' ')).toMatch(/room temperature/)
  })

  test('5b · ambient cooked food whose declared window runs past 2 h → reject with a fix', () => {
    const v = verifyDonation({ kind: 'scan', scan: scan() }, facts({ storage: 'Ambient', cookedMinutesAgo: 60, safeHours: 3 }))
    expect(v.outcome).toBe('reject')
    expect(v.failReasons.join(' ')).toMatch(/Shorten it to 1 h/)
    // …and the same food with a compliant window passes.
    expect(verifyDonation({ kind: 'scan', scan: scan() }, facts({ storage: 'Ambient', cookedMinutesAgo: 60, safeHours: 0.75 })).outcome).toBe('pass')
  })

  test('5c · open packaging for a cooked meal → reject', () => {
    expect(verifyDonation({ kind: 'scan', scan: scan({ packaging: 'open' }) }, facts({ packaging: 'Open' })).outcome).toBe('reject')
  })

  test('5d · contradictory timing (unsafe before it is packed) → reject', () => {
    expect(verifyDonation({ kind: 'scan', scan: scan() }, facts({ safeHours: 0.25, prepMinutes: 30 })).outcome).toBe('reject')
  })

  test('5e · chilled cooked food beyond 24 h from cooking → reject', () => {
    expect(verifyDonation({ kind: 'scan', scan: scan() }, facts({ cookedMinutesAgo: 20 * 60, safeHours: 6 })).outcome).toBe('reject')
  })

  test('diet contradiction: photo shows meat but donor says Veg → review (protects veg-only kitchens)', () => {
    const v = verifyDonation({ kind: 'scan', scan: scan({ dietGuess: 'Non-veg', dishName: 'Chicken biryani' }) }, facts({ diet: 'Veg' }))
    expect(v.outcome).toBe('review')
    expect(v.reviewReasons.join(' ')).toMatch(/meat, fish or egg/)
  })

  test('packaging contradiction: donor says sealed, photo looks open → review', () => {
    expect(verifyDonation({ kind: 'scan', scan: scan({ packaging: 'open' }) }, facts({ packaging: 'Sealed' })).outcome).toBe('review')
  })

  test('category disagreement is advisory only (donor keeps their choice)', () => {
    const v = verifyDonation({ kind: 'scan', scan: scan({ category: 'Bakery' }) }, facts())
    expect(v.outcome).toBe('pass')
    expect(v.advisories.join(' ')).toMatch(/Kept your choice/)
  })

  test('10 · image API failed/timed out → review, never a fabricated pass', () => {
    const v = verifyDonation({ kind: 'error', message: 'TIMEOUT' }, facts())
    expect(v.outcome).toBe('review')
    expect(v.visual).toBe('Not scanned')
  })

  test('manual listing without AI keeps the original behaviour (no new required fields)', () => {
    const v = verifyDonation({ kind: 'none' }, facts({ cookedMinutesAgo: NaN, packaging: null }))
    expect(v.outcome).toBe('pass')
    expect(v.visual).toBe('Not scanned')
  })

  test('11 · donor edits to AI-generated details are tracked', () => {
    const ai = { name: 'Veg pulao', category: 'Meals', servings: '20', diet: 'Veg' }
    expect(editedFields(ai, { name: 'Veg pulao', category: 'Meals', servings: '35', diet: 'Jain' })).toEqual(['servings', 'diet'])
    expect(editedFields(ai, { ...ai })).toEqual([])
  })
})
