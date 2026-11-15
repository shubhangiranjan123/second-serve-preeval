// Account menu + "Open on a phone" QR + activity log.
// Shown in the coordinator console and on every role board.

import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowLeftRight, Download, LogOut, Smartphone, X } from 'lucide-react'
import type { Role } from '../lib/actions'
import QRCode from 'qrcode'
import type { RescueStore, User } from '../lib/useRescueStore'
import { useT } from '../lib/i18n'
import { cx } from './ui'

type Toast = (msg: string, tone?: 'ok' | 'info' | 'warn') => void

const ROLE_LABEL = { coordinator: 'Coordinator', donor: 'Donor', ngo: 'NGO', runner: 'Runner' } as const

export function LiveDot({ conn, mode }: { conn: RescueStore['conn']; mode: RescueStore['mode'] }) {
  const { t } = useT()
  const label = mode === 'local' ? t('Offline demo') : conn === 'live' ? t('Live') : t('Reconnecting…')
  return (
    <span className={cx('live-dot', mode === 'local' ? 'off' : conn === 'live' ? 'on' : 'wait')} title={label}>
      <i /> <span>{label}</span>
    </span>
  )
}

/** Sign-in screen opens straight at this role after a switch. */
export const NEXT_ROLE_KEY = 'second-serve-next-role'

/** Always-visible "Switch board" button: pick a role, land on its sign-in list. */
export function RoleSwitch({ store, user }: { store: RescueStore; user: User }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  const go = (role: Role) => {
    try {
      sessionStorage.setItem(NEXT_ROLE_KEY, role)
    } catch {
      /* private mode: lands on the role picker instead */
    }
    setOpen(false)
    store.logout()
  }
  return (
    <div className="role-switch" ref={ref}>
      <button className="role-switch-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" title={t('Switch board')} aria-label={t('Switch board')}>
        <ArrowLeftRight size={16} />
        <span>{t('Switch board')}</span>
      </button>
      {open && (
        <div className="role-switch-menu" role="menu">
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
            <button key={r} role="menuitem" className={cx('rs-item', `role-${r}`, r === user.role && 'is-me')} onClick={() => go(r)}>
              <i />
              {t(ROLE_LABEL[r])}
              {r === user.role && <em>{t('you')}</em>}
            </button>
          ))}
          <button role="menuitem" className="rs-all" onClick={() => go('' as Role)}>
            {t('Back to the start screen')}
          </button>
        </div>
      )}
    </div>
  )
}

export function AccountMenu({ store, user, toast }: { store: RescueStore; user: User; toast: Toast }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<'phone' | 'log' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <>
    <RoleSwitch store={store} user={user} />
    <div className="acct" ref={ref}>
      <button className="acct-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className={cx('acct-avatar', `role-${user.role}`)}>{initials}</span>
        <LiveDot conn={store.conn} mode={store.mode} />
      </button>
      {open && (
        <div className="acct-menu" role="menu">
          <div className="acct-who">
            <strong>{user.name}</strong>
            <span>
              {t(ROLE_LABEL[user.role])}
              {store.mode === 'local' && ` · ${t('offline demo: data stays in this browser')}`}
            </span>
          </div>
          <button role="menuitem" onClick={() => (setPanel('phone'), setOpen(false))}>
            <Smartphone size={16} /> {t('Open on a phone')}
          </button>
          {user.role === 'coordinator' && store.mode === 'server' && (
            <>
              <button role="menuitem" onClick={() => (setPanel('log'), setOpen(false))}>
                <Activity size={16} /> {t('Activity log')}
              </button>
              <button
                role="menuitem"
                onClick={async () => {
                  setOpen(false)
                  toast(await store.importLocal(), 'info')
                }}
              >
                <Download size={16} /> {t('Import this browser’s saved data')}
              </button>
            </>
          )}
          <button role="menuitem" onClick={() => store.logout()}>
            <LogOut size={16} /> {store.mode === 'local' ? t('Switch role') : t('Sign out')}
          </button>
        </div>
      )}
      {panel === 'phone' && <PhonePanel mode={store.mode} onClose={() => setPanel(null)} />}
      {panel === 'log' && <ActivityLog onClose={() => setPanel(null)} />}
    </div>
    </>
  )
}

