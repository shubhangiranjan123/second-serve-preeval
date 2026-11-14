import type { AppState, Category, Donation, Ngo, RescueRecord, Runner, StorageType } from '../types'
import { MIN, estimateWeightKg } from '../lib/engine'

export type Area = { name: string; lat: number; lng: number }

// Approximate coordinates of Chandigarh areas, for the demo only.
// These are not verified donor or recipient addresses.
export const AREAS: Area[] = [
  { name: 'Sector 8', lat: 30.748, lng: 76.795 },
  { name: 'Sector 15', lat: 30.752, lng: 76.77 },
  { name: 'Sector 17', lat: 30.741, lng: 76.779 },
  { name: 'Sector 22', lat: 30.734, lng: 76.775 },
  { name: 'Sector 26', lat: 30.727, lng: 76.804 },
  { name: 'Sector 34', lat: 30.722, lng: 76.768 },
  { name: 'Sector 35', lat: 30.727, lng: 76.759 },
  { name: 'Sector 36', lat: 30.737, lng: 76.755 },
  { name: 'Sector 43', lat: 30.719, lng: 76.75 },
  { name: 'Manimajra', lat: 30.718, lng: 76.835 },
]

export function findArea(name: string): Area {
  return AREAS.find((a) => a.name === name) ?? AREAS[2]
}

export const CATEGORIES: Category[] = ['Meals', 'Bakery', 'Produce', 'Dry rations']

export function defaultsFor(category: Category): { unit: string; storage: StorageType } {
  switch (category) {
    case 'Bakery':
      return { unit: 'items', storage: 'Ambient' }
    case 'Produce':
      return { unit: 'kg', storage: 'Ambient' }
    case 'Dry rations':
      return { unit: 'kg', storage: 'Ambient' }
    default:
      return { unit: 'servings', storage: 'Chilled' }
  }
}

const H = 60 * MIN

type Seed = Omit<
  Donation,
  'lat' | 'lng' | 'readyAt' | 'createdAt' | 'timeline' | 'safeUntil'
> & { createdAgo: number; safeFor: number }

function build(seed: Seed, now: number): Donation {
  const area = findArea(seed.area)
  const createdAt = now - seed.createdAgo
  const { createdAgo, safeFor, ...rest } = seed
  void createdAgo
  return {
    ...rest,
    lat: area.lat,
    lng: area.lng,
    createdAt,
    readyAt: createdAt + seed.prepMinutes * MIN,
    safeUntil: now + safeFor,
    timeline: [{ key: 'created', at: createdAt, note: `Listed by ${seed.donor}` }],
  }
}

export function createInitialNgos(): Ngo[] {
  const at = (name: string) => {
    const a = findArea(name)
    return { area: a.name, lat: a.lat, lng: a.lng }
  }
  return [
    {
      id: 101,
      name: 'Annapurna Community Kitchen',
      type: 'Community kitchen',
      ...at('Sector 15'),
      verification: 'Verified',
      refrigeration: true,
      freezer: false,
      acceptsNonVeg: true,
      needs: 'Cooked meals, rice & dal, fresh produce',
      dailyCapacity: 120,
      accepting: true,
      opensHour: 7,
      closesHour: 23,
    },
    {
      id: 102,
      name: 'Haven Night Shelter',
      type: 'Night shelter',
      ...at('Sector 43'),
      verification: 'Verified',
      refrigeration: false,
      freezer: false,
      acceptsNonVeg: true,
      needs: 'Ready-to-eat food, bread, fruit',
      dailyCapacity: 60,
      accepting: true,
      opensHour: 0,
      closesHour: 24,
    },
    {
      id: 103,
      name: "Saathi Children's Home",
      type: "Children's home",
      ...at('Sector 26'),
      verification: 'Verified',
      refrigeration: true,
      freezer: true,
      acceptsNonVeg: false,
      needs: 'Vegetarian meals, milk products, fruit',
      dailyCapacity: 80,
      accepting: true,
      opensHour: 7,
      closesHour: 21,
    },
    {
      id: 104,
      name: 'Roti Bank Manimajra',
      type: 'Food bank',
      ...at('Manimajra'),
      verification: 'Pending',
      refrigeration: true,
      freezer: false,
      acceptsNonVeg: true,
      needs: 'Rotis, dry rations, packed meals',
      dailyCapacity: 150,
      accepting: true,
      opensHour: 9,
      closesHour: 21,
    },
  ]
}

