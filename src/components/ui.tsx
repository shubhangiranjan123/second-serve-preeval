import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import type { Verdict } from '../lib/engine'
import type { DispatchStage, DonationStatus } from '../types'
import { useT } from '../lib/i18n'

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

// Animated number that eases from its previous value to the new one.
export function CountUp({ value, decimals = 0, duration = 900 }: { value: number; decimals?: number; duration?: number }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)

  useEffect(() => {
    const start = performance.now()
    const begin = from.current
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(begin + (value - begin) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      from.current = value
    }
  }, [value, duration])

  return <>{shown.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}</>
}

const verdictIcon: Record<Verdict, ReactNode> = {
  Feasible: <CheckCircle2 size={14} strokeWidth={2.2} />,
  'At risk': <AlertTriangle size={14} strokeWidth={2.2} />,
  'Not feasible': <XCircle size={14} strokeWidth={2.2} />,
}

export function VerdictPill({ verdict, large }: { verdict: Verdict; large?: boolean }) {
  const { t } = useT()
  const tone = verdict === 'Feasible' ? 'ok' : verdict === 'At risk' ? 'warn' : 'bad'
  return (
    <span className={cx('verdict', `verdict-${tone}`, large && 'verdict-lg')}>
      {verdictIcon[verdict]}
      {t(verdict)}
    </span>
  )
}

export function StatusPill({ status, stage }: { status: DonationStatus; stage: DispatchStage }) {
  const { t } = useT()
  if (status === 'In review') return <span className="status status-review">{t('In review')}</span>
  if (status === 'Available') return <span className="status status-available">{t('Available')}</span>
  if (status === 'Delivered') return <span className="status status-delivered">{t('Delivered')}</span>
  const label = stage === 'Pending' ? t('Matched · awaiting runner') : t(stage)
  return <span className="status status-reserved">{label}</span>
}

export function ScoreRing({ score, size = 58 }: { score: number; size?: number }) {
  const r = size / 2 - 5
  const c = 2 * Math.PI * r
  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="score-ring-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="score-ring-fill"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span>{score}</span>
    </div>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="eyebrow">
      <span className="eyebrow-dot" />
      {children}
    </div>
  )
}

export function DemoBadge({ children }: { children?: ReactNode }) {
  const { t } = useT()
  return <span className="demo-badge">{children ?? t('Demonstration data')}</span>
}
