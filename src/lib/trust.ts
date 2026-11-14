// TrustCheck — Verified Rescue Network.
//
// A person (the coordinator/admin) checks each organisation on the official
// government portals and records what they found. Nothing here calls those
// portals: there is no public API integration, and the app never claims there
// is. Format checks below only catch typos; they do NOT prove a number is real.

import type { AppState, Category, Ngo, TrustApplication, TrustPortal, TrustRole, TrustStatus } from '../types'
import { findArea } from '../data/demoData'

export const STATUSES: TrustStatus[] = ['Not Submitted', 'Submitted', 'Under Review', 'Verified', 'Rejected', 'Resubmission Required']

export const PORTALS: Array<{ portal: TrustPortal; url?: string; for: string }> = [
  { portal: 'FoSCoS (FSSAI)', url: 'https://foscos.fssai.gov.in/', for: 'FSSAI licence / registration of food businesses' },
  { portal: 'GST search', url: 'https://services.gst.gov.in/services/quicklinks/searchtxp', for: 'GSTIN, legal name and status' },
  { portal: 'NGO Darpan', url: 'https://ngodarpan.gov.in/', for: 'NGO Darpan unique ID of trusts, societies, Section 8 companies' },
  { portal: 'MCA', url: 'https://www.mca.gov.in/', for: 'Section 8 company master data' },
  { portal: 'Phone call', for: 'Contact person confirms the application' },
  { portal: 'Site visit', for: 'Premises, storage and hygiene seen in person' },
  { portal: 'Other', for: 'Any other evidence' },
]

// What a reviewer must tick before approving.
export const CHECKLIST: Record<TrustRole, Array<{ key: string; label: string }>> = {
  donor: [
    { key: 'identity', label: 'Organisation name matches the documents' },
    { key: 'fssai', label: 'FSSAI licence/registration checked on FoSCoS (or reason recorded why not applicable)' },
    { key: 'gst', label: 'GSTIN checked on the GST portal, if given' },
    { key: 'contact', label: 'Contact person reached by phone or email' },
    { key: 'premises', label: 'Premises photos or visit show a working food business' },
  ],
  recipient: [
    { key: 'identity', label: 'Organisation name matches the documents' },
    { key: 'registration', label: 'Registration checked (NGO Darpan / MCA / certificate), or alternative evidence for an unregistered community kitchen' },
    { key: 'contact', label: 'Contact person reached by phone or email' },
    { key: 'storage', label: 'Stated storage (fridge, freezer, dry store) is plausible from photos or visit' },
    { key: 'capacity', label: 'Daily capacity and service area are realistic' },
  ],
}

// ---------------------------------------------------------------- validation
export const FORMAT = {
  phone: /^(?:\+91[\s-]?)?[6-9]\d{9}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  fssai: /^\d{14}$/, // FSSAI licence/registration numbers are 14 digits
  gstin: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  darpan: /^[A-Z]{2}\/\d{4}\/\d{7}$/, // e.g. CH/2019/0234567
}

export type AppErrors = Partial<Record<string, string>>

