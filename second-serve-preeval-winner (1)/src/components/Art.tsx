import { Carrot, Croissant, Soup, Wheat } from 'lucide-react'
import type { Category } from '../types'
import { cx } from './ui'

const DROP = 'M32 4c11 15 22 23 22 36a22 22 0 0 1-44 0C10 27 21 19 32 4Z'

export function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <span className="wordmark">
      <svg className="wordmark-drop" viewBox="0 0 64 64" aria-hidden>
        <path d={DROP} />
      </svg>
      {!compact && <span className="wordmark-text">second serve</span>}
    </span>
  )
}

// The signature drip: a wobbly underline with a bead hanging from the middle.
export function DripUnderline({ className }: { className?: string }) {
  return (
    <svg className={cx('drip-line', className)} viewBox="0 0 760 74" preserveAspectRatio="none" aria-hidden>
      <path d="M8 22c120-10 250-12 332-8 20 1 28 6 30 18 2 14 6 24 12 24s10-10 12-24c2-12 10-17 30-18 92-4 220-2 326 8 7 1 7 9 0 10-110 10-240 12-326 9-14 0-22 8-24 20-3 14-8 28-18 28s-15-14-18-28c-2-12-10-20-24-20-86 3-216 1-332-9-7-1-7-9 0-10Z" />
    </svg>
  )
}

export function FallingDrop({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <svg className={cx('falling-drop', className)} style={{ animationDelay: `${delay}s` }} viewBox="0 0 64 64" aria-hidden>
      <path d={DROP} />
    </svg>
  )
}

export function Drop({ className, size = 18 }: { className?: string; size?: number }) {
  return (
    <svg className={cx('drop', className)} width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <path d={DROP} />
    </svg>
  )
}

// Print-grain overlay so flat colour reads like risograph paper.
export function Grain() {
  return (
    <svg className="grain" aria-hidden>
      <filter id="grain-noise">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
        <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#grain-noise)" />
    </svg>
  )
}

// Hand-drawn arrow for margin annotations.
export function Squiggle({ className }: { className?: string }) {
  return (
    <svg className={cx('squiggle', className)} viewBox="0 0 120 60" aria-hidden>
      <path d="M4 50c18-6 22-30 40-30s18 22 36 18 22-26 34-30" />
      <path d="M102 4l12 4-6 11" />
    </svg>
  )
}

export function Stamp({ children, tone = 'pink' }: { children: string; tone?: 'pink' | 'ink' }) {
  return <span className={cx('stamp', `stamp-${tone}`)}>{children}</span>
}

const tokenTone: Record<Category, string> = {
  Meals: 'pink',
  Bakery: 'amber',
  Produce: 'mint',
  'Dry rations': 'lilac',
}

export function CategoryToken({ category, size = 46 }: { category: Category; size?: number }) {
  const Icon = category === 'Bakery' ? Croissant : category === 'Produce' ? Carrot : category === 'Dry rations' ? Wheat : Soup
  return (
    <span className={`token token-${tokenTone[category]}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" aria-hidden>
        <path d={DROP} />
      </svg>
      <Icon size={size * 0.4} strokeWidth={2} />
    </span>
  )
}

// Countdown ring: how much of the safe window is left (out of `total` minutes shown).
export function ClockRing({
  minutesLeft,
  tone,
  size = 74,
}: {
  minutesLeft: number
  tone: 'ok' | 'warn' | 'bad' | 'done'
  size?: number
}) {
  const r = size / 2 - 7
  const c = 2 * Math.PI * r
  const span = 6 * 60 // a full ring = 6 hours
  const frac = Math.max(0, Math.min(1, minutesLeft / span))
  const m = Math.max(0, Math.round(minutesLeft))
  const label = tone === 'done' ? '✓' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
  return (
    <span className={cx('ring', `ring-${tone}`)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="ring-fill"
          strokeDasharray={c}
          strokeDashoffset={tone === 'done' ? 0 : c * (1 - frac)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <b>{label}</b>
    </span>
  )
}
