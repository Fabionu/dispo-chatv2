import type { Connection } from '../../lib/types'
import { RowMeta, RowTile } from '../../pages/sidebarBits'

type Props = {
  connection: Connection
  selected: boolean
  onClick: () => void
}

// One pending cross-company connection request in the rail. Reads as actionable
// until handled: the name in full-strength text over the requester's email, and
// a quiet "Request" marker on the right where a conversation row shows its time.
// Matches the single conversation-row layout.
export default function ConnectionRequestRow({ connection, selected, onClick }: Props) {
  const peer = connection.otherUser
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
      className={`w-full flex items-center border-l-2 text-left transition-colors ${
        selected
          ? 'border-text bg-white/8 text-text'
          : 'border-transparent text-muted hover:bg-white/8 hover:text-text'
      }`}
    >
      <RowTile kind="user" id={peer.id} name={peer.displayName} />
      <span className="flex-1 min-w-0 flex flex-col gap-px">
        <span
          className="truncate leading-tight text-text font-semibold"
          style={{ fontSize: 'var(--sidebar-conv-font-size)' }}
        >
          {peer.displayName}
        </span>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1">
            <RowMeta segments={[peer.email]} />
          </span>
          <span className="eyebrow shrink-0 border px-1.5 py-0.5 leading-none">Request</span>
        </span>
      </span>
    </button>
  )
}
