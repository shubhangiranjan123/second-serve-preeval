// Operational alerts for the coordinator. Plain rules over current state.
import type { AppState } from '../types'
import { minutesBetween } from './engine'

export type Alert = { id: string; tone: 'bad' | 'warn' | 'info'; text: string; go: 'board' | 'dispatch' | 'trust' }

export function operationalAlerts(state: AppState, now: number): Alert[] {
  const out: Alert[] = []
  const live = state.donations.filter((d) => d.status === 'Reserved')
  const busyIds = new Set(live.map((d) => d.runnerId).filter((x): x is number => x !== null))
  const free = state.runners.filter((r) => r.onShift && !busyIds.has(r.id))
  const waiting = live.filter((d) => d.stage === 'Pending')
  if (waiting.length && free.length === 0)
    out.push({ id: 'runners', tone: 'bad', text: `${waiting.length} reserved rescue${waiting.length > 1 ? 's are' : ' is'} waiting and no runner is free. Put a runner on shift.`, go: 'dispatch' })
  else if (waiting.length > free.length)
    out.push({ id: 'runners', tone: 'warn', text: `${waiting.length} rescues need a runner but only ${free.length} ${free.length === 1 ? 'is' : 'are'} free.`, go: 'dispatch' })

  const soon = state.donations.filter((d) => (d.status === 'Available' || (d.status === 'Reserved' && d.stage !== 'Picked Up')) && d.safeUntil > now && minutesBetween(now, d.safeUntil) <= 45)
  if (soon.length) out.push({ id: 'deadline', tone: 'bad', text: `${soon.length} listing${soon.length > 1 ? 's' : ''} reach${soon.length > 1 ? '' : 'es'} the end of the safe window within 45 min and ${soon.length > 1 ? 'aren’t' : 'isn’t'} collected yet.`, go: 'board' })

  const review = state.donations.filter((d) => d.status === 'In review')
  if (review.length) out.push({ id: 'review', tone: 'warn', text: `${review.length} scanned listing${review.length > 1 ? 's need' : ' needs'} a human food check before matching.`, go: 'board' })

  const apps = (state.applications ?? []).filter((a) => a.status === 'Submitted' || a.status === 'Under Review')
  if (apps.length) out.push({ id: 'trust', tone: 'info', text: `${apps.length} TrustCheck application${apps.length > 1 ? 's' : ''} waiting for review.`, go: 'trust' })
  return out
}