export function validateApplication(a: TrustApplication): AppErrors {
  const e: AppErrors = {}
  if (a.orgName.trim().length < 3) e.orgName = 'Enter the organisation’s full name'
  if (!a.orgType.trim()) e.orgType = 'Choose a type'
  if (a.contactName.trim().length < 2) e.contactName = 'Who should we contact?'
  if (!FORMAT.phone.test(a.phone.replace(/\s/g, ''))) e.phone = '10-digit Indian mobile number'
  if (!FORMAT.email.test(a.email.trim())) e.email = 'A valid email address'
  if (a.address.trim().length < 8) e.address = 'Full address with landmark'
  if (a.role === 'donor') {
    if (!a.fssai || !FORMAT.fssai.test(a.fssai.trim())) e.fssai = 'FSSAI number is 14 digits'
    if (a.gstin && !FORMAT.gstin.test(a.gstin.trim().toUpperCase())) e.gstin = 'GSTIN looks wrong (15 characters, e.g. 04ABCDE1234F1Z5)'
    if (!a.docs.some((d) => /fssai/i.test(d.kind))) e.docs = 'Upload the FSSAI licence or registration'
  } else {
    if (!a.registrationType) e.registrationType = 'Choose how the organisation is constituted'
    const unregistered = a.registrationType === 'Community kitchen (unregistered)' || a.registrationType === 'Religious / community body' || a.registrationType === 'Other'
    if (a.darpanId && !FORMAT.darpan.test(a.darpanId.trim().toUpperCase())) e.darpanId = 'NGO Darpan ID looks like CH/2019/0234567'
    if (!unregistered && !a.darpanId && !a.registrationNo?.trim()) e.registrationNo = 'Give the NGO Darpan ID or registration number'
    if (unregistered && !a.docs.length) e.docs = 'Upload alternative evidence (letter from a ward councillor, temple/gurdwara trust, photos of the kitchen…)'
    if (!a.docs.length) e.docs = e.docs ?? 'Upload the registration certificate or other supporting document'
    if (!(Number(a.dailyCapacity) >= 1 && Number(a.dailyCapacity) <= 5000)) e.dailyCapacity = '1–5000 servings a day'
    if (!a.accepts?.length) e.accepts = 'Which food can you accept?'
    if (!a.serviceArea?.trim()) e.serviceArea = 'Where do you serve food?'
    const o = Number(a.opensHour)
    const c = Number(a.closesHour)
    if (!(o >= 0 && o <= 23 && c >= 1 && c <= 24 && c > o)) e.hours = 'Opening hour must be before closing hour'
  }
  return e
}

// ---------------------------------------------------------------- documents
export const DOC_LIMIT = { maxBytes: 5 * 1024 * 1024, types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] }

/**
 * Keep a small preview for images only. PDFs and the original files are NOT
 * stored: this demo keeps everything in one browser's localStorage, which is
 * neither secure nor big enough for real documents.
 */
export async function docPreview(file: File): Promise<string | undefined> {
  if (!file.type.startsWith('image/')) return undefined
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('bad image'))
      i.src = url
    })
    const scale = Math.min(1, 520 / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * scale)
    c.height = Math.round(img.height * scale)
    c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.7)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ---------------------------------------------------------------- workflow
export type ReviewAction = 'start' | 'approve' | 'reject' | 'resubmit'

export function canApprove(a: TrustApplication): string | null {
  const list = CHECKLIST[a.role]
  const missing = list.filter((c) => !a.checklist[c.key])
  if (missing.length) return `Tick every checklist item first (${missing.length} left).`
  if (!a.checks.some((c) => c.result === 'Match')) return 'Record at least one check with result “Match” (portal, phone call or site visit).'
  return null
}

export function nextStatus(action: ReviewAction): TrustStatus {
  return action === 'start' ? 'Under Review' : action === 'approve' ? 'Verified' : action === 'reject' ? 'Rejected' : 'Resubmission Required'
}

