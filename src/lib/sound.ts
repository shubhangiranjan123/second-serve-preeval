import { useEffect, useState } from 'react'

const KEY = 'second-serve-sound'
const EVENT = 'ss-sound-change'

let ctx: AudioContext | null = null

function readOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

export function unlockAudio() {
  audio()
}

function note(ac: AudioContext, freq: number, start: number, length: number, gain: number, type: OscillatorType = 'sine') {
  const osc = ac.createOscillator()
  const g = ac.createGain()
  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 2400
  osc.type = type
  osc.frequency.value = freq
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(gain, start + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, start + length)
  osc.connect(filter)
  filter.connect(g)
  g.connect(ac.destination)
  osc.start(start)
  osc.stop(start + length + 0.05)
}

export function chime(kind: 'bloom' | 'milestone' | 'tick' = 'bloom') {
  if (!readOn()) return
  const ac = audio()
  if (!ac) return
  const t = ac.currentTime + 0.02
  if (kind === 'tick') {
    note(ac, 1318.5, t, 0.25, 0.04, 'triangle')
    return
  }
  if (kind === 'bloom') {
    const seq = [523.25, 659.25, 783.99, 1046.5]
    seq.forEach((f, i) => {
      note(ac, f, t + i * 0.11, 1.4, 0.07)
      note(ac, f * 2, t + i * 0.11, 0.6, 0.015, 'triangle')
    })
    return
  }
  const chord = [392, 493.88, 587.33, 739.99, 880, 1174.66]
  chord.forEach((f, i) => note(ac, f, t + i * 0.07, 2.4, 0.06))
  note(ac, 196, t, 2.6, 0.05, 'triangle')
}

export function useSound(): [boolean, () => void] {
  const [on, setOn] = useState(readOn)
  useEffect(() => {
    const sync = () => setOn(readOn())
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  const toggle = () => {
    const next = !on
    try {
      localStorage.setItem(KEY, next ? 'on' : 'off')
    } catch {
      return
    }
    window.dispatchEvent(new Event(EVENT))
    if (next) {
      unlockAudio()
      chime('tick')
    }
  }
  return [on, toggle]
}