export function createInitialRunners(): Runner[] {
  const at = (name: string) => {
    const a = findArea(name)
    return { area: a.name, lat: a.lat, lng: a.lng }
  }
  return [
    { id: 1, name: 'Aarav Sharma', initials: 'AS', vehicle: 'Bicycle', ...at('Sector 22'), onShift: true, completed: 28 },
    { id: 2, name: 'Meera Kapoor', initials: 'MK', vehicle: 'Scooter', ...at('Sector 35'), onShift: true, completed: 42 },
    { id: 3, name: 'Kabir Singh', initials: 'KS', vehicle: 'Bicycle', ...at('Sector 8'), onShift: false, completed: 19 },
  ]
}

export function createInitialDonations(now: number): Donation[] {
  const base = {
    ngoId: null,
    runnerId: null,
    stage: 'Pending' as const,
    status: 'Available' as const,
  }

  const pulao = build(
    {
      ...base,
      id: 1,
      name: 'Veg pulao & dal tadka',
      donor: 'The Green Kitchen',
      category: 'Meals',
      servings: 24,
      quantity: 24,
      unit: 'servings',
      area: 'Sector 35',
      address: 'SCO 42, Sector 35-C market',
      storage: 'Chilled',
      diet: 'Veg',
      description: 'Lunch-service surplus, cooked at 12:30 and kept in sealed hotel pans.',
      prepMinutes: 15,
      travelEstimate: 20,
      createdAgo: 4 * MIN,
      safeFor: 4 * H,
    },
    now,
  )

  const bakery = build(
    {
      ...base,
      id: 2,
      name: 'Pav, buns & atta cookies',
      donor: 'Sunday Bakehouse',
      category: 'Bakery',
      servings: 15,
      quantity: 30,
      unit: 'items',
      area: 'Sector 34',
      address: 'Booth 118, Sector 34-A',
      storage: 'Ambient',
      diet: 'Veg',
      description: 'Today’s unsold bake, boxed. Cookies contain wheat and butter.',
      prepMinutes: 0,
      travelEstimate: 25,
      createdAgo: 22 * MIN,
      safeFor: 10 * H,
    },
    now,
  )

  const sandwiches = build(
    {
      ...base,
      id: 3,
      name: 'Paneer tikka sandwich boxes',
      donor: 'Daily Grind Café',
      category: 'Meals',
      servings: 18,
      quantity: 18,
      unit: 'boxes',
      area: 'Sector 36',
      address: 'Shop 7, Sector 36-D',
      storage: 'Chilled',
      diet: 'Veg',
      description: 'Packed for a cancelled office order. Contains dairy.',
      prepMinutes: 10,
      travelEstimate: 20,
      createdAgo: 9 * MIN,
      safeFor: 65 * MIN,
    },
    now,
  )

  const biryani = build(
    {
      ...base,
      id: 4,
      name: 'Chicken biryani handis',
      donor: 'Rasoi Banquet Hall',
      category: 'Meals',
      servings: 40,
      quantity: 40,
      unit: 'servings',
      area: 'Sector 8',
      address: 'Banquet kitchen, Sector 8-B',
      storage: 'Chilled',
      diet: 'Non-veg',
      description: 'Wedding-lunch surplus. Handis still need to be portioned and sealed.',
      prepMinutes: 30,
      travelEstimate: 25,
      createdAgo: 2 * MIN,
      safeFor: 50 * MIN,
    },
    now,
  )

  const produce = build(
    {
      ...base,
      id: 5,
      name: 'Seasonal vegetables & fruit',
      donor: 'Harvest Market',
      category: 'Produce',
      servings: 20,
      quantity: 8,
      unit: 'kg',
      area: 'Sector 22',
      address: 'Stall 14, Sector 22 sabzi mandi',
      storage: 'Ambient',
      diet: 'Veg',
      description: 'Slightly bruised tomatoes, spinach and bananas — good for same-day cooking.',
      prepMinutes: 5,
      travelEstimate: 15,
      createdAgo: 55 * MIN,
      safeFor: 20 * H,
    },
    now,
  )
  produce.status = 'Reserved'
  produce.ngoId = 101
  produce.runnerId = 2
  produce.stage = 'Assigned'
  produce.timeline.push(
    { key: 'matched', at: now - 48 * MIN, note: 'Matched to Annapurna Community Kitchen · score 81' },
    { key: 'assigned', at: now - 41 * MIN, note: 'Meera Kapoor accepted the run' },
  )

  const rajma = build(
    {
      ...base,
      id: 6,
      name: 'Rajma chawal',
      donor: 'Hearth & Tandoor',
      category: 'Meals',
      servings: 30,
      quantity: 30,
      unit: 'servings',
      area: 'Sector 17',
      address: 'SCO 9, Sector 17-E plaza',
      storage: 'Ambient',
      diet: 'Veg',
      description: 'Breakfast-buffet surplus, packed in foil containers.',
      prepMinutes: 10,
      travelEstimate: 20,
      createdAgo: 3 * H,
      safeFor: 2 * H,
    },
    now,
  )
  rajma.status = 'Delivered'
  rajma.ngoId = 102
  rajma.runnerId = 1
  rajma.stage = 'Delivered'
  rajma.timeline.push(
    { key: 'matched', at: now - 172 * MIN, note: 'Matched to Haven Night Shelter · score 74' },
    { key: 'assigned', at: now - 168 * MIN, note: 'Aarav Sharma accepted the run' },
    { key: 'picked', at: now - 150 * MIN, note: 'Collected from Hearth & Tandoor' },
    { key: 'delivered', at: now - 128 * MIN, note: 'Handed over at Haven Night Shelter' },
  )

  return [pulao, sandwiches, biryani, bakery, produce, rajma]
}