/** Keep the NGO record in step with its recipient application. Matching reads ngo.verification. */
export function syncNgo(state: AppState, app: TrustApplication): { ngos: Ngo[]; ngoId: number | null } {
  if (app.role !== 'recipient') return { ngos: state.ngos, ngoId: app.ngoId ?? null }
  const existing = state.ngos.find((n) => n.id === app.ngoId)
  if (existing) {
    const verified = app.status === 'Verified'
    return {
      ngoId: existing.id,
      ngos: state.ngos.map((n) =>
        n.id === existing.id
          ? {
              ...n,
              verification: app.status,
              // On approval, the reviewed details become the matching data.
              ...(verified
                ? {
                    dailyCapacity: app.dailyCapacity ?? n.dailyCapacity,
                    refrigeration: app.refrigeration ?? n.refrigeration,
                    freezer: app.freezer ?? n.freezer,
                    fridgeLitres: app.fridgeLitres ?? n.fridgeLitres,
                    freezerLitres: app.freezerLitres ?? n.freezerLitres,
                    dryStoreKg: app.dryStoreKg ?? n.dryStoreKg,
                    acceptsNonVeg: app.acceptsNonVeg ?? n.acceptsNonVeg,
                    opensHour: app.opensHour ?? n.opensHour,
                    closesHour: app.closesHour ?? n.closesHour,
                    prefers: app.accepts?.length ? app.accepts : n.prefers,
                  }
                : {}),
            }
          : n,
      ),
    }
  }
  if (app.status !== 'Verified') return { ngos: state.ngos, ngoId: null }
  // First approval of a new recipient: create its NGO record so it can be matched.
  const area = findArea(app.area)
  const id = Math.max(100, ...state.ngos.map((n) => n.id)) + 1
  const ngo: Ngo = {
    id,
    name: app.orgName,
    type: app.orgType,
    area: area.name,
    lat: area.lat,
    lng: area.lng,
    verification: 'Verified',
    refrigeration: !!app.refrigeration,
    freezer: !!app.freezer,
    acceptsNonVeg: !!app.acceptsNonVeg,
    needs: (app.accepts ?? []).join(', ').toLowerCase() || 'Any surplus food',
    dailyCapacity: app.dailyCapacity ?? 40,
    accepting: true,
    opensHour: app.opensHour ?? 9,
    closesHour: app.closesHour ?? 21,
    fridgeLitres: app.refrigeration ? app.fridgeLitres ?? 60 : 0,
    freezerLitres: app.freezer ? app.freezerLitres ?? 30 : 0,
    dryStoreKg: app.dryStoreKg ?? 40,
    canReheat: true,
    jainKitchen: false,
    mealHours: [13, 20],
    prefers: (app.accepts?.length ? app.accepts : ['Meals']) as Category[],
  }
  return { ngos: [...state.ngos, ngo], ngoId: id }
}

// ---------------------------------------------------------------- demo seeds
const H = 3_600_000
const D = 24 * H

