import { BadgeCheck, Clock, Hourglass, Leaf, MapPin, Refrigerator, Snowflake, Utensils } from 'lucide-react'
import type { AppState } from '../types'
import { capacityUsage, hoursLabel, openingCheck } from '../lib/engine'
import { DemoBadge, Eyebrow, cx } from '../components/ui'

export function NgoNetwork({ state, now }: { state: AppState; now: number }) {
  return (
    <div className="view">
      <header className="view-head">
        <div>
          <Eyebrow>NGO network</Eyebrow>
          <h1>
            Partners who can <em>receive</em> food.
          </h1>
          <p className="view-lede">
            Matching only ever sends food to a verified organisation with the right storage, enough capacity today and
            open doors on arrival. Capacity is recalculated live from reservations and deliveries.
          </p>
        </div>
        <DemoBadge>Fictional organisations</DemoBadge>
      </header>

      <div className="ngo-list">
        {state.ngos.map((n, i) => {
          const cap = capacityUsage(n, state.donations, state.history, now)
          const open = openingCheck(n, now).open
          const usedPct = n.dailyCapacity ? (cap.deliveredToday / n.dailyCapacity) * 100 : 0
          const resPct = n.dailyCapacity ? (cap.committed / n.dailyCapacity) * 100 : 0
          return (
            <article key={n.id} className={cx('ngo', n.verification !== 'Verified' && 'ngo-pending')} style={{ animationDelay: `${i * 60}ms` }}>
              <div className="ngo-id">
                <span className="ngo-mono">{n.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                <div>
                  <h3>{n.name}</h3>
                  <span className="ngo-sub"><MapPin size={13} /> {n.type} · {n.area}</span>
                </div>
              </div>

              <div className="ngo-tags">
                {n.verification === 'Verified' ? (
                  <span className="tag tag-ok"><BadgeCheck size={13} /> Verified</span>
                ) : (
                  <span className="tag tag-wait"><Hourglass size={13} /> Pending review</span>
                )}
                <span className={cx('tag', open ? 'tag-open' : 'tag-closed')}>
                  <Clock size={13} /> {open ? 'Open now' : 'Closed'} · {hoursLabel(n)}
                </span>
                <span className={cx('tag', !n.refrigeration && 'tag-no')}><Refrigerator size={13} /> {n.refrigeration ? 'Fridge' : 'No fridge'}</span>
                <span className={cx('tag', !n.freezer && 'tag-no')}><Snowflake size={13} /> {n.freezer ? 'Freezer' : 'No freezer'}</span>
                <span className="tag"><Leaf size={13} /> {n.acceptsNonVeg ? 'Veg & non-veg' : 'Veg only'}</span>
              </div>

              <p className="ngo-needs"><Utensils size={14} /> {n.needs}</p>

              <div className="ngo-cap">
                <div className="cap-head">
                  <span>Today’s capacity</span>
                  <strong>
                    {cap.remaining} <small>of {n.dailyCapacity} servings left</small>
                  </strong>
                </div>
                <div className="cap-bar">
                  <i className="cap-used" style={{ width: `${usedPct}%` }} />
                  <i className="cap-res" style={{ width: `${resPct}%` }} />
                </div>
                <div className="cap-legend">
                  <span><i className="cap-used" /> Delivered today {cap.deliveredToday}</span>
                  <span><i className="cap-res" /> Reserved {cap.committed}</span>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
