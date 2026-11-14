import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useRescueStore } from './lib/useRescueStore'
import { TopNav, NAV, type View } from './components/Sidebar'
import { Toasts, type Toast } from './components/Toasts'
import { DonationForm } from './components/DonationForm'
import { RescueFile } from './components/RescueFile'
import { Drop, Grain, Wordmark } from './components/Art'
import { cx } from './components/ui'
import { Home } from './views/Home'
import { RescueBoard } from './views/RescueBoard'
import { NgoNetwork } from './views/NgoNetwork'
import { Dispatch } from './views/Dispatch'
import { Impact } from './views/Impact'
import { Live } from './views/Live'
import { MapView } from './views/MapView'
import { Confetti, burstConfetti } from './components/Confetti'
import { CursorGlow } from './components/CursorGlow'
import { chime } from './lib/sound'
import { SPECIES, milestoneReached, MILESTONES } from './lib/garden'
import { useT } from './lib/i18n'
import type { RescueRecord } from './types'

const VIEWS: View[] = ['home', 'board', 'map', 'ngos', 'dispatch', 'impact', 'live']

function readHash(): View {
  const h = window.location.hash.replace('#', '') as View
  return VIEWS.includes(h) ? h : 'home'
}

function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export default function App() {
  const { t } = useT()
  const store = useRescueStore()
  const { state } = store
  const tickNow = useNow()
  const [actionNow, setActionNow] = useState(() => Date.now())
  useEffect(() => setActionNow(Date.now()), [state])
  const now = Math.max(tickNow, actionNow)

  const [view, setView] = useState<View>(readHash)
  const [openId, setOpenId] = useState<number | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [celebrate, setCelebrate] = useState<RescueRecord | null>(null)
  const [milestone, setMilestone] = useState<(typeof MILESTONES)[number] | null>(null)
  const toastId = useRef(0)
  const historyCount = useRef(state.history.length)

  // A new delivery anywhere (this tab or another) triggers the stamp moment.
  useEffect(() => {
    if (state.history.length > historyCount.current) {
      const latest = [...state.history].sort((a, b) => b.deliveredAt - a.deliveredAt)[0]
      const reached = milestoneReached(historyCount.current, state.history.length)
      setCelebrate(latest ?? null)
      chime('bloom')
      burstConfetti(0.6)
      const timers = [setTimeout(() => setCelebrate(null), 2600)]
      if (reached) {
        timers.push(
          setTimeout(() => {
            setMilestone(reached)
            chime('milestone')
            burstConfetti(1.6)
          }, 2700),
          setTimeout(() => setMilestone(null), 7200),
        )
      }
      historyCount.current = state.history.length
      return () => timers.forEach(clearTimeout)
    }
    historyCount.current = state.history.length
  }, [state.history])

  useEffect(() => {
    const onHash = () => {
      setView(readHash())
      setOpenId(null)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = useCallback((v: View) => {
    if (window.location.hash !== `#${v}`) window.location.hash = v
    setView(v)
    setOpenId(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const toast = useCallback((msg: string, tone: Toast['tone'] = 'ok') => {
    const id = ++toastId.current
    setToasts((t) => [...t.slice(-2), { id, msg, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600)
  }, [])

  const open = state.donations.find((d) => d.id === openId) ?? null
  const counts = {
    board: state.donations.filter((d) => d.status === 'Available').length,
    dispatch: state.donations.filter((d) => d.status === 'Reserved').length,
  }
  const openFile = (d: { id: number }) => setOpenId(d.id)

  useEffect(() => {
    document.body.style.overflow = open || formOpen || confirmReset ? 'hidden' : ''
  }, [open, formOpen, confirmReset])

  const celebration = celebrate && (
    <div className="celebrate" aria-live="assertive">
      {Array.from({ length: 14 }, (_, i) => (
        <Drop key={i} className={`burst burst-${i}`} size={22 + (i % 4) * 8} />
      ))}
      <div className="celebrate-card">
        <span className="stamp-big">{t('RESCUED')}</span>
        <strong>{t('{n} meals', { n: celebrate.servings })}</strong>
        <span>
          {celebrate.food} → {celebrate.ngoName}
        </span>
        <span>{t('A {flower} just bloomed in the garden', { flower: t(SPECIES[celebrate.category].name).toLowerCase() })}</span>
      </div>
    </div>
  )

  const milestoneBanner = milestone && (
    <div className="live-milestone" role="status">
      <span>{t('New in the garden')}</span>
      <strong>{t(milestone.name)}</strong>
      <em>{t(milestone.line)}</em>
    </div>
  )

  const overlays = (
    <>
      <Confetti />
      <CursorGlow />
    </>
  )

  if (view === 'live') {
    return (
      <>
        <Grain />
        <Live state={state} now={now} onExit={() => navigate('home')} />
        {celebration}
        {milestoneBanner}
        {overlays}
      </>
    )
  }

  return (
    <div className="shell">
      <Grain />
      <TopNav view={view} onNavigate={navigate} counts={counts} onAdd={() => setFormOpen(true)} />

      <main className={cx('content', view === 'home' && 'content-home')} key={view}>
        {view === 'home' && <Home state={state} now={now} onAdd={() => setFormOpen(true)} onOpen={openFile} onNavigate={navigate} />}
        {view === 'board' && <RescueBoard state={state} now={now} onAdd={() => setFormOpen(true)} onOpen={openFile} />}
        {view === 'map' && <MapView state={state} now={now} onOpen={openFile} />}
        {view === 'ngos' && <NgoNetwork state={state} now={now} />}
        {view === 'dispatch' && <Dispatch state={state} now={now} store={store} toast={toast} onOpen={openFile} />}
        {view === 'impact' && <Impact state={state} now={now} />}
      </main>

      <footer className="footer">
        <Wordmark />
        <span className="footer-tag">{t('Good food. Better futures.')}</span>
        <span className="footer-note">
          {t('Pre-evaluation build · demonstration data (fictional NGOs, simulated runners) · feasibility is a screening aid, not a food-safety certification · environmental figures are estimates · supports SDG 13.')}
        </span>
        <button className="reset-link" onClick={() => setConfirmReset(true)}>
          <RotateCcw size={13} /> {t('Reset demo data')}
        </button>
      </footer>

      <nav className="tabbar" aria-label="Main navigation">
        {NAV.map(({ id, short, Icon }) => (
          <button key={id} className={cx(view === id && 'on')} onClick={() => navigate(id)}>
            <Icon size={19} />
            <span>{t(short)}</span>
          </button>
        ))}
      </nav>

      {formOpen && (
        <DonationForm
          state={state}
          now={now}
          onClose={() => setFormOpen(false)}
          onSubmit={(input) => {
            const created = store.addDonation(input)
            setFormOpen(false)
            toast(t('“{name}” is on the board. Here are its matches.', { name: created.name }))
            setOpenId(created.id)
          }}
        />
      )}

      {open && (
        <RescueFile
          donation={open}
          state={state}
          now={now}
          store={store}
          toast={toast}
          onClose={() => setOpenId(null)}
          onOpenImpact={() => navigate('impact')}
        />
      )}

      {confirmReset && (
        <div className="modal-scrim" onClick={() => setConfirmReset(false)}>
          <div className="modal confirm" role="alertdialog" aria-modal="true" aria-label="Reset demo data" onClick={(e) => e.stopPropagation()}>
            <h2>{t('Reset demo data?')}</h2>
            <p>{t('This clears every listing, match and rescue you created in this browser and restores the sample city.')}</p>
            <div className="confirm-actions">
              <button className="btn btn-outline-ink" onClick={() => setConfirmReset(false)}>
                {t('Keep my data')}
              </button>
              <button
                className="btn btn-ink"
                onClick={() => {
                  store.reset()
                  setConfirmReset(false)
                  setOpenId(null)
                  toast(t('Demo data restored.'), 'info')
                  navigate('home')
                }}
              >
                <RotateCcw size={15} /> {t('Reset')}
              </button>
            </div>
          </div>
        </div>
      )}

      {celebration}
      {milestoneBanner}
      <Toasts toasts={toasts} />
      {overlays}
    </div>
  )
}
