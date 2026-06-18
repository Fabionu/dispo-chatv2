import { useState, type ReactNode } from 'react'
import type { StatusTone } from '../../lib/vehicleOps'

// Shared, panel-native controls for the vehicle-room operational tabs. They
// match the GroupInfoPanel aesthetic (muted label over value, hairline divider,
// individual inline editing) so the new tabs read as part of the same panel.

// Map a semantic status tone to the app's existing colour tokens. Kept as full
// class strings so Tailwind's content scan keeps them.
const TONE_TEXT: Record<StatusTone, string> = {
  done: 'text-done',
  active: 'text-active',
  alert: 'text-alert',
  muted: 'text-muted',
}
const TONE_DOT: Record<StatusTone, string> = {
  done: 'bg-done',
  active: 'bg-active',
  alert: 'bg-alert',
  muted: 'bg-muted',
}

// Compact status pill: a coloured dot + label on a subtle surface. Used wherever
// a status needs to be scannable at a glance (hero, stop rows, trip header).
export function StatusChip({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-chip bg-white/[0.05] px-1.5 py-0.5 text-[10.5px] font-medium ${TONE_TEXT[tone]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />
      {label}
    </span>
  )
}

// A labelled row that edits a value chosen from a fixed option list. Read-only
// (just the label text) unless `editable`; editing is a styled native <select>
// that saves on change. Mirrors EditableRow's layout/spacing for a uniform tab.
export function SelectRow<T extends string>({
  label,
  value,
  options,
  editable,
  onSave,
}: {
  label: string
  value: T | undefined
  options: ReadonlyArray<{ value: T; label: string }>
  editable: boolean
  // Persist the new value (undefined when cleared back to "Not set").
  onSave: (value: T | undefined) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const current = options.find((o) => o.value === value)?.label

  async function change(next: T | undefined) {
    setSaving(true)
    setError(false)
    try {
      await onSave(next)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="py-2 border-b border-white/[0.04] last:border-0">
      <label className="block text-[11px] text-muted mb-1">{label}</label>
      {editable ? (
        <select
          value={value ?? ''}
          disabled={saving}
          onChange={(e) => void change((e.target.value || undefined) as T | undefined)}
          className="h-8 w-full rounded-lg border border-white/[0.1] bg-white/[0.03] px-2 text-[12.5px] text-text outline-none focus:border-white/[0.25] disabled:opacity-50"
        >
          <option value="">Not set</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <div className={`text-[12.5px] ${current ? 'text-text' : 'text-faint'}`}>{current ?? 'Not set'}</div>
      )}
      {error && <div className="text-[11px] text-alert mt-1">Could not save. Try again.</div>}
    </div>
  )
}

// A small eyebrow sub-heading used to group related rows within a tab (e.g.
// "Loading" / "Unloading" in the trip tab). Lighter than GroupInfoPanel's
// Section — no action slot, tighter spacing.
export function SubHeading({ children }: { children: ReactNode }) {
  return <div className="eyebrow mb-1 mt-3 first:mt-0">{children}</div>
}
