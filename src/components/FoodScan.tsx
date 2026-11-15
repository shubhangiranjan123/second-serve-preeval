// AI Food Scan: 1 required + up to 3 optional photos of ONE donation → Engine 1 vision analysis.
// The photos are sent together and analysed as one piece of evidence.
// On success the review form opens pre-filled with the AI reading; on any
// failure the donor can retry, change photos, or continue without AI (the
// listing then goes to manual review, never straight to matching).

import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Camera, ImageUp, Loader2, Plus, RefreshCw, RotateCcw, ScanLine, X } from 'lucide-react'
import {
  UPLOAD,
  checkFile,
  friendlyError,
  preparePhoto,
  scanFood,
  visionHealth,
  type FoodScan as Scan,
  type ScanMeta,
  type VisionHealth,
} from '../lib/foodScan'
import { useT } from '../lib/i18n'
import { PipelineTrack } from './PipelineTrack'
import { cx } from './ui'

export type ScanHandoff =
  | { kind: 'scan'; scan: Scan; meta: ScanMeta; thumbs: string[] }
  | { kind: 'error'; message: string; thumbs: string[] }

type Photo = { id: number; name: string; dataUrl: string; thumb: string }
type Phase = { at: 'capture' } | { at: 'analysing' } | { at: 'failed'; message: string; retryable: boolean; code: string }

let nextId = 1

