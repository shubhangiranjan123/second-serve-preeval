import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n'

export const INDIA_KG_PER_SECOND = 78.1e9 / (365.25 * 24 * 3600)

const OPENED_AT = performance.now()

export function WasteCounter() {
  const [kg, setKg] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setKg(((performance.now() - OPENED_AT) / 1000) * INDIA_KG_PER_SECOND), 90)
    return () => clearInterval(t)
  }, [])
  return <>{Math.floor(kg).toLocaleString('en-IN')}</>
}

export function WasteBar() {
  const { t } = useT()
  return (
    <div className="waste-bar" role="status" aria-live="off">
      <span className="waste-bar-dot" />
      <span>{t('Since you opened this site, India has thrown away')}</span>
      <strong>
        <WasteCounter /> kg
      </strong>
      <span>{t('of food.')}</span>
    </div>
  )
}
