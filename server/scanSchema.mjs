// Engine 1, step 1: what we ask the vision model for, and how we check
// what comes back. The model's reply is NEVER trusted as-is: normalizeScan()
// coerces every field into a known shape, and anything it cannot read is
// recorded as "unknown" / "uncertain" rather than guessed.

export const CATEGORIES = ['Meals', 'Bakery', 'Produce', 'Dry rations', 'Unknown']
export const DIETS = ['Veg', 'Non-veg', 'Unknown']
export const VISUAL = ['acceptable', 'concerns', 'uncertain']
export const CONCERN_KINDS = [
  'spoilage',
  'mould',
  'discoloration',
  'contamination',
  'pests',
  'foreign_object',
  'packaging',
  'other',
]
export const SEVERITIES = ['low', 'medium', 'high']
export const PACKAGING = ['sealed', 'covered', 'open', 'unclear']
export const UNITS = ['servings', 'boxes', 'items', 'kg']

export const SCAN_PROMPT = `You are the visual screening step of SECOND-SERVE, a platform that redistributes surplus food from restaurants to NGOs and shelters in India.

Look at the photo and describe ONLY what is visible. You cannot judge microbiological safety, temperature or age from a photo, so never claim the food is "safe". Be conservative: if you are not sure, say so with a lower confidence and mark the visual assessment "uncertain".

Return JSON with:
- isFood: is the main subject food intended for people?
- dishName: short, specific name suitable for a listing (e.g. "Veg pulao with dal tadka"). Use Indian dish names where they fit.
- items: list of distinct foods you can see.
- category: "Meals" (cooked dishes), "Bakery" (bread, buns, cakes, biscuits), "Produce" (raw fruit/vegetables), "Dry rations" (packaged grains, flour, pulses), or "Unknown".
- dietGuess: "Non-veg" ONLY if meat, fish or egg is visible; "Veg" if clearly vegetarian; otherwise "Unknown".
- visualAssessment: "acceptable" (no visible problems), "concerns" (something visible needs attention), or "uncertain" (photo too dark, blurry, partial or ambiguous to judge).
- concerns: each visible issue, with kind (spoilage, mould, discoloration, contamination, pests, foreign_object, packaging, other), a one-line detail, and severity (high = should not be eaten, medium = needs a human to check, low = cosmetic).
- packaging: "sealed", "covered", "open" (food exposed) or "unclear".
- quantity: set inferable=true only if you can reasonably count or estimate it; give servings and/or amount+unit (servings, boxes, items, kg) and a short basis for the estimate. Otherwise inferable=false, servings=0, amount=0, unit="none".
- confidence: numbers from 0 to 1 for overall, identification (what the food is) and condition (visible state).
- reviewNotes: anything a human inspector should double-check.
- description: one or two plain sentences for the listing, describing only what is visible (no safety claims).`

// JSON Schema shared by both providers (Gemini responseJsonSchema / Claude tool input_schema).
export const SCAN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    isFood: { type: 'boolean' },
    dishName: { type: 'string' },
    items: { type: 'array', items: { type: 'string' } },
    category: { type: 'string', enum: CATEGORIES },
    dietGuess: { type: 'string', enum: DIETS },
    visualAssessment: { type: 'string', enum: VISUAL },
    concerns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: CONCERN_KINDS },
          detail: { type: 'string' },
          severity: { type: 'string', enum: SEVERITIES },
        },
        required: ['kind', 'detail', 'severity'],
      },
    },
    packaging: { type: 'string', enum: PACKAGING },
    quantity: {
      type: 'object',
      properties: {
        inferable: { type: 'boolean' },
        // Plain types only (no "number | null"): some Gemini versions reject
        // nullable unions. 0 / "none" mean "not given"; normalizeScan() maps them to null.
        servings: { type: 'number' },
        amount: { type: 'number' },
        unit: { type: 'string', enum: [...UNITS, 'none'] },
        basis: { type: 'string' },
      },
      required: ['inferable', 'servings', 'amount', 'unit', 'basis'],
    },
    confidence: {
      type: 'object',
      properties: {
        overall: { type: 'number' },
        identification: { type: 'number' },
        condition: { type: 'number' },
      },
      required: ['overall', 'identification', 'condition'],
    },
    reviewNotes: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
  },
  required: [
    'isFood',
    'dishName',
    'items',
    'category',
    'dietGuess',
    'visualAssessment',
    'concerns',
    'packaging',
    'quantity',
    'confidence',
    'reviewNotes',
    'description',
  ],
}

