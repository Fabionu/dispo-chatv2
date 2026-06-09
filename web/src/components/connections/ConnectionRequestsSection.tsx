import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Connection } from '../../lib/types'
import ConnectionRequestRow from './ConnectionRequestRow'

type Props = {
  pendingReceived: Connection[]
  // True while the initial connections fetch is in flight. Surfaced as a compact
  // "Loading requests…" line only when there's nothing to show yet, so a silent
  // background refresh (which keeps the existing rows) never flashes it.
  loading: boolean
  // The last connections fetch failed. We keep whatever rows we already had and
  // show a compact, retryable error line rather than hiding the section.
  error: boolean
  onRetry: () => void
  selectedId: string | null
  onSelect: (connectionId: string) => void
}

// Collapsible "Connection requests" rail section. Owns its own open/closed
// state so Workspace.tsx doesn't have to. Auto-expands the first time a
// pending request appears; after the user toggles it manually we stop
// overriding their preference.
export default function ConnectionRequestsSection({
  pendingReceived,
  loading,
  error,
  onRetry,
  selectedId,
  onSelect,
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

  return (
    <div>
      <button
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-2 mb-1.5 py-0.5 rounded-chip hover:bg-white/[0.02] transition-colors"
      >
        <ChevronDown
          size={10}
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
          <span className="font-mono text-[10px] font-semibold bg-active text-bg rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center shrink-0">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-0.5">
          {/* Status line: error (with retry) takes precedence; otherwise a
              first-load spinner-less hint, otherwise the empty copy. Existing
              rows below are kept regardless, so an error never hides data. */}
          {error ? (
            <div className="flex items-center justify-between gap-2 px-2 py-1 text-[11.5px] leading-[1.45]">
              <span className="text-alert">Couldn’t load requests.</span>
              <button
                type="button"
                onClick={onRetry}
                className="text-muted hover:text-text underline underline-offset-2 shrink-0 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : loading && count === 0 ? (
            <div className="text-[11.5px] text-faint px-2 py-1 leading-[1.45]">
              Loading requests…
            </div>
          ) : count === 0 ? (
            <div className="text-[11.5px] text-faint px-2 py-1 leading-[1.45]">
              No pending connection invitations.
            </div>
          ) : null}

          {count > 0 &&
            pendingReceived.map((c) => (
              <ConnectionRequestRow
                key={c.id}
                connection={c}
                selected={selectedId === c.id}
                onClick={() => onSelect(c.id)}
              />
            ))}
        </div>
      )}
    </div>
  )
}
