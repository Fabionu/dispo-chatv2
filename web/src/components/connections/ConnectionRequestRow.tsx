import { CircleUser } from 'lucide-react'
import type { Connection } from '../../lib/types'

type Props = {
  connection: Connection
  selected: boolean
  onClick: () => void
}

// Pending requests always read as unread until handled — the dot persists
// even on the selected row so the operational state stays clear.
export default function ConnectionRequestRow({ connection, selected, onClick }: Props) {
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
        style={{ fontSize: 'var(--sidebar-row-font-size)' }}
      >
        {connection.otherUser.displayName}
      </span>
      <span
        className="text-faint shrink-0 truncate max-w-[96px]"
        style={{ fontSize: 'var(--sidebar-meta-font-size)' }}
      >
        {connection.otherUser.workspace.name}
      </span>
    </button>
  )
}
