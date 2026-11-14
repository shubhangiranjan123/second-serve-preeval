// Shared data model for the SECOND-SERVE pre-evaluation build.
// Timestamps are milliseconds since 1970 (the value Date.now() returns).

export type StorageType = 'Ambient' | 'Chilled' | 'Frozen'

export type Diet = 'Veg' | 'Non-veg' | 'Jain'

export type Category = 'Meals' | 'Bakery' | 'Produce' | 'Dry rations'

// Listing status on the Rescue Board. 'In review' is added by the AI Food
// Scan pipeline: a listing that a person must inspect before it can be
// matched. It is never visible to matching, the map or the counters.
export type DonationStatus = 'In review' | 'Available' | 'Reserved' | 'Delivered'

export type Packaging = 'Sealed' | 'Covered' | 'Open'

// ---- Engine 1 (AI Food Verification) snapshot stored with a listing ----
export type VisualVerdict = 'Visually acceptable' | 'Potentially unsuitable' | 'Uncertain' | 'Not scanned'
export type RuleStatus = 'pass' | 'warn' | 'fail' | 'missing'
export type RuleSource = 'AI vision' | 'Safety rule' | 'Donor input'
export type RuleCheck = {
  id: string
  label: string
  status: RuleStatus
  detail: string
  source: RuleSource
  blocking?: boolean // a 'warn' that sends the listing to manual review
}
export type ScreeningOutcome = 'pass' | 'review' | 'reject' | 'incomplete'

export type Screening = {
  outcome: 'pass' | 'review' // rejected / incomplete scans are never listed
  visual: VisualVerdict
  rules: RuleCheck[]
  reviewReasons: string[]
  screenedAt: number
  ai: null | {
    provider: string
    model: string
    latencyMs: number
    dishName: string
    items: string[]
    category: string
    dietGuess: string
    packaging: string
    confidence: { overall: number; identification: number; condition: number }
    concerns: Array<{ kind: string; detail: string; severity: string }>
    reviewNotes: string[]
  }
  aiError?: string // why the scan could not run (then outcome is always 'review')
  edited: string[] // fields the donor changed from the AI suggestion
  photo?: string // small square thumbnail (data URL)
  review?: { decision: 'approved'; at: number; by: string; note?: string }
}

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
  // Optional, added by the AI Food Scan flow. Older listings simply lack them.
  preparedAt?: number // when the food was cooked / prepared
  packaging?: Packaging
  screening?: Screening
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