export function FoodScan({ onClose, onResult }: { onClose: () => void; onResult: (r: ScanHandoff) => void }) {
  const { t } = useT()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [phase, setPhase] = useState<Phase>({ at: 'capture' })
  const [health, setHealth] = useState<VisionHealth | null | 'loading'>('loading')
  const [dragging, setDragging] = useState(false)
  const [samples, setSamples] = useState<Array<{ file: string; label: string }>>([])
  const camRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const replaceId = useRef<number | null>(null)
  const abort = useRef<AbortController | null>(null)

  // Setup runs ONCE per opening of the scan window. (It used to depend on
  // onClose, which the parent re-creates on every render, so the app's
  // 15-second clock tick re-ran this effect and its cleanup cancelled any
  // scan in progress. That was the "sometimes it scans, sometimes it
  // doesn't" bug.)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    visionHealth().then(setHealth)
    // Optional demo photos in public/samples (set up by `node fix-ai.mjs`).
    // They go through the same real AI scan as any uploaded photo.
    fetch('/samples/manifest.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: unknown) => setSamples(Array.isArray(list) ? list.slice(0, 4) : []))
      .catch(() => setSamples([]))
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      abort.current?.abort() // only when the scan window actually closes
    }
  }, [])

  /** Validate, shrink and strip metadata from each file. Bad files get a message, good ones a slot. */
  async function prepare(files: File[]): Promise<{ ok: Photo[]; bad: string[] }> {
    const ok: Photo[] = []
    const bad: string[] = []
    for (const file of files) {
      const problem = checkFile(file)
      if (problem) {
        bad.push(`${file.name}: ${problem}`)
        continue
      }
      try {
        const { dataUrl, thumb } = await preparePhoto(file)
        ok.push({ id: nextId++, name: file.name, dataUrl, thumb })
      } catch {
        bad.push(`${file.name}: this file couldn’t be opened as an image (it may be corrupted).`)
      }
    }
    return { ok, bad }
  }

  async function addFiles(list: FileList | File[] | null | undefined) {
    const files = Array.from(list ?? [])
    if (!files.length) return
    // Check every file first, so each bad one gets its own reason, then let
    // only the good ones compete for the free slots.
    const msgs: string[] = []
    const valid: File[] = []
    for (const f of files) {
      const problem = checkFile(f)
      if (problem) msgs.push(`${f.name}: ${problem}`)
      else valid.push(f)
    }
    const room = UPLOAD.maxPhotos - photos.length
    if (valid.length > room)
      msgs.push(room <= 0 ? t('You already have 4 photos. Remove one to add another.') : t('One donation takes up to 4 photos. {n} extra skipped.', { n: valid.length - room }))
    setAdding(true)
    const { ok, bad } = await prepare(valid.slice(0, Math.max(0, room)))
    setAdding(false)
    setPhotos((p) => [...p, ...ok].slice(0, UPLOAD.maxPhotos))
    setProblems([...msgs, ...bad])
  }

  async function replace(list: FileList | null) {
    const id = replaceId.current
    const file = list?.[0]
    if (id === null || !file) return
    setAdding(true)
    const { ok, bad } = await prepare([file])
    setAdding(false)
    if (ok[0]) setPhotos((p) => p.map((x) => (x.id === id ? ok[0] : x)))
    setProblems(bad)
  }

  async function addSample(file: string) {
    try {
      const res = await fetch(`/samples/${file}`)
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      await addFiles([new File([blob], file, { type: blob.type || 'image/jpeg' })])
    } catch {
      setProblems([t('That sample photo is missing. Run node fix-ai.mjs to set samples up again.')])
    }
  }

  async function analyse() {
    if (photos.length < UPLOAD.minPhotos) {
      setProblems([t('Add a photo of the food first.')])
      return
    }
    setProblems([])
    setPhase({ at: 'analysing' })
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    let res = await scanFood(
      photos.map((p) => p.dataUrl),
      ctrl.signal,
    )
    if (ctrl.signal.aborted) return
    // One quiet automatic retry for temporary problems (Google busy, rate
    // limit, slow or garbled answer, network blip) before showing an error.
    // Timeouts are NOT retried here: the server already retried those within
    // its own time budget, and doing it again would double the wait.
    if (!res.ok && res.error.retryable && res.error.code !== 'RATE_LIMITED' && res.error.code !== 'TIMEOUT') {
      setRetrying(true)
      await new Promise((r) => setTimeout(r, 2500))
      if (ctrl.signal.aborted) return
      res = await scanFood(
        photos.map((p) => p.dataUrl),
        ctrl.signal,
      )
      setRetrying(false)
      if (ctrl.signal.aborted) return
    }
    if (res.ok) onResult({ kind: 'scan', scan: res.scan, meta: res.meta, thumbs: photos.map((p) => p.thumb) })
    else setPhase({ at: 'failed', message: friendlyError(res.error), retryable: res.error.retryable, code: res.error.code })
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (phase.at === 'capture') addFiles(e.dataTransfer.files)
  }

  const ready = health !== 'loading' && health?.configured
  const n = photos.length
  const enough = n >= UPLOAD.minPhotos
  const track =
    phase.at === 'capture'
      ? { photo: enough ? ('done' as const) : ('active' as const) }
      : phase.at === 'analysing'
        ? { photo: 'done' as const, vision: 'active' as const }
        : { photo: 'done' as const, vision: 'fail' as const }
  const editable = phase.at === 'capture'

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal scan-modal" role="dialog" aria-modal="true" aria-label={t('AI food scan')} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <span className="drawer-kicker">{t('Scan & donate')}</span>
            <h2>{t('Show us the food')}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close')}>
            <X size={20} />
          </button>
        </header>

        <div className="scan-body">
          <PipelineTrack states={track} compact />

          <div
            className={cx('photo-board', dragging && 'on', phase.at === 'analysing' && 'scanning')}
            onDragOver={(e) => {
              e.preventDefault()
              if (editable) setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <div className="photo-board-head">
              <strong>
                {t('{n} of 4 photos', { n })}
                <span className={cx('photo-count', enough ? 'ok' : 'need')}>{enough ? t('ready') : t('add 1 photo')}</span>
              </strong>
              <p>{t('One clear photo of all the food is enough. Add up to 3 more close-ups of the same surplus if you can: more angles help the AI spot problems.')}</p>
            </div>

            <div className="photo-slots">
              {Array.from({ length: UPLOAD.maxPhotos }, (_, i) => {
                const p = photos[i]
                if (p)
                  return (
                    <figure key={p.id} className="photo-slot filled">
                      <img src={p.thumb} alt={t('Photo {n}', { n: i + 1 })} />
                      <span className="photo-no">{i + 1}</span>
                      {editable && (
                        <div className="photo-tools">
                          <button
                            type="button"
                            onClick={() => {
                              replaceId.current = p.id
                              replaceRef.current?.click()
                            }}
                            aria-label={t('Replace photo {n}', { n: i + 1 })}
                          >
                            <RefreshCw size={14} /> {t('Replace')}
                          </button>
                          <button type="button" onClick={() => setPhotos((all) => all.filter((x) => x.id !== p.id))} aria-label={t('Remove photo {n}', { n: i + 1 })}>
                            <X size={14} />
                          </button>
                        </div>
                      )}
                    </figure>
                  )
                return (
                  <button
                    key={`empty-${i}`}
                    type="button"
                    className={cx('photo-slot empty', i < UPLOAD.minPhotos && 'required')}
                    onClick={() => fileRef.current?.click()}
                    disabled={!editable || adding}
                  >
                    {adding && i === n ? <Loader2 size={22} className="spin" /> : <Plus size={22} />}
                    <span>{i < UPLOAD.minPhotos ? t('Photo {n} (required)', { n: i + 1 }) : t('Photo {n} (optional)', { n: i + 1 })}</span>
                  </button>
                )
              })}
              {phase.at === 'analysing' && <span className="scan-beam" aria-hidden />}
            </div>

            {editable && (
              <div className="scan-actions">
                <button type="button" className="btn btn-ghost" onClick={() => camRef.current?.click()} disabled={n >= UPLOAD.maxPhotos || adding}>
                  <Camera size={17} /> {t('Take photo')}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={n >= UPLOAD.maxPhotos || adding}>
                  <ImageUp size={17} /> {t('Upload photos')}
                </button>
                <button type="button" className="btn btn-primary btn-lg" onClick={analyse} disabled={adding || n === 0}>
                  <ScanLine size={18} /> {n === 1 ? t('Analyse 1 photo') : enough ? t('Analyse {n} photos', { n }) : t('Analyse photos')}
                </button>
              </div>
            )}
            <small className="photo-hint">{t('JPEG, PNG or WebP, up to 15 MB each. Photos are shrunk and location data is removed before they leave this device.')}</small>
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
            <input ref={replaceRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { replace(e.target.files); e.target.value = '' }} />
          </div>

          {problems.length > 0 && (
            <ul className="scan-problem" role="alert">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          {editable && samples.length > 0 && n < UPLOAD.maxPhotos && (
            <div className="scan-samples">
              <span>{t('No food in front of you? Add sample photos:')}</span>
              <div>
                {samples.map((s) => (
                  <button type="button" key={s.file} className="scan-sample" onClick={() => addSample(s.file)} title={s.label}>
                    <img src={`/samples/${s.file}`} alt={s.label} loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {phase.at === 'analysing' && (
            <div className="scan-side" aria-live="polite">
              <Loader2 size={22} className="spin" />
              <strong>{retrying ? t('Google is busy, trying again…') : n === 1 ? t('Reading your photo…') : t('Reading {n} photos together…', { n })}</strong>
              <p>{t('The vision model is identifying the food, its condition and packaging across all photos. Photos show what food looks like, not whether it’s safe, so safety rules run next.')}</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { abort.current?.abort(); setRetrying(false); setPhase({ at: 'capture' }) }}>
                {t('Cancel')}
              </button>
            </div>
          )}

          {phase.at === 'failed' && (
            <div className="scan-side" role="alert">
              <strong>{t('The scan didn’t work')}</strong>
              <p>{phase.message}</p>
              <small className="scan-code">{t('Error code')}: {phase.code}</small>
              <div className="scan-actions">
                {phase.retryable && (
                  <button type="button" className="btn btn-primary" onClick={analyse}>
                    <RotateCcw size={16} /> {t('Try again')}
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={() => setPhase({ at: 'capture' })}>
                  <Camera size={16} /> {t('Change photos')}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => onResult({ kind: 'error', message: phase.message, thumbs: photos.map((p) => p.thumb) })}>
                  {t('Continue without AI')}
                </button>
              </div>
              <small>{t('Without a scan, a coordinator must inspect the food before any NGO is matched.')}</small>
            </div>
          )}

          {phase.at === 'capture' && (
            <p className="scan-status">
              {health === 'loading' ? (
                t('Checking the AI scanner…')
              ) : ready ? (
                <>
                  <i className="dot-ok" /> {t('AI scanner ready')} · {health.model}
                </>
              ) : (
                <>
                  <i className="dot-off" /> {health ? health.reason : t('The AI backend isn’t running. Start it with npm run dev.')}{' '}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() =>
                      enough
                        ? onResult({ kind: 'error', message: t('AI scanner not available'), thumbs: photos.map((p) => p.thumb) })
                        : setProblems([t('Add a photo first: the coordinator who inspects it needs to see the food.')])
                    }
                  >
                    {t('Continue without AI')}
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
