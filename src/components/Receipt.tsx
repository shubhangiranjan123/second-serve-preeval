import { Download } from 'lucide-react'
import type { RescueRecord } from '../types'
import { IMPACT, formatClock, formatDuration } from '../lib/engine'

type ReceiptData = {
  no: number
  record: RescueRecord
  pickedAt?: number
  minutesSpare?: number
}

function lines(d: ReceiptData) {
  const { record: r } = d
  return [
    [r.food, `${r.servings} meals`],
    [r.donor, d.pickedAt ? formatClock(d.pickedAt) : '—'],
    [`→ ${r.ngoName}`, formatClock(r.deliveredAt)],
    [`Runner: ${r.runnerName}`, ''],
    ['Safe time left on arrival', d.minutesSpare !== undefined ? formatDuration(d.minutesSpare) : '—'],
  ] as Array<[string, string]>
}

// Draws the receipt onto a canvas and downloads it as a PNG.
// Uses the page's already-loaded fonts; falls back to system fonts offline.
function downloadPng(d: ReceiptData) {
  const W = 720
  const H = 940
  const canvas = document.createElement('canvas')
  const scale = 2
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(scale, scale)

  const ink = '#18231E'
  const pink = '#FF5C9A'
  ctx.fillStyle = ink
  ctx.fillRect(0, 0, W, H)

  // paper with torn edges
  ctx.fillStyle = '#FFFDFB'
  ctx.beginPath()
  const x0 = 60
  const x1 = W - 60
  const y0 = 70
  const y1 = H - 70
  ctx.moveTo(x0, y0)
  for (let x = x0; x <= x1; x += 20) ctx.lineTo(x + 10, y0 + (((x / 20) | 0) % 2 ? 8 : 0))
  ctx.lineTo(x1, y1)
  for (let x = x1; x >= x0; x -= 20) ctx.lineTo(x - 10, y1 - (((x / 20) | 0) % 2 ? 8 : 0))
  ctx.closePath()
  ctx.fill()

  const mono = '"JetBrains Mono", ui-monospace, monospace'
  const display = '"Bricolage Grotesque", system-ui, sans-serif'
  ctx.fillStyle = ink
  ctx.font = `600 18px ${mono}`
  ctx.fillText('SECOND SERVE · RESCUE RECEIPT', x0 + 36, y0 + 64)
  ctx.textAlign = 'right'
  ctx.fillText(`#${String(d.no).padStart(3, '0')}`, x1 - 36, y0 + 64)
  ctx.textAlign = 'left'

  ctx.font = `800 64px ${display}`
  ctx.fillText(`${d.record.servings} meals`, x0 + 36, y0 + 150)
  ctx.font = `700 34px ${display}`
  ctx.fillStyle = pink
  ctx.fillText('got a second serve.', x0 + 36, y0 + 196)

  ctx.strokeStyle = ink
  ctx.setLineDash([6, 6])
  ctx.beginPath()
  ctx.moveTo(x0 + 36, y0 + 236)
  ctx.lineTo(x1 - 36, y0 + 236)
  ctx.stroke()

  ctx.fillStyle = ink
  ctx.font = `400 19px ${mono}`
  lines(d).forEach(([l, r], i) => {
    const y = y0 + 288 + i * 44
    ctx.textAlign = 'left'
    ctx.fillText(l.length > 30 ? `${l.slice(0, 29)}…` : l, x0 + 36, y)
    ctx.textAlign = 'right'
    ctx.fillText(r, x1 - 36, y)
  })
  ctx.textAlign = 'left'

  ctx.beginPath()
  ctx.moveTo(x0 + 36, y0 + 520)
  ctx.lineTo(x1 - 36, y0 + 520)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.font = `600 20px ${mono}`
  ctx.fillText('Waste avoided (est.)', x0 + 36, y0 + 566)
  ctx.textAlign = 'right'
  ctx.fillText(`${d.record.weightKg} kg`, x1 - 36, y0 + 566)
  ctx.textAlign = 'left'

  // barcode
  for (let i = 0, x = x0 + 36; x < x1 - 36; i++) {
    const w = 1 + ((i * 7 + d.no * 3) % 4)
    ctx.fillRect(x, y0 + 600, w, 70)
    x += w + 2 + ((i * 5) % 3)
  }

  // stamp
  ctx.save()
  ctx.translate(x1 - 150, y0 + 130)
  ctx.rotate(-0.22)
  ctx.strokeStyle = pink
  ctx.lineWidth = 5
  ctx.strokeRect(-92, -34, 184, 68)
  ctx.fillStyle = pink
  ctx.font = `800 34px ${display}`
  ctx.textAlign = 'center'
  ctx.fillText('RESCUED', 0, 12)
  ctx.restore()

  ctx.fillStyle = '#56685D'
  ctx.font = `400 14px ${mono}`
  ctx.textAlign = 'center'
  ctx.fillText(`Estimate: ${IMPACT.kgPerServing} kg/serving where not weighed. Demo build.`, W / 2, y1 - 40)

  canvas.toBlob((blob) => {
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `second-serve-receipt-${String(d.no).padStart(3, '0')}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }, 'image/png')
}

export function Receipt(d: ReceiptData & { onDownloaded?: () => void }) {
  return (
    <div className="receipt">
      <div className="receipt-paper">
        <div className="receipt-head">
          <span>RESCUE RECEIPT</span>
          <span>#{String(d.no).padStart(3, '0')}</span>
        </div>
        <strong className="receipt-big">{d.record.servings} meals</strong>
        <em className="receipt-sub">got a second serve.</em>
        <hr />
        {lines(d).map(([l, r]) => (
          <div className="receipt-row" key={l}>
            <span>{l}</span>
            <span>{r}</span>
          </div>
        ))}
        <hr />
        <div className="receipt-row receipt-total">
          <span>Waste avoided (est.)</span>
          <span>{d.record.weightKg} kg</span>
        </div>
        <div className="barcode" aria-hidden />
        <span className="receipt-stamp">RESCUED</span>
      </div>
      <button
        className="btn btn-pink btn-block"
        onClick={() => {
          downloadPng(d)
          d.onDownloaded?.()
        }}
      >
        <Download size={16} /> Download receipt
      </button>
    </div>
  )
}
