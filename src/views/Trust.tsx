// TrustCheck — Verified Rescue Network.
// Review centre (admin) + applications (donors and recipients).
// Verification is done by a person on the official portals; this screen
// records what they checked. Nothing is verified automatically.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BadgeCheck, ExternalLink, FileText, Plus, Search, ShieldCheck, Upload, X } from 'lucide-react'
import type { AppState, Category, TrustApplication, TrustCheckRecord, TrustDoc, TrustRole, TrustStatus } from '../types'
import type { RescueStore } from '../lib/useRescueStore'
import { AREAS, CATEGORIES } from '../data/demoData'
import { CHECKLIST, DOC_LIMIT, PORTALS, blankApplication, canApprove, docPreview, validateApplication, type AppErrors } from '../lib/trust'
import { Eyebrow, cx } from '../components/ui'
import { useT } from '../lib/i18n'

type Toast = (msg: string, tone?: 'ok' | 'info' | 'warn') => void
type Bucket = 'pending' | 'resubmit' | 'verified' | 'rejected' | 'all'

const BUCKETS: Array<{ id: Bucket; label: string; match: (s: TrustStatus) => boolean }> = [
  { id: 'pending', label: 'Pending', match: (s) => s === 'Submitted' || s === 'Under Review' },
  { id: 'resubmit', label: 'Resubmission', match: (s) => s === 'Resubmission Required' },
  { id: 'verified', label: 'Verified', match: (s) => s === 'Verified' },
  { id: 'rejected', label: 'Rejected', match: (s) => s === 'Rejected' },
  { id: 'all', label: 'All', match: () => true },
]

