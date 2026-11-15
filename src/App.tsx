import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useRescueStore, type RescueStore, type User } from './lib/useRescueStore'
import { TopNav, NAV, type View } from './components/Sidebar'
import { Toasts, type Toast } from './components/Toasts'
import { ScanFlow } from './components/ScanFlow'
import { RescueFile } from './components/RescueFile'
import { Drop, Grain, Wordmark } from './components/Art'
import { AccountMenu } from './components/AccountMenu'
import { cx } from './components/ui'
import { Home } from './views/Home'
import { RescueBoard } from './views/RescueBoard'
import { NgoNetwork } from './views/NgoNetwork'
import { Trust } from './views/Trust'
import { Dispatch } from './views/Dispatch'
import { Impact } from './views/Impact'
import { Live } from './views/Live'
import { MapView } from './views/MapView'
import { Login } from './views/Login'
import { DonorBoard } from './views/boards/DonorBoard'
import { NgoBoard } from './views/boards/NgoBoard'
import { RunnerBoard } from './views/boards/RunnerBoard'
import { Cursor } from './components/Cursor'
import { chime } from './lib/sound'
import { SPECIES, milestoneReached, MILESTONES } from './lib/garden'
import { useT } from './lib/i18n'
import type { AppState, RescueRecord } from './types'

const VIEWS: View[] = ['home', 'board', 'map', 'ngos', 'trust', 'dispatch', 'impact', 'live']

function readHash(): View {
  const h = window.location.hash.replace('#', '') as View
  return VIEWS.includes(h) ? h : 'home'
}

export function useNow(state: unknown, intervalMs = 15_000) {
  const [tick, setTick] = useState(() => Date.now())
  const [changed, setChanged] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  useEffect(() => setChanged(Date.now()), [state])
  return Math.max(tick, changed)
}

export type ToastFn = (msg: string, tone?: Toast['tone']) => void

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const id = useRef(0)
  const toast = useCallback<ToastFn>((msg, tone = 'ok') => {
    const n = ++id.current
    setToasts((t) => [...t.slice(-2), { id: n, msg, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n)), 3800)
  }, [])
  return { toasts, toast }
}

// ---------------------------------------------------------------- gate

export default function App() {
  const store = useRescueStore()
  const { toasts, toast } = useToasts()
  const { t } = useT()

  useEffect(() => store.setErrorHandler((m) => toast(m, 'warn')), [store.setErrorHandler, toast]) // eslint-disable-line react-hooks/exhaustive-deps

  let body
  if (store.mode === 'loading' || (store.user && !store.state)) {
    body = (
      <div className="splash" aria-live="polite">
        <Wordmark />
        <span className="spinner" />
        <p>{store.mode === 'loading' ? t('Connecting to SECOND-SERVE…') : t('Loading the live board…')}</p>
      </div>
    )
  } else if (!store.user || !store.state) {
    body = <Login store={store} />
  } else if (store.user.role === 'coordinator') {
    body = <Console store={store} state={store.state} user={store.user} toast={toast} />
  } else if (store.user.role === 'donor') {
    body = <DonorBoard store={store} state={store.state} user={store.user} toast={toast} />
  } else if (store.user.role === 'ngo') {
    body = <NgoBoard store={store} state={store.state} user={store.user} toast={toast} />
  } else {
    body = <RunnerBoard store={store} state={store.state} user={store.user} toast={toast} />
  }

  return (
    <>
      {body}
      <Toasts toasts={toasts} />
    </>
  )
}

// ---------------------------------------------------------------- coordinator console

