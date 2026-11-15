// Every change to SECOND-SERVE data goes through applyAction().
//
// The SAME function runs in two places:
//   • on the server (server/build/core.mjs, bundled from this file), against
//     the SQLite database, for every signed-in user;
//   • in the browser, in offline mode when no server is reachable.
// So the rules can't drift apart: who may do what, valid status changes,
// gate checks before a reservation, duplicate and double-booking guards.

import type {
  AppState,
  Category,
  Diet,
  Donation,
  MatchWeights,
  Packaging,
  Screening,
  StorageType,
  TrustApplication,
  TrustCheckRecord,
} from '../types'
import { createInitialState, findArea } from '../data/demoData'
import { MIN, estimateWeightKg } from './engine'
import { runMatchingPipeline } from './pipeline'
import { canApprove, createInitialApplications, nextStatus, syncNgo, type ReviewAction } from './trust'

// ---------------------------------------------------------------- types

export type Role = 'coordinator' | 'donor' | 'ngo' | 'runner'

/** Who is acting. On the server this comes from the session, never from the request body. */
export type Actor = {
  role: Role
  name: string
  userId?: number
  donorName?: string // donor accounts: the organisation name used on listings
  ngoId?: number | null // NGO accounts (null until TrustCheck approves them)
  runnerId?: number // runner accounts
  applicationId?: number | null
}

export type NewDonationInput = {
  name: string
  donor: string
  category: Category
  servings: number
  quantity: number
  unit: string
  area: string
  address: string
  storage: StorageType
  diet: Diet
  description: string
  prepMinutes: number
  travelEstimate: number
  safeHours: number
}

export type ScreenedExtras = {
  preparedAt?: number
  packaging?: Packaging
  screening?: Screening
}

export type Action =
  | { type: 'addDonation'; input: NewDonationInput; extras?: ScreenedExtras; autoMatch?: boolean }
  | { type: 'approveReview'; donationId: number; note?: string; autoMatch?: boolean }
  | { type: 'reserve'; donationId: number; ngoId: number; score: number }
  | { type: 'autoMatch'; donationId: number }
  | { type: 'releaseMatch'; donationId: number }
  | { type: 'assignRunner'; donationId: number; runnerId: number }
  | { type: 'advance'; donationId: number }
  | { type: 'withdraw'; donationId: number }
  | { type: 'splitDonation'; donationId: number; servings: number; autoMatch?: boolean }
  | { type: 'ngoDecline'; donationId: number; reason: string }
  | { type: 'ngoConfirmReceipt'; donationId: number }
  | { type: 'setAccepting'; ngoId: number; accepting: boolean }
  | { type: 'toggleShift'; runnerId: number }
  | { type: 'setWeights'; weights: MatchWeights | null }
  | { type: 'submitApplication'; draft: TrustApplication; asDraft?: boolean }
  | { type: 'reviewApplication'; id: number; action: ReviewAction; note?: string }
  | { type: 'addTrustCheck'; id: number; check: Omit<TrustCheckRecord, 'id' | 'at' | 'by'> }
  | { type: 'toggleTrustItem'; id: number; key: string }
  | { type: 'reset' }

export type ActionResult = {
  donation?: Donation
  matchedTo?: string | null // NGO name if auto-matching reserved one
  matchNote?: string
  application?: TrustApplication
}

export class ActionError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

const fail = (msg: string, code = 'INVALID', status = 400): never => {
  throw new ActionError(code, msg, status)
}
const forbid = (msg: string): never => fail(msg, 'FORBIDDEN', 403)

// ---------------------------------------------------------------- helpers

