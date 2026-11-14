import { Bike, Building2, ClipboardList, PackageCheck, Route } from 'lucide-react'
import type { Donation, TimelineKey } from '../types'
import { formatClock } from '../lib/engine'
import { cx } from './ui'

const STEPS: Array<{ key: TimelineKey; label: string; Icon: typeof Bike }> = [
  { key: 'created', label: 'Donation created', Icon: ClipboardList },
  { key: 'matched', label: 'NGO matched', Icon: Building2 },
  { key: 'assigned', label: 'Runner assigned', Icon: Bike },
  { key: 'picked', label: 'Food picked up', Icon: Route },
  { key: 'delivered', label: 'Food delivered', Icon: PackageCheck },
]

export function RescueTimeline({ donation, horizontal }: { donation: Donation; horizontal?: boolean }) {
  const done = new Map(donation.timeline.map((t) => [t.key, t]))
  const currentIndex = STEPS.findIndex((s) => !done.has(s.key))

  return (
    <ol className={cx('timeline', horizontal && 'timeline-h')}>
      {STEPS.map((s, i) => {
        const ev = done.get(s.key)
        const state = ev ? 'done' : i === currentIndex ? 'current' : 'todo'
        return (
          <li key={s.key} className={`tl-${state}`}>
            <span className="tl-node">
              <s.Icon size={15} strokeWidth={2} />
            </span>
            <div className="tl-text">
              <strong>{s.label}</strong>
              {ev ? (
                <span>
                  {formatClock(ev.at)} · {ev.note}
                </span>
              ) : (
                <span>{state === 'current' ? 'Up next' : 'Waiting'}</span>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
