import { useEffect, useRef } from 'react'

const INTERACTIVE = 'a, button, [role="button"], [role="switch"], select, label, summary, .fl, .m-pin, .m-house, .m-runner'
const TYPING = 'input, textarea, [contenteditable="true"]'

export function Cursor() {
  const ring = useRef<HTMLDivElement>(null)
  const pond = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const r = ring.current
    const water = pond.current
    if (!r || !water) return
    const fine = window.matchMedia('(pointer: fine)').matches
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const ripple = (x: number, y: number) => {
      for (let i = 0; i < 2; i++) {
        const el = document.createElement('span')
        el.className = 'cursor-ripple'
        el.style.left = `${x}px`
        el.style.top = `${y}px`
        el.style.animationDelay = `${i * 140}ms`
        el.addEventListener('animationend', () => el.remove())
        water.appendChild(el)
      }
    }

    const click = (e: PointerEvent) => {
      if (reduce) return
      ripple(e.clientX, e.clientY)
    }
    window.addEventListener('pointerdown', click, { passive: true })

    if (!fine || reduce) {
      return () => window.removeEventListener('pointerdown', click)
    }

    let mx = -100
    let my = -100
    let x = -100
    let y = -100
    let raf = 0

    const move = (e: PointerEvent) => {
      mx = e.clientX
      my = e.clientY
      r.style.opacity = ''
    }
    const over = (e: PointerEvent) => {
      const el = e.target as Element | null
      if (!el || !el.closest) return
      const typing = !!el.closest(TYPING)
      r.classList.toggle('is-hot', !typing && !!el.closest(INTERACTIVE))
      r.classList.toggle('is-hidden', typing)
    }
    const leave = () => {
      r.style.opacity = '0'
    }
    const frame = () => {
      x += (mx - x) * 0.2
      y += (my - y) * 0.2
      r.style.transform = `translate3d(${x}px, ${y}px, 0)`
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerover', over, { passive: true })
    document.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointerdown', click)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerover', over)
      document.removeEventListener('pointerleave', leave)
    }
  }, [])

  return (
    <>
      <div ref={pond} className="cursor-pond" aria-hidden />
      <div ref={ring} className="cursor-ring" aria-hidden>
        <i />
      </div>
    </>
  )
}