const nextId = (xs: Array<{ id: number }>) => Math.max(0, ...xs.map((x) => x.id)) + 1
const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const str = (v: unknown, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.length <= max

function findDonation(s: AppState, id: number) {
  return s.donations.find((d) => d.id === id) ?? fail('That listing no longer exists.', 'NOT_FOUND', 404)
}

function patchDonation(s: AppState, id: number, fn: (d: Donation) => Donation): AppState {
  return { ...s, donations: s.donations.map((d) => (d.id === id ? fn(d) : d)) }
}

function validateInput(i: NewDonationInput) {
  if (!i || typeof i !== 'object') fail('Missing listing details.')
  if (!str(i.name, 80)) fail('Name the food.')
  if (!str(i.donor, 120)) fail('Who is donating?')
  if (!['Meals', 'Bakery', 'Produce', 'Dry rations'].includes(i.category)) fail('Unknown category.')
  if (!num(i.servings, 1, 2000)) fail('Servings must be 1–2000.')
  if (!num(i.quantity, 0.01, 100000)) fail('Quantity must be above 0.')
  if (!['servings', 'boxes', 'items', 'kg'].includes(i.unit)) fail('Unknown unit.')
  if (!str(i.address, 200)) fail('Where should the runner go?')
  if (!['Ambient', 'Chilled', 'Frozen'].includes(i.storage)) fail('Unknown storage.')
  if (!['Veg', 'Jain', 'Non-veg'].includes(i.diet)) fail('Unknown diet.')
  if (!num(i.prepMinutes, 0, 240)) fail('Preparation time must be 0–240 min.')
  if (!num(i.travelEstimate, 1, 180)) fail('Travel estimate must be 1–180 min.')
  if (!num(i.safeHours, 0.05, 48)) fail('Safe window must be up to 48 h.')
  if (typeof i.description !== 'string' || i.description.length > 1000) fail('Description is too long.')
}

/** Reserve the best feasible NGO for an Available listing, if there is one. */
function runAutoMatch(s: AppState, donationId: number, now: number): { state: AppState; matchedTo: string | null; note: string } {
  const d = s.donations.find((x) => x.id === donationId)
  if (!d || d.status !== 'Available') return { state: s, matchedTo: null, note: 'Not available for matching.' }
  const p = runMatchingPipeline(d, s, now, s.weights)
  if (!p.recommended) return { state: s, matchedTo: null, note: p.hints[0]?.text ?? p.headline }
  const ngo = p.recommended.e.ngo
  const state = patchDonation(s, donationId, (x) => ({
    ...x,
    status: 'Reserved',
    ngoId: ngo.id,
    stage: 'Pending',
    timeline: [...x.timeline, { key: 'matched', at: now, note: `Matched to ${ngo.name} · score ${p.recommended!.score}` }],
  }))
  return { state, matchedTo: ngo.name, note: p.recommended.feasibilityNote }
}

// ---------------------------------------------------------------- permissions

/** Can this actor perform this action at all (before looking at the data)? */
function authorize(a: Action, actor: Actor, s: AppState) {
  if (actor.role === 'coordinator') return
  const own = (id: number) => s.donations.find((d) => d.id === id)
  switch (a.type) {
    case 'addDonation':
      if (actor.role !== 'donor') forbid('Only donors and coordinators can list food.')
      return
    case 'withdraw': {
      const d = own(a.donationId)
      if (actor.role !== 'donor' || !d || d.donor !== actor.donorName) forbid('You can only withdraw your own listings.')
      return
    }
    case 'ngoDecline':
    case 'ngoConfirmReceipt': {
      const d = own(a.donationId)
      if (actor.role !== 'ngo' || !d || actor.ngoId == null || d.ngoId !== actor.ngoId) forbid('This rescue isn’t addressed to your organisation.')
      return
    }
    case 'setAccepting':
      if (actor.role !== 'ngo' || actor.ngoId !== a.ngoId) forbid('You can only change your own organisation.')
      return
    case 'toggleShift':
      if (actor.role !== 'runner' || actor.runnerId !== a.runnerId) forbid('You can only change your own shift.')
      return
    case 'assignRunner':
      if (actor.role !== 'runner' || actor.runnerId !== a.runnerId) forbid('Runners can only take runs for themselves.')
      return
    case 'advance': {
      const d = own(a.donationId)
      if (actor.role !== 'runner' || !d || d.runnerId !== actor.runnerId) forbid('Only the runner on this rescue can update it.')
      return
    }
    case 'submitApplication': {
      const want = a.draft?.role
      if (!((actor.role === 'donor' && want === 'donor') || (actor.role === 'ngo' && want === 'recipient'))) forbid('Apply with the matching account type.')
      const existing = (s.applications ?? []).find((x) => x.id === a.draft.id)
      if (existing && existing.id !== actor.applicationId) forbid('That application belongs to another organisation.')
      return
    }
    default:
      forbid('Only a coordinator can do that.')
  }
}

// ---------------------------------------------------------------- reducer

export function applyAction(s: AppState, a: Action, actor: Actor, now: number): { state: AppState; result: ActionResult } {
  if (!a || typeof a !== 'object' || typeof a.type !== 'string') fail('Unknown action.')
  authorize(a, actor, s)
  const result: ActionResult = {}

  switch (a.type) {
    case 'addDonation': {
      const input = { ...a.input }
      if (actor.role === 'donor') input.donor = actor.donorName ?? actor.name // donors can't list as someone else
      validateInput(input)
      const dup = s.donations.find(
        (d) =>
          d.status !== 'Delivered' &&
          d.donor.trim().toLowerCase() === input.donor.trim().toLowerCase() &&
          d.name.trim().toLowerCase() === input.name.trim().toLowerCase() &&
          now - d.createdAt < 10 * MIN,
      )
      if (dup) fail(`“${input.name}” from ${input.donor} is already on the board.`, 'DUPLICATE', 409)
      const extras = a.extras ?? {}
      if (extras.screening && !['pass', 'review'].includes(extras.screening.outcome)) fail('Only screened food that passed or needs review can be listed.')
      const held = !extras.screening || extras.screening.outcome === 'review'
      // A listing without an AI screening (e.g. created by API) always waits for a human check.
      const area = findArea(input.area)
      const { safeHours, ...fields } = input
      const created: Donation = {
        id: nextId(s.donations),
        ...fields,
        lat: area.lat,
        lng: area.lng,
        createdAt: now,
        readyAt: now + input.prepMinutes * MIN,
        safeUntil: now + Math.round(safeHours * 60) * MIN,
        status: held ? 'In review' : 'Available',
        ngoId: null,
        runnerId: null,
        stage: 'Pending',
        timeline: [
          { key: 'created', at: now, note: extras.screening ? `Listed by ${input.donor} · AI-screened${held ? ', held for review' : ''}` : `Listed by ${input.donor} · needs a human check` },
        ],
        ...(extras.preparedAt ? { preparedAt: extras.preparedAt } : {}),
        ...(extras.packaging ? { packaging: extras.packaging } : {}),
        ...(extras.screening ? { screening: extras.screening } : {}),
      }
      let state: AppState = { ...s, donations: [created, ...s.donations] }
      if (a.autoMatch && !held) {
        const m = runAutoMatch(state, created.id, now)
        state = m.state
        result.matchedTo = m.matchedTo
        result.matchNote = m.note
      }
      result.donation = state.donations.find((d) => d.id === created.id)
      return { state, result }
    }

    case 'approveReview': {
      const d = findDonation(s, a.donationId)
      if (d.status !== 'In review') fail('This listing isn’t waiting for review.')
      if (d.safeUntil <= now) fail('Its safe window has closed. Reject it instead.')
      let state = patchDonation(s, d.id, (x) => ({
        ...x,
        status: 'Available',
        screening: x.screening ? { ...x.screening, review: { decision: 'approved', at: now, by: actor.name, note: a.note } } : x.screening,
        timeline: [...x.timeline, { key: 'created', at: now, note: `Food inspected and approved by ${actor.name}` }],
      }))
      if (a.autoMatch) {
        const m = runAutoMatch(state, d.id, now)
        state = m.state
        result.matchedTo = m.matchedTo
        result.matchNote = m.note
      }
      result.donation = state.donations.find((x) => x.id === d.id)
      return { state, result }
    }

    case 'reserve': {
      const d = findDonation(s, a.donationId)
      if (d.status !== 'Available') fail('Only available listings can be reserved.')
      // The server re-checks the 7 gates: a stale screen can't reserve an ineligible NGO.
      const p = runMatchingPipeline(d, s, now, s.weights)
      const c = p.ranked.find((x) => x.e.ngo.id === a.ngoId)
      if (!c) fail('That organisation no longer passes every safety gate for this food.', 'NOT_ELIGIBLE', 409)
      if (!c!.feasible) fail('That organisation can’t be reached in time any more.', 'NOT_FEASIBLE', 409)
      const state = patchDonation(s, d.id, (x) => ({
        ...x,
        status: 'Reserved',
        ngoId: a.ngoId,
        stage: 'Pending',
        timeline: [...x.timeline, { key: 'matched', at: now, note: `Matched to ${c!.e.ngo.name} · score ${c!.score}` }],
      }))
      return { state, result: { donation: state.donations.find((x) => x.id === d.id) } }
    }

    case 'autoMatch': {
      const m = runAutoMatch(s, a.donationId, now)
      return { state: m.state, result: { matchedTo: m.matchedTo, matchNote: m.note, donation: m.state.donations.find((x) => x.id === a.donationId) } }
    }

    case 'releaseMatch': {
      const d = findDonation(s, a.donationId)
      if (!(d.status === 'Reserved' && d.stage === 'Pending')) fail('Only a reservation without a runner can be released.')
      const state = patchDonation(s, d.id, (x) => ({ ...x, status: 'Available', ngoId: null, timeline: x.timeline.filter((t) => t.key === 'created') }))
      return { state, result }
    }

    case 'assignRunner': {
      const d = findDonation(s, a.donationId)
      const runner = s.runners.find((r) => r.id === a.runnerId) ?? fail('Unknown runner.')
      if (!(d.status === 'Reserved' && d.stage === 'Pending')) fail('This rescue already has a runner or isn’t reserved.', 'CONFLICT', 409)
      if (!runner.onShift) fail(`${runner.name} is off shift.`)
      const busy = s.donations.some((x) => x.id !== d.id && x.runnerId === runner.id && x.status === 'Reserved')
      if (busy) fail(`${runner.name} is already on another run.`, 'CONFLICT', 409)
      const state = patchDonation(s, d.id, (x) => ({
        ...x,
        runnerId: runner.id,
        stage: 'Assigned',
        timeline: [...x.timeline, { key: 'assigned', at: now, note: `${runner.name} accepted the run` }],
      }))
      return { state, result }
    }

    case 'advance': {
      const d = findDonation(s, a.donationId)
      if (d.status !== 'Reserved') fail('This rescue isn’t in progress.')
      if (d.stage === 'Assigned') {
        const state = patchDonation(s, d.id, (x) => ({ ...x, stage: 'Picked Up', timeline: [...x.timeline, { key: 'picked', at: now, note: `Collected from ${x.donor}` }] }))
        return { state, result }
      }
      if (d.stage === 'Picked Up') return { state: deliver(s, d, now), result }
      return fail('Assign a runner first.')
    }

    case 'ngoConfirmReceipt': {
      const d = findDonation(s, a.donationId)
      if (d.status === 'Delivered') {
        if (d.receivedBy) fail('Receipt already confirmed.')
        const state = patchDonation(s, d.id, (x) => ({ ...x, receivedBy: { at: now, by: actor.name } }))
        return { state, result }
      }
      if (!(d.status === 'Reserved' && d.stage === 'Picked Up')) fail('You can confirm once the runner has picked the food up.')
      const delivered = deliver(s, d, now)
      const state = patchDonation(delivered, d.id, (x) => ({ ...x, receivedBy: { at: now, by: actor.name } }))
      return { state, result }
    }

    case 'ngoDecline': {
      const d = findDonation(s, a.donationId)
      if (!(d.status === 'Reserved' && (d.stage === 'Pending' || d.stage === 'Assigned'))) fail('It’s already on the way: call the coordinator instead.')
      if (!str(a.reason, 300)) fail('Say why, so the coordinator can learn from it.')
      const ngoName = s.ngos.find((n) => n.id === d.ngoId)?.name ?? 'Organisation'
      let state = patchDonation(s, d.id, (x) => ({
        ...x,
        status: 'Available',
        ngoId: null,
        runnerId: null,
        stage: 'Pending',
        declinedBy: [...(x.declinedBy ?? []), d.ngoId!],
        timeline: [...x.timeline.filter((t) => t.key === 'created'), { key: 'created', at: now, note: `${ngoName} declined: ${a.reason.trim()}` }],
      }))
      // Automatic fallback to the next-best feasible organisation.
      const m = runAutoMatch(state, d.id, now)
      state = m.state
      return { state, result: { matchedTo: m.matchedTo, matchNote: m.note } }
    }

    case 'setAccepting': {
      if (!s.ngos.some((n) => n.id === a.ngoId)) fail('Unknown organisation.')
      return { state: { ...s, ngos: s.ngos.map((n) => (n.id === a.ngoId ? { ...n, accepting: !!a.accepting } : n)) }, result }
    }

    case 'withdraw': {
      const d = findDonation(s, a.donationId)
      if (!(d.status === 'Available' || d.status === 'In review')) fail('Only listings that aren’t reserved can be withdrawn.')
      return { state: { ...s, donations: s.donations.filter((x) => x.id !== d.id) }, result }
    }

    case 'splitDonation': {
      const d = findDonation(s, a.donationId)
      if (d.status !== 'Available' || !num(a.servings, 1, d.servings - 1) || !Number.isInteger(a.servings)) fail('Pick a whole number of servings smaller than the listing.')
      const ratio = a.servings / d.servings
      const child: Donation = {
        ...d,
        id: nextId(s.donations),
        servings: a.servings,
        quantity: d.unit === 'servings' ? a.servings : Math.max(0.1, Math.round(d.quantity * ratio * 10) / 10),
        ngoId: null,
        runnerId: null,
        stage: 'Pending',
        status: 'Available',
        timeline: [...d.timeline.filter((t) => t.key === 'created'), { key: 'created', at: now, note: `Split ${a.servings} of ${d.servings} servings from listing #${String(d.id).padStart(3, '0')}` }],
      }
      let state: AppState = {
        ...s,
        donations: [
          child,
          ...s.donations.map((x) =>
            x.id === d.id
              ? { ...x, servings: x.servings - a.servings, quantity: x.unit === 'servings' ? x.servings - a.servings : Math.max(0.1, Math.round(x.quantity * (1 - ratio) * 10) / 10) }
              : x,
          ),
        ],
      }
      if (a.autoMatch) {
        const m = runAutoMatch(state, child.id, now)
        state = m.state
        result.matchedTo = m.matchedTo
        result.matchNote = m.note
      }
      result.donation = state.donations.find((x) => x.id === child.id)
      return { state, result }
    }

    case 'toggleShift': {
      const r = s.runners.find((x) => x.id === a.runnerId) ?? fail('Unknown runner.')
      if (r.onShift && s.donations.some((d) => d.runnerId === r.id && d.status === 'Reserved')) fail('Finish or hand over the current run before going off shift.')
      return { state: { ...s, runners: s.runners.map((x) => (x.id === r.id ? { ...x, onShift: !x.onShift } : x)) }, result }
    }

    case 'setWeights': {
      const next = { ...s }
      if (a.weights) {
        const w = a.weights
        const keys = ['compat', 'travel', 'need', 'safety', 'hours'] as const
        if (!keys.every((k) => num(w[k], 0, 1))) fail('Weights must be between 0 and 1.')
        if (keys.reduce((t, k) => t + w[k], 0) <= 0) fail('At least one weight must be above 0.')
        next.weights = w
      } else delete next.weights
      return { state: next, result }
    }

    case 'submitApplication': {
      const draft = a.draft
      if (!draft || (draft.role !== 'donor' && draft.role !== 'recipient')) fail('Unknown application type.')
      const apps = s.applications ?? []
      const existing = apps.find((x) => x.id === draft.id)
      if (existing && !['Not Submitted', 'Resubmission Required'].includes(existing.status)) fail('This application is already with a reviewer.')
      const saved: TrustApplication = {
        ...draft,
        id: existing ? existing.id : nextId(apps),
        status: a.asDraft ? 'Not Submitted' : 'Submitted',
        demo: false,
        // Reviewer-owned fields can't be set by the applicant.
        checks: existing?.checks ?? [],
        checklist: existing?.checklist ?? {},
        decisionNote: existing?.decisionNote,
        ngoId: existing?.ngoId ?? null,
        submittedAt: a.asDraft ? null : now,
        history: [
          ...(existing?.history ?? []),
          ...(a.asDraft ? [] : [{ at: now, by: actor.role === 'coordinator' ? 'Coordinator' : 'Applicant', action: existing?.status === 'Resubmission Required' ? 'Resubmitted' : 'Submitted' }]),
        ],
      }
      const list = existing ? apps.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...apps]
      const { ngos, ngoId } = syncNgo(s, saved)
      const final = { ...saved, ngoId }
      return { state: { ...s, ngos, applications: list.map((x) => (x.id === final.id ? final : x)) }, result: { application: final } }
    }

    case 'reviewApplication': {
      const app = (s.applications ?? []).find((x) => x.id === a.id) ?? fail('Unknown application.', 'NOT_FOUND', 404)
      if (a.action === 'approve') {
        const why = canApprove(app)
        if (why) fail(why)
      }
      if ((a.action === 'reject' || a.action === 'resubmit') && !str(a.note, 1000)) fail('Write the reason the applicant will see.')
      if (!['start', 'approve', 'reject', 'resubmit'].includes(a.action)) fail('Unknown review action.')
      const status = nextStatus(a.action)
      const updated: TrustApplication = {
        ...app,
        status,
        decisionNote: a.action === 'reject' || a.action === 'resubmit' ? a.note : app.decisionNote,
        history: [...app.history, { at: now, by: actor.name, action: status, note: a.note }],
      }
      const { ngos, ngoId } = syncNgo(s, updated)
      const final = { ...updated, ngoId }
      return { state: { ...s, ngos, applications: (s.applications ?? []).map((x) => (x.id === a.id ? final : x)) }, result: { application: final } }
    }

    case 'addTrustCheck': {
      const c = a.check
      if (!c || !str(c.portal, 40) || !/^\d{4}-\d{2}-\d{2}$/.test(c.checkedOn) || !['Match', 'Mismatch', 'Not found', 'Not applicable'].includes(c.result)) fail('Fill in portal, date and result.')
      const state = {
        ...s,
        applications: (s.applications ?? []).map((x) =>
          x.id === a.id
            ? {
                ...x,
                checks: [...x.checks, { ...c, reference: String(c.reference ?? '').slice(0, 80), notes: String(c.notes ?? '').slice(0, 500), id: nextId(x.checks), at: now, by: actor.name }],
                history: [...x.history, { at: now, by: actor.name, action: `Checked ${c.portal}`, note: `${c.result}${c.reference ? ` · ${c.reference}` : ''}` }],
              }
            : x,
        ),
      }
      return { state, result }
    }

    case 'toggleTrustItem': {
      const state = { ...s, applications: (s.applications ?? []).map((x) => (x.id === a.id ? { ...x, checklist: { ...x.checklist, [a.key]: !x.checklist[a.key] } } : x)) }
      return { state, result }
    }

    case 'reset':
      return { state: freshState(now), result }
  }
  return fail('Unknown action.')
}