const fmtDate = (ts: number | null) => (ts ? new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—')

export function StatusChip({ status }: { status: TrustStatus }) {
  const { t } = useT()
  return <span className={cx('tstatus', `ts-${status.replace(/\s/g, '-').toLowerCase()}`)}>{t(status)}</span>
}

export function Trust({ state, store, toast }: { state: AppState; store: RescueStore; toast: Toast }) {
  const { t } = useT()
  const apps = useMemo(() => state.applications ?? [], [state.applications])
  const [tab, setTab] = useState<'review' | 'apply'>('review')
  const [bucket, setBucket] = useState<Bucket>('pending')
  const [role, setRole] = useState<'all' | TrustRole>('all')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [editing, setEditing] = useState<TrustApplication | null>(null)

  const list = apps
    .filter((a) => a.status !== 'Not Submitted')
    .filter((a) => BUCKETS.find((b) => b.id === bucket)!.match(a.status))
    .filter((a) => role === 'all' || a.role === role)
    .filter((a) => {
      const s = q.trim().toLowerCase()
      return !s || `${a.orgName} ${a.orgType} ${a.area} ${a.fssai ?? ''} ${a.gstin ?? ''} ${a.darpanId ?? ''}`.toLowerCase().includes(s)
    })
    .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0))
  const open = apps.find((a) => a.id === openId) ?? null
  const count = (b: Bucket) => apps.filter((a) => a.status !== 'Not Submitted' && BUCKETS.find((x) => x.id === b)!.match(a.status)).length
  const mine = apps.filter((a) => !a.demo || a.status === 'Resubmission Required' || a.status === 'Not Submitted')

  return (
    <div className="view trust-view">
      <header className="view-head">
        <div>
          <Eyebrow>{t('TrustCheck · Verified Rescue Network')}</Eyebrow>
          <h1>{t('Who’s been checked.')}</h1>
          <p className="view-lede">
            {t('Donors and recipients apply with their licences and registrations. A coordinator checks them on the official portals and records what they found. Only verified recipients can be matched.')}
          </p>
        </div>
        <div className="view-head-actions">
          <button className={cx('btn btn-lg', tab === 'review' ? 'btn-primary' : 'btn-ghost-light')} onClick={() => setTab('review')}>
            <ShieldCheck size={18} /> {t('Review centre')}
          </button>
          <button className={cx('btn btn-lg', tab === 'apply' ? 'btn-primary' : 'btn-ghost-light')} onClick={() => setTab('apply')}>
            <Plus size={18} /> {t('Apply')}
          </button>
        </div>
      </header>

      <p className="trust-note">
        <b>{t('DEMO DATA')}</b> {t('Sample organisations and numbers are fictional. Portal checks are recorded by a person; nothing is verified automatically. This demo keeps applications in this browser only, with no login: it is not secure document storage.')}
      </p>

      {tab === 'review' ? (
        <>
          <div className="filters">
            <div className="chips" role="group" aria-label={t('Status')}>
              {BUCKETS.map((b) => (
                <button key={b.id} className={cx('chip', bucket === b.id && 'on')} onClick={() => setBucket(b.id)}>
                  {t(b.label)} <em>{count(b.id)}</em>
                </button>
              ))}
            </div>
            <div className="filters-right">
              <div className="segmented small" role="group" aria-label={t('Role')}>
                {(['all', 'donor', 'recipient'] as const).map((r) => (
                  <button key={r} className={cx(role === r && 'on')} onClick={() => setRole(r)}>
                    {r === 'all' ? t('All') : r === 'donor' ? t('Donors') : t('Recipients')}
                  </button>
                ))}
              </div>
              <label className="search">
                <Search size={15} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search name, area, FSSAI, GSTIN')} aria-label={t('Search applications')} />
              </label>
            </div>
          </div>

          {list.length === 0 ? (
            <div className="empty-board">
              <p>{bucket === 'pending' ? t('Nothing waiting for review.') : t('No applications match these filters.')}</p>
            </div>
          ) : (
            <div className="trust-list">
              {list.map((a) => (
                <button key={a.id} className="trust-row" onClick={() => setOpenId(a.id)}>
                  <span className="trust-role">{a.role === 'donor' ? t('Donor') : t('Recipient')}</span>
                  <span className="trust-name">
                    <strong>{a.orgName}</strong>
                    <small>
                      {a.orgType} · {a.area}
                      {a.demo && <> · {t('demo')}</>}
                    </small>
                  </span>
                  <span className="trust-meta">
                    {a.docs.length} {t('docs')} · {a.checks.length} {t('checks')}
                  </span>
                  <span className="trust-when">{fmtDate(a.submittedAt)}</span>
                  <StatusChip status={a.status} />
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="apply-grid">
          {(['donor', 'recipient'] as const).map((r) => (
            <div key={r} className="apply-card">
              <h3>{r === 'donor' ? t('I give surplus food') : t('I receive and serve food')}</h3>
              <p>
                {r === 'donor'
                  ? t('Restaurants, caterers, bakeries, hotels and shops. You’ll need your FSSAI licence or registration, and GSTIN if you have one.')
                  : t('NGOs, shelters, community kitchens, trusts. NGO Darpan ID or registration if you have one; community kitchens without registration can send other evidence.')}
              </p>
              <button className="btn btn-primary" onClick={() => setEditing(blankApplication(r))}>
                {r === 'donor' ? t('Apply as a donor') : t('Apply as a recipient')}
              </button>
            </div>
          ))}
          <div className="apply-mine">
            <h3>{t('Your applications')}</h3>
            {mine.length === 0 ? (
              <p className="step-muted">{t('None yet.')}</p>
            ) : (
              <ul>
                {mine.map((a) => (
                  <li key={a.id}>
                    <span>
                      <strong>{a.orgName || t('Untitled draft')}</strong>
                      <small>{a.role === 'donor' ? t('Donor') : t('Recipient')}{a.decisionNote ? ` · ${a.decisionNote}` : ''}</small>
                    </span>
                    <StatusChip status={a.status} />
                    {(a.status === 'Resubmission Required' || a.status === 'Not Submitted') && (
                      <button className="btn btn-ghost-light btn-sm" onClick={() => setEditing(a)}>
                        {a.status === 'Not Submitted' ? t('Continue') : t('Fix & resubmit')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {open && <ReviewDrawer app={open} store={store} toast={toast} onClose={() => setOpenId(null)} />}
      {editing && (
        <ApplicationForm
          store={store}
          draft={editing}
          onClose={() => setEditing(null)}
          onSave={(a, asDraft) => {
            store.submitApplication(a, asDraft).then((r) => {
              if (!r.ok) return
              setEditing(null)
              toast(asDraft ? t('Draft saved.') : t('Application submitted. A coordinator will review it.'), asDraft ? 'info' : 'ok')
              if (!asDraft) {
                setTab('review')
                setBucket('pending')
              }
            })
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- review

function ReviewDrawer({ app: a, store, toast, onClose }: { app: TrustApplication; store: RescueStore; toast: Toast; onClose: () => void }) {
  const { t } = useT()
  const [note, setNote] = useState('')
  const [noteErr, setNoteErr] = useState('')
  const [check, setCheck] = useState<Omit<TrustCheckRecord, 'id' | 'at' | 'by'>>({
    portal: a.role === 'donor' ? 'FoSCoS (FSSAI)' : a.darpanId ? 'NGO Darpan' : 'Phone call',
    checkedOn: new Date().toISOString().slice(0, 10),
    result: 'Match',
    reference: a.role === 'donor' ? a.fssai ?? '' : a.darpanId ?? '',
    notes: '',
  })
  const [preview, setPreview] = useState<TrustDoc | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (preview ? setPreview(null) : onClose())
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, preview])

  const blocked = canApprove(a)
  const final = a.status === 'Verified' || a.status === 'Rejected'
  const relevantPortals = PORTALS.filter((p) => p.url && (a.role === 'donor' ? ['FoSCoS (FSSAI)', 'GST search'] : ['NGO Darpan', 'MCA']).includes(p.portal))

  function act(action: 'start' | 'approve' | 'reject' | 'resubmit') {
    if ((action === 'reject' || action === 'resubmit') && note.trim().length < 5) {
      setNoteErr(t('Write the reason the applicant will see (at least a few words).'))
      return
    }
    if (action === 'approve' && blocked) {
      setNoteErr(blocked)
      return
    }
    store.reviewApplication(a.id, action, note.trim() || undefined).then((r) => {
      if (!r.ok) return
      setNote('')
      setNoteErr('')
      toast(msg, action === 'approve' ? 'ok' : 'info')
    })
    const msg =
      action === 'approve'
        ? a.role === 'recipient'
          ? t('{name} is verified and can now be matched.', { name: a.orgName })
          : t('{name} is a verified donor.', { name: a.orgName })
        : action === 'reject'
          ? t('Application rejected.')
          : action === 'resubmit'
            ? t('Sent back for resubmission.')
            : t('Review started.')
  }

  const Row = ({ k, v }: { k: string; v: ReactNode }) =>
    v ? (
      <div className="kv">
        <span>{t(k)}</span>
        <b>{v}</b>
      </div>
    ) : null

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside className="drawer trust-drawer" role="dialog" aria-modal="true" aria-label={t('Review {name}', { name: a.orgName })} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div className="drawer-title">
            <span className="drawer-kicker">
              TrustCheck · {a.role === 'donor' ? t('Donor') : t('Recipient')} #{String(a.id).padStart(3, '0')} {a.demo && `· ${t('DEMO DATA')}`}
            </span>
            <h2>{a.orgName}</h2>
            <span className="drawer-sub">
              {a.orgType} · {a.area}
            </span>
          </div>
          <StatusChip status={a.status} />
          <button className="icon-btn" onClick={onClose} aria-label={t('Close')}>
            <X size={20} />
          </button>
        </header>

        <div className="drawer-body">
          {a.decisionNote && (a.status === 'Rejected' || a.status === 'Resubmission Required') && <p className="review-reasons">{a.decisionNote}</p>}

          <section className="step">
            <div className="step-label">{t('Details')}</div>
            <div className="kv-grid">
              <Row k="Contact" v={a.contactName} />
              <Row k="Phone" v={a.phone} />
              <Row k="Email" v={a.email} />
              <Row k="Address" v={a.address} />
              <Row k="FSSAI" v={a.fssai} />
              <Row k="GSTIN" v={a.gstin} />
              <Row k="NGO Darpan ID" v={a.darpanId} />
              <Row k="Constituted as" v={a.registrationType} />
              <Row k="Registration no." v={a.registrationNo} />
              {a.role === 'recipient' && (
                <>
                  <Row k="Capacity" v={a.dailyCapacity ? `${a.dailyCapacity} servings / day` : ''} />
                  <Row
                    k="Storage"
                    v={[a.refrigeration && `fridge ${a.fridgeLitres ?? 0} L`, a.freezer && `freezer ${a.freezerLitres ?? 0} L`, `dry ${a.dryStoreKg ?? 0} kg`].filter(Boolean).join(' · ')}
                  />
                  <Row k="Accepts" v={`${(a.accepts ?? []).join(', ')}${a.acceptsNonVeg ? ' · veg & non-veg' : ' · veg only'}`} />
                  <Row k="Service area" v={a.serviceArea} />
                  <Row k="Hours" v={a.opensHour !== undefined ? `${a.opensHour}:00 – ${a.closesHour}:00` : ''} />
                </>
              )}
            </div>
          </section>

          <section className="step">
            <div className="step-label">{t('Documents')}</div>
            {a.docs.length === 0 ? (
              <p className="step-muted">{t('No documents uploaded.')}</p>
            ) : (
              <div className="docs">
                {a.docs.map((d) => (
                  <button key={d.id} className="doc" onClick={() => (d.url ? window.open(d.url, '_blank', 'noopener') : d.preview ? setPreview(d) : undefined)} disabled={!d.preview && !d.url}>
                    {d.preview ? <img src={d.preview} alt={d.name} /> : <FileText size={28} />}
                    <span>
                      <strong>{d.kind}</strong>
                      <small>
                        {d.name} · {Math.round(d.size / 1024)} KB{d.url ? ` · ${t('open original')}` : !d.preview && ` · ${t('name only')}`}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="feas-disclaimer">{t('Files uploaded while the server is running open in full. Older demo entries are recorded by name only.')}</p>
          </section>

          <section className="step">
            <div className="step-label">{t('Check on official portals')}</div>
            <div className="portal-links">
              {relevantPortals.map((p) => (
                <a key={p.portal} href={p.url} target="_blank" rel="noreferrer noopener" className="portal">
                  <ExternalLink size={14} /> {p.portal}
                  <small>{p.for}</small>
                </a>
              ))}
            </div>
            <p className="step-muted">{t('Search there by hand, then record what you found. SECOND-SERVE does not connect to these portals.')}</p>

            {a.checks.length > 0 && (
              <ul className="check-log">
                {a.checks.map((c) => (
                  <li key={c.id} className={cx(`cr-${c.result.replace(/\s/g, '-').toLowerCase()}`)}>
                    <strong>
                      {c.portal} · {t(c.result)}
                    </strong>
                    <span>
                      {c.checkedOn}
                      {c.reference && ` · ${t('ref')} ${c.reference}`} · {c.by}
                    </span>
                    {c.notes && <em>{c.notes}</em>}
                  </li>
                ))}
              </ul>
            )}

            {!final && (
              <form
                className="check-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  store.addTrustCheck(a.id, { ...check, reference: check.reference.trim(), notes: check.notes.trim() })
                  setCheck((c) => ({ ...c, notes: '' }))
                  setNoteErr('')
                  toast(t('Check recorded.'), 'info')
                }}
              >
                <label className="field">
                  <span>{t('Portal or method')}</span>
                  <select value={check.portal} onChange={(e) => setCheck({ ...check, portal: e.target.value as TrustCheckRecord['portal'] })}>
                    {PORTALS.map((p) => (
                      <option key={p.portal}>{p.portal}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t('Date checked')}</span>
                  <input type="date" value={check.checkedOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setCheck({ ...check, checkedOn: e.target.value })} required />
                </label>
                <label className="field">
                  <span>{t('Result')}</span>
                  <select value={check.result} onChange={(e) => setCheck({ ...check, result: e.target.value as TrustCheckRecord['result'] })}>
                    {(['Match', 'Mismatch', 'Not found', 'Not applicable'] as const).map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t('Reference')}</span>
                  <input value={check.reference} onChange={(e) => setCheck({ ...check, reference: e.target.value })} placeholder={t('Licence / GSTIN / Darpan ID')} />
                </label>
                <label className="field span-2">
                  <span>{t('Notes')}</span>
                  <input value={check.notes} onChange={(e) => setCheck({ ...check, notes: e.target.value })} placeholder={t('What you saw, e.g. “licence active till 2028”')} />
                </label>
                <button className="btn btn-dark btn-sm" type="submit">
                  {t('Record check')}
                </button>
              </form>
            )}
          </section>

          <section className="step">
            <div className="step-label">{t('Verification checklist')}</div>
            <div className="trust-checklist">
              {CHECKLIST[a.role].map((c) => (
                <label key={c.key} className={cx('check', a.checklist[c.key] && 'check-on')}>
                  <input type="checkbox" checked={!!a.checklist[c.key]} disabled={final} onChange={() => { store.toggleTrustItem(a.id, c.key); setNoteErr('') }} />
                  <span className="check-box">
                    <BadgeCheck size={13} />
                  </span>
                  {t(c.label)}
                </label>
              ))}
            </div>
          </section>

          {!final && (
            <section className="step">
              <div className="step-label">{t('Decision')}</div>
              <label className="field">
                <span>{t('Reason / note (shown to the applicant for reject or resubmission)')}</span>
                <textarea rows={2} value={note} onChange={(e) => { setNote(e.target.value); setNoteErr('') }} />
              </label>
              {noteErr && <p className="field-err">{noteErr}</p>}
              <div className="review-actions">
                {a.status === 'Submitted' && (
                  <button className="btn btn-ghost" onClick={() => act('start')}>
                    {t('Start review')}
                  </button>
                )}
                <button className="btn btn-primary" onClick={() => act('approve')} title={blocked ?? ''}>
                  <BadgeCheck size={16} /> {t('Approve as verified')}
                </button>
                <button className="btn btn-ghost" onClick={() => act('resubmit')}>
                  {t('Request resubmission')}
                </button>
                <button className="btn btn-ghost" onClick={() => act('reject')}>
                  {t('Reject')}
                </button>
              </div>
              {blocked && <p className="step-muted">{t('To approve: {why}', { why: blocked })}</p>}
            </section>
          )}
          {final && (
            <section className="step">
              <div className="step-label">{t('Decision')}</div>
              <p className="step-muted">
                {a.status === 'Verified'
                  ? a.role === 'recipient'
                    ? t('Verified: eligible for matching (gate 1).')
                    : t('Verified donor.')
                  : t('Rejected: excluded from matching.')}
              </p>
              <button className="btn btn-ghost btn-sm" onClick={() => act('resubmit')}>
                {a.status === 'Verified' ? t('Suspend: request resubmission') : t('Reopen: request resubmission')}
              </button>
              {noteErr && <p className="field-err">{noteErr}</p>}
              <label className="field">
                <span>{t('Reason')}</span>
                <textarea rows={2} value={note} onChange={(e) => { setNote(e.target.value); setNoteErr('') }} />
              </label>
            </section>
          )}

          <section className="step">
            <div className="step-label">{t('History')}</div>
            <ul className="trust-history">
              {[...a.history].reverse().map((h, i) => (
                <li key={i}>
                  <b>{h.action}</b> · {h.by} · {fmtDate(h.at)}
                  {h.note && <em>{h.note}</em>}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {preview && (
          <div className="doc-preview" onClick={() => setPreview(null)} role="dialog" aria-label={preview.name}>
            <img src={preview.preview} alt={preview.name} />
            <span>
              {preview.kind} · {preview.name} · {t('click to close')}
            </span>
          </div>
        )}
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------- apply

const ORG_TYPES: Record<TrustRole, string[]> = {
  donor: ['Restaurant', 'Hotel', 'Banquet / caterer', 'Bakery', 'Café', 'Grocery / retail', 'Institutional kitchen', 'Other'],
  recipient: ['NGO', 'Night shelter', "Children's home", 'Old-age home', 'Community kitchen', 'Food bank', 'Gurdwara / temple langar', 'Other'],
}
const DOC_KINDS: Record<TrustRole, string[]> = {
  donor: ['FSSAI licence', 'GST certificate', 'Premises photo', 'Other'],
  recipient: ['Registration certificate', '12A / 80G certificate', 'Alternative evidence', 'Kitchen / storage photo', 'Other'],
}

export function ApplicationForm({
  draft,
  onClose,
  onSave,
  store,
}: {
  draft: TrustApplication
  onClose: () => void
  onSave: (a: TrustApplication, asDraft: boolean) => void
  store?: RescueStore
}) {
  const { t } = useT()
  const [a, setA] = useState<TrustApplication>(draft)
  const [touched, setTouched] = useState(false)
  const [docKind, setDocKind] = useState(DOC_KINDS[draft.role][0])
  const [docErr, setDocErr] = useState('')
  const set = <K extends keyof TrustApplication>(k: K, v: TrustApplication[K]) => setA((p) => ({ ...p, [k]: v }))
  const errors: AppErrors = touched ? validateApplication(a) : {}
  const err = (k: string) => (errors[k] ? <span className="field-err">{errors[k]}</span> : null)
  const isDonor = a.role === 'donor'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function addDocs(files: FileList | null) {
    const msgs: string[] = []
    const added: TrustDoc[] = []
    for (const f of Array.from(files ?? [])) {
      if (!DOC_LIMIT.types.includes(f.type)) {
        msgs.push(`${f.name}: ${t('use PDF, JPEG, PNG or WebP')}`)
        continue
      }
      if (f.size > DOC_LIMIT.maxBytes) {
        msgs.push(`${f.name}: ${t('larger than 5 MB')}`)
        continue
      }
      let preview: string | undefined
      try {
        preview = await docPreview(f)
      } catch {
        msgs.push(`${f.name}: ${t('couldn’t be opened (corrupted?)')}`)
        continue
      }
      // With the server running, the original file is uploaded and stored there.
      let url: string | undefined
      if (store?.mode === 'server') {
        try {
          url = (await store.uploadDoc(f, docKind)) ?? undefined
        } catch (e) {
          msgs.push(`${f.name}: ${(e as Error).message}`)
          continue
        }
      }
      added.push({ id: Date.now() + added.length, kind: docKind, name: f.name, size: f.size, type: f.type, preview, url })
    }
    setA((p) => ({ ...p, docs: [...p.docs, ...added].slice(0, 8) }))
    setDocErr(msgs.join(' · '))
  }

  function submit() {
    setTouched(true)
    const e = validateApplication(a)
    if (Object.keys(e).length) return
    onSave({ ...a, gstin: a.gstin?.trim().toUpperCase(), darpanId: a.darpanId?.trim().toUpperCase() }, false)
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal form-modal trust-form" role="dialog" aria-modal="true" aria-label={t('TrustCheck application')} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <span className="drawer-kicker">TrustCheck · {isDonor ? t('Donor application') : t('Recipient application')}</span>
            <h2>{a.status === 'Resubmission Required' ? t('Fix and resubmit') : t('Tell us who you are')}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close')}>
            <X size={20} />
          </button>
        </header>
        <div className="form-grid trust-form-grid">
          <div className="form-fields">
            {a.decisionNote && a.status === 'Resubmission Required' && <p className="review-reasons">{t('Reviewer’s note')}: {a.decisionNote}</p>}
            <fieldset>
              <legend>{t('Organisation')}</legend>
              <label className="field span-2">
                <span>{t('Organisation name')}</span>
                <input value={a.orgName} onChange={(e) => set('orgName', e.target.value)} />
                {err('orgName')}
              </label>
              <label className="field">
                <span>{t('Type')}</span>
                <select value={a.orgType} onChange={(e) => set('orgType', e.target.value)}>
                  <option value="">{t('Choose…')}</option>
                  {ORG_TYPES[a.role].map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
                {err('orgType')}
              </label>
              <label className="field">
                <span>{t('Area')}</span>
                <select value={a.area} onChange={(e) => set('area', e.target.value)}>
                  {AREAS.map((x) => (
                    <option key={x.name}>{x.name}</option>
                  ))}
                </select>
              </label>
              <label className="field span-2">
                <span>{t('Address')}</span>
                <input value={a.address} onChange={(e) => set('address', e.target.value)} />
                {err('address')}
              </label>
            </fieldset>
            <fieldset>
              <legend>{t('Contact')}</legend>
              <label className="field span-2">
                <span>{t('Contact person')}</span>
                <input value={a.contactName} onChange={(e) => set('contactName', e.target.value)} />
                {err('contactName')}
              </label>
              <label className="field">
                <span>{t('Mobile')}</span>
                <input inputMode="tel" value={a.phone} onChange={(e) => set('phone', e.target.value)} placeholder="98XXXXXXXX" />
                {err('phone')}
              </label>
              <label className="field">
                <span>{t('Email')}</span>
                <input type="email" value={a.email} onChange={(e) => set('email', e.target.value)} />
                {err('email')}
              </label>
            </fieldset>

            {isDonor ? (
              <fieldset>
                <legend>{t('Licences')}</legend>
                <label className="field">
                  <span>{t('FSSAI licence / registration no.')}</span>
                  <input inputMode="numeric" value={a.fssai ?? ''} onChange={(e) => set('fssai', e.target.value.replace(/\D/g, '').slice(0, 14))} placeholder="14 digits" />
                  {err('fssai')}
                </label>
                <label className="field">
                  <span>{t('GSTIN (if registered)')}</span>
                  <input value={a.gstin ?? ''} onChange={(e) => set('gstin', e.target.value.toUpperCase().slice(0, 15))} placeholder="04ABCDE1234F1Z5" />
                  {err('gstin')}
                </label>
              </fieldset>
            ) : (
              <>
                <fieldset>
                  <legend>{t('Registration')}</legend>
                  <label className="field span-2">
                    <span>{t('Constituted as')}</span>
                    <select value={a.registrationType ?? ''} onChange={(e) => set('registrationType', (e.target.value || undefined) as TrustApplication['registrationType'])}>
                      <option value="">{t('Choose…')}</option>
                      {(['Trust', 'Society', 'Section 8 company', 'Community kitchen (unregistered)', 'Religious / community body', 'Other'] as const).map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                    {err('registrationType')}
                  </label>
                  <label className="field">
                    <span>{t('NGO Darpan ID (if any)')}</span>
                    <input value={a.darpanId ?? ''} onChange={(e) => set('darpanId', e.target.value.toUpperCase())} placeholder="CH/2019/0234567" />
                    {err('darpanId')}
                  </label>
                  <label className="field">
                    <span>{t('Registration / CIN no.')}</span>
                    <input value={a.registrationNo ?? ''} onChange={(e) => set('registrationNo', e.target.value)} />
                    {err('registrationNo')}
                  </label>
                </fieldset>
                <fieldset>
                  <legend>{t('Food handling')}</legend>
                  <label className="field">
                    <span>{t('Servings you can serve per day')}</span>
                    <input inputMode="numeric" value={a.dailyCapacity ?? ''} onChange={(e) => set('dailyCapacity', Number(e.target.value.replace(/\D/g, '')) || undefined)} />
                    {err('dailyCapacity')}
                  </label>
                  <label className="field">
                    <span>{t('Service area')}</span>
                    <input value={a.serviceArea ?? ''} onChange={(e) => set('serviceArea', e.target.value)} placeholder="e.g. Sectors 40–46" />
                    {err('serviceArea')}
                  </label>
                  <div className="field span-2">
                    <span>{t('Food you can accept')}</span>
                    <div className="chips">
                      {CATEGORIES.map((c: Category) => (
                        <button
                          type="button"
                          key={c}
                          className={cx('chip-mini', a.accepts?.includes(c) && 'on')}
                          onClick={() => set('accepts', a.accepts?.includes(c) ? a.accepts.filter((x) => x !== c) : [...(a.accepts ?? []), c])}
                        >
                          {t(c)}
                        </button>
                      ))}
                      <button type="button" className={cx('chip-mini', a.acceptsNonVeg && 'on')} onClick={() => set('acceptsNonVeg', !a.acceptsNonVeg)}>
                        {t('Non-veg OK')}
                      </button>
                    </div>
                    {err('accepts')}
                  </div>
                  <label className="field">
                    <span>{t('Fridge (litres, 0 if none)')}</span>
                    <input inputMode="numeric" value={a.fridgeLitres ?? 0} onChange={(e) => { const v = Number(e.target.value.replace(/\D/g, '')) || 0; setA((p) => ({ ...p, fridgeLitres: v, refrigeration: v > 0 })) }} />
                  </label>
                  <label className="field">
                    <span>{t('Freezer (litres, 0 if none)')}</span>
                    <input inputMode="numeric" value={a.freezerLitres ?? 0} onChange={(e) => { const v = Number(e.target.value.replace(/\D/g, '')) || 0; setA((p) => ({ ...p, freezerLitres: v, freezer: v > 0 })) }} />
                  </label>
                  <label className="field">
                    <span>{t('Opens (hour, 0–23)')}</span>
                    <input inputMode="numeric" value={a.opensHour ?? ''} onChange={(e) => set('opensHour', Number(e.target.value))} />
                  </label>
                  <label className="field">
                    <span>{t('Closes (hour, 1–24)')}</span>
                    <input inputMode="numeric" value={a.closesHour ?? ''} onChange={(e) => set('closesHour', Number(e.target.value))} />
                    {err('hours')}
                  </label>
                </fieldset>
              </>
            )}

            <fieldset>
              <legend>{t('Documents and photos')}</legend>
              <div className="field span-2 doc-upload">
                <select value={docKind} onChange={(e) => setDocKind(e.target.value)} aria-label={t('Document type')}>
                  {DOC_KINDS[a.role].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
                <label className="btn btn-ghost btn-sm">
                  <Upload size={14} /> {t('Add file')}
                  <input type="file" hidden multiple accept={DOC_LIMIT.types.join(',')} onChange={(e) => { addDocs(e.target.files); e.target.value = '' }} />
                </label>
                <small>{store?.mode === 'server' ? t('PDF, JPEG, PNG or WebP, up to 5 MB. Stored on the SECOND-SERVE server; only you and coordinators can open it.') : t('PDF, JPEG, PNG or WebP, up to 5 MB. Offline demo: kept in this browser only.')}</small>
                {docErr && <span className="field-err">{docErr}</span>}
                {err('docs')}
              </div>
              {a.docs.length > 0 && (
                <ul className="doc-list span-2">
                  {a.docs.map((d) => (
                    <li key={d.id}>
                      {d.preview ? <img src={d.preview} alt="" /> : <FileText size={18} />}
                      <span>
                        <b>{d.kind}</b> {d.name}
                      </span>
                      <button type="button" className="icon-btn" onClick={() => set('docs', a.docs.filter((x) => x.id !== d.id))} aria-label={t('Remove {name}', { name: d.name })}>
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          </div>
        </div>
        <footer className="modal-foot">
          <span className="foot-hint">{touched && Object.keys(errors).length ? t('A few details still need attention.') : t('Format checks only catch typos. A coordinator checks the real records.')}</span>
          <button type="button" className="btn btn-ghost" onClick={() => onSave(a, true)}>
            {t('Save draft')}
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            {a.status === 'Resubmission Required' ? t('Resubmit') : t('Submit for review')}
          </button>
        </footer>
      </div>
    </div>
  )
}
