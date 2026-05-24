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
      className={`w-full flex items-center gap-2 pl-2 pr-2 py-1.5 rounded-chip text-left transition-colors ${
        selected
          ? 'bg-white/[0.06] text-text'
          : 'text-muted hover:bg-white/[0.025] hover:text-text'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-active" />
      <span className="flex-1 truncate text-[13px] text-text font-medium">
        {connection.otherUser.displayName}
      </span>
      <span className="text-[10.5px] text-faint shrink-0 truncate max-w-[96px]">
        {connection.otherUser.workspace.name}
      </span>
    </button>
  )
}
