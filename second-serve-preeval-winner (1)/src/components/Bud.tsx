import type { Category, Donation } from '../types'
import { useT } from '../lib/i18n'

const HEAD: Record<Category, string> = {
  Meals: '#ff5c9a',
  Bakery: '#ffc94d',
  Produce: '#8fe3b9',
  'Dry rations': '#c9b8ff',
}

export function budState(d: Pick<Donation, 'createdAt' | 'safeUntil' | 'status'>, now: number) {
  if (d.status === 'Delivered') return { fresh: 1, phase: 'bloom' as const }
  const total = Math.max(1, d.safeUntil - d.createdAt)
  const fresh = Math.max(0, Math.min(1, (d.safeUntil - now) / total))
  if (fresh <= 0) return { fresh, phase: 'dead' as const }
  if (fresh < 0.25) return { fresh, phase: 'wilting' as const }
  if (fresh < 0.55) return { fresh, phase: 'tired' as const }
  return { fresh, phase: 'fresh' as const }
}

export function Bud({ d, now, size = 54 }: { d: Donation; now: number; size?: number }) {
  const { t } = useT()
  const { fresh, phase } = budState(d, now)
  const droop = phase === 'bloom' ? 0 : (1 - fresh) * 78
  const color = phase === 'dead' ? '#5d6e64' : HEAD[d.category]
  const stem = phase === 'dead' ? '#4a5a51' : phase === 'wilting' ? '#6f8a5c' : '#4fc27e'
  const open = phase === 'bloom' ? 1 : phase === 'fresh' ? 0.25 : 0
  const label =
    phase === 'bloom'
      ? t('Bloomed: delivered in time')
      : phase === 'dead'
        ? t('Wilted: safe window closed')
        : t('{n}% of safe time left', { n: Math.round(fresh * 100) })

  return (
    <span className={`bud bud-${phase}`} title={label} aria-label={label} role="img" style={{ width: size, height: size }}>
      <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden>
        <path d="M30 58 C30 46 29 38 30 30" stroke={stem} strokeWidth="3.2" fill="none" strokeLinecap="round" />
        <path d="M30 46 C22 44 18 38 18 34 C25 35 29 40 30 46 Z" fill={stem} opacity="0.9" />
        <g style={{ transform: `rotate(${droop}deg)`, transformOrigin: '30px 31px', transition: 'transform 1.2s cubic-bezier(.34,1.56,.64,1)' }}>
          <path d="M30 31 C30 27 30 24 30 21" stroke={stem} strokeWidth="3" fill="none" strokeLinecap="round" />
          {phase === 'bloom' ? (
            <g>
              {Array.from({ length: 8 }, (_, i) => (
                <ellipse key={i} cx="30" cy="9" rx="4.2" ry="8" fill={color} transform={`rotate(${i * 45} 30 17)`} />
              ))}
              <circle cx="30" cy="17" r="4.5" fill="#ffc94d" />
            </g>
          ) : (
            <g>
              <ellipse cx={30 - open * 6} cy="15" rx="5.5" ry="8.5" fill={color} transform={`rotate(${-12 - open * 30} 30 21)`} />
              <ellipse cx={30 + open * 6} cy="15" rx="5.5" ry="8.5" fill={color} transform={`rotate(${12 + open * 30} 30 21)`} />
              <ellipse cx="30" cy="14" rx="5" ry="9" fill={color} opacity="0.92" />
              <path d="M24 20 C27 23 33 23 36 20 L34 23 C32 25 28 25 26 23 Z" fill={stem} />
            </g>
          )}
        </g>
        {phase === 'dead' && <ellipse cx="44" cy="56" rx="5" ry="2.2" fill="#5d6e64" transform="rotate(-14 44 56)" />}
      </svg>
    </span>
  )
}
