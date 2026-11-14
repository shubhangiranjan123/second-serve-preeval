import { useEffect, useRef } from 'react'

const EVENT = 'ss-confetti'
const COLORS = ['#ff5c9a', '#ff8ab5', '#ffc94d', '#8fe3b9', '#c9b8ff', '#7fe6ff', '#fcf0f5']

type Petal = {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  w: number
  h: number
  color: string
  life: number
  wobble: number
}

export function burstConfetti(power = 1) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: power }))
}

export function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const g = canvas.getContext('2d')
    if (!g) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let petals: Petal[] = []
    let raf = 0
    let running = false

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const frame = () => {
      g.clearRect(0, 0, window.innerWidth, window.innerHeight)
      petals = petals.filter((p) => p.life > 0 && p.y < window.innerHeight + 40)
      for (const p of petals) {
        p.vy += 0.06
        p.vx *= 0.99
        p.vy *= 0.99
        p.wobble += 0.08
        p.x += p.vx + Math.sin(p.wobble) * 0.8
        p.y += p.vy
        p.rot += p.vr
        p.life -= 1
        g.save()
        g.globalAlpha = Math.min(1, p.life / 40)
        g.translate(p.x, p.y)
        g.rotate(p.rot)
        g.scale(1, Math.abs(Math.cos(p.wobble)) * 0.7 + 0.3)
        g.fillStyle = p.color
        g.beginPath()
        g.ellipse(0, 0, p.w, p.h, 0, 0, Math.PI * 2)
        g.fill()
        g.restore()
      }
      if (petals.length) raf = requestAnimationFrame(frame)
      else {
        running = false
        g.clearRect(0, 0, window.innerWidth, window.innerHeight)
      }
    }

    const fire = (e: Event) => {
      if (reduce) return
      const power = Number((e as CustomEvent).detail) || 1
      const count = Math.round(110 * power)
      const w = window.innerWidth
      for (let i = 0; i < count; i++) {
        const fromLeft = i % 2 === 0
        petals.push({
          x: fromLeft ? -10 : w + 10,
          y: window.innerHeight * (0.55 + Math.random() * 0.3),
          vx: (fromLeft ? 1 : -1) * (5 + Math.random() * 9),
          vy: -(8 + Math.random() * 9),
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.25,
          w: 4 + Math.random() * 6,
          h: 9 + Math.random() * 8,
          color: COLORS[i % COLORS.length],
          life: 160 + Math.random() * 90,
          wobble: Math.random() * 6,
        })
      }
      if (!running) {
        running = true
        raf = requestAnimationFrame(frame)
      }
    }

    window.addEventListener(EVENT, fire)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener(EVENT, fire)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={ref} className="confetti" aria-hidden />
}
