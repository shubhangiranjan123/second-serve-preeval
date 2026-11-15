// Sign in: choose a role → choose your account → PIN.
// Donors and NGOs can create an account; runners are added by a coordinator.

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, Bike, Building2, ChefHat, Delete, LayoutDashboard, Search } from 'lucide-react'
import type { Account, RescueStore } from '../lib/useRescueStore'
import type { Role } from '../lib/actions'
import { DripUnderline, FallingDrop, Grain, Wordmark } from '../components/Art'
import { WasteCounter } from '../components/WasteCounter'
import { NEXT_ROLE_KEY } from '../components/AccountMenu'
import { LangToggle } from '../components/Sidebar'
import { useT } from '../lib/i18n'
import { cx } from '../components/ui'

const ROLES: Array<{ role: Role; title: string; line: string; Icon: typeof ChefHat }> = [
  { role: 'donor', title: 'Donor', line: 'Restaurants, caterers, bakeries. Scan surplus food and follow it to the plate.', Icon: ChefHat },
  { role: 'ngo', title: 'NGO', line: 'Shelters and kitchens. See food coming your way, accept it, confirm it arrived.', Icon: Building2 },
  { role: 'runner', title: 'Runner', line: 'Volunteers on bikes and scooters. Take a run, pick up, deliver.', Icon: Bike },
  { role: 'coordinator', title: 'Coordinator', line: 'Runs the rescue desk: matching, dispatch, TrustCheck, the room wall.', Icon: LayoutDashboard },
]