function deliver(s: AppState, d: Donation, now: number): AppState {
  const ngo = s.ngos.find((n) => n.id === d.ngoId)
  const runner = s.runners.find((r) => r.id === d.runnerId)
  const already = s.history.some((r) => r.donationId === d.id)
  return {
    ...patchDonation(s, d.id, (x) => ({ ...x, stage: 'Delivered', status: 'Delivered', timeline: [...x.timeline, { key: 'delivered', at: now, note: `Handed over at ${ngo?.name ?? 'organisation'}` }] })),
    runners: already ? s.runners : s.runners.map((r) => (r.id === d.runnerId ? { ...r, completed: r.completed + 1 } : r)),
    history: already
      ? s.history
      : [
          ...s.history,
          {
            donationId: d.id,
            food: d.name,
            donor: d.donor,
            category: d.category,
            ngoId: d.ngoId,
            ngoName: ngo?.name ?? 'Organisation',
            runnerName: runner?.name ?? 'Runner',
            servings: d.servings,
            weightKg: estimateWeightKg(d),
            deliveredAt: now,
          },
        ],
  }
}

/** Fresh demo state with TrustCheck applications and matching NGO statuses. */
export function freshState(now: number): AppState {
  return withTrust(createInitialState(now), now)
}

export function withTrust(s: AppState, now = Date.now()): AppState {
  if (Array.isArray(s.applications)) return s
  const applications = createInitialApplications(now, s.ngos)
  const ngos = s.ngos.map((n) => {
    const app = applications.find((x) => x.role === 'recipient' && x.ngoId === n.id)
    return app ? { ...n, verification: app.status } : n
  })
  return { ...s, ngos, applications }
}

export function isState(value: unknown): value is AppState {
  if (!value || typeof value !== 'object') return false
  const s = value as Partial<AppState>
  return s.version === 1 && Array.isArray(s.donations) && Array.isArray(s.ngos) && Array.isArray(s.runners) && Array.isArray(s.history)
}
