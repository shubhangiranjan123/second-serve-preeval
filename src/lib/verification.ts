// Engine 1, step 2: the transparent safety-validation layer.
//
// The vision model (lib/foodScan.ts) only DESCRIBES what is visible. This
// file decides what to do with that description, combined with what the
// donor declares. Every rule is plain code with a plain-language reason, so a
// judge, a donor or an NGO can see exactly why a listing was published, held
// for review or refused.
//
//   any rule "fail"               → reject      (not published)
//   any required field "missing"  → incomplete  (can't submit yet)
//   any blocking "warn"           → review      (listed as 'In review', NOT matched)
//   otherwise                     → pass        (published as AI-screened, auto-matched)
//
// "pass" means: nothing visible or declared breaks a platform rule. It is a
// screening result, NOT a food-safety certification. A photo cannot show
// temperature history, microbial load or allergens.
//
// The thresholds below are SECOND-SERVE platform policy, chosen to be
// conservative. They are modelled on the widely used "2-hour rule" for cooked
// food at room temperature, but they are not a legal standard.

import type { Category, Diet, Packaging, RuleCheck, ScreeningOutcome, StorageType, VisualVerdict } from '../types'
import type { FoodScan } from './foodScan'
import { formatDuration } from './engine'

export const SAFETY_POLICY = {
  minOverallConfidence: 0.55, // below this the AI reading is not trusted
  mismatchConfidence: 0.7, // AI must be this sure before contradicting the donor's category
  dietConfidence: 0.6, // AI must be this sure it saw meat/egg/fish
  notFoodConfidence: 0.6, // AI must be this sure the photo isn't food to reject it outright
  ambientCookedMaxMinutes: 120, // cooked food at room temperature: total time since cooking
  chilledCookedMaxHours: 24, // cooked food kept chilled: time since cooking + declared window
  quantityOverstatement: 3, // declared servings > 3x the AI's visible estimate → flag
}

const HARD_CONCERNS = new Set(['spoilage', 'mould', 'pests', 'contamination', 'foreign_object'])

export type DonorFacts = {
  name: string
  category: Category
  diet: Diet
  storage: StorageType
  packaging: Packaging | null
  cookedMinutesAgo: number // NaN when not given
  prepMinutes: number
  safeHours: number
  servings: number
  checklistDone: boolean
}

export type ScanInput =
  | { kind: 'scan'; scan: FoodScan; photoCount?: number }
  | { kind: 'error'; message: string } // the AI could not run
  | { kind: 'none' } // ordinary manual listing (no AI step)