export function createInitialApplications(now: number, ngos: Ngo[]): TrustApplication[] {
  const base = {
    demo: true,
    docs: [],
    checks: [],
    checklist: {},
    history: [],
  }
  const ngoBy = (name: string) => ngos.find((n) => n.name === name)
  const verifiedRecipient = (id: number, name: string, type: string, area: string, darpan: string, regType: TrustApplication['registrationType'], days: number): TrustApplication => {
    const n = ngoBy(name)
    return {
      ...base,
      id,
      role: 'recipient',
      status: 'Verified',
      orgName: name,
      orgType: type,
      contactName: 'Demo contact',
      phone: '98140 00' + String(id).slice(-3),
      email: `contact${id}@example.org`,
      address: `${area}, Chandigarh`,
      area,
      darpanId: darpan,
      registrationType: regType,
      dailyCapacity: n?.dailyCapacity,
      refrigeration: n?.refrigeration,
      freezer: n?.freezer,
      fridgeLitres: n?.fridgeLitres,
      freezerLitres: n?.freezerLitres,
      dryStoreKg: n?.dryStoreKg,
      acceptsNonVeg: n?.acceptsNonVeg,
      accepts: n?.prefers,
      serviceArea: `${area} and nearby sectors`,
      opensHour: n?.opensHour,
      closesHour: n?.closesHour,
      ngoId: n?.id ?? null,
      submittedAt: now - days * D,
      docs: [{ id: 1, kind: 'Registration certificate', name: 'registration-certificate.pdf', size: 412_000, type: 'application/pdf' }],
      checklist: Object.fromEntries(CHECKLIST.recipient.map((c) => [c.key, true])),
      checks: [
        { id: 1, portal: 'NGO Darpan', checkedOn: new Date(now - (days - 1) * D).toISOString().slice(0, 10), result: 'Match', reference: darpan, notes: 'Name and address match the Darpan record.', by: 'Coordinator', at: now - (days - 1) * D },
        { id: 2, portal: 'Site visit', checkedOn: new Date(now - (days - 2) * D).toISOString().slice(0, 10), result: 'Match', reference: '', notes: 'Kitchen and storage seen.', by: 'Coordinator', at: now - (days - 2) * D },
      ],
      history: [
        { at: now - days * D, by: 'Applicant', action: 'Submitted' },
        { at: now - (days - 1) * D, by: 'Coordinator', action: 'Under Review' },
        { at: now - (days - 2) * D, by: 'Coordinator', action: 'Verified', note: 'All checks matched.' },
      ],
    }
  }
  const roti = ngoBy('Roti Bank Manimajra')
  return [
    verifiedRecipient(1, 'Annapurna Community Kitchen', 'Community kitchen', 'Sector 15', 'CH/2018/0193345', 'Trust', 40),
    verifiedRecipient(2, 'Haven Night Shelter', 'Night shelter', 'Sector 43', 'CH/2016/0102233', 'Society', 32),
    verifiedRecipient(3, "Saathi Children's Home", "Children's home", 'Sector 26', 'CH/2020/0288871', 'Section 8 company', 21),
    {
      ...base,
      id: 4,
      role: 'recipient',
      status: 'Under Review',
      orgName: 'Roti Bank Manimajra',
      orgType: 'Food bank',
      contactName: 'Demo contact',
      phone: '98150 12345',
      email: 'rotibank@example.org',
      address: 'Near Mansa Devi road, Manimajra, Chandigarh',
      area: 'Manimajra',
      registrationType: 'Community kitchen (unregistered)',
      registrationNo: '',
      dailyCapacity: roti?.dailyCapacity ?? 150,
      refrigeration: roti?.refrigeration ?? true,
      freezer: roti?.freezer ?? false,
      fridgeLitres: roti?.fridgeLitres,
      freezerLitres: roti?.freezerLitres,
      dryStoreKg: roti?.dryStoreKg,
      acceptsNonVeg: roti?.acceptsNonVeg ?? true,
      accepts: roti?.prefers ?? ['Meals', 'Bakery'],
      serviceArea: 'Manimajra and Mauli Jagran',
      opensHour: roti?.opensHour ?? 9,
      closesHour: roti?.closesHour ?? 21,
      ngoId: roti?.id ?? null,
      submittedAt: now - 2 * D,
      docs: [
        { id: 1, kind: 'Alternative evidence', name: 'ward-councillor-letter.pdf', size: 233_000, type: 'application/pdf' },
        { id: 2, kind: 'Kitchen photo', name: 'kitchen.jpg', size: 180_000, type: 'image/jpeg' },
      ],
      checklist: { identity: true, contact: true },
      checks: [{ id: 1, portal: 'Phone call', checkedOn: new Date(now - D).toISOString().slice(0, 10), result: 'Match', reference: '', notes: 'Spoke to the organiser; site visit pending.', by: 'Coordinator', at: now - D }],
      history: [
        { at: now - 2 * D, by: 'Applicant', action: 'Submitted' },
        { at: now - D, by: 'Coordinator', action: 'Under Review', note: 'Unregistered community kitchen: needs a site visit.' },
      ],
    },
    {
      ...base,
      id: 5,
      role: 'donor',
      status: 'Verified',
      orgName: 'The Green Kitchen',
      orgType: 'Restaurant',
      contactName: 'Demo contact',
      phone: '98760 11122',
      email: 'kitchen@example.com',
      address: 'SCO 12, Sector 35-B, Chandigarh',
      area: 'Sector 35',
      fssai: '12719999000123',
      gstin: '04ABCDE1234F1Z5',
      submittedAt: now - 15 * D,
      docs: [{ id: 1, kind: 'FSSAI licence', name: 'fssai-licence.pdf', size: 301_000, type: 'application/pdf' }],
      checklist: Object.fromEntries(CHECKLIST.donor.map((c) => [c.key, true])),
      checks: [{ id: 1, portal: 'FoSCoS (FSSAI)', checkedOn: new Date(now - 14 * D).toISOString().slice(0, 10), result: 'Match', reference: '12719999000123', notes: 'Licence active.', by: 'Coordinator', at: now - 14 * D }],
      history: [
        { at: now - 15 * D, by: 'Applicant', action: 'Submitted' },
        { at: now - 14 * D, by: 'Coordinator', action: 'Verified' },
      ],
    },
    {
      ...base,
      id: 6,
      role: 'donor',
      status: 'Submitted',
      orgName: 'Sunday Bakehouse',
      orgType: 'Bakery',
      contactName: 'Demo contact',
      phone: '99880 22233',
      email: 'bakehouse@example.com',
      address: 'Booth 4, Sector 34-C market, Chandigarh',
      area: 'Sector 34',
      fssai: '22119999000456',
      submittedAt: now - 5 * H,
      docs: [{ id: 1, kind: 'FSSAI licence', name: 'fssai-registration.jpg', size: 220_000, type: 'image/jpeg' }],
      history: [{ at: now - 5 * H, by: 'Applicant', action: 'Submitted' }],
    },
    {
      ...base,
      id: 7,
      role: 'donor',
      status: 'Resubmission Required',
      orgName: 'Rasoi Banquet Hall',
      orgType: 'Banquet / caterer',
      contactName: 'Demo contact',
      phone: '97790 33344',
      email: 'rasoi@example.com',
      address: 'Plot 8, Sector 8-B, Chandigarh',
      area: 'Sector 8',
      fssai: '10019999000789',
      gstin: '04ZZZZZ9999Z1Z9',
      submittedAt: now - 3 * D,
      decisionNote: 'GSTIN not found on the GST portal. Upload the GST certificate or correct the number.',
      docs: [{ id: 1, kind: 'FSSAI licence', name: 'fssai.pdf', size: 280_000, type: 'application/pdf' }],
      checks: [{ id: 1, portal: 'GST search', checkedOn: new Date(now - 2 * D).toISOString().slice(0, 10), result: 'Not found', reference: '04ZZZZZ9999Z1Z9', notes: 'No taxpayer found.', by: 'Coordinator', at: now - 2 * D }],
      history: [
        { at: now - 3 * D, by: 'Applicant', action: 'Submitted' },
        { at: now - 2 * D, by: 'Coordinator', action: 'Resubmission Required', note: 'GSTIN not found on the GST portal.' },
      ],
    },
    {
      ...base,
      id: 8,
      role: 'recipient',
      status: 'Rejected',
      orgName: 'QuickMeals Resale Pvt Ltd',
      orgType: 'Other',
      contactName: 'Demo contact',
      phone: '90000 44455',
      email: 'resale@example.com',
      address: 'Industrial Area Phase 1, Chandigarh',
      area: 'Sector 22',
      registrationType: 'Other',
      dailyCapacity: 500,
      accepts: ['Meals', 'Bakery'],
      serviceArea: 'Tricity',
      opensHour: 9,
      closesHour: 21,
      submittedAt: now - 6 * D,
      decisionNote: 'Commercial reseller, not a charitable recipient.',
      docs: [{ id: 1, kind: 'Other', name: 'company-profile.pdf', size: 510_000, type: 'application/pdf' }],
      history: [
        { at: now - 6 * D, by: 'Applicant', action: 'Submitted' },
        { at: now - 5 * D, by: 'Coordinator', action: 'Rejected', note: 'Commercial reseller, not a charitable recipient.' },
      ],
    },
  ]
}

export function blankApplication(role: TrustRole): TrustApplication {
  return {
    id: 0,
    role,
    status: 'Not Submitted',
    orgName: '',
    orgType: '',
    contactName: '',
    phone: '',
    email: '',
    address: '',
    area: 'Sector 17',
    fssai: '',
    gstin: '',
    darpanId: '',
    registrationNo: '',
    dailyCapacity: role === 'recipient' ? 50 : undefined,
    refrigeration: false,
    freezer: false,
    fridgeLitres: 0,
    freezerLitres: 0,
    dryStoreKg: 30,
    acceptsNonVeg: false,
    accepts: [],
    serviceArea: '',
    opensHour: 9,
    closesHour: 21,
    docs: [],
    checks: [],
    checklist: {},
    history: [],
    ngoId: null,
    submittedAt: null,
  }
}
