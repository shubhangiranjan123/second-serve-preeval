// Runner board (phone-first): go on shift, take a run, pick up, deliver.

import { useEffect, useRef, useState } from 'react'
import { Bike, CheckCircle2, LocateFixed, MapPin, Navigation, PackageCheck, Route } from 'lucide-react'
import { CITY, RealMap } from '../../components/RealMap'
import { haversineKm as kmBetween } from '../../lib/routing'
import type { AppState, Donation } from '../../types'
import type { RescueStore, User } from '../../lib/useRescueStore'
import { formatClock, haversineKm, runnerOptions, sameLocalDay, travelMinutes } from '../../lib/engine'
import { useNow } from '../../App'
import { useT } from '../../lib/i18n'
import { cx } from '../../components/ui'
import { BoardShell, HeroArt, SafeClock, Stat, Steps, photoOf, type Toast } from './shared'

const directions = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=bicycling`

export function RunnerBoard({ store, state, user, toast }: { store: RescueStore; state: AppState; user: User; toast: Toast }) {
  const { t } = useT()
  const now = useNow(state)
  const me = state.runners.find((r) => r.id === user.runnerId)
  if (!me) return <BoardShell store={store} user={user} toast={toast} kind={t('Runner board')}><p className="bempty">{t('This account isn’t linked to a runner.')}</p></BoardShell>

  const current = state.donations.find((d) => d.runnerId === me.id && d.status === 'Reserved') ?? null
  const ngoOf = (d: Donation) => state.ngos.find((n) => n.id === d.ngoId)
  const waiting = state.donations
    .filter((d) => d.status === 'Reserved' && d.stage === 'Pending' && d.safeUntil > now)
    .map((d) => {
      const o = runnerOptions(d, [me], state.donations)[0]
      const ngo = ngoOf(d)
      const legKm = ngo ? haversineKm(d, ngo) : 0
      return { d, toPickupMin: o.etaMin, km: o.km, legMin: travelMinutes(legKm) }
    })
    .sort((a, b) => a.toPickupMin - b.toPickupMin)
  const doneToday = state.history.filter((h) => h.runnerName === me.name && sameLocalDay(h.deliveredAt, now))

  return (
    <BoardShell store={store} user={user} toast={toast} kind={t('Runner board')}>
      <section className="bhero runner-hero">
        <HeroArt />
        <div>
          <h1>{me.name}</h1>
          <p>
            {t(me.vehicle)} · {me.area} · {t('{n} runs completed', { n: me.completed })}
          </p>
        </div>
        <label className={cx('big-switch', me.onShift && 'on')}>
          <input
            type="checkbox"
            checked={me.onShift}
            onChange={() => store.toggleShift(me.id).then((r) => r.ok && toast(me.onShift ? t('You’re off shift. Thanks!') : t('You’re on shift. Runs near you appear below.'), 'info'))}
          />
          <span className="big-switch-track">
            <i />
          </span>
          <span>{me.onShift ? t('On shift') : t('Off shift')}</span>
        </label>
      </section>

      <LiveLocation store={store} runnerId={me.id} sharing={!!me.gps && now - me.gps.at < 3 * 60_000} />

      {current ? (
        <section className="bcard run-now">
          <span className="run-kicker">{t('Your run')}</span>
          <div className="dcard-b-top">
            {photoOf(current) ? <img src={photoOf(current)} alt="" /> : <span className="dthumb-empty" />}
            <div>
              <strong>
                {current.servings} × {current.name}
              </strong>
              <SafeClock d={current} now={now} />
            </div>
          </div>
          <Steps d={current} />
          <RealMap state={state} now={now} focusDonationId={current.id} variant="mini" />
          <div className="legs">
            <div className={cx('leg', current.stage === 'Assigned' && 'leg-now')}>
              <span>
                <MapPin size={15} /> {t('Pick up')}
              </span>
              <strong>{current.donor}</strong>
              <em>
                {current.address} · {current.area}
              </em>
              <a className="btn btn-ghost btn-sm" href={directions(current.lat, current.lng)} target="_blank" rel="noreferrer noopener">
                <Navigation size={14} /> {t('Directions')}
              </a>
            </div>
            <div className={cx('leg', current.stage === 'Picked Up' && 'leg-now')}>
              <span>
                <Route size={15} /> {t('Deliver to')}
              </span>
              <strong>{ngoOf(current)?.name}</strong>
              <em>{ngoOf(current)?.area}</em>
              {ngoOf(current) && (
                <a className="btn btn-ghost btn-sm" href={directions(ngoOf(current)!.lat, ngoOf(current)!.lng)} target="_blank" rel="noreferrer noopener">
                  <Navigation size={14} /> {t('Directions')}
                </a>
              )}
            </div>
          </div>
          <button
            className="btn btn-pink btn-xl btn-block"
            onClick={() => {
              const stage = current.stage
              store.advance(current.id).then((r) => {
                if (!r.ok) return
                toast(stage === 'Assigned' ? t('Picked up. Ride safe!') : t('Delivered! {n} meals rescued.', { n: current.servings }))
              })
            }}
          >
            {current.stage === 'Assigned' ? (
              <>
                <Bike size={22} /> {t('I’ve picked it up')}
              </>
            ) : (
              <>
                <PackageCheck size={22} /> {t('Delivered')}
              </>
            )}
          </button>
        </section>
      ) : (
        <section className="bstats">
          <Stat value={doneToday.length} label={t('runs today')} />
          <Stat value={doneToday.reduce((s, h) => s + h.servings, 0)} label={t('meals delivered today')} />
          <Stat value={waiting.length} label={t('runs waiting')} />
        </section>
      )}

      <h2 className="bsec">{t('Runs waiting for a runner')}</h2>
      {!me.onShift && <p className="bwarn">{t('You’re off shift. Taking a run puts you on shift.')}</p>}
      {waiting.length === 0 && <p className="bempty">{t('No runs waiting. You’ll see new ones here instantly.')}</p>}
      <div className="run-list">
        {waiting.map(({ d, toPickupMin, km, legMin }) => (
          <article key={d.id} className="bcard run-card">
            <div>
              <strong>
                {d.servings} × {d.name}
              </strong>
              <span>
                {d.donor} → {ngoOf(d)?.name}
              </span>
              <span>
                {t('{min} min to pickup ({km} km) · then about {leg} min', { min: toPickupMin, km: km.toFixed(1), leg: legMin })}
              </span>
              <SafeClock d={d} now={now} />
            </div>
            <button
              className="btn btn-dark"
              disabled={!!current}
              title={current ? t('Finish your current run first') : ''}
              onClick={async () => {
                // Taking a run while off shift puts you on shift first.
                if (!me.onShift) {
                  const on = await store.toggleShift(me.id)
                  if (!on.ok) return
                }
                const r = await store.assignRunner(d.id, me.id)
                if (r.ok) toast(me.onShift ? t('Run taken. Head to {donor}.', { donor: d.donor }) : t('You’re on shift and the run is yours. Head to {donor}.', { donor: d.donor }))
              }}
            >
              <Bike size={16} /> {t('Take this run')}
            </button>
          </article>
        ))}
      </div>

      {doneToday.length > 0 && (
        <section className="bcard">
          <h3>{t('Done today')}</h3>
          <ul className="done-list">
            {doneToday.map((h) => (
              <li key={h.donationId}>
                <CheckCircle2 size={16} />
                <span>
                  <b>{h.servings}</b> {h.food} → {h.ngoName}
                </span>
                <small>{formatClock(h.deliveredAt)}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </BoardShell>
  )
}

/** Share this phone's GPS so the coordinator, NGO and donor see the runner move for real. */
function LiveLocation({ store, runnerId, sharing }: { store: RescueStore; runnerId: number; sharing: boolean }) {
  const { t } = useT()
  const key = `second-serve-gps-${runnerId}`
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const [status, setStatus] = useState('')
  const [bad, setBad] = useState(false)
  const last = useRef<{ t: number; lat: number; lng: number; acc: number } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(key, on ? '1' : '0')
    } catch {
      /* ignore */
    }
    if (!on) return
    if (!window.isSecureContext) {
      setBad(true)
      setStatus(t('Phones only share GPS over a secure (https) link or on localhost. Open the app through an https link to use this.'))
      return
    }
    if (!('geolocation' in navigator)) {
      setBad(true)
      setStatus(t('This browser can’t share location.'))
      return
    }
    setBad(false)
    setStatus(t('Finding you…'))
    const send = (lat: number, lng: number, acc: number) => {
      last.current = { t: Date.now(), lat, lng, acc }
      store.shareLocation(runnerId, lat, lng, acc)
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude: lat, longitude: lng, accuracy: acc } = p.coords
        const far = kmBetween({ lat, lng }, CITY) > 60
        setBad(far)
        setStatus(far ? t('Sharing, but you’re outside Chandigarh, so the demo city map can’t show you.') : t('Sharing live · accurate to about {m} m', { m: Math.round(acc) }))
        const prev = last.current
        if (!prev || Date.now() - prev.t > 10_000 || kmBetween(prev, { lat, lng }) > 0.025) send(lat, lng, acc)
      },
      (e) => {
        setBad(true)
        setStatus(e.code === 1 ? t('Location permission was refused. Allow it in the browser’s site settings.') : t('No GPS fix yet. Try near a window or outdoors.'))
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
    )
    // Keep the dot fresh even when standing still (the map drops fixes older than 3 min).
    const beat = setInterval(() => {
      const p = last.current
      if (p && Date.now() - p.t > 45_000) send(p.lat, p.lng, p.acc)
    }, 15_000)
    return () => {
      navigator.geolocation.clearWatch(id)
      clearInterval(beat)
    }
  }, [on]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className={cx('gps-card', on && 'on', bad && 'bad')}>
      <LocateFixed size={22} />
      <div>
        <strong>{t('Share live location')}</strong>
        <span>{on ? status : sharing ? t('Sharing from another device.') : t('Off. The map shows an estimate from your route instead.')}</span>
      </div>
      <label className={cx('big-switch small', on && 'on')}>
        <input
          type="checkbox"
          checked={on}
          onChange={() => {
            if (on) {
              store.stopLocation(runnerId)
              last.current = null
            }
            setOn(!on)
          }}
          aria-label={t('Share live location')}
        />
        <span className="big-switch-track">
          <i />
        </span>
      </label>
    </section>
  )
}
