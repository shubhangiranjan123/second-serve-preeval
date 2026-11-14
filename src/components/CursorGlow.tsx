import { useEffect, useRef } from 'react'

const COLORS = ['255, 92, 154', '255, 201, 77', '201, 184, 255', '127, 230, 255']

type Spark = { x: number; y: number; vx: number; vy: number; life: number; size: number; c: string }

export function CursorGlow() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const fine = window.matchMedia('(pointer: fine)').matches
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!fine || reduce) return
    const g = canvas.getContext('2d')
    if (!g) return

    let sparks: Spark[] = []
    let raf = 0
    let mx = -100
    let my = -100
    let lx = -100
    let ly = -100
    let i = 0

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const move = (e: PointerEvent) => {
      mx = e.clientX
      my = e.clientY
      const dist = Math.hypot(mx - lx, my - ly)
      const n = Math.min(4, Math.floor(dist / 9))
      for (let k = 0; k < n; k++) {
        const t = k / Math.max(1, n)
        sparks.push({
          x: lx + (mx - lx) * t,
          y: ly + (my - ly) * t,
          vx: (Math.random() - 0.5) * 0.6,
          vy: (Math.random() - 0.5) * 0.6 + 0.25,
          life: 1,
          size: 2 + Math.random() * 3.5,
          c: COLORS[i++ % COLORS.length],
        })
      }
      if (sparks.length > 140) sparks = sparks.slice(-140)
      lx = mx
      ly = my
    }

    const frame = () => {
      g.clearRect(0, 0, window.innerWidth, window.innerHeight)
      g.globalCompositeOperation = 'lighter'
      const halo = g.createRadialGradient(mx, my, 0, mx, my, 120)
      halo.addColorStop(0, 'rgba(255, 92, 154, 0.10)')
      halo.addColorStop(1, 'rgba(255, 92, 154, 0)')
      g.fillStyle = halo
      g.fillRect(mx - 120, my - 120, 240, 240)
      for (const s of sparks) {
        s.x += s.vx
        s.y += s.vy
        s.life -= 0.022
        if (s.life <= 0) continue
        g.fillStyle = `rgba(${s.c}, ${s.life * 0.85})`
        g.shadowColor = `rgba(${s.c}, ${s.life})`
        g.shadowBlur = 12
        g.beginPath()
        g.arc(s.x, s.y, s.size * s.life, 0, Math.PI * 2)
        g.fill()
      }
      g.shadowBlur = 0
      g.globalCompositeOperation = 'source-over'
      sparks = sparks.filter((s) => s.life > 0)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={ref} className="cursor-glow" aria-hidden />
}
