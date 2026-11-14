import type { Category, RescueRecord } from '../types'

export type MilestoneId = 'tree' | 'fireflies' | 'pond' | 'aurora'

export const MILESTONES: Array<{ at: number; id: MilestoneId; name: string; line: string }> = [
  { at: 5, id: 'tree', name: 'The lantern tree', line: 'A tree of tiny lanterns took root.' },
  { at: 10, id: 'fireflies', name: 'Fireflies', line: 'Fireflies found the garden.' },
  { at: 15, id: 'pond', name: 'The moon pond', line: 'A moon pond opened up.' },
  { at: 20, id: 'aurora', name: 'Aurora sky', line: 'The sky lit up with an aurora.' },
]

export function unlockedMilestones(count: number) {
  return new Set(MILESTONES.filter((m) => count >= m.at).map((m) => m.id))
}

export function nextMilestone(count: number) {
  return MILESTONES.find((m) => count < m.at) ?? null
}

export function milestoneReached(before: number, after: number) {
  return MILESTONES.filter((m) => before < m.at && after >= m.at).pop() ?? null
}

export const SPECIES: Record<Category, { name: string; food: string; petal: string; petal2: string; center: string }> = {
  Meals: { name: 'Dahlia', food: 'cooked meals', petal: '#ff5c9a', petal2: '#ff8ab5', center: '#ffc94d' },
  Bakery: { name: 'Sunflower', food: 'bakery', petal: '#ffc94d', petal2: '#ffb020', center: '#16211c' },
  Produce: { name: 'Tulip', food: 'fresh produce', petal: '#8fe3b9', petal2: '#c8f5df', center: '#4fc27e' },
  'Dry rations': { name: 'Lotus', food: 'dry rations', petal: '#c9b8ff', petal2: '#ebe4ff', center: '#ffc94d' },
}

export function seeded(text: string, salt: number) {
  let h = 2166136261 ^ salt
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10_000) / 10_000
}

export type Plant = {
  r: RescueRecord
  key: string
  x: number
  base: number
  h: number
  scale: number
  tilt: number
  sway: number
}

export const GARDEN_W = 1200
export const GARDEN_H = 440

export function plantFor(r: RescueRecord): Plant {
  const key = `${r.donationId}-${r.deliveredAt}`
  const size = Math.min(1, r.servings / 40)
  const depth = seeded(key, 4)
  return {
    r,
    key,
    x: 200 + seeded(key, 1) * 720,
    base: 362 + depth * 40,
    h: 80 + size * 120 + seeded(key, 2) * 40,
    scale: (0.75 + size * 0.55) * (0.85 + depth * 0.3),
    tilt: (seeded(key, 3) - 0.5) * 2,
    sway: 4 + seeded(key, 5) * 4,
  }
}

export function layoutGarden(history: RescueRecord[]) {
  return history.map(plantFor).sort((a, b) => a.base - b.base)
}
