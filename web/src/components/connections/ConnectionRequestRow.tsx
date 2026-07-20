import type { Connection } from '../../lib/types'
import Avatar from '../Avatar'
import IdentitySlot from '../IdentitySlot'

type Props = {
  connection: Connection
  selected: boolean
  // Identity-slot diameter in design px (tracks display density).
  size: number
  onClick: () => void
}

// One pending cross-company connection request in the rail. Reads as actionable
// until handled: a circular requester avatar, the name in full-strength text,
// and a quiet "Request" marker on the right where a conversation row shows its
// time. Matches the single conversation-row layout.
export default function ConnectionRequestRow({ connection, selected, size, onClick }: Props) {
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
      className={`w-full flex items-center rounded-btn text-left transition-colors ${
        selected
          ? 'bg-white/[0.075] text-text'
          : 'text-muted hover:bg-white/[0.07] hover:text-text'
      }`}
    >
      <IdentitySlot>
        <Avatar userId={peer.id} name={peer.displayName} size={size} />
      </IdentitySlot>
      <span className="flex-1 min-w-0 flex flex-col gap-px">
        <span
          className="truncate leading-tight text-text font-semibold"
          style={{ fontSize: 'var(--sidebar-conv-font-size)' }}
        >
          {peer.displayName}
        </span>
        <span className="flex items-center gap-2">
          <span
            className="flex-1 min-w-0 truncate leading-tight text-faint"
            style={{ fontSize: 'var(--sidebar-conv-meta-font-size)' }}
          >
            {peer.email}
          </span>
          <span className="shrink-0 h-[1.0625rem] px-1.5 rounded-full bg-white/[0.07] text-muted text-[0.625rem] font-semibold leading-none flex items-center justify-center">
            Request
          </span>
        </span>
      </span>
    </button>
  )
}
