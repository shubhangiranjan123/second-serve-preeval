import { CheckCircle2, Info, AlertTriangle } from 'lucide-react'

export type Toast = { id: number; msg: string; tone: 'ok' | 'info' | 'warn' }

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.tone === 'ok' ? <CheckCircle2 size={18} /> : t.tone === 'warn' ? <AlertTriangle size={18} /> : <Info size={18} />}
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  )
}
