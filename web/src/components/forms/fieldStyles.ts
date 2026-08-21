// ── Form field recipe ───────────────────────────────────────────────────────
// ONE source of truth for every editable control in the app — profile panels,
// company details, group info tabs, trip/stop editors, settings. Before this the
// same field was written four different ways (pill inputs on white/4, `h-8`
// selects on white/2, `.modal-input` on white/3, one-off number inputs), so a
// form looked slightly different in every panel.
//
// Everything is expressed in existing tokens: the wash scale for fill and edge,
// the radius scale for corners, `focus-visible:ring-white/20` for focus, and the
// text/muted/faint trio for content. No literal colours here.
//
// A field is DRAWN, not filled: the rework took the sunken white/4 wash off
// every control, so what marks a field is its hairline, exactly like every other
// box in the app. That also means fill is free again as a pure STATE — nothing
// else is competing for it.
//
// States, in the order the eye should be able to tell them apart:
//   default    hairline edge, no fill
//   hover      edge brightens (the control says "I'm interactive")
//   focus      edge goes to line-2 + a calm ring — never a colour change
//   invalid    alert edge + alert ring; the message sits under the field
//   disabled   dimmed, no pointer
//   read-only  no field chrome at all — a plain value line (see FieldValue)
//   saving     the field locks (disabled) while its own Save spins
//   saved      a brief check on the Save control, then back to rest

// The control box shared by input / textarea / select.
// `bg-transparent` is load-bearing and NOT redundant with "no fill" above.
// Tailwind's preflight zeroes background-color for BUTTONS only; a text input
// keeps the user agent's, and this app runs `color-scheme: dark`, so Chrome
// paints an undeclared field a solid rgb(59,59,59) — several steps louder than
// the #2C2C2C hairline that is supposed to be its only mark. Without this line
// "a field is drawn, not filled" is true of the CSS and false of the pixels.
// Every hand-rolled input in the app (ChatComposer, ChatHeader, the search and
// picker modals, DateTimeField) already writes it; the shared recipe was the
// one place that didn't — so the fields built from THIS file were the only
// filled ones in the app, which is the exact opposite of what it documents.
//
// It stays in BASE rather than EDGE so the resting fill is stated once for
// every variant, invalid included. `focus:bg-white/4` still wins on focus:
// Tailwind emits variant utilities after their plain counterparts, so the
// focus rule is later in the stylesheet regardless of class order here.
export const FIELD_BASE =
  'min-w-0 rounded-card border bg-transparent text-base text-text ' +
  'placeholder:text-faint/70 outline-none ' +
  'transition-[border-color,background-color,box-shadow] duration-150 ' +
  'motion-reduce:transition-none ' +
  'disabled:opacity-50 disabled:cursor-not-allowed'

// Resting edge + its hover/focus progression.
export const FIELD_EDGE =
  'border-line hover:border-line-2 ' +
  'focus:border-line-2 focus:bg-white/4 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20'

// Invalid overrides the edge entirely so the two can never stack ambiguously.
export const FIELD_EDGE_INVALID =
  'border-alert/50 hover:border-alert/60 focus:border-alert/70 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alert/30'

// Single-line height. Matches the app's 32px control step (h-8) so a field, a
// button and a select all line up in a row.
export const FIELD_SINGLE = 'h-8 px-2.5'
export const FIELD_MULTI = 'px-2.5 py-1.5 resize-none leading-[1.45]'

export function fieldClass(opts?: {
  invalid?: boolean
  multiline?: boolean
  /**
   * Most standalone controls fill their container. Compact controls that live
   * together in a flex row provide their own width/flex-basis instead.
   */
  fullWidth?: boolean
}): string {
  return [
    opts?.fullWidth === false ? '' : 'w-full',
    FIELD_BASE,
    opts?.invalid ? FIELD_EDGE_INVALID : FIELD_EDGE,
    opts?.multiline ? FIELD_MULTI : FIELD_SINGLE,
  ].join(' ')
}

// The label above a control. Identical position and metrics everywhere, and in
// the mono voice — a field label names a slot, which is structure.
export const FIELD_LABEL = 'eyebrow block leading-tight'

// The value line of a READ-ONLY row — deliberately not a disabled input, which
// would read as "you could edit this if something changed".
export const FIELD_VALUE = 'text-base break-words leading-snug'

// Row rhythm inside a grouped field card. The card draws the box; each row
// carries its own hairline, and the last one drops it.
export const FIELD_ROW = 'py-2 border-b border-line last:border-0'
