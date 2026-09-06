import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTravellingMarker } from './useTravellingMarker'

// The chat window's open tools, as a tab bar with ONE underline that travels.
//
// Each tab used to carry its own drawn box — the live one took a hairline and
// full-brightness text, the rest were borderless. That is the per-item mark the
// travelling-marker idiom exists to replace (user, 2026-09-06: "apply the same
// under bar we have in the filter pills in the sidebar"): a box that appears on
// one tab and disappears from another reads as two separate things toggling,
// where one bar sliding across reads as the same object moving — which is what
// tells you the tabs belong to one control.
//
// The TRACK is an inner element, not the scrolling row. Enough attachment tabs
// and the row scrolls; an absolutely positioned marker inside a scroll container
// is placed in CONTENT coordinates, while `getBoundingClientRect` deltas are
// measured against the visible box, so the two disagree by exactly `scrollLeft`.
// A content-width track that does not scroll itself keeps the marker in the same
// frame it is measured in, and the outer row carries the whole thing sideways.
export function ChatToolTabs({
  activeKey,
  children,
}: {
  /** The live tool's id. Changes whenever the marker must re-measure. */
  activeKey: string
  children: ReactNode
}) {
  const { trackRef, rect } = useTravellingMarker(activeKey, '[data-tool-tab="active"]')

  return (
    <div className="shrink-0 h-9 px-3 flex items-center border-b border-line overflow-x-auto [scrollbar-width:none]">
      <div ref={trackRef} className="relative flex h-full min-w-max items-center gap-4">
        {children}
        {rect && (
          <span
            aria-hidden
            // Mounted only once a position is known — a transition has no
            // previous value to run from on the frame an element is inserted, so
            // the bar appears under the live tab and only travels on later
            // changes. Same rule, and the same class, as the rail's filter bar.
            className="travelling-marker pointer-events-none absolute left-0 top-0 h-0.5 bg-text motion-reduce:transition-none"
            style={{
              width: rect.w,
              transform: `translate(${rect.x}px, ${rect.y + rect.h - 1}px)`,
            }}
          />
        )}
      </div>
    </div>
  )
}

// One tab. No box of its own in any state: the bar above marks the live one, and
// the only other difference is text brightness.
//
// `data-tool-tab` rather than `aria-pressed` because the measured element has to
// be this whole wrapper — the bar should underline the × as well as the label —
// and a <div> cannot carry `aria-pressed`. The button inside states the
// selection for assistive tech.
export default function ToolTab({
  active,
  icon,
  label,
  onClick,
  onClose,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
  onClose?: () => void
}) {
  return (
    <div
      data-tool-tab={active ? 'active' : undefined}
      className={`eyebrow inline-flex h-full items-center gap-1.5 transition-colors ${
        // `.eyebrow` sets this label's colour and ties on specificity with a
        // `text-*` utility, so the live state is stated the same way the rail's
        // tabs state theirs — see `.filter-tab-active` in index.css.
        active ? 'filter-tab-active' : 'hover:text-text'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        {icon}
        {label}
      </button>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${label}`}
          className="rounded-btn h-4 w-4 flex items-center justify-center text-muted hover:text-text hover:bg-white/8 transition-colors"
        >
          <X size="0.6875rem" strokeWidth={2.2} />
        </button>
      )}
    </div>
  )
}