export type Verification = {
  outcome: ScreeningOutcome
  visual: VisualVerdict
  rules: RuleCheck[]
  failReasons: string[]
  reviewReasons: string[]
  missing: string[]
  advisories: string[]
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const valid = (n: number) => Number.isFinite(n)

export function visualVerdict(input: ScanInput): VisualVerdict {
  if (input.kind !== 'scan') return 'Not scanned'
  const s = input.scan
  if (!s.isFood && s.confidence.identification >= SAFETY_POLICY.notFoodConfidence) return 'Potentially unsuitable'
  if (s.concerns.some((c) => c.severity !== 'low')) return 'Potentially unsuitable'
  if (s.visualAssessment === 'concerns') return 'Potentially unsuitable'
  if (s.visualAssessment === 'uncertain' || !s.isFood || s.confidence.overall < SAFETY_POLICY.minOverallConfidence) return 'Uncertain'
  return 'Visually acceptable'
}

function aiRules(input: ScanInput, d: DonorFacts): RuleCheck[] {
  if (input.kind === 'none') return []
  if (input.kind === 'error')
    return [
      {
        id: 'ai-scan',
        label: 'AI visual screening',
        status: 'warn',
        blocking: true,
        source: 'AI vision',
        detail: `The photo could not be analysed (${input.message}). A person must inspect this food before it is matched.`,
      },
    ]

  const s = input.scan
  const out: RuleCheck[] = []

  // 1. Is it food at all?
  if (s.isFood) out.push({ id: 'ai-food', label: 'Photo shows food', status: 'pass', source: 'AI vision', detail: `Identified as ${s.dishName || 'food'} (${pct(s.confidence.identification)} sure).` })
  else if (s.confidence.identification >= SAFETY_POLICY.notFoodConfidence)
    out.push({ id: 'ai-food', label: 'Photo shows food', status: 'fail', source: 'AI vision', detail: 'The photo does not appear to show food. Retake it with the food clearly in frame.' })
  else out.push({ id: 'ai-food', label: 'Photo shows food', status: 'warn', blocking: true, source: 'AI vision', detail: 'The AI could not tell whether this is food.' })

  // 2. Visible condition.
  const high = s.concerns.filter((c) => c.severity === 'high')
  const medium = s.concerns.filter((c) => c.severity === 'medium')
  // Any high-severity concern refuses the listing. Medium concerns of the
  // "hard" kinds (spoilage, mould, pests…) still only go to review, because
  // the model may be wrong and a person can look at the actual food.
  const hardMedium = medium.filter((c) => HARD_CONCERNS.has(c.kind))
  if (high.length > 0)
    out.push({ id: 'ai-condition', label: 'Visible condition', status: 'fail', source: 'AI vision', detail: `Visible warning sign: ${high.map((c) => c.detail).join('; ')}. Do not redistribute.` })
  else if (hardMedium.length > 0)
    out.push({ id: 'ai-condition', label: 'Visible condition', status: 'warn', blocking: true, source: 'AI vision', detail: `Possible ${hardMedium.map((c) => c.kind.replace('_', ' ')).join(', ')}: ${hardMedium.map((c) => c.detail).join('; ')}. A person must inspect it.` })
  else if (medium.length > 0 || s.visualAssessment === 'concerns')
    out.push({ id: 'ai-condition', label: 'Visible condition', status: 'warn', blocking: true, source: 'AI vision', detail: `Needs a human check: ${medium.map((c) => c.detail).join('; ') || 'the AI flagged a visual concern'}.` })
  else if (s.visualAssessment === 'uncertain')
    out.push({ id: 'ai-condition', label: 'Visible condition', status: 'warn', blocking: true, source: 'AI vision', detail: 'The photo is too unclear to judge the food’s condition (dark, blurry or partly hidden).' })
  else
    out.push({ id: 'ai-condition', label: 'Visible condition', status: 'pass', source: 'AI vision', detail: `No visible spoilage, mould or contamination (${pct(s.confidence.condition)} sure). This does not prove the food is safe.` })

  // 3. Confidence.
  if (s.confidence.overall < SAFETY_POLICY.minOverallConfidence)
    out.push({ id: 'ai-confidence', label: 'AI confidence', status: 'warn', blocking: true, source: 'AI vision', detail: `Only ${pct(s.confidence.overall)} confident overall (threshold ${pct(SAFETY_POLICY.minOverallConfidence)}). A person must confirm what this is.` })
  else out.push({ id: 'ai-confidence', label: 'AI confidence', status: 'pass', source: 'AI vision', detail: `${pct(s.confidence.overall)} confident overall.` })

  // 4. Diet: a veg-only kitchen must never receive meat by mistake.
  if (s.dietGuess === 'Non-veg' && d.diet !== 'Non-veg' && s.confidence.identification >= SAFETY_POLICY.dietConfidence)
    out.push({ id: 'ai-diet', label: 'Diet matches photo', status: 'warn', blocking: true, source: 'AI vision', detail: `You marked this ${d.diet}, but the photo appears to contain meat, fish or egg. A person must confirm before it can go to a vegetarian kitchen.` })
  else if (s.dietGuess !== 'Unknown')
    out.push({ id: 'ai-diet', label: 'Diet matches photo', status: 'pass', source: 'AI vision', detail: `Photo looks ${s.dietGuess.toLowerCase()}; listing says ${d.diet}.` })

  // 5. Category (advisory only: the donor knows their food).
  if (s.category !== 'Unknown' && s.category !== d.category && s.confidence.identification >= SAFETY_POLICY.mismatchConfidence)
    out.push({ id: 'ai-category', label: 'Category matches photo', status: 'warn', source: 'AI vision', detail: `AI read it as ${s.category}; you chose ${d.category}. Kept your choice.` })

  // 6. Packaging contradiction.
  if (s.packaging === 'open' && d.packaging === 'Sealed')
    out.push({ id: 'ai-packaging', label: 'Packaging matches photo', status: 'warn', blocking: true, source: 'AI vision', detail: 'You marked it sealed, but the food looks uncovered in the photo.' })

  // 7. Photo quality: blurry/dark photos can't support a visual check.
  const issues = s.qualityIssues.length ? ` (${s.qualityIssues.join(', ')})` : ''
  if (s.photoQuality === 'poor')
    out.push({ id: 'ai-quality', label: 'Photo quality', status: 'warn', blocking: true, source: 'AI vision', detail: `The photos are too unclear to judge the food${issues}. Retake them, or a person must inspect it.` })
  else if (s.photoQuality === 'fair')
    out.push({ id: 'ai-quality', label: 'Photo quality', status: 'warn', source: 'AI vision', detail: `Usable, but not ideal${issues}.` })
  else out.push({ id: 'ai-quality', label: 'Photo quality', status: 'pass', source: 'AI vision', detail: 'Photos are clear enough to read.' })

  // 8. All photos must show the same donation.
  const n = input.photoCount ?? 1
  if (n >= 2) {
    if (!s.samePhotoSet || s.inconsistencies.length > 0)
      out.push({
        id: 'ai-photo-set',
        label: 'Photos show one donation',
        status: 'warn',
        blocking: true,
        source: 'AI vision',
        detail: `The ${n} photos may not show the same food${s.inconsistencies.length ? `: ${s.inconsistencies.join('; ')}` : ''}. A person must check before it's listed as one donation.`,
      })
    else out.push({ id: 'ai-photo-set', label: 'Photos show one donation', status: 'pass', source: 'AI vision', detail: `All ${n} photos appear to show the same donation.` })
  }

  // 9. Quantity sanity (advisory).
  const est = s.quantity.inferable ? s.quantity.servings : null
  if (est && d.servings > est * SAFETY_POLICY.quantityOverstatement)
    out.push({ id: 'ai-quantity', label: 'Quantity looks plausible', status: 'warn', source: 'AI vision', detail: `You listed ${d.servings} servings; the photo suggests about ${est}. Make sure the photo shows all of it.` })

  return out
}

function donorRules(d: DonorFacts, scanned: boolean): RuleCheck[] {
  const out: RuleCheck[] = []
  const missing: string[] = []
  if (!d.name.trim()) missing.push('food name')
  if (!(d.servings >= 1)) missing.push('servings')
  if (!(d.safeHours > 0)) missing.push('safe-consumption window')
  if (scanned && !valid(d.cookedMinutesAgo)) missing.push('when it was cooked/prepared')
  if (scanned && !d.packaging) missing.push('packaging')
  out.push(
    missing.length
      ? { id: 'required', label: 'Required safety details', status: 'missing', source: 'Donor input', detail: `Still needed: ${missing.join(', ')}.` }
      : { id: 'required', label: 'Required safety details', status: 'pass', source: 'Donor input', detail: 'Preparation time, storage, packaging, quantity and safe window are all given.' },
  )

  // Safe window must be open and longer than the time to pack.
  if (d.safeHours > 0) {
    if (d.safeHours > 48)
      out.push({ id: 'window', label: 'Safe window is realistic', status: 'fail', source: 'Safety rule', detail: 'A declared safe window over 48 hours isn’t accepted for surplus food.' })
    else if (d.safeHours * 60 <= d.prepMinutes)
      out.push({ id: 'window', label: 'Safe window is realistic', status: 'fail', source: 'Safety rule', detail: `The food would be unsafe (${formatDuration(d.safeHours * 60)}) before it’s even packed (${d.prepMinutes} min). These details contradict each other.` })
    else out.push({ id: 'window', label: 'Safe window is realistic', status: 'pass', source: 'Safety rule', detail: `Safe for ${formatDuration(d.safeHours * 60)} from now, longer than the ${d.prepMinutes} min to pack.` })
  }

  // Time–temperature: only cooked meals carry a hard limit here.
  if (valid(d.cookedMinutesAgo) && d.cookedMinutesAgo >= 0 && d.safeHours > 0) {
    const sinceCook = d.cookedMinutesAgo
    const totalH = (sinceCook + d.safeHours * 60) / 60
    if (d.category !== 'Meals') {
      out.push({ id: 'time-temp', label: 'Time & temperature', status: 'pass', source: 'Safety rule', detail: `No cooked-food time limit applies to ${d.category.toLowerCase()}.` })
    } else if (d.storage === 'Ambient') {
      const limit = SAFETY_POLICY.ambientCookedMaxMinutes
      if (sinceCook > limit)
        out.push({ id: 'time-temp', label: 'Time & temperature', status: 'fail', source: 'Safety rule', detail: `Cooked food has been at room temperature for ${formatDuration(sinceCook)}, past the ${formatDuration(limit)} limit. Don’t redistribute it.` })
      else if (sinceCook + d.safeHours * 60 > limit)
        out.push({ id: 'time-temp', label: 'Time & temperature', status: 'fail', source: 'Safety rule', detail: `At room temperature, cooked food may stay out ${formatDuration(limit)} in total. Your window would run to ${formatDuration(sinceCook + d.safeHours * 60)}. Shorten it to ${formatDuration(Math.max(0, limit - sinceCook))} or keep it chilled.` })
      else out.push({ id: 'time-temp', label: 'Time & temperature', status: 'pass', source: 'Safety rule', detail: `Room temperature for ${formatDuration(sinceCook + d.safeHours * 60)} in total, within the ${formatDuration(limit)} limit.` })
    } else if (d.storage === 'Chilled') {
      const limit = SAFETY_POLICY.chilledCookedMaxHours
      if (totalH > limit)
        out.push({ id: 'time-temp', label: 'Time & temperature', status: 'fail', source: 'Safety rule', detail: `Chilled cooked food: cooking time plus safe window is ${Math.round(totalH)} h, over the ${limit} h platform limit.` })
      else out.push({ id: 'time-temp', label: 'Time & temperature', status: 'pass', source: 'Safety rule', detail: `Kept chilled; ${Math.round(totalH * 10) / 10} h from cooking to end of window (limit ${limit} h).` })
    } else {
      out.push({ id: 'time-temp', label: 'Time & temperature', status: 'pass', source: 'Safety rule', detail: 'Frozen: no cooked-food time limit applied.' })
    }
  }

  if (d.packaging) {
    if (d.packaging === 'Open' && (d.category === 'Meals' || d.category === 'Bakery'))
      out.push({ id: 'packaging', label: 'Packaging', status: 'fail', source: 'Safety rule', detail: `${d.category} must be sealed or covered before pickup.` })
    else if (d.packaging === 'Open')
      out.push({ id: 'packaging', label: 'Packaging', status: 'warn', source: 'Safety rule', detail: 'Uncovered produce: ask the runner to bag it.' })
    else out.push({ id: 'packaging', label: 'Packaging', status: 'pass', source: 'Safety rule', detail: `${d.packaging} for transport.` })
  }

  out.push(
    d.checklistDone
      ? { id: 'checklist', label: 'Safe-handling checklist', status: 'pass', source: 'Donor input', detail: 'All four safe-handling points confirmed by the donor.' }
      : { id: 'checklist', label: 'Safe-handling checklist', status: 'missing', source: 'Donor input', detail: 'Confirm every safe-handling point.' },
  )
  return out
}

export function verifyDonation(input: ScanInput, d: DonorFacts): Verification {
  const rules = [...aiRules(input, d), ...donorRules(d, input.kind !== 'none')]
  const failReasons = rules.filter((r) => r.status === 'fail').map((r) => r.detail)
  const missing = rules.filter((r) => r.status === 'missing').map((r) => r.detail)
  const reviewReasons = rules.filter((r) => r.status === 'warn' && r.blocking).map((r) => r.detail)
  const advisories = rules.filter((r) => r.status === 'warn' && !r.blocking).map((r) => r.detail)
  const outcome: ScreeningOutcome = failReasons.length ? 'reject' : missing.length ? 'incomplete' : reviewReasons.length ? 'review' : 'pass'
  return { outcome, visual: visualVerdict(input), rules, failReasons, reviewReasons, missing, advisories }
}

export const OUTCOME_COPY: Record<ScreeningOutcome, { title: string; body: string }> = {
  pass: {
    title: 'Passed screening',
    body: 'Nothing visible or declared breaks a rule. It will be published and matched automatically. This is a screening result, not a food-safety certificate.',
  },
  review: {
    title: 'Needs a human check',
    body: 'It will be listed as “In review”. No NGO is matched until a coordinator inspects and approves it.',
  },
  reject: {
    title: 'Can’t be published',
    body: 'This food fails a mandatory safety rule. Fix the details if they were wrong, otherwise please don’t redistribute it.',
  },
  incomplete: {
    title: 'Missing safety details',
    body: 'Fill in the highlighted details before this can be screened.',
  },
}

// Which fields the donor changed after the AI pre-filled them (recorded with
// the listing, so reviewers can see what was human-corrected).
export type Suggestion = Partial<Record<'name' | 'category' | 'diet' | 'servings' | 'quantity' | 'unit' | 'description', string>>

export function editedFields(suggested: Suggestion, final: Suggestion): string[] {
  return (Object.keys(suggested) as Array<keyof Suggestion>).filter(
    (k) => suggested[k] !== undefined && String(suggested[k]).trim() !== String(final[k] ?? '').trim(),
  )
}