function Console({ store, state, user, toast }: { store: RescueStore; state: AppState; user: User; toast: ToastFn }) {
  const { t } = useT()
  const now = useNow(state)
  const [view, setView] = useState<View>(readHash)
  const [openId, setOpenId] = useState<number | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [celebrate, setCelebrate] = useState<RescueRecord | null>(null)
  const [milestone, setMilestone] = useState<(typeof MILESTONES)[number] | null>(null)
  const historyCount = useRef(state.history.length)

  // A new delivery anywhere (any screen, any device) triggers the stamp moment.
  useEffect(() => {
    if (state.history.length > historyCount.current) {
      const latest = [...state.history].sort((a, b) => b.deliveredAt - a.deliveredAt)[0]
      const reached = milestoneReached(historyCount.current, state.history.length)
      setCelebrate(latest ?? null)
      chime('bloom')
      const timers = [setTimeout(() => setCelebrate(null), 2600)]
      if (reached) {
        timers.push(
          setTimeout(() => {
            setMilestone(reached)
            chime('milestone')
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

  const openScan = () => setScanOpen(true)
  const open = state.donations.find((d) => d.id === openId) ?? null
  const counts = {
    board: state.donations.filter((d) => d.status === 'Available' || d.status === 'In review').length,
    dispatch: state.donations.filter((d) => d.status === 'Reserved').length,
    trust: (state.applications ?? []).filter((a) => a.status === 'Submitted' || a.status === 'Under Review').length,
  }
  const openFile = (d: { id: number }) => setOpenId(d.id)

  useEffect(() => {
    document.body.style.overflow = open || scanOpen || confirmReset ? 'hidden' : ''
  }, [open, scanOpen, confirmReset])

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

  if (view === 'live') {
    return (
      <>
        <Grain />
        <Live state={state} now={now} onExit={() => navigate('home')} />
        {celebration}
        {milestoneBanner}
        <Cursor />
      </>
    )
  }

  return (
    <div className="shell">
      <Grain />
      <TopNav view={view} onNavigate={navigate} counts={counts} onScan={openScan} account={<AccountMenu store={store} user={user} toast={toast} />} />

      <main className={cx('content', view === 'home' && 'content-home')} key={view}>
        {view === 'home' && <Home state={state} now={now} onAdd={openScan} onOpen={openFile} onNavigate={navigate} />}
        {view === 'board' && <RescueBoard state={state} now={now} onScan={openScan} onOpen={openFile} />}
        {view === 'map' && <MapView state={state} now={now} onOpen={openFile} />}
        {view === 'ngos' && <NgoNetwork state={state} now={now} />}
        {view === 'trust' && <Trust state={state} store={store} toast={toast} />}
        {view === 'dispatch' && <Dispatch state={state} now={now} store={store} toast={toast} onOpen={openFile} />}
        {view === 'impact' && <Impact state={state} now={now} />}
      </main>

      <footer className="footer">
        <Wordmark />
        <span className="footer-tag">{t('Good food. Better futures.')}</span>
        <span className="footer-note">
          {t('Demonstration data (fictional NGOs, simulated runners) · feasibility is a screening aid, not a food-safety certification · environmental figures are estimates · supports SDG 13.')}
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

      <ScanFlow open={scanOpen} onClose={() => setScanOpen(false)} state={state} now={now} store={store} toast={toast} onPublished={(id) => setOpenId(id)} />

      {open && (
        <RescueFile
          donation={open}
          state={state}
          now={now}
          store={store}
          toast={toast}
          onClose={() => setOpenId(null)}
          onOpenImpact={() => navigate('impact')}
          onNavigate={(v) => navigate(v)}
          onApprove={(d) =>
            store.approveReview(d.id, undefined, true).then((r) => {
              if (!r.ok) return
              toast(
                r.result.matchedTo
                  ? t('Published and matched to {name}. Now assign a runner.', { name: r.result.matchedTo })
                  : t('Published, but no organisation can take it in time. It stays on the board, unmatched.'),
                r.result.matchedTo ? 'ok' : 'warn',
              )
            })
          }
        />
      )}

      {confirmReset && (
        <div className="modal-scrim" onClick={() => setConfirmReset(false)}>
          <div className="modal confirm" role="alertdialog" aria-modal="true" aria-label="Reset demo data" onClick={(e) => e.stopPropagation()}>
            <h2>{t('Reset demo data?')}</h2>
            <p>
              {store.mode === 'server'
                ? t('This clears every listing, match and rescue on the server, for everyone, and restores the sample city. Accounts are kept.')
                : t('This clears every listing, match and rescue you created in this browser and restores the sample city.')}
            </p>
            <div className="confirm-actions">
              <button className="btn btn-outline-ink" onClick={() => setConfirmReset(false)}>
                {t('Keep my data')}
              </button>
              <button
                className="btn btn-ink"
                onClick={() =>
                  store.reset().then((r) => {
                    setConfirmReset(false)
                    if (!r.ok) return
                    setOpenId(null)
                    toast(t('Demo data restored.'), 'info')
                    navigate('home')
                  })
                }
              >
                <RotateCcw size={15} /> {t('Reset')}
              </button>
            </div>
          </div>
        </div>
      )}

      {celebration}
      {milestoneBanner}
      <Cursor />
    </div>
  )
}
