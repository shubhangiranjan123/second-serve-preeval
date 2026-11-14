import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Download, Sprout, Volume2, VolumeX } from 'lucide-react'
import type { Category, Donation, RescueRecord } from '../types'
import {
  GARDEN_H,
  GARDEN_W,
  MILESTONES,
  SPECIES,
  layoutGarden,
  nextMilestone,
  seeded,
  unlockedMilestones,
  type Plant,
} from '../lib/garden'
import { formatClock, impactTotals, sameLocalDay } from '../lib/engine'
import { useSound } from '../lib/sound'
import { useT } from '../lib/i18n'
import { cx } from './ui'

function Head({ category, R }: { category: Category; R: number }) {
  const s = SPECIES[category]
  if (category === 'Meals') {
    return (
      <g>
        {Array.from({ length: 12 }, (_, i) => (
          <ellipse key={`o${i}`} cx="0" cy={-R * 0.55} rx={R * 0.24} ry={R * 0.5} fill={s.petal} transform={`rotate(${i * 30})`} />
        ))}
        {Array.from({ length: 9 }, (_, i) => (
          <ellipse key={`i${i}`} cx="0" cy={-R * 0.36} rx={R * 0.18} ry={R * 0.34} fill={s.petal2} transform={`rotate(${i * 40 + 20})`} />
        ))}
        <circle r={R * 0.24} fill={s.center} />
      </g>
    )
  }
  if (category === 'Bakery') {
    return (
      <g>
        {Array.from({ length: 16 }, (_, i) => (
          <ellipse key={`a${i}`} cx="0" cy={-R * 0.66} rx={R * 0.15} ry={R * 0.42} fill={s.petal2} transform={`rotate(${i * 22.5 + 11})`} />
        ))}
        {Array.from({ length: 16 }, (_, i) => (
          <ellipse key={`b${i}`} cx="0" cy={-R * 0.62} rx={R * 0.15} ry={R * 0.4} fill={s.petal} transform={`rotate(${i * 22.5})`} />
        ))}
        <circle r={R * 0.4} fill={s.center} />
        {Array.from({ length: 7 }, (_, i) => (
          <circle key={`d${i}`} cx={Math.cos(i * 0.9) * R * 0.22} cy={Math.sin(i * 0.9) * R * 0.22} r={R * 0.05} fill="#ffc94d" />
        ))}
      </g>
    )
  }
  if (category === 'Produce') {
    return (
      <g>
        <path
          d={`M${-R * 0.55} ${-R * 0.05} C${-R * 0.7} ${-R * 0.9} ${-R * 0.25} ${-R * 1.05} 0 ${-R * 0.6} C${R * 0.25} ${-R * 1.05} ${R * 0.7} ${-R * 0.9} ${R * 0.55} ${-R * 0.05} C${R * 0.5} ${R * 0.5} ${-R * 0.5} ${R * 0.5} ${-R * 0.55} ${-R * 0.05} Z`}
          fill={s.petal}
        />
        <path d={`M0 ${-R * 0.75} C${R * 0.3} ${-R * 0.4} ${R * 0.25} ${R * 0.25} 0 ${R * 0.3} C${-R * 0.25} ${R * 0.25} ${-R * 0.3} ${-R * 0.4} 0 ${-R * 0.75} Z`} fill={s.petal2} opacity="0.85" />
      </g>
    )
  }
  const petal = `M0 0 C${-R * 0.36} ${-R * 0.4} ${-R * 0.26} ${-R * 0.95} 0 ${-R * 1.12} C${R * 0.26} ${-R * 0.95} ${R * 0.36} ${-R * 0.4} 0 0 Z`
  return (
    <g transform={`translate(0 ${R * 0.35})`}>
      {[-66, -44, -22, 22, 44, 66].map((a) => (
        <path key={a} d={petal} fill={s.petal} transform={`rotate(${a})`} />
      ))}
      <path d={petal} fill={s.petal2} />
      {[-30, 30].map((a) => (
        <path key={`in${a}`} d={petal} fill={s.petal2} opacity="0.8" transform={`rotate(${a}) scale(0.75)`} />
      ))}
      <ellipse cx="0" cy={-R * 0.1} rx={R * 0.22} ry={R * 0.1} fill={s.center} />
    </g>
  )
}

