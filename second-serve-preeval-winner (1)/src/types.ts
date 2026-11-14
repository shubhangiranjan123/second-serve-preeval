// Shared data model for the SECOND-SERVE pre-evaluation build.
// Timestamps are milliseconds since 1970 (the value Date.now() returns).

export type StorageType = 'Ambient' | 'Chilled' | 'Frozen'

export type Diet = 'Veg' | 'Non-veg' | 'Jain'

export type Category = 'Meals' | 'Bakery' | 'Produce' | 'Dry rations'

// Listing status on the Rescue Board (same three states as the final build).
export type DonationStatus = 'Available' | 'Reserved' | 'Delivered'

// Runner Dispatch stage for a reserved donation.
export type DispatchStage = 'Pending' | 'Assigned' | 'Picked Up' | 'Delivered'

export type TimelineKey = 'created' | 'matched' | 'assigned' | 'picked' | 'delivered'

export type TimelineEvent = {
  key: TimelineKey
  at: number
  note: string
}

export type Donation = {
  id: number
  name: string
  donor: string
  category: Category
  servings: number
  quantity: number
  unit: string
  area: string // demo area name, e.g. "Sector 35"
  address: string // pickup point within the area
  lat: number
  lng: number
  storage: StorageType
  diet: Diet
  description: string
  createdAt: number
  prepMinutes: number // donor's time to pack and hand over
  travelEstimate: number // donor's own travel-time estimate, minutes
  readyAt: number // createdAt + prepMinutes
  safeUntil: number // donor-declared safe-consumption deadline
  status: DonationStatus
  ngoId: number | null
  runnerId: number | null
  stage: DispatchStage
  timeline: TimelineEvent[]
}

export type VerificationStatus = 'Verified' | 'Pending'

export type Ngo = {
  id: number
  name: string
  type: string
  area: string
  lat: number
  lng: number
  verification: VerificationStatus
  refrigeration: boolean
  freezer: boolean
  acceptsNonVeg: boolean
  needs: string // what food they ask for, in their words
  dailyCapacity: number // servings per day
  accepting: boolean
  opensHour: number // 0-23
  closesHour: number // 1-24 (24 = midnight)
  fridgeLitres: number
  freezerLitres: number
  dryStoreKg: number
  canReheat: boolean
  jainKitchen: boolean
  mealHours: number[]
  prefers: Category[]
}

export type Runner = {
  id: number
  name: string
  initials: string
  vehicle: 'Bicycle' | 'Scooter'
  area: string
  lat: number
  lng: number
  onShift: boolean
  completed: number
}

// Permanent record of one completed rescue. Written only when a job
// reaches Delivered, keyed by donation id so it can never double count.
export type RescueRecord = {
  donationId: number
  food: string
  donor: string
  category: Category
  ngoId: number | null
  ngoName: string
  runnerName: string
  servings: number
  weightKg: number
  deliveredAt: number
  seeded?: boolean // pre-loaded demonstration record
}

export type AppState = {
  version: 1
  donations: Donation[]
  ngos: Ngo[]
  runners: Runner[]
  history: RescueRecord[]
}
