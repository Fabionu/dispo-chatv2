import { CircleUser } from 'lucide-react'
import type { Connection } from '../../lib/types'
import { useViewMode } from '../../lib/viewMode'
import Avatar from '../Avatar'

type Props = {
  connection: Connection
  selected: boolean
  onClick: () => void
}

// Pending requests always read as unread until handled — the dot persists
// even on the selected row so the operational state stays clear.
export default function ConnectionRequestRow({ connection, selected, onClick }: Props) {
  const viewMode = useViewMode()
  const peer = connection.otherUser

  // ── Normal view: the same breathable two-line row as a DM/GroupRow ─────────
  // 40px avatar; clean requester name on line 1 (no company), a quiet person
  // subtitle (email) on line 2 with the compact "Request" pill in the right-side
  // metadata slot — aligned to the same baseline as a DM's timestamp.
  if (viewMode === 'normal') {
    const NORMAL_AVATAR = 44
    return (
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-3 py-2.5 min-h-[3.875rem] rounded-chip text-left transition-colors ${
          selected ? 'bg-white/[0.06] text-text' : 'text-muted hover:bg-white/[0.025] hover:text-text'
        }`}
      >
        <span className="relative shrink-0 flex">
          <Avatar userId={peer.id} name={peer.displayName} size={NORMAL_AVATAR} />
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-px">
          {/* Line 1 — just the requester name, kept clean. */}
          <span className="flex items-center gap-2">
            <span className="flex-1 truncate text-[0.96875rem] leading-tight text-text font-semibold">
              {peer.displayName}
            </span>
          </span>
          {/* Line 2 — quiet person subtitle on the left; the "Request" pill on
              the right, where a DM row shows its timestamp. */}
          <span className="flex items-center gap-2">
            <span className="flex-1 truncate text-[0.875rem] leading-tight text-faint">{peer.email}</span>
            <span className="shrink-0 h-[1.1875rem] px-2 rounded-full bg-active/15 text-active text-[0.65625rem] font-semibold leading-none flex items-center justify-center">
              Request
            </span>
          </span>
        </span>
      </button>
    )
  }

  // ── Compact view: the original dense single line (unchanged) ───────────────
  return (
    <button
      onClick={onClick}
      style={{
        minHeight: 'var(--sidebar-row-height)',
        gap: 'var(--sidebar-row-gap)',
        paddingLeft: 'var(--sidebar-row-pad-x)',
        paddingRight: 'var(--sidebar-row-pad-x)',
        paddingTop: 'var(--sidebar-row-pad-y)',
        paddingBottom: 'var(--sidebar-row-pad-y)',
      }}
      className={`w-full flex items-center rounded-chip text-left transition-colors ${
        selected
          ? 'bg-white/[0.06] text-text'
          : 'text-muted hover:bg-white/[0.025] hover:text-text'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-active" />
      {/* Same leading glyph as a DM row (GroupRow uses CircleUser for `direct`),
          so a pending invitation reads as a person conversation in the rail. */}
      <span className="relative shrink-0 flex">
        <CircleUser
          strokeWidth={1.6}
          style={{ width: 'var(--sidebar-icon-size)', height: 'var(--sidebar-icon-size)' }}
          className="shrink-0 text-muted"
        />
      </span>
      <span
        className="flex-1 truncate text-text font-medium"
        style={{ fontSize: 'var(--sidebar-conv-font-size)' }}
      >
        {peer.displayName}
      </span>
      <span
        className="text-faint shrink-0 truncate max-w-[6rem]"
        style={{ fontSize: 'var(--sidebar-conv-meta-font-size)' }}
      >
        {peer.workspace.name}
      </span>
    </button>
  )
}