// A few earlier rescues so the Impact report has a week of shape.
// Every one is flagged `seeded` and labelled as demonstration data in the UI.
function createSeedHistory(now: number, donations: Donation[]): RescueRecord[] {
  const day = 24 * H
  const past: Array<[number, string, string, Category, number, string, string, number]> = [
    [6, 'Dal makhani & jeera rice', 'Punjabi Rasoi', 'Meals', 26, 'Annapurna Community Kitchen', 'Meera Kapoor', 101],
    [5, 'Bread loaves', 'Sunday Bakehouse', 'Bakery', 18, 'Haven Night Shelter', 'Aarav Sharma', 102],
    [4, 'Bananas & papaya', 'Harvest Market', 'Produce', 22, "Saathi Children's Home", 'Kabir Singh', 103],
    [3, 'Veg thali boxes', 'The Green Kitchen', 'Meals', 34, 'Annapurna Community Kitchen', 'Meera Kapoor', 101],
    [2, 'Poha & upma trays', 'Daily Grind Café', 'Meals', 16, "Saathi Children's Home", 'Aarav Sharma', 103],
    [1, 'Atta & chana (dry)', 'Gupta Provision Store', 'Dry rations', 40, 'Haven Night Shelter', 'Kabir Singh', 102],
  ]
  const records: RescueRecord[] = past.map(([daysAgo, food, donor, category, servings, ngoName, runnerName, ngoId], i) => ({
    donationId: -(i + 1),
    food,
    donor,
    category,
    ngoId,
    ngoName,
    runnerName,
    servings,
    weightKg: estimateWeightKg({ unit: 'servings', quantity: servings, servings }),
    deliveredAt: now - daysAgo * day - 2 * H,
    seeded: true,
  }))

  const rajma = donations.find((d) => d.id === 6)
  if (rajma) {
    records.push({
      donationId: rajma.id,
      food: rajma.name,
      donor: rajma.donor,
      category: rajma.category,
      ngoId: 102,
      ngoName: 'Haven Night Shelter',
      runnerName: 'Aarav Sharma',
      servings: rajma.servings,
      weightKg: estimateWeightKg(rajma),
      deliveredAt: now - 128 * MIN,
      seeded: true,
    })
  }
  return records
}

export function createInitialState(now: number): AppState {
  const donations = createInitialDonations(now)
  return {
    version: 1,
    donations,
    ngos: createInitialNgos(),
    runners: createInitialRunners(),
    history: createSeedHistory(now, donations),
  }
}