export function Login({ store }: { store: RescueStore }) {
  const { t } = useT()
  const [all, setAll] = useState<Account[] | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [role, setRole] = useState<Role | null>(() => {
    // arriving from "Switch board": open straight at that role's account list
    try {
      const r = sessionStorage.getItem(NEXT_ROLE_KEY)
      sessionStorage.removeItem(NEXT_ROLE_KEY)
      return r === 'donor' || r === 'ngo' || r === 'runner' || r === 'coordinator' ? r : null
    } catch {
      return null
    }
  })
  const [account, setAccount] = useState<Account | null>(null)
  const [pin, setPin] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [signup, setSignup] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newPin2, setNewPin2] = useState('')
  const server = store.mode === 'server'

  useEffect(() => {
    store
      .accounts()
      .then(setAll)
      .catch(() => setLoadErr(t('Couldn’t load accounts from the server.')))
  }, [store.mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(
    () => (all ?? []).filter((a) => a.role === role).filter((a) => !q.trim() || a.name.toLowerCase().includes(q.trim().toLowerCase())),
    [all, role, q],
  )

  async function go(acc: Account, p: string) {
    setBusy(true)
    setError('')
    const e = await store.login(acc, p).catch(() => t('Couldn’t reach the server.'))
    setBusy(false)
    if (e) {
      setError(e)
      setPin('')
    }
  }

  async function doSignup(e: FormEvent) {
    e.preventDefault()
    if (!role || (role !== 'donor' && role !== 'ngo')) return
    if (newName.trim().length < 3) return setError(t('Organisation name must be 3–80 characters.'))
    if (!/^\d{4,8}$/.test(newPin)) return setError(t('Choose a PIN of 4–8 digits.'))
    if (newPin !== newPin2) return setError(t('The two PINs don’t match.'))
    setBusy(true)
    const err = await store.signup(role, newName.trim(), newPin).catch(() => t('Couldn’t reach the server.'))
    setBusy(false)
    if (err) setError(err)
  }

  const pinPad = (
    <div className="pinpad" aria-label={t('PIN keypad')}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
        k === '' ? (
          <span key={i} />
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => (k === '⌫' ? setPin((p) => p.slice(0, -1)) : setPin((p) => (p.length < 8 ? p + k : p)))}
            aria-label={k === '⌫' ? t('Delete') : k}
          >
            {k === '⌫' ? <Delete size={20} /> : k}
          </button>
        ),
      )}
    </div>
  )

  return (
    <div className="login">
      <Grain />
      <header className="login-top">
        <Wordmark />
        <LangToggle />
      </header>

      <section className="login-hero">
        <p className="lw-lead">{t('Since you opened this page, India has thrown away')}</p>
        <div className="lw-number">
          <strong>
            <WasteCounter /> kg
          </strong>
          <DripUnderline />
          <FallingDrop />
          <FallingDrop className="fd-2" delay={1.3} />
        </div>
        <p className="lw-tail">
          {t('of food. Every plate has a route.')} <b>{t('Pick your board and give it one.')}</b>
        </p>
        <p className="lw-mode">{server ? t('Sign in to your board. Every screen updates live as food moves from kitchen to shelter.') : t('Offline demo: no server found, so data stays in this browser. Pick who you want to be.')}</p>
      </section>

      <section className="login-panel">
        {!role && (
          <div className="role-grid">
            {ROLES.map(({ role: r, title, line, Icon }) => (
              <button key={r} className={cx('role-card', `role-${r}`)} onClick={() => (setRole(r), setError(''), setQ(''))}>
                <Icon size={28} strokeWidth={1.8} />
                <strong>{t(title)}</strong>
                <span>{t(line)}</span>
              </button>
            ))}
          </div>
        )}

        {role && !account && !signup && (
          <div className="login-step">
            <button className="link-back" onClick={() => setRole(null)}>
              <ArrowLeft size={16} /> {t('Choose a different role')}
            </button>
            <span className={cx('login-role-tag', `role-${role}`)}>{t(ROLES.find((x) => x.role === role)!.title)}</span>
            <h2>{t('Who are you?')}</h2>
            {loadErr && <p className="field-err">{loadErr}</p>}
            {(all?.filter((a) => a.role === role).length ?? 0) > 6 && (
              <label className="search">
                <Search size={15} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search')} aria-label={t('Search accounts')} autoFocus />
              </label>
            )}
            <div className="acct-list">
              {list.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    setAccount(a)
                    setPin(store.demoPins?.[a.role] ?? '') // demo: PIN pre-filled, one tap to sign in
                    setError('')
                    if (!server) go(a, '')
                  }}
                >
                  {a.name}
                </button>
              ))}
              {all && list.length === 0 && <p className="step-muted">{t('No accounts yet.')}</p>}
            </div>
            {server && (role === 'donor' || role === 'ngo') && (
              <button className="btn btn-ghost-light" onClick={() => (setSignup(true), setError(''))}>
                {role === 'donor' ? t('New donor? Create an account') : t('New NGO? Create an account')}
              </button>
            )}
          </div>
        )}

        {role && account && server && (
          <form
            className="login-step"
            onSubmit={(e) => {
              e.preventDefault()
              if (pin.length >= 4) go(account, pin)
            }}
          >
            <button type="button" className="link-back" onClick={() => setAccount(null)}>
              <ArrowLeft size={16} /> {account.name}
            </button>
            <h2>{t('Enter your PIN')}</h2>
            <input
              className="pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              aria-label={t('PIN')}
              autoFocus
            />
            {pinPad}
            {error && <p className="field-err" role="alert">{error}</p>}
            <button className="btn btn-pink btn-lg btn-block" type="submit" disabled={busy || pin.length < 4}>
              {busy ? t('Signing in…') : t('Sign in')}
            </button>
            {store.demoPins && (
              <small className="demo-pins">
                {t('Demo: the PIN ({pin}) is filled in for you. Just press Sign in.', { pin: store.demoPins[role] })}
              </small>
            )}
          </form>
        )}

        {role && signup && (
          <form className="login-step" onSubmit={doSignup}>
            <button type="button" className="link-back" onClick={() => setSignup(false)}>
              <ArrowLeft size={16} /> {t('Back')}
            </button>
            <h2>{role === 'donor' ? t('Create a donor account') : t('Create an NGO account')}</h2>
            <label className="field">
              <span>{t('Organisation name')}</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>{t('Choose a PIN (4–8 digits)')}</span>
              <input type="password" inputMode="numeric" autoComplete="new-password" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
            </label>
            <label className="field">
              <span>{t('Repeat the PIN')}</span>
              <input type="password" inputMode="numeric" autoComplete="new-password" value={newPin2} onChange={(e) => setNewPin2(e.target.value.replace(/\D/g, '').slice(0, 8))} />
            </label>
            {error && <p className="field-err" role="alert">{error}</p>}
            <button className="btn btn-pink btn-lg btn-block" type="submit" disabled={busy}>
              {busy ? t('Creating…') : t('Create account')}
            </button>
            <small className="demo-pins">
              {role === 'ngo'
                ? t('You can see your board straight away. You start receiving food once a coordinator verifies you in TrustCheck.')
                : t('Next, apply in TrustCheck from your board so the network can verify your kitchen.')}
            </small>
          </form>
        )}
      </section>
    </div>
  )
}
