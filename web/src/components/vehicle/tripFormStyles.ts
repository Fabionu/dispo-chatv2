// Field styling shared across the Add-trip panel + its stop form, matching the
// in-place editable rows (EditableRow): a soft rounded pill on a subtle dark
// fill, no heavy border, and a quiet brighten on focus.
//
// FIELD_BASE is the pill styling WITHOUT a width, so inline fields (the
// country/postal/city row) can set their own flex/width. INPUT_CLASS is the
// full-width variant used by the standalone fields; AREA_CLASS is the textarea
// variant.
export const FIELD_BASE =
  'rounded-full border border-white/[0.06] bg-white/[0.04] px-4 py-2 text-[0.78125rem] text-text placeholder:text-faint outline-none transition-colors focus:border-white/[0.12] focus:bg-white/[0.05]'

export const INPUT_CLASS = `w-full ${FIELD_BASE}`

export const AREA_CLASS =
  'w-full resize-none rounded-[1.125rem] border border-white/[0.06] bg-white/[0.04] px-4 py-2.5 text-[0.78125rem] text-text placeholder:text-faint outline-none transition-colors focus:border-white/[0.12] focus:bg-white/[0.05]'
