import { useState, type ReactNode } from 'react'
import type { ChipTone } from '../../lib/vehicleOps'

// Shared, panel-native controls for the vehicle-room operational tabs. They
// match the GroupInfoPanel aesthetic (muted label over value, hairline divider,
// individual inline editing) so the new tabs read as part of the same panel.

// Map a chip tone to colour classes. The base four reuse the app's palette
// tokens; the trip-progress tones use carefully desaturated hues tuned for the
// dark theme. Kept as FULL class strings so Tailwind's content scan keeps them.
// The colour lives on the dot + text; the chip keeps the app's neutral grey pill
// surface so every chip reads consistently (no per-status background wash).
const TONE_TEXT: Record<ChipTone, string> = {
  muted: 'text-muted',
  done: 'text-done',
  active: 'text-active',
  alert: 'text-alert',
  blue: 'text-[#6f9bd1]',
  green: 'text-[#5fae72]',
  cyan: 'text-[#4fb3a7]',
  purple: 'text-[#a98bd6]',
  indigo: 'text-[#7c86d8]',
  slate: 'text-[#8a93a6]',
  orange: 'text-[#d68a52]',
}
const TONE_DOT: Record<ChipTone, string> = {
  muted: 'bg-muted',
  done: 'bg-done',
  active: 'bg-active',
  alert: 'bg-alert',
  blue: 'bg-[#6f9bd1]',
  green: 'bg-[#5fae72]',
  cyan: 'bg-[#4fb3a7]',
  purple: 'bg-[#a98bd6]',
  indigo: 'bg-[#7c86d8]',
  slate: 'bg-[#8a93a6]',
  orange: 'bg-[#d68a52]',
}
// Compact status pill: a coloured dot + label on the app's neutral grey pill
// surface. Used wherever a status needs to be scannable at a glance (hero, stop
// rows, trip header, sidebar). Stays small/elegant — never a card.
export function StatusChip({ tone, label }: { tone: ChipTone; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10.5px] font-medium ${TONE_TEXT[tone]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />
      {label}
    </span>
  )
}

// Bare coloured status dot — the most compact possible indicator, for dense
// surfaces (e.g. the Compact sidebar row) where a full chip won't fit.
export function StatusDot({ tone, title, className = '' }: { tone: ChipTone; title?: string; className?: string }) {
  return <span title={title} className={`h-2 w-2 rounded-full shrink-0 ${TONE_DOT[tone]} ${className}`} />
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
