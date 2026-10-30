import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTravellingMarker } from '../useTravellingMarker'
import { RowMeta } from '../../pages/sidebarBits'

// The section vocabulary of the reworked rail panels (Workspace settings,
// Account, My profile) and of Group info: a drill-in row, a titled block with
// one line of why, and the neutral controls those blocks hold. Kept here so
// every panel speaks the same pieces instead of each growing a copy.

// A drill-in row: drawn tile, name over its live value, chevron. Rows sit on
// the rail's own field (no card around them), like the conversation rows.
export function NavRow({
  icon,
  title,
  value,
  onClick,
  trailing,
  tag,
}: {
  icon: ReactNode
  title: string
  value: string[]
  onClick: () => void
  /** A quiet tag beside the title — who the row is for ("Admin"). */
  tag?: string
  /** Replaces the chevron — e.g. a window glyph for a row that opens a window. */
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-card px-3 py-2.5 text-left transition-colors hover:bg-white/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      <span className="flex h-[2.375rem] w-[2.375rem] shrink-0 items-center justify-center rounded-tile border border-line text-muted transition-colors group-hover:text-text">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-lg font-semibold leading-tight">
          {title}
          {tag && (
            <span className="rounded-btn border border-line px-1.5 py-px text-xs font-medium text-faint">{tag}</span>
          )}
        </span>
        <span className="mt-1 block text-muted">
          <RowMeta segments={value} whole />
        </span>
      </span>
      {trailing ?? (
        <ChevronRight
          size="1rem"
          strokeWidth={1.8}
          className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-muted"
        />
      )}
    </button>
  )
}

// One block of a detail view: title, one line of why, then the control. Blocks
// are separated by a hairline; the last one is open at the bottom.
export function SettingsSection({
  title,
  description,
  aside,
  action,
  last = false,
  children,
}: {
  title: string
  description?: ReactNode
  /** Quiet trailing text on the title line (a count). */
  aside?: ReactNode
  /** A control at the end of the title line (Edit, Change …). */
  action?: ReactNode
  last?: boolean
  children: ReactNode
}) {
  return (
    <section className={`flex flex-col gap-3 py-5 ${last ? '' : 'border-b border-line'}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="text-lg font-semibold">{title}</h3>
            {aside && <span className="text-base text-muted">{aside}</span>}
          </div>
          {description && <p className="mt-1 text-base leading-[1.45] text-muted">{description}</p>}
        </div>
        {action && <div className="-my-1 shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  )
}

// The quiet text button a section or row uses for its one action (Edit,
// Change, Cancel invite). `tone="alert"` for the destructive ones.
export function TextAction({
  children,
  onClick,
  tone = 'default',
  disabled = false,
  label,
}: {
  children: ReactNode
  onClick: () => void
  tone?: 'default' | 'alert'
  disabled?: boolean
  /** aria-label when the visible word needs its object ("Edit job title"). */
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`h-8 shrink-0 rounded-btn px-2.5 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50 ${
        tone === 'alert' ? 'text-alert hover:bg-alert/10' : 'text-muted hover:bg-white/6 hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

// The selection mark of every single-choice list in settings: a ring that
// fills to a thick edge when chosen. Round because it IS a radio — and the
// whole of the reworked settings speaks it, so it no longer stands alone.
export function RadioMark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`box-border inline-block h-4 w-4 shrink-0 rounded-full align-middle transition-[border-width,border-color] duration-150 motion-reduce:transition-none ${
        on ? 'border-[5px] border-text' : 'border-[1.5px] border-faint'
      }`}
    />
  )
}

// An on/off setting. A sliding track (the one place `rounded-full` is a
// control): white with a dark knob when on, a quiet track when off.
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[1.625rem] w-[2.75rem] shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-text' : 'bg-white/10'
      }`}
    >
      <span
        className={`absolute top-[0.1875rem] h-5 w-5 rounded-full transition-all motion-reduce:transition-none ${
          checked ? 'left-[1.3125rem] bg-bg' : 'left-[0.1875rem] bg-muted'
        }`}
      />
    </button>
  )
}

// The app's neutral segmented control: a recessed track where the selected
// option is a solid `bg-text` block with `text-bg` on it (inverting per theme
// for free). The selected block TRAVELS between options (useTravellingMarker).
// `fill` spreads the options over the full width in equal columns — the
// settings details use that, so a four-way choice reads as one control. An
// option's `dot` draws its colour before the label (availability).
export function Segmented({
  value,
  options,
  onChange,
  fill = false,
  label,
}: {
  value: string
  options: { value: string; label: string; dot?: string }[]
  onChange: (value: string) => void
  fill?: boolean
  /** Names the group for assistive tech. */
  label?: string
}) {
  const { trackRef, rect } = useTravellingMarker(value)

  return (
    <div
      ref={trackRef}
      role="group"
      aria-label={label}
      className={`relative items-center gap-0.5 rounded-card bg-white/4 p-0.5 ${fill ? 'grid w-full' : 'inline-flex'}`}
      style={fill ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}
    >
      {rect && (
        <span
          aria-hidden
          className="travelling-marker pointer-events-none absolute left-0 top-0 rounded-btn bg-text motion-reduce:transition-none"
          style={{
            width: rect.w,
            height: rect.h,
            transform: `translate(${rect.x}px, ${rect.y}px)`,
          }}
        />
      )}
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            // `aria-current` is what the marker measures; `aria-pressed` stays
            // because that is what makes these read as a toggle group.
            aria-current={active ? 'true' : undefined}
            className={`relative z-10 flex min-w-0 items-center justify-center gap-2 rounded-btn font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
              fill ? 'h-8 px-1.5 text-base' : 'h-6 px-2.5 text-xs'
            } ${active ? 'text-bg' : 'text-muted hover:text-text'}`}
          >
            {o.dot && (
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: o.dot }} />
            )}
            <span className="truncate">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