function Flower({
  p,
  fresh,
  intro,
  index,
  glow,
  onHover,
}: {
  p: Plant
  fresh: boolean
  intro: boolean
  index: number
  glow: string
  onHover: (p: Plant | null) => void
}) {
  const R = 22 * p.scale
  const hx = p.tilt * 10
  const hy = -p.h
  const stem = `M0 0 C${p.tilt * 4} ${-p.h * 0.35} ${hx - p.tilt * 16} ${-p.h * 0.7} ${hx} ${hy}`
  const leafY = -p.h * 0.35
  return (
    <g
      transform={`translate(${p.x.toFixed(1)} ${p.base.toFixed(1)})`}
      className={cx('fl', fresh && 'fl-new', intro && 'fl-intro')}
      style={{ animationDelay: intro ? `${index * 70}ms` : undefined }}
      onMouseEnter={() => onHover(p)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(p)}
      onBlur={() => onHover(null)}
      tabIndex={0}
      role="img"
      aria-label={`${p.r.food}, ${p.r.servings}`}
    >
      <g className="fl-sway" style={{ animationDuration: `${p.sway}s`, animationDelay: `${-index * 0.7}s` }}>
        <path className="fl-stem" d={stem} pathLength={1} stroke="#4fc27e" strokeWidth={Math.max(2.4, 3.4 * p.scale)} fill="none" strokeLinecap="round" />
        <g className="fl-leaf" transform={`translate(${p.tilt * 2} ${leafY})`}>
          <path d="M0 0 C-14 -4 -22 -14 -22 -22 C-10 -20 -2 -12 0 0 Z" fill="#3fae6c" transform={`scale(${p.scale})`} />
        </g>
        <g className="fl-leaf fl-leaf-2" transform={`translate(${p.tilt * 3} ${leafY - p.h * 0.18})`}>
          <path d="M0 0 C14 -4 22 -14 22 -22 C10 -20 2 -12 0 0 Z" fill="#4fc27e" transform={`scale(${p.scale * 0.85})`} />
        </g>
        <g transform={`translate(${hx} ${hy})`}>
          <g className="fl-head" filter={`url(#${glow})`}>
            <Head category={p.r.category} R={R} />
          </g>
          {fresh && <circle className="fl-ring" r={R * 1.4} fill="none" stroke={SPECIES[p.r.category].petal} strokeWidth="2" />}
        </g>
      </g>
      <circle r={R + 12} cx={hx} cy={hy} fill="transparent" />
    </g>
  )
}

function Sky({ unlocked, ids }: { unlocked: Set<string>; ids: { sky: string; aurora: string; moon: string } }) {
  return (
    <g>
      <defs>
        <linearGradient id={ids.sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b1210" />
          <stop offset="0.7" stopColor="#16211c" />
          <stop offset="1" stopColor="#1f2c26" />
        </linearGradient>
        <linearGradient id={ids.aurora} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ff5c9a" stopOpacity="0" />
          <stop offset="0.3" stopColor="#ff8ab5" stopOpacity="0.45" />
          <stop offset="0.6" stopColor="#c9b8ff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#7fe6ff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={ids.moon}>
          <stop offset="0" stopColor="#fcf0f5" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fcf0f5" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={GARDEN_W} height={GARDEN_H} fill={`url(#${ids.sky})`} />
      {unlocked.has('aurora') && (
        <g className="g-aurora">
          <path d="M-20 120 C200 40 420 150 640 80 S1000 20 1220 90 L1220 150 C1000 90 820 190 640 140 S220 110 -20 180 Z" fill={`url(#${ids.aurora})`} />
          <path d="M-20 70 C260 10 480 100 700 50 S1040 0 1220 40 L1220 80 C1040 40 860 130 700 95 S260 70 -20 110 Z" fill={`url(#${ids.aurora})`} opacity="0.6" />
        </g>
      )}
      {Array.from({ length: 56 }, (_, i) => (
        <circle
          key={i}
          className="g-star"
          cx={seeded(`s${i}`, 1) * GARDEN_W}
          cy={seeded(`s${i}`, 2) * 230}
          r={0.6 + seeded(`s${i}`, 3) * 1.4}
          fill="#fcf0f5"
          style={{ animationDelay: `${seeded(`s${i}`, 4) * 4}s` }}
        />
      ))}
      <circle cx="1080" cy="74" r="70" fill={`url(#${ids.moon})`} />
      <circle cx="1080" cy="74" r="26" fill="#fcf0f5" />
      <circle cx="1091" cy="66" r="23" fill="#0f1814" />
    </g>
  )
}

function Tree({ glow }: { glow: string }) {
  return (
    <g className="g-tree" transform="translate(96 392)">
      <path d="M-10 0 C-8 -40 -14 -80 -4 -120 C0 -140 6 -150 4 -170 L12 -170 C12 -140 8 -120 12 -90 C14 -60 10 -30 14 0 Z" fill="#31453a" />
      <path d="M0 -110 C-20 -125 -40 -130 -58 -128" stroke="#31453a" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M8 -130 C26 -145 44 -150 62 -146" stroke="#31453a" strokeWidth="6" fill="none" strokeLinecap="round" />
      <g filter={`url(#${glow})`} opacity="0.9">
        {[
          [-50, -160, 40],
          [0, -195, 48],
          [52, -170, 42],
          [-20, -150, 34],
          [28, -145, 34],
          [-62, -128, 26],
          [70, -138, 26],
        ].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill="#8fe3b9" opacity={0.18 + (i % 3) * 0.06} />
        ))}
      </g>
      {[
        [-56, -128],
        [-30, -150],
        [12, -176],
        [44, -150],
        [66, -140],
        [-8, -130],
        [30, -200],
        [-44, -182],
      ].map(([x, y], i) => (
        <g key={i} className="g-lantern" style={{ animationDelay: `${i * 0.4}s` }}>
          <line x1={x} y1={y - 12} x2={x} y2={y - 4} stroke="#4d5f55" strokeWidth="1" />
          <circle cx={x} cy={y} r="4.5" fill="#ffc94d" filter={`url(#${glow})`} />
        </g>
      ))}
    </g>
  )
}

