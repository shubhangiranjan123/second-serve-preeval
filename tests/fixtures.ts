import { createInitialState } from '../src/data/demoData'
import { MIN } from '../src/lib/engine'
import type { FoodScan } from '../src/lib/foodScan'
import type { DonorFacts } from '../src/lib/verification'
import type { AppState, Donation } from '../src/types'

// 1 pm local time on the hackathon day: every demo NGO is open.
export const NOW = new Date(2026, 10, 14, 13, 0).getTime()

export function demo(): AppState {
  return createInitialState(NOW)
}

export function donation(over: Partial<Donation> = {}): Donation {
  return {
    id: 900,
    name: 'Veg pulao',
    donor: 'Test Kitchen',
    category: 'Meals',
    servings: 20,
    quantity: 20,
    unit: 'servings',
    area: 'Sector 17',
    address: 'Gate 1',
    lat: 30.741,
    lng: 76.779,
    storage: 'Chilled',
    diet: 'Veg',
    description: '',
    createdAt: NOW,
    prepMinutes: 0,
    travelEstimate: 20,
    readyAt: NOW,
    safeUntil: NOW + 4 * 60 * MIN,
    status: 'Available',
    ngoId: null,
    runnerId: null,
    stage: 'Pending',
    timeline: [],
    ...over,
  }
}

export function scan(over: Partial<FoodScan> = {}): FoodScan {
  return {
    isFood: true,
    dishName: 'Veg pulao with dal tadka',
    items: ['pulao', 'dal tadka'],
    category: 'Meals',
    dietGuess: 'Veg',
    visualAssessment: 'acceptable',
    concerns: [],
    packaging: 'sealed',
    quantity: { inferable: true, servings: 20, amount: null, unit: null, basis: '4 trays of ~5 portions' },
    confidence: { overall: 0.88, identification: 0.9, condition: 0.85 },
    reviewNotes: [],
    description: 'Four sealed foil trays of pulao and dal.',
    ...over,
  }
}

export function facts(over: Partial<DonorFacts> = {}): DonorFacts {
  return {
    name: 'Veg pulao & dal',
    category: 'Meals',
    diet: 'Veg',
    storage: 'Chilled',
    packaging: 'Sealed',
    cookedMinutesAgo: 45,
    prepMinutes: 15,
    safeHours: 3,
    servings: 20,
    checklistDone: true,
    ...over,
  }
}
