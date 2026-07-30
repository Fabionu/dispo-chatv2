import type { ReactNode } from 'react'

// The message under a field. It reserves NO space when empty and is a single
// tight line when present, so showing a validation error nudges the layout by
// one line instead of reflowing the panel. `role="alert"` announces it the
// moment it appears; `aria-describedby` on the control points here.
export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="mt-1 text-xs leading-tight text-alert">
      {children}
    </p>
  )
}

// The quiet counterpart: a hint or a lock explanation ("Set at signup",
// "Comma-separated"). Same position and metrics as the error so a field never
// jumps when one replaces the other.
export function FieldHint({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null
  return (
    <p id={id} className="mt-1 text-xs leading-tight text-faint">
      {children}
    </p>
  )
}

// Marks a field the user may leave blank. Deliberately tiny and faint — an
// optional field should whisper, while a REQUIRED one is the one that earns a
// visible mark (see EditableField's asterisk).
export function OptionalMark() {
  return (
    <span className="text-2xs font-normal text-faint/80" title="Optional">
      optional
    </span>
  )
}
