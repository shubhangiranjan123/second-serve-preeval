import { BarChart3, Bike, Building2, Home, Plus, Soup, Tv } from 'lucide-react'
import { Wordmark } from './Art'
import { cx } from './ui'

export type View = 'home' | 'board' | 'ngos' | 'dispatch' | 'impact' | 'live'

export const NAV: Array<{ id: View; label: string; short: string; Icon: typeof Soup }> = [
  { id: 'home', label: 'Home', short: 'Home', Icon: Home },
  { id: 'board', label: 'Rescue board', short: 'Board', Icon: Soup },
  { id: 'ngos', label: 'NGO network', short: 'NGOs', Icon: Building2 },
  { id: 'dispatch', label: 'Runner dispatch', short: 'Runners', Icon: Bike },
  { id: 'impact', label: 'Impact', short: 'Impact', Icon: BarChart3 },
]

export function TopNav({
  view,
  onNavigate,
  counts,
  onAdd,
}: {
  view: View
  onNavigate: (v: View) => void
  counts: Partial<Record<View, number>>
  onAdd: () => void
}) {
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
            {label}
            {counts[id] ? <em>{counts[id]}</em> : null}
          </a>
        ))}
      </nav>
      <div className="topnav-right">
        <button className="btn btn-ghost-light room-btn" onClick={() => onNavigate('live')}>
          <Tv size={16} /> <span>Room wall</span>
        </button>
        <button className="btn btn-pink" onClick={onAdd}>
          <Plus size={17} /> <span>List surplus food</span>
        </button>
      </div>
    </header>
  )
}