function Pond({ glow }: { glow: string }) {
  return (
    <g className="g-pond">
      <ellipse cx="1050" cy="404" rx="140" ry="26" fill="#0f2b3a" stroke="#7fe6ff" strokeOpacity="0.25" strokeWidth="2" />
      <ellipse className="g-shimmer" cx="1068" cy="402" rx="22" ry="5" fill="#fcf0f5" opacity="0.45" />
      <ellipse className="g-shimmer g-shimmer-2" cx="1044" cy="410" rx="34" ry="3" fill="#7fe6ff" opacity="0.25" />
      {[
        [972, 400, 16],
        [1118, 408, 13],
        [1010, 414, 10],
      ].map(([x, y, r], i) => (
        <path key={i} d={`M${x} ${y} m-${r} 0 a${r} ${r * 0.4} 0 1 0 ${r * 2} 0 L${x} ${y} Z`} fill="#3fae6c" />
      ))}
      <g transform="translate(972 396)" filter={`url(#${glow})`}>
        {[-40, 0, 40].map((a) => (
          <ellipse key={a} cx="0" cy="-6" rx="3.5" ry="7" fill="#ff8ab5" transform={`rotate(${a})`} />
        ))}
      </g>
    </g>
  )
}

function Fireflies({ glow }: { glow: string }) {
  return (
    <g className="g-fireflies" filter={`url(#${glow})`}>
      {Array.from({ length: 18 }, (_, i) => (
        <circle
          key={i}
          className="g-firefly"
          cx={160 + seeded(`f${i}`, 1) * 900}
          cy={150 + seeded(`f${i}`, 2) * 190}
          r={2 + seeded(`f${i}`, 3) * 1.6}
          fill="#ffe27a"
          style={{ animationDelay: `${-seeded(`f${i}`, 4) * 9}s`, animationDuration: `${7 + seeded(`f${i}`, 5) * 6}s` }}
        />
      ))}
    </g>
  )
}

