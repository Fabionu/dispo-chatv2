import { type ReactNode } from 'react'
import type { ChipTone } from '../../lib/vehicleOps'
import { EditableSelect } from '../forms'
import { ProfileSection } from '../settings/profileChrome'

// Shared, panel-native controls for the vehicle-room operational tabs. They
// match the GroupInfoPanel aesthetic (muted label over value, hairline divider,
// individual inline editing) so the new tabs read as part of the same panel.

// Map a chip tone to colour classes. The base four reuse the app's palette
// tokens; the trip-progress tones use carefully desaturated hues tuned for the
// dark theme. Kept as FULL class strings so Tailwind's content scan keeps them.
// The colour lives on the dot + text; the chip keeps the app's neutral grey pill
// surface so every chip reads consistently (no per-status background wash).
// Exported so other surfaces that colour by the same semantics (e.g. the chat
// header's Load/Unload markers) reuse these exact hues instead of re-declaring
// the hex values.
export const TONE_TEXT: Record<ChipTone, string> = {
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
// rows, trip header, sidebar). Stays small/elegant — never a card. The optional
// `size="lg"` variant is a touch bigger + more prominent (taller pill, larger
// text, bigger dot, subtle border) for the conversation header, where the trip
// status needs to stand out; the default stays small for dense surfaces.
export function StatusChip({
  tone,
  label,
  size = 'sm',
}: {
  tone: ChipTone
  label: string
  size?: 'sm' | 'lg'
}) {
  const pill =
    size === 'lg'
      ? 'h-7 gap-2 px-3 text-base font-semibold bg-white/8 border border-white/6'
      : 'gap-1.5 px-2 py-0.5 text-xs font-medium bg-white/6'
  const dot = size === 'lg' ? 'h-2 w-2' : 'h-1.5 w-1.5'
  return (
    <span className={`inline-flex items-center rounded-full ${pill} ${TONE_TEXT[tone]}`}>
      <span className={`${dot} rounded-full ${TONE_DOT[tone]}`} />
      {label}
    </span>
  )
}

// Bare coloured status dot — the most compact possible indicator, for dense
// surfaces (e.g. the Compact sidebar row) where a full chip won't fit.
export function StatusDot({ tone, title, className = '' }: { tone: ChipTone; title?: string; className?: string }) {
  return <span title={title} className={`h-2 w-2 rounded-full shrink-0 ${TONE_DOT[tone]} ${className}`} />
}

// Inline trip status for the SIDEBAR rows — no pill, no background: a faint
// separator dot then the status label in its tone colour, sitting right after
// the group name (`SV01HLC · Going to loading`). Truncates as a flex item
// (needs a `min-w-0` parent + its own `shrink`), so a long status ellipsizes
// while the name stays primary. Sizing/shrink priority come from the caller via
// `className` + `style` so Compact/Normal rows keep their own scale.
export function TripStatusInline({
  tone,
  label,
  title,
  className = '',
  style,
}: {
  tone: ChipTone
  label: string
  title?: string
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span title={title ?? label} style={style} className={`min-w-0 truncate ${TONE_TEXT[tone]} ${className}`}>
      <span className="text-faint" aria-hidden>
        ·
      </span>{' '}
      {label}
    </span>
  )
}

// A labelled row that edits a value chosen from a fixed option list. A thin
// pass-through to the shared EditableSelect so a vehicle/trip status field is
// the SAME control (and the same read/edit/saving/error states) as every other
// field in the app — this used to be a bespoke always-visible <select>.
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
  return (
    <EditableSelect
      label={label}
      value={value}
      options={options}
      editable={editable}
      onSave={onSave}
    />
  )
}

// A small eyebrow sub-heading used to group related rows within a tab (e.g.
// "Loading" / "Unloading" in the trip tab). Lighter than GroupInfoPanel's
// Section — no action slot, tighter spacing.
// A labelled block inside a Group info tab. Delegates to the app-wide
// ProfileSection so the vehicle tabs, My profile, Company profile and the User
// profile card all render an eyebrow over the SAME grouped field card.
export function SubHeading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <ProfileSection label={label}>{children}</ProfileSection>
    </div>
  )
}
