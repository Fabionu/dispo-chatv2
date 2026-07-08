import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Connection } from '../../lib/types'
import ConnectionRequestRow from './ConnectionRequestRow'

type Props = {
  pendingReceived: Connection[]
  // The last connections fetch failed. We keep whatever rows we already had and
  // show a compact, retryable error line rather than hiding the section (this is
  // also why an errored, empty section still renders — see the early return).
  error: boolean
  onRetry: () => void
  selectedId: string | null
  onSelect: (connectionId: string) => void
  // Identity-slot diameter in design px (tracks display density).
  size: number
}

// Collapsible "Connection requests" rail section. Owns its own open/closed
// state so Workspace.tsx doesn't have to. Auto-expands the first time a
// pending request appears; after the user toggles it manually we stop
// overriding their preference.
export default function ConnectionRequestsSection({
  pendingReceived,
  error,
  onRetry,
  selectedId,
  onSelect,
  size,
}: Props) {
  const [open, setOpen] = useState(false)
  const toggledRef = useRef(false)
  const count = pendingReceived.length

  useEffect(() => {
    if (toggledRef.current) return
    if (count > 0) setOpen(true)
  }, [count])

  function toggle() {
    toggledRef.current = true
    setOpen((v) => !v)
  }

  // Nothing pending → render no section at all (no header, chevron, badge, or
  // reserved spacing). The one exception is a failed fetch: keep the section so
  // its retryable error line stays reachable. Placed after the hooks so the
  // component stays mounted and preserves the user's collapse preference across
  // count changes (a live-arriving request re-shows it exactly as before).
  if (count === 0 && !error) return null

  return (
    <div>
      <button
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-2 mb-1.5 py-0.5 rounded-chip hover:bg-white/[0.02] transition-colors"
      >
        <ChevronDown
          size="0.6875rem"
          strokeWidth={2}
          className={`text-faint shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
        />
        <span
          className="eyebrow flex-1 text-left"
          style={{ fontSize: 'var(--sidebar-section-font-size)' }}
        >
          Connection requests
        </span>
        {count > 0 && (
          <span className="font-mono text-[0.65625rem] font-semibold bg-active text-bg rounded-full min-w-[1.0625rem] h-[1.0625rem] px-1 flex items-center justify-center shrink-0">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-0.5">
          {/* The section only renders with pending rows OR a fetch error (see the
              early return above), so the sole status line left is the retryable
              error — shown above whatever rows we already had, so a failed
              refresh never hides existing data. */}
          {error && (
            <div className="flex items-center justify-between gap-2 px-2 py-1 text-[0.75rem] leading-[1.45]">
              <span className="text-alert">Couldn’t load requests.</span>
              <button
                type="button"
                onClick={onRetry}
                className="text-muted hover:text-text underline underline-offset-2 shrink-0 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {count > 0 &&
            pendingReceived.map((c) => (
              <ConnectionRequestRow
                key={c.id}
                connection={c}
                selected={selectedId === c.id}
                size={size}
                onClick={() => onSelect(c.id)}
              />
            ))}
        </div>
      )}
    </div>
  )
}
