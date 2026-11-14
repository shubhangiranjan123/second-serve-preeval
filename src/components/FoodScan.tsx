// AI Food Scan: capture or upload a photo → Engine 1 vision analysis.
// On success the donation form opens pre-filled with the AI reading; on any
// failure the donor can retry, retake, or continue without AI (the listing
// then goes to manual review, never straight to matching).

import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Camera, ImageUp, Loader2, RotateCcw, ScanLine, X } from 'lucide-react'
import {
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

export type ScanHandoff =
  | { kind: 'scan'; scan: Scan; meta: ScanMeta; thumb: string }
  | { kind: 'error'; message: string; thumb?: string }

type Phase =
  | { at: 'capture'; problem?: string }
  | { at: 'analysing'; preview: string; thumb: string; dataUrl: string }
  | { at: 'failed'; preview: string; thumb: string; dataUrl: string; message: string; retryable: boolean }

export function FoodScan({ onClose, onResult }: { onClose: () => void; onResult: (r: ScanHandoff) => void }) {
  const { t } = useT()
  const [phase, setPhase] = useState<Phase>({ at: 'capture' })
  const [health, setHealth] = useState<VisionHealth | null | 'loading'>('loading')
  const [dragging, setDragging] = useState(false)
  const camRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    visionHealth().then(setHealth)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      abort.current?.abort()
    }
  }, [onClose])

  async function analyse(dataUrl: string, preview: string, thumb: string) {
    setPhase({ at: 'analysing', preview, thumb, dataUrl })
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    const res = await scanFood(dataUrl, ctrl.signal)
    if (ctrl.signal.aborted) return
    if (res.ok) onResult({ kind: 'scan', scan: res.scan, meta: res.meta, thumb })
    else setPhase({ at: 'failed', preview, thumb, dataUrl, message: friendlyError(res.error), retryable: res.error.retryable })
  }

  async function take(file: File | undefined) {
    if (!file) return
    const problem = checkFile(file)
    if (problem) return setPhase({ at: 'capture', problem })
    try {
      const { dataUrl, thumb } = await preparePhoto(file)
      await analyse(dataUrl, dataUrl, thumb)
    } catch (e) {
      setPhase({ at: 'capture', problem: (e as Error).message })
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    take(e.dataTransfer.files?.[0])
  }

  const ready = health !== 'loading' && health?.configured
  const track =
    phase.at === 'capture'
      ? { photo: 'active' as const }
      : phase.at === 'analysing'
        ? { photo: 'done' as const, vision: 'active' as const }
        : { photo: 'done' as const, vision: 'fail' as const }

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

          {phase.at === 'capture' && (
            <>
              <div
                className={dragging ? 'scan-drop on' : 'scan-drop'}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <ScanLine size={40} strokeWidth={1.6} />
                <p>{t('Photograph the surplus in good light, with every tray or box in frame and the food itself visible.')}</p>
                <div className="scan-actions">
                  <button type="button" className="btn btn-primary btn-lg" onClick={() => camRef.current?.click()}>
                    <Camera size={18} /> {t('Take photo')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-lg" onClick={() => fileRef.current?.click()}>
                    <ImageUp size={18} /> {t('Upload photo')}
                  </button>
                </div>
                <small>{t('JPEG, PNG or WebP · up to 15 MB · or drop it here')}</small>
                <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => take(e.target.files?.[0])} />
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => take(e.target.files?.[0])} />
              </div>
              {phase.problem && <p className="scan-problem" role="alert">{phase.problem}</p>}
              <p className="scan-status">
                {health === 'loading' ? (
                  t('Checking the AI scanner…')
                ) : ready ? (
                  <>
                    <i className="dot-ok" /> {t('AI scanner ready')} · {health.model}
                  </>
                ) : (
                  <>
                    <i className="dot-off" /> {health ? health.reason : t('The AI backend isn’t running. Start it with npm run dev.')}
                  </>
                )}
              </p>
            </>
          )}

          {phase.at !== 'capture' && (
            <div className="scan-stage">
              <figure className={phase.at === 'analysing' ? 'scan-photo scanning' : 'scan-photo'}>
                <img src={phase.preview} alt={t('Your food photo')} />
                {phase.at === 'analysing' && <span className="scan-beam" aria-hidden />}
              </figure>
              {phase.at === 'analysing' ? (
                <div className="scan-side" aria-live="polite">
                  <Loader2 size={22} className="spin" />
                  <strong>{t('Reading the photo…')}</strong>
                  <p>{t('The vision model is identifying the food, its condition and packaging. A photo can show what food looks like, not whether it’s safe, so safety rules run next.')}</p>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { abort.current?.abort(); setPhase({ at: 'capture' }) }}>
                    {t('Cancel')}
                  </button>
                </div>
              ) : (
                <div className="scan-side" role="alert">
                  <strong>{t('The scan didn’t work')}</strong>
                  <p>{phase.message}</p>
                  <div className="scan-actions col">
                    {phase.retryable && (
                      <button type="button" className="btn btn-primary" onClick={() => analyse(phase.dataUrl, phase.preview, phase.thumb)}>
                        <RotateCcw size={16} /> {t('Try again')}
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost" onClick={() => setPhase({ at: 'capture' })}>
                      <Camera size={16} /> {t('Use another photo')}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => onResult({ kind: 'error', message: phase.message, thumb: phase.thumb })}>
                      {t('Continue without AI')}
                    </button>
                  </div>
                  <small>{t('Without a scan, a coordinator must inspect the food before any NGO is matched.')}</small>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