function FallenPetal({ d, onHover }: { d: Donation; onHover: (d: Donation | null) => void }) {
  const key = `w${d.id}`
  const x = 200 + seeded(key, 1) * 720
  const y = 398 + seeded(key, 2) * 22
  const rot = (seeded(key, 3) - 0.5) * 120
  return (
    <g
      transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(0)})`}
      className="g-fallen"
      onMouseEnter={() => onHover(d)}
      onMouseLeave={() => onHover(null)}
    >
      <ellipse rx="11" ry="4.5" fill="#5d6e64" />
      <ellipse rx="7" ry="2.6" cx="-2" fill="#7f9989" opacity="0.5" />
      <circle r="14" fill="transparent" />
    </g>
  )
}

export type GardenProps = {
  history: RescueRecord[]
  wilted?: Donation[]
  now: number
  revealUntil?: number
  variant?: 'full' | 'wall' | 'mini'
  showHeader?: boolean
}

export function Garden({ history, wilted = [], now, revealUntil, variant = 'full', showHeader = true }: GardenProps) {
  const { t } = useT()
  const uid = useId().replace(/:/g, '')
  const ids = { glow: `g-glow-${uid}`, sky: `g-sky-${uid}`, aurora: `g-aur-${uid}`, moon: `g-moon-${uid}` }
  const svgRef = useRef<SVGSVGElement>(null)
  const [sound, toggleSound] = useSound()
  const [hover, setHover] = useState<Plant | null>(null)
  const [hoverMiss, setHoverMiss] = useState<Donation | null>(null)

  const visible = useMemo(
    () => (revealUntil === undefined ? history : history.filter((r) => r.deliveredAt <= revealUntil)),
    [history, revealUntil],
  )
  const plants = useMemo(() => layoutGarden(visible), [visible])
  const unlocked = unlockedMilestones(visible.length)
  const next = nextMilestone(visible.length)
  const totals = impactTotals(visible)

  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [intro, setIntro] = useState(true)
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(plants.map((p) => p.key))
      const t1 = setTimeout(() => setIntro(false), 2400)
      return () => clearTimeout(t1)
    }
    const current = new Set(plants.map((p) => p.key))
    for (const k of [...seen.current]) if (!current.has(k)) seen.current.delete(k)
    const added = plants.filter((p) => !seen.current!.has(p.key)).map((p) => p.key)
    if (added.length) {
      added.forEach((k) => seen.current!.add(k))
      setFresh((f) => new Set([...f, ...added]))
      const t2 = setTimeout(() => setFresh((f) => new Set([...f].filter((k) => !added.includes(k)))), 4200)
      return () => clearTimeout(t2)
    }
  }, [plants])

  const downloadPostcard = async () => {
    const svg = svgRef.current
    if (!svg) return
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(GARDEN_W))
    clone.setAttribute('height', String(GARDEN_H))
    clone.querySelectorAll('.fl-ring').forEach((n) => n.remove())
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('render failed'))
      img.src = url
    }).catch(() => undefined)
    const W = 1600
    const H = 1000
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const g = c.getContext('2d')
    if (!g) return
    g.fillStyle = '#16211c'
    g.fillRect(0, 0, W, H)
    const gh = (W * GARDEN_H) / GARDEN_W
    try {
      g.drawImage(img, 0, H - gh, W, gh)
    } catch {
      g.fillStyle = '#1f2c26'
      g.fillRect(0, H - gh, W, gh)
    }
    URL.revokeObjectURL(url)
    const grad = g.createLinearGradient(0, 0, 0, 420)
    grad.addColorStop(0, '#16211c')
    grad.addColorStop(1, 'rgba(22,33,28,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, W, 420)
    g.fillStyle = '#ff5c9a'
    g.font = '600 26px "JetBrains Mono", monospace'
    g.fillText('SECOND SERVE · RESCUE GARDEN', 80, 100)
    g.fillStyle = '#eef4ef'
    g.font = '800 92px "Bricolage Grotesque", sans-serif'
    g.fillText(`${totals.meals.toLocaleString('en-IN')} meals`, 80, 205)
    g.fillStyle = '#ff8ab5'
    g.font = '800 92px "Bricolage Grotesque", sans-serif'
    g.fillText('grew this garden.', 80, 300)
    g.fillStyle = '#b5c7bb'
    g.font = '500 30px Figtree, sans-serif'
    g.fillText(`${totals.deliveries} rescues · ${totals.kg} kg kept out of the bin · ≈ ${totals.co2e} kg CO₂e avoided (est.)`, 80, 360)
    g.fillStyle = '#7f9989'
    g.font = '400 20px "JetBrains Mono", monospace'
    g.fillText(new Date(now).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }), W - 330, 100)
    c.toBlob((b) => {
      if (!b) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b)
      a.download = 'second-serve-garden.png'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    }, 'image/png')
  }

  const hoverStyle = hover
    ? {
        left: `${Math.min(84, Math.max(10, (hover.x / GARDEN_W) * 100))}%`,
        top: `${Math.max(4, ((hover.base - hover.h - 40) / GARDEN_H) * 100)}%`,
      }
    : undefined

  return (
    <section className={cx('garden', `garden-${variant}`)} aria-label={t('Rescue garden')}>
      {showHeader && variant !== 'wall' && (
        <header className="garden-head">
          <div>
            <span className="kicker"><Sprout size={14} /> {t('The rescue garden')}</span>
            <h2>{t('Every rescue grows something.')}</h2>
            <p>{t('One flower blooms for each delivered rescue. Food that runs out of time falls as a grey petal.')}</p>
          </div>
          <div className="garden-actions">
            <button className="btn btn-ghost-light btn-sm" onClick={toggleSound} aria-pressed={sound}>
              {sound ? <Volume2 size={15} /> : <VolumeX size={15} />} {sound ? t('Sound on') : t('Sound off')}
            </button>
            <button className="btn btn-pink btn-sm" onClick={downloadPostcard}>
              <Download size={15} /> {t('Garden postcard')}
            </button>
          </div>
        </header>
      )}

      <div className="garden-stage">
        <svg ref={svgRef} viewBox={`0 0 ${GARDEN_W} ${GARDEN_H}`} preserveAspectRatio="xMidYMax slice" role="img" aria-label={t('{n} flowers in the rescue garden', { n: plants.length })}>
          <defs>
            <filter id={ids.glow} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <Sky unlocked={unlocked} ids={ids} />
          {unlocked.has('tree') && <Tree glow={ids.glow} />}
          <path d="M0 378 C200 352 380 372 600 364 C820 356 1000 380 1200 366 L1200 440 L0 440 Z" fill="#1f2c26" />
          {unlocked.has('pond') && <Pond glow={ids.glow} />}
          {plants.map((p, i) => (
            <Flower key={p.key} p={p} index={i} fresh={fresh.has(p.key)} intro={intro} glow={ids.glow} onHover={setHover} />
          ))}
          <path d="M0 418 C240 408 460 422 700 414 C900 408 1060 420 1200 412 L1200 440 L0 440 Z" fill="#18241f" />
          {Array.from({ length: 34 }, (_, i) => {
            const x = seeded(`g${i}`, 1) * GARDEN_W
            return <path key={i} d={`M${x} 426 q2 -10 4 0 q2 -8 4 0`} stroke="#31453a" strokeWidth="1.6" fill="none" />
          })}
          {wilted.map((d) => (
            <FallenPetal key={d.id} d={d} onHover={setHoverMiss} />
          ))}
          {unlocked.has('fireflies') && <Fireflies glow={ids.glow} />}
        </svg>

        {hover && (
          <div className="garden-card" style={hoverStyle}>
            <span className="garden-card-species" style={{ color: SPECIES[hover.r.category].petal }}>
              {t(SPECIES[hover.r.category].name)} · {t(SPECIES[hover.r.category].food)}
            </span>
            <strong>{hover.r.food}</strong>
            <span>
              {t('{n} meals', { n: hover.r.servings })} · {hover.r.donor} → {hover.r.ngoName}
            </span>
            <em>
              {t('Runner')} {hover.r.runnerName} ·{' '}
              {sameLocalDay(hover.r.deliveredAt, now)
                ? `${t('today')} ${formatClock(hover.r.deliveredAt)}`
                : new Date(hover.r.deliveredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </em>
          </div>
        )}
        {hoverMiss && !hover && (
          <div className="garden-card garden-card-miss" style={{ left: '50%', top: '58%' }}>
            <span className="garden-card-species">{t('Missed rescue')}</span>
            <strong>{hoverMiss.name}</strong>
            <span>
              {hoverMiss.donor} · {t('{n} meals', { n: hoverMiss.servings })}
            </span>
            <em>{t('Safe window closed at {time}', { time: formatClock(hoverMiss.safeUntil) })}</em>
          </div>
        )}
      </div>

      {variant === 'full' && (
        <footer className="garden-foot">
          <ul className="garden-legend">
            {(Object.keys(SPECIES) as Category[]).map((c) => (
              <li key={c}>
                <i style={{ background: SPECIES[c].petal }} /> {t(SPECIES[c].name)} <span>· {t(SPECIES[c].food)}</span>
              </li>
            ))}
            {wilted.length > 0 && (
              <li>
                <i style={{ background: '#5d6e64' }} /> {t('Grey petal')} <span>· {t('missed')} ({wilted.length})</span>
              </li>
            )}
          </ul>
          <div className="garden-progress">
            <div className="garden-badges">
              {MILESTONES.map((m) => (
                <span key={m.id} className={cx('garden-badge', unlocked.has(m.id) && 'on')} title={t(m.line)}>
                  {t(m.name)} <em>{m.at}</em>
                </span>
              ))}
            </div>
            {next ? (
              <p>
                {t('{n} more rescues until {name}', { n: next.at - visible.length, name: t(next.name) })}
                <span className="garden-bar">
                  <i style={{ width: `${(visible.length / next.at) * 100}%` }} />
                </span>
              </p>
            ) : (
              <p>{t('Every milestone unlocked. The garden is in full bloom.')}</p>
            )}
          </div>
        </footer>
      )}
    </section>
  )
}
