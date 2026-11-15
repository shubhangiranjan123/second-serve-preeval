// Scan & donate, end to end: photos → AI reading → review → publish.
// Shared by the coordinator console and the donor board. Matching runs on
// the server as part of publishing (autoMatch), so every screen sees the
// result at the same moment.

import { useState } from 'react'
import type { AppState } from '../types'
import type { RescueStore } from '../lib/useRescueStore'
import { DonationForm } from './DonationForm'
import { FoodScan, type ScanHandoff } from './FoodScan'
import { useT } from '../lib/i18n'

type Toast = (msg: string, tone?: 'ok' | 'info' | 'warn') => void

export function ScanFlow({
  open,
  onClose,
  state,
  now,
  store,
  toast,
  fixedDonor,
  onPublished,
}: {
  open: boolean
  onClose: () => void
  state: AppState
  now: number
  store: RescueStore
  toast: Toast
  fixedDonor?: string // donors always list as their own organisation
  onPublished?: (donationId: number) => void
}) {
  const { t } = useT()
  const [scanned, setScanned] = useState<ScanHandoff | undefined>(undefined)
  const [stage, setStage] = useState<'scan' | 'form'>('scan')

  if (!open) return null
  const close = () => {
    setScanned(undefined)
    setStage('scan')
    onClose()
  }

  if (stage === 'scan' || !scanned)
    return (
      <FoodScan
        onClose={close}
        onResult={(r) => {
          setScanned(r)
          setStage('form')
        }}
      />
    )

  return (
    <DonationForm
      key={scanned.kind === 'scan' ? scanned.meta.at : 'noscan'}
      state={state}
      now={now}
      scanned={scanned}
      fixedDonor={fixedDonor}
      onRescan={() => {
        setScanned(undefined)
        setStage('scan')
      }}
      onClose={close}
      onSubmit={async (input, extras) => {
        const r = await store.addDonation(input, extras, true)
        if (!r.ok) return false
        const d = r.result.donation
        close()
        if (!d) return true
        if (d.status === 'In review') toast(t('“{name}” is waiting for a human check before matching.', { name: d.name }), 'info')
        else if (r.result.matchedTo) toast(t('Published and matched to {name}. Now assign a runner.', { name: r.result.matchedTo }))
        else toast(t('Published, but no organisation can take it in time. It stays on the board, unmatched.'), 'warn')
        onPublished?.(d.id)
        return true
      }}
    />
  )
}
