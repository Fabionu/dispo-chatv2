// Thread chrome — the drawing vocabulary of the reworked timeline.
//
// The rework removed every tone step and every shadow, so a message is no
// longer a shape sitting on a surface; it is a LABEL, a RULE and an INDENT.
// Anything structured a message wants to show — a route, a load, a cost
// breakdown, a trip — is drawn with the pieces below rather than by inventing
// another bordered div per feature. Three parts:
//
//   Attribution  the mono uppercase name + time row that leads every message.
//   DataBlock    a bordered block INSIDE a message: header row → content →
//                stats → notices, each separated by a hairline.
//   ThreadAction the mono uppercase text buttons (copy, send to driver, …)
//                that fade in on hover.
//
// Sizing note: everything here is on the mono tokens (--msg-label-size,
// --stat-value-size), not the rem type scale — see the note in
// tailwind.config.js about why chat/thread text is deliberately off it.

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

// A person's NAME, as opposed to everything else on the attribution row.
//
// It used to be an `.eyebrow` like the timestamp and the status flags beside
// it, which meant uppercase and 0.14em of tracking — and a name is the one
// thing on that row those two are wrong for. Tracking is for short structural
// labels where the letters are a code to be picked apart; a name is a word you
// read whole, and spacing it out makes you spell it instead. Uppercase throws
// away the capital that tells you it IS a name, and takes the ascenders and
// descenders that make one recognisable at a glance with it.
//
// So the name is sans, its own case, normal tracking — the same call the rail
// made for conversation names, for the same reason: mono and tracked, every row
// read as a serial number rather than as a person. The timestamp and the status
// flags stay `.eyebrow`, because those ARE structure.
//
// One more thing falls out of leaving `.eyebrow`: `text-muted` finally applies.
// It was always on the name and never won — `.eyebrow` sets a colour too, and
// at equal specificity the later rule took it — so the name had been rendering
// at exactly the same `faint` as the clock next to it. Now it sits a step
// brighter, which is the hierarchy the row was written for.
const NAME_TYPE = 'text-[length:var(--msg-author-size)] font-medium text-muted'

// ── Attribution ─────────────────────────────────────────────────────────────
// The row that identifies a message. Sits above the body, inside the indent,
// so name and text share a left edge. `time` is pushed to sit right after the
// name rather than to the far right: at a 62ch measure a right-aligned time
// would float an unreadable distance away from the name it belongs to.
export function Attribution({
  name,
  time,
  trailing,
  onNameClick,
  alignEnd = false,
}: {
  name: string
  time?: string
  // Status glyphs (edited, pinned, delivery ticks) — anything that belongs to
  // the message's identity rather than to its content.
  trailing?: ReactNode
  // Opens the author's profile. With avatars gone from the timeline, the name
  // IS the profile affordance, so it becomes a real button when there's a
  // profile to open (and stays plain text when there isn't — my own rows).
  onNameClick?: () => void
  // Own messages sit on the right of the column with their rule on the right
  // edge, so their label row has to hang off that edge too.
  alignEnd?: boolean
}) {
  // The gap to the body is BOTH of the numbers below, and most of it used to be
  // the one that is invisible in the markup. `.eyebrow` inherits the app's
  // line-height, so an 11px label sat in a 16.5px line box — 2.75px of dead
  // leading under the glyphs — and the body's own 1.6 line-height adds ~4px of
  // half-leading above its first line. Against those ~7px of leading a 6px
  // margin was doing less than half the work, and the label read as floating
  // between two messages rather than belonging to the one under it.
  //
  // `leading-none` makes the label's box its glyphs (uppercase mono has no
  // descenders to clip, and the row is `items-center`, so the trailing ticks
  // and pin glyph are unaffected), which leaves the margin as the only spacing
  // and therefore the only thing to tune. Measured: the label's box drops from
  // 16.5px to 11px and the gap under it from 7.4px to 5px, so the distance from
  // the top of the name to the top of the message closes by a third.
  return (
    <div
      // gap-1.5, down from gap-2.5. The name and the time are one statement —
      // who, and when — and at 10px apart they read as two separate labels that
      // happened to land on the same line. The same gap carries the status
      // flags and the delivery ticks after them, which want to sit close to the
      // time they qualify rather than drift toward the middle of the row.
      className={`flex items-center gap-1.5 mb-1 leading-none select-none ${
        alignEnd ? 'justify-end' : ''
      }`}
    >
      {onNameClick ? (
        <button
          type="button"
          onClick={onNameClick}
          className={`${NAME_TYPE} transition-colors hover:text-text focus-visible:outline-none focus-visible:underline focus-visible:underline-offset-4`}
        >
          {name}
        </button>
      ) : (
        <span className={NAME_TYPE}>{name}</span>
      )}
      {time ? <span className="eyebrow eyebrow-time">{time}</span> : null}
      {trailing}
    </div>
  )
}

// ── Data block ──────────────────────────────────────────────────────────────
// The bordered block a message renders structured data into. It owns only its
// outer hairline; every internal division is a border on the child, so blocks
// compose in any order without doubling rules.
export function DataBlock({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`border ${className}`}>{children}</div>
}

