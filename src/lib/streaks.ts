import type { RescueRecord } from '../types'

const DAY = 24 * 60 * 60 * 1000

function dayKey(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export type Streak = { donor: string; days: number; week: boolean[]; total: number; meals: number }

export function donorStreaks(history: RescueRecord[], now: number): Streak[] {
  const byDonor = new Map<string, RescueRecord[]>()
  for (const r of history) {
    const list = byDonor.get(r.donor) ?? []
    list.push(r)
    byDonor.set(r.donor, list)
  }
  const out: Streak[] = []
  for (const [donor, recs] of byDonor) {
    const days = new Set(recs.map((r) => dayKey(r.deliveredAt)))
    const week = Array.from({ length: 7 }, (_, i) => days.has(dayKey(now - (6 - i) * DAY)))
    let streak = 0
    let cursor = days.has(dayKey(now)) ? now : now - DAY
    while (days.has(dayKey(cursor))) {
      streak++
      cursor -= DAY
    }
    out.push({ donor, days: streak, week, total: recs.length, meals: recs.reduce((s, r) => s + r.servings, 0) })
  }
  return out.sort((a, b) => b.days - a.days || b.meals - a.meals)
}

export function streakFor(history: RescueRecord[], donor: string, now: number) {
  return donorStreaks(history, now).find((s) => s.donor === donor)?.days ?? 0
}
