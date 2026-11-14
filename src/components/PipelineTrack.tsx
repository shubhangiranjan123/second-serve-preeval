// The dual-engine track: two lanes joined by a bridge. Engine 1 verifies the
// food, Engine 2 finds the recipient. Each stop lights up as the donation
// moves through, so anyone can see where it is and why it stopped.

import type { Donation } from '../types'
import type { PipelineResult } from '../lib/pipeline'
import { useT } from '../lib/i18n'
import { cx } from './ui'

export type StopState = 'todo' | 'active' | 'done' | 'fail' | 'skip'
export type StopId = 'photo' | 'vision' | 'rules' | 'listing' | 'gates' | 'rank' | 'feasible' | 'dispatch'

const LANES: Array<{ engine: string; name: string; stops: Array<{ id: StopId; label: string }> }> = [
  {
    engine: 'Engine 1',
    name: 'Verify the food',
    stops: [
      { id: 'photo', label: 'Photo' },
      { id: 'vision', label: 'Vision AI' },
      { id: 'rules', label: 'Safety rules' },
      { id: 'listing', label: 'Listing' },
    ],
  },
  {
    engine: 'Engine 2',
    name: 'Find the recipient',
    stops: [
      { id: 'gates', label: '7 gates' },
      { id: 'rank', label: 'Rank' },
      { id: 'feasible', label: 'Feasibility' },
      { id: 'dispatch', label: 'Dispatch' },
    ],
  },
]

export function PipelineTrack({ states, compact }: { states: Partial<Record<StopId, StopState>>; compact?: boolean }) {
  const { t } = useT()
  return (
    <div className={cx('ptrack', compact && 'ptrack-compact')} role="list" aria-label={t('Rescue pipeline')}>
      {LANES.map((lane, li) => (
        <div className="ptrack-lane" key={lane.engine}>
          <div className="ptrack-name">
            <strong>{t(lane.engine)}</strong>
            <span>{t(lane.name)}</span>
          </div>
          <ol className="ptrack-stops">
            {lane.stops.map((s) => {
              const st = states[s.id] ?? 'todo'
              return (
                <li key={s.id} className={cx('pstop', `pstop-${st}`)} role="listitem" aria-label={`${t(s.label)}: ${st}`}>
                  <i aria-hidden />
                  <span>{t(s.label)}</span>
                </li>
              )
            })}
          </ol>
          {li === 0 && <span className={cx('ptrack-bridge', (states.listing === 'done' || states.gates) && 'on')} aria-hidden />}
        </div>
      ))}
    </div>
  )
}

/** Where a stored donation sits on the track. */
export function trackFor(d: Donation, p: PipelineResult | null): Partial<Record<StopId, StopState>> {
  const sc = d.screening
  const s: Partial<Record<StopId, StopState>> = {}
  if (sc) {
    s.photo = sc.photo || sc.ai ? 'done' : 'skip'
    s.vision = sc.ai ? 'done' : 'fail'
    s.rules = d.status === 'In review' ? 'active' : 'done'
  } else {
    s.photo = 'skip'
    s.vision = 'skip'
    s.rules = 'done'
  }
  s.listing = 'done'
  if (d.status === 'In review') return s

  if (d.status !== 'Available') {
    return { ...s, gates: 'done', rank: 'done', feasible: 'done', dispatch: d.status === 'Delivered' || d.stage !== 'Pending' ? 'done' : 'active' }
  }
  if (!p || p.status === 'not-ready') return { ...s, gates: 'fail' }
  s.gates = p.eligible.length ? 'done' : 'fail'
  s.rank = p.eligible.length ? 'done' : 'skip'
  s.feasible = p.recommended ? 'done' : p.eligible.length ? 'fail' : 'skip'
  s.dispatch = p.recommended ? 'active' : 'skip'
  return s
}