export class ScanError extends Error {
  /** @param {string} code  @param {string} message  @param {number} status */
  constructor(code, message, status = 502) {
    super(message)
    this.code = code
    this.status = status
  }
}

const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback)
const str = (v, max = 160) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const prob = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)
const posNum = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(max, Math.round(v * 10) / 10) : null)

/** Pull the first JSON object out of a model's text (handles ```json fences). */
export function extractJson(text) {
  if (typeof text !== 'string') throw new ScanError('INVALID_RESPONSE', 'Model returned no text')
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new ScanError('INVALID_RESPONSE', 'Model reply contained no JSON object')
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    throw new ScanError('INVALID_RESPONSE', 'Model reply was not valid JSON')
  }
}

/**
 * Coerce a raw model reply into the FoodScan shape the frontend expects.
 * Missing or malformed fields become conservative defaults ("Unknown",
 * "uncertain", confidence 0): we never invent a value the model did not give.
 */
export function normalizeScan(raw) {
  if (!raw || typeof raw !== 'object') throw new ScanError('INVALID_RESPONSE', 'Model reply was not an object')
  const q = raw.quantity && typeof raw.quantity === 'object' ? raw.quantity : {}
  const c = raw.confidence && typeof raw.confidence === 'object' ? raw.confidence : {}
  const concerns = Array.isArray(raw.concerns)
    ? raw.concerns
        .filter((x) => x && typeof x === 'object')
        .slice(0, 8)
        .map((x) => ({
          kind: oneOf(x.kind, CONCERN_KINDS, 'other'),
          detail: str(x.detail, 200) || 'Unspecified visual concern',
          severity: oneOf(x.severity, SEVERITIES, 'medium'),
        }))
    : []
  const servings = posNum(q.servings, 2000)
  const amount = posNum(q.amount, 2000)
  const unit = oneOf(q.unit, UNITS, null)
  const inferable = q.inferable === true && (servings !== null || (amount !== null && unit !== null))

  let visual = oneOf(raw.visualAssessment, VISUAL, 'uncertain')
  // A reply that lists a concern can't also be "acceptable".
  if (visual === 'acceptable' && concerns.some((x) => x.severity !== 'low')) visual = 'concerns'

  return {
    isFood: raw.isFood === true,
    dishName: str(raw.dishName, 80),
    items: Array.isArray(raw.items) ? raw.items.map((s) => str(s, 60)).filter(Boolean).slice(0, 12) : [],
    category: oneOf(raw.category, CATEGORIES, 'Unknown'),
    dietGuess: oneOf(raw.dietGuess, DIETS, 'Unknown'),
    visualAssessment: visual,
    concerns,
    packaging: oneOf(raw.packaging, PACKAGING, 'unclear'),
    quantity: {
      inferable,
      servings: inferable ? servings : null,
      amount: inferable ? amount : null,
      unit: inferable ? unit : null,
      basis: str(q.basis, 160),
    },
    confidence: {
      overall: prob(c.overall),
      identification: prob(c.identification),
      condition: prob(c.condition),
    },
    reviewNotes: Array.isArray(raw.reviewNotes) ? raw.reviewNotes.map((s) => str(s, 200)).filter(Boolean).slice(0, 6) : [],
    description: str(raw.description, 300),
  }
}
