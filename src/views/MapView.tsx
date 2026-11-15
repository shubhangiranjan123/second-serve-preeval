import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, Rewind } from 'lucide-react'
import type { AppState, Donation, RescueRecord } from '../types'
import { formatClock } from '../lib/engine'
import { DONOR_AREAS, findArea } from '../data/demoData'
import { CityMap, project, type ReplayFrame, type ReplayItem } from '../components/CityMap'
import { RealMap } from '../components/RealMap'
import { Garden } from '../components/Garden'
import { DemoBadge, Eyebrow } from '../components/ui'
import { chime } from '../lib/sound'
import { useT } from '../lib/i18n'

const DAY = 24 * 60 * 60 * 1000
const REPLAY_MS = 15_000

function donorPoint(rec: RescueRecord, state: AppState) {
  const d = state.donations.find((x) => x.id === rec.donationId)
  if (d) return project(d)
  return project(findArea(DONOR_AREAS[rec.donor] ?? 'Sector 17'))
}

function ngoPoint(rec: RescueRecord, state: AppState) {
  const n = state.ngos.find((x) => x.id === rec.ngoId)
  return n ? project(n) : project(findArea('Sector 17'))
}

export function useReplay(state: AppState, now: number) {
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [paused, setPaused] = useState(false)
  const startedAt = useRef(0)
  const pausedAt = useRef(0)
  const lastDone = useRef(0)

  const recs = useMemo(
    () => [...state.history].filter((r) => r.deliveredAt > now - DAY && r.deliveredAt <= now).sort((a, b) => a.deliveredAt - b.deliveredAt),
    [state.history, now],
  )

  const start = useCallback(() => {
    startedAt.current = performance.now()
    lastDone.current = 0
    setPaused(false)
    setElapsed(0)
  }, [])

  const stop = useCallback(() => {
    setElapsed(null)
    setPaused(false)
  }, [])

  const togglePause = useCallback(() => {
    setPaused((p) => {
      if (p) startedAt.current += performance.now() - pausedAt.current
      else pausedAt.current = performance.now()
      return !p
    })
  }, [])

  useEffect(() => {
    if (elapsed === null || paused) return
    let raf = 0
    const tick = () => {
      const e = performance.now() - startedAt.current
      if (e >= REPLAY_MS + 1800) {
        setElapsed(null)
        return
      }
      setElapsed(e)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [elapsed === null, paused])

  const frame: ReplayFrame | null = useMemo(() => {
    if (elapsed === null) return null
    const start = now - DAY
    const n = Math.max(1, recs.length)
    const slot = REPLAY_MS / n
    const e = Math.min(elapsed, REPLAY_MS)
    const idx = Math.min(n - 1, Math.floor(e / slot))
    const within = (e - idx * slot) / slot
    const prevT = idx === 0 ? start : recs[idx - 1]?.deliveredAt ?? start
    const thisT = recs[idx]?.deliveredAt ?? now
    const clock = elapsed >= REPLAY_MS ? now : prevT + (thisT - prevT) * Math.min(1, within / 0.8)
    const items: ReplayItem[] = recs.map((rec, i) => {
      const from = donorPoint(rec, state)
      const to = ngoPoint(rec, state)
      if (i < idx || (i === idx && within >= 0.8) || elapsed >= REPLAY_MS) {
        const sinceDone = i === idx ? within - 0.8 : 1
        return { rec, from, to, phase: 'done', progress: 1, burst: i === idx && sinceDone < 0.18 }
      }
      if (i > idx) return { rec, from, to, phase: 'listed', progress: 0, burst: false }
      if (within < 0.22) return { rec, from, to, phase: 'listed', progress: 0, burst: false }
      return { rec, from, to, phase: 'moving', progress: Math.min(1, (within - 0.22) / 0.58), burst: false }
    })
    return { clock, start, end: now, items: items.filter((_, i) => i <= idx || elapsed >= REPLAY_MS) }
  }, [elapsed, recs, now, state])

  const done = frame ? frame.items.filter((i) => i.phase === 'done').length : 0
  useEffect(() => {
    if (frame && done > lastDone.current) {
      lastDone.current = done
      chime('bloom')
    }
  }, [done, frame])

  return { frame, start, stop, paused, togglePause, recs, running: elapsed !== null }
}

export function MapView({ state, now, onOpen }: { state: AppState; now: number; onOpen: (d: Donation) => void }) {
  const { t } = useT()
  const replay = useReplay(state, now)
  const [kind, setKind] = useState<'real' | 'drawn'>(() => {
    try {
      return localStorage.getItem('second-serve-map-kind') === 'drawn' ? 'drawn' : 'real'
    } catch {
      return 'real'
    }
  })
  const pick = (k: 'real' | 'drawn') => {
    setKind(k)
    try {
      localStorage.setItem('second-serve-map-kind', k)
    } catch {
      /* ignore */
    }
  }
  const live = state.runners.filter((r) => r.gps && now - r.gps.at < 3 * 60_000).length
  const moving = state.donations.filter((d) => d.status === 'Reserved')
  const wilted = state.donations.filter((d) => d.status === 'Available' && d.safeUntil <= now)
  const revealUntil = replay.frame ? replay.frame.clock : undefined
  const doneLog = replay.frame ? replay.frame.items.filter((i) => i.phase === 'done') : []

  return (
    <div className="view map-view">
      <header className="view-head">
        <div>
          <Eyebrow>{t('Live map')}</Eyebrow>
          <h1>
            {t('The whole city,')} <em>{t('one glance.')}</em>
          </h1>
          <p className="view-lede">
            {kind === 'real'
              ? t('Real Chandigarh streets. Food waiting shows its safe time left, every rescue on the road follows the actual road route, and runners who share their phone’s GPS move live. Press replay to watch the last 24 hours draw themselves in 15 seconds.')
              : t('Every listing is a countdown ring. Every partner is a little house. Every rescue on the road is a firefly. Press replay to watch the last 24 hours draw themselves in 15 seconds.')}
          </p>
        </div>
        <div className="map-head-side">
          <div className="map-switch" role="group" aria-label={t('Map style')}>
            <button className={kind === 'real' ? 'on' : ''} onClick={() => pick('real')} aria-pressed={kind === 'real'}>
              {t('Real streets')}
            </button>
            <button className={kind === 'drawn' ? 'on' : ''} onClick={() => pick('drawn')} aria-pressed={kind === 'drawn'}>
              {t('Illustrated')}
            </button>
          </div>
          <DemoBadge>
            {kind === 'real'
              ? live
                ? t('{n} runner(s) sharing live GPS', { n: live })
                : t('Demo runners: positions estimated')
              : t('Illustrated map · works offline')}
          </DemoBadge>
        </div>
      </header>

      <div className="map-layout">
        {kind === 'real' ? <RealMap state={state} now={now} replay={replay.frame} onOpen={onOpen} /> : <CityMap state={state} now={now} replay={replay.frame} onOpen={onOpen} />}

        <aside className="map-side">
          <div className="panel">
            <h3>{t('Replay the day')}</h3>
            {replay.running ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-pink replay-btn" onClick={replay.togglePause}>
                  {replay.paused ? <Play size={16} /> : <Pause size={16} />} {replay.paused ? t('Resume') : t('Pause')}
                </button>
                <button className="btn btn-ghost-light" onClick={replay.stop}>
                  {t('Stop')}
                </button>
              </div>
            ) : (
              <button className="btn btn-pink btn-lg replay-btn" onClick={replay.start} disabled={replay.recs.length === 0}>
                <Rewind size={17} /> {t('Replay last 24 hours')}
              </button>
            )}
            <p className="replay-note">{t('{n} rescues in the last 24 hours. The garden below grows in sync.', { n: replay.recs.length })}</p>
            {doneLog.length > 0 && (
              <ul className="replay-log">
                {doneLog.map((it) => (
                  <li key={`${it.rec.donationId}-${it.rec.deliveredAt}`}>
                    <time>{formatClock(it.rec.deliveredAt)}</time>
                    <span>
                      {it.rec.servings} · {it.rec.food} → {it.rec.ngoName.split(' ')[0]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel">
            <h3>{t('On the road')}</h3>
            {moving.length === 0 ? (
              <p className="replay-note">{t('No rescues moving right now.')}</p>
            ) : (
              <ul className="run-list">
                {moving.map((d) => {
                  const ngo = state.ngos.find((n) => n.id === d.ngoId)
                  const runner = state.runners.find((r) => r.id === d.runnerId)
                  return (
                    <li key={d.id}>
                      <button onClick={() => onOpen(d)}>
                        <strong>{d.name}</strong>
                        <span>
                          {d.donor} → {ngo?.name ?? '—'}
                        </span>
                        <em>
                          {d.stage === 'Pending' ? t('needs a runner') : `${runner?.name ?? ''} · ${t(d.stage)}`}
                        </em>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {kind === 'real' ? (
          <div className="panel">
            <h3>{t('Legend')}</h3>
            <ul className="map-legend">
              <li>
                <span className="legend-swatch"><span className="rm-food ok" style={{ height: 20, width: 34, fontSize: 10 }}>1:30</span></span>
                {t('Food waiting · safe time left')}
              </li>
              <li>
                <span className="legend-swatch"><span className="legend-line" /></span>
                {t('Rescue on the road (real road route)')}
              </li>
              <li>
                <span className="legend-swatch"><span className="legend-line lead" /></span>
                {t('Runner heading to the pickup')}
              </li>
              <li>
                <span className="legend-swatch"><span className="rm-ngo"><svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7v9H3z" /></svg></span></span>
                {t('NGO (number = rescues today)')}
              </li>
              <li>
                <span className="legend-swatch"><span className="rm-runner rm-live"><b>AS</b></span></span>
                {t('Runner: solid = live GPS, dashed = estimated')}
              </li>
            </ul>
          </div>
          ) : (
          <div className="panel">
            <h3>{t('Legend')}</h3>
            <ul className="map-legend">
              <li>
                <svg width="26" height="26" viewBox="-13 -13 26 26"><circle r="9" fill="none" stroke="#ff5c9a" strokeWidth="3.5" /></svg>
                {t('Ring = safe time left (full = 6 h)')}
              </li>
              <li>
                <svg width="26" height="26" viewBox="-13 -13 26 26"><circle r="9" fill="none" stroke="#ffc94d" strokeWidth="3.5" /></svg>
                {t('Amber = at risk or on the move')}
              </li>
              <li>
                <svg width="26" height="26" viewBox="-13 -15 26 26"><path d="M-9 4 L-9 -4 L0 -11 L9 -4 L9 4 Z" fill="#fcf0f5" /></svg>
                {t('Partner organisation (sprouts = rescues today)')}
              </li>
              <li>
                <svg width="26" height="26" viewBox="-13 -13 26 26"><circle r="5" fill="#ffe27a" /></svg>
                {t('Firefly = food in transit')}
              </li>
            </ul>
          </div>
          )}
        </aside>
      </div>

      <Garden history={state.history} wilted={wilted} now={now} revealUntil={revealUntil} variant="mini" />
    </div>
  )
}