// Header row: mono eyebrow on the left (optionally glyph-led), mono meta on the
// right. The right slot is where a timestamp, a status or a count goes.
export function DataBlockHead({
  icon: Icon,
  label,
  meta,
}: {
  icon?: LucideIcon
  label: string
  meta?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 border-b px-4 py-2.5">
      {Icon ? <Icon size="0.875rem" strokeWidth={1.6} className="text-faint shrink-0" /> : null}
      <span className="eyebrow min-w-0 truncate">{label}</span>
      {meta ? <span className="eyebrow ml-auto shrink-0">{meta}</span> : null}
    </div>
  )
}

// Free content region — diagrams, corridors, rows. Padded to match the header.
export function DataBlockBody({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`px-4 py-4 ${className}`}>{children}</div>
}

// ── Stats ───────────────────────────────────────────────────────────────────
// Equal columns split by 1px vertical hairlines. The splitting is done by the
// `.data-stats` rule in index.css (`> * + *`), which also handles the wrap to
// two-up in a narrow thread — see the comment there.
export function DataStats({ children }: { children: ReactNode }) {
  return <div className="data-stats border-t">{children}</div>
}

// One cell: mono eyebrow label above a mono value. `unit` rides the value at
// eyebrow size so "1 042 km" reads as one number with a unit rather than as
// two competing figures.
export function DataStat({
  label,
  value,
  unit,
}: {
  label: string
  value: ReactNode
  unit?: string
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="eyebrow truncate">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1 font-mono text-[length:var(--stat-value-size)] font-medium tabular-nums text-text">
        <span className="min-w-0 truncate">{value}</span>
        {unit ? <span className="shrink-0 text-xs lowercase text-faint">{unit}</span> : null}
      </div>
    </div>
  )
}

// ── Notice ──────────────────────────────────────────────────────────────────
// A warning or advisory attached to a block: glyph, sans title, muted body, and
// an optional mono chip carrying the window/limit the notice is about.
export function DataNotice({
  icon: Icon,
  title,
  children,
  chip,
  tone = 'default',
}: {
  icon: LucideIcon
  title: string
  children?: ReactNode
  chip?: ReactNode
  // `alert` is for a notice that blocks the plan (a ban, an over-limit); the
  // default tone is for one that merely shapes it.
  tone?: 'default' | 'alert'
}) {
  return (
    <div className="flex gap-3 border-t px-4 py-3.5">
      <Icon
        size="1rem"
        strokeWidth={1.6}
        className={`mt-0.5 shrink-0 ${tone === 'alert' ? 'text-alert' : 'text-faint'}`}
      />
      <div className="min-w-0">
        <div className="text-base font-medium text-text">{title}</div>
        {children ? (
          <div className="mt-1.5 max-w-body text-base leading-[1.55] text-muted">{children}</div>
        ) : null}
        {chip ? <div className="mt-2.5">{chip}</div> : null}
      </div>
    </div>
  )
}

// ── Chip ────────────────────────────────────────────────────────────────────
// A bordered mono token: a time window, a status, an ADR class, a tag. Square,
// hairline, no fill — the same rule vocabulary as everything else.
export function DataChip({
  children,
  dot,
}: {
  children: ReactNode
  // A leading dot for chips that carry a live state (loaded, en route, ADR).
  dot?: boolean
}) {
  return (
    <span className="eyebrow inline-flex items-center gap-1.5 border px-2 py-1 text-muted">
      {dot ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      ) : null}
      {children}
    </span>
  )
}

// ── Action ──────────────────────────────────────────────────────────────────
// Message actions are mono uppercase TEXT, never icon buttons on a fill. They
// are invisible until the message is hovered or something inside it is
// keyboard-focused, so a quiet thread stays quiet.
//
// opacity-0 (not hidden) is deliberate: they stay reachable by Tab, and
// `focus-visible:opacity-100` brings them back for keyboard users, who get no
// hover event at all.
export function ThreadAction({
  icon: Icon,
  children,
  onClick,
  title,
}: {
  icon?: LucideIcon
  children: ReactNode
  onClick: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="eyebrow inline-flex items-center gap-1.5 whitespace-nowrap opacity-0 transition-opacity duration-150 hover:text-text focus-visible:opacity-100 focus-visible:outline-none focus-visible:underline focus-visible:underline-offset-4 group-hover:opacity-100"
    >
      {Icon ? <Icon size="0.75rem" strokeWidth={1.7} className="shrink-0" /> : null}
      {children}
    </button>
  )
}

// The strip the actions live in — ABSOLUTE, hanging in the gap below the
// message rather than sitting in its flow.
//
// In flow it reserved ~30px of height even while invisible, and since the rule
// is drawn by the message's own border, that reserved space made every rule run
// a couple of lines past the text it belonged to. Out of flow, the rule stops
// exactly where the content does, and the strip still costs nothing to reveal
// because it never occupied space to begin with. It lands in the inter-message
// margin, which is empty and already there.
//
// `side` is the side the message's rule is on, so the strip aligns to the same
// edge as the text above it.
export function ThreadActions({
  children,
  side = 'left',
}: {
  children: ReactNode
  side?: 'left' | 'right'
}) {
  return (
    <div
      className={`absolute top-full z-10 mt-1 flex items-center gap-x-5 ${
        side === 'right' ? 'right-[var(--msg-indent)]' : 'left-[var(--msg-indent)]'
      }`}
    >
      {children}
    </div>
  )
}