function PhonePanel({ mode, onClose }: { mode: RescueStore['mode']; onClose: () => void }) {
  const { t } = useT()
  const [urls, setUrls] = useState<string[]>([])
  const [qr, setQr] = useState<string | null>(null)
  const [pick, setPick] = useState(0)

  useEffect(() => {
    const here = `${location.protocol}//${location.host}${location.pathname}`
    if (mode !== 'server') return setUrls([here])
    fetch('/api/lan')
      .then((r) => r.json())
      .then((b: { addresses?: string[] }) => {
        const port = location.port ? `:${location.port}` : ''
        const lan = (b.addresses ?? []).map((ip) => `${location.protocol}//${ip}${port}${location.pathname}`)
        setUrls(lan.length ? lan : [here])
      })
      .catch(() => setUrls([here]))
  }, [mode])

  useEffect(() => {
    if (!urls[pick]) return
    QRCode.toDataURL(urls[pick], { margin: 1, width: 320, color: { dark: '#16211c', light: '#fff1f4' } })
      .then(setQr)
      .catch(() => setQr(null))
  }, [urls, pick])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal phone-modal" role="dialog" aria-modal="true" aria-label={t('Open on a phone')} onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn phone-close" onClick={onClose} aria-label={t('Close')}>
          <X size={20} />
        </button>
        <h2>{t('Scan with a phone camera')}</h2>
        <p>{mode === 'server' ? t('The phone must be on the same Wi-Fi as this computer. Then sign in as a donor, NGO or runner.') : t('Offline demo: the phone will get its own separate data. Start the server for a shared live board.')}</p>
        {qr ? <img className="phone-qr" src={qr} alt={urls[pick]} /> : <div className="phone-qr skeleton" />}
        <code className="phone-url">{urls[pick]}</code>
        {urls.length > 1 && (
          <div className="chips">
            {urls.map((u, i) => (
              <button key={u} className={cx('chip-mini', i === pick && 'on')} onClick={() => setPick(i)}>
                {t('Network {n}', { n: i + 1 })}
              </button>
            ))}
          </div>
        )}
        {location.hostname === 'localhost' && mode === 'server' && urls[0]?.includes('localhost') && (
          <small>{t('No Wi-Fi address found. Connect this computer to Wi-Fi first.')}</small>
        )}
      </div>
    </div>
  )
}

type AuditRow = { id: number; at: number; user_name: string | null; role: string | null; action: string; target: string | null; ok: number; detail: string | null }

function ActivityLog({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetch('/api/audit?limit=150')
      .then((r) => r.json())
      .then((b) => (b.ok ? setRows(b.entries) : setError(b.error?.message ?? 'Couldn’t load the log')))
      .catch(() => setError('Couldn’t reach the server'))
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside className="drawer audit-drawer" role="dialog" aria-modal="true" aria-label={t('Activity log')} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div className="drawer-title">
            <span className="drawer-kicker">{t('Server audit trail')}</span>
            <h2>{t('Activity log')}</h2>
            <span className="drawer-sub">{t('Every sign-in and every change, including refused ones, with who did it.')}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t('Close')}>
            <X size={20} />
          </button>
        </header>
        <div className="drawer-body">
          {error && <p className="field-err">{error}</p>}
          {!rows && !error && <div className="skeleton" />}
          {rows && (
            <ol className="audit-list">
              {rows.map((r) => {
                let msg = ''
                try {
                  msg = r.detail ? (JSON.parse(r.detail).message ?? '') : ''
                } catch {
                  /* ignore */
                }
                return (
                  <li key={r.id} className={r.ok ? '' : 'audit-bad'}>
                    <time>{new Date(r.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</time>
                    <strong>{r.action}</strong>
                    <span>
                      {r.user_name ?? '—'} {r.role && <em>({r.role})</em>}
                      {r.target && ` · #${r.target}`}
                      {!r.ok && ` · ${t('refused')}${msg ? `: ${msg}` : ''}`}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </aside>
    </div>
  )
}
