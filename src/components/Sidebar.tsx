import type { ReactNode } from 'react'
import { BarChart3, Bike, Building2, Home, Map, ScanLine, ShieldCheck, Soup, Tv } from 'lucide-react'
import { Wordmark } from './Art'
import { cx } from './ui'
import { LANGS, useT } from '../lib/i18n'

export type View = 'home' | 'board' | 'map' | 'ngos' | 'trust' | 'dispatch' | 'impact' | 'live'

export const NAV: Array<{ id: View; label: string; short: string; Icon: typeof Soup }> = [
  { id: 'home', label: 'Home', short: 'Home', Icon: Home },
  { id: 'board', label: 'Rescue board', short: 'Board', Icon: Soup },
  { id: 'map', label: 'Live map', short: 'Map', Icon: Map },
  { id: 'ngos', label: 'NGO network', short: 'NGOs', Icon: Building2 },
  { id: 'trust', label: 'TrustCheck', short: 'Trust', Icon: ShieldCheck },
  { id: 'dispatch', label: 'Runner dispatch', short: 'Runners', Icon: Bike },
  { id: 'impact', label: 'Impact', short: 'Impact', Icon: BarChart3 },
]

export function LangToggle() {
  const { lang, setLang } = useT()
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button key={l.id} className={cx(lang === l.id && 'on')} onClick={() => setLang(l.id)} aria-pressed={lang === l.id} title={l.name}>
          {l.label}
        </button>
      ))}
    </div>
  )
}

export function TopNav({
  view,
  onNavigate,
  counts,
  onScan,
  account,
}: {
  view: View
  onNavigate: (v: View) => void
  counts: Partial<Record<View, number>>
  onScan: () => void
  account?: ReactNode
}) {
  const { t } = useT()
  return (
    <header className="topnav">
      <a
        className="brand"
        href="#home"
        onClick={(e) => {
          e.preventDefault()
          onNavigate('home')
        }}
      >
        <Wordmark />
      </a>
      <nav className="topnav-links" aria-label="Main navigation">
        {NAV.slice(1).map(({ id, label }) => (
          <a
            key={id}
            href={`#${id}`}
            className={cx('nav-link', view === id && 'active')}
            aria-current={view === id ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault()
              onNavigate(id)
            }}
          >
            {t(label)}
            {counts[id] ? <em>{counts[id]}</em> : null}
          </a>
        ))}
      </nav>
      <div className="topnav-right">
        <LangToggle />
        <button className="btn btn-ghost-light room-btn" onClick={() => onNavigate('live')}>
          <Tv size={16} /> <span>{t('Room wall')}</span>
        </button>
        <button className="btn btn-pink" onClick={onScan}>
          <ScanLine size={17} /> <span>{t('Scan & donate')}</span>
        </button>
        {account}
      </div>
    </header>
  )
}
