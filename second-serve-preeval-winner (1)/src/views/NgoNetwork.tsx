import { BadgeCheck, Clock, Flame, Hourglass, Leaf, MapPin, Refrigerator, Snowflake, Utensils, Warehouse } from 'lucide-react'
import type { AppState, Ngo } from '../types'
import { capacityUsage, hoursLabel, openingCheck, unitUsage, type StorageUnit } from '../lib/engine'
import { DemoBadge, Eyebrow, cx } from '../components/ui'
import { useT } from '../lib/i18n'

function fmtHour(h: number) {
  const hh = h % 24
  return `${hh % 12 === 0 ? 12 : hh % 12}${hh >= 12 ? 'pm' : 'am'}`
}

function Unit({ ngo, unit, state }: { ngo: Ngo; unit: StorageUnit; state: AppState }) {
  const { t } = useT()
  const cap = unit === 'fridge' ? (ngo.refrigeration ? ngo.fridgeLitres : 0) : unit === 'freezer' ? (ngo.freezer ? ngo.freezerLitres : 0) : ngo.dryStoreKg
  const used = unitUsage(ngo, unit, state.donations)
  const measure = unit === 'dry' ? 'kg' : 'L'
  const Icon = unit === 'fridge' ? Refrigerator : unit === 'freezer' ? Snowflake : Warehouse
  const name = unit === 'fridge' ? t('Fridge') : unit === 'freezer' ? t('Freezer') : t('Dry store')
  return (
    <div className={cx('ngo-unit', cap === 0 && 'off')}>
      <span>
        <Icon size={13} /> {name}
      </span>
      <b>{cap === 0 ? t('None') : `${cap - used} ${measure} ${t('free')}`}</b>
      {cap > 0 && (
        <div className="unit-bar">
          <i className="u-used" style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} />
        </div>
      )}
      <span>{cap > 0 ? t('{n} {m} total', { n: cap, m: measure }) : t('Excluded for food that needs it')}</span>
    </div>
  )
}

export function NgoNetwork({ state, now }: { state: AppState; now: number }) {
  const { t } = useT()
  return (
    <div className="view">
      <header className="view-head">
        <div>
          <Eyebrow>{t('NGO network')}</Eyebrow>
          <h1>
            {t('Partners who can')} <em>{t('receive')}</em> {t('food.')}
          </h1>
          <p className="view-lede">
            {t('Matching only sends food to a verified organisation with the right storage unit and room in it, enough capacity today and open doors on arrival. Fridge, freezer and dry-store space is recalculated live from every reservation.')}
          </p>
        </div>
        <DemoBadge>{t('Fictional organisations')}</DemoBadge>
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
                  <span className="tag tag-ok"><BadgeCheck size={13} /> {t('Verified')}</span>
                ) : (
                  <span className="tag tag-wait"><Hourglass size={13} /> {t('Pending review')}</span>
                )}
                <span className={cx('tag', open ? 'tag-open' : 'tag-closed')}>
                  <Clock size={13} /> {open ? t('Open now') : t('Closed')} · {hoursLabel(n)}
                </span>
                <span className="tag"><Leaf size={13} /> {n.acceptsNonVeg ? t('Veg & non-veg') : t('Veg only')}</span>
                {n.jainKitchen && <span className="tag"><Leaf size={13} /> {t('Jain-separated kitchen')}</span>}
                <span className={cx('tag', !n.canReheat && 'tag-no')}><Flame size={13} /> {n.canReheat ? t('Can reheat') : t('No reheating')}</span>
              </div>

              <div className="ngo-units">
                <Unit ngo={n} unit="fridge" state={state} />
                <Unit ngo={n} unit="freezer" state={state} />
                <Unit ngo={n} unit="dry" state={state} />
              </div>

              <div className="ngo-meals">
                <Utensils size={14} /> {t('Serves meals at')}
                {n.mealHours.map((h) => (
                  <span key={h}>{fmtHour(h)}</span>
                ))}
                · {t('asks for')} {n.prefers.map((c) => t(c)).join(', ')}
              </div>

              <p className="ngo-needs"><Utensils size={14} /> {n.needs}</p>

              <div className="ngo-cap">
                <div className="cap-head">
                  <span>{t('Today’s capacity')}</span>
                  <strong>
                    {cap.remaining} <small>{t('of {n} servings left', { n: n.dailyCapacity })}</small>
                  </strong>
                </div>
                <div className="cap-bar">
                  <i className="cap-used" style={{ width: `${usedPct}%` }} />
                  <i className="cap-res" style={{ width: `${resPct}%` }} />
                </div>
                <div className="cap-legend">
                  <span><i className="cap-used" /> {t('Delivered today')} {cap.deliveredToday}</span>
                  <span><i className="cap-res" /> {t('Reserved')} {cap.committed}</span>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
