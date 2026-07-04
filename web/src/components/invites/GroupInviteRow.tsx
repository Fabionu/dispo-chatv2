import { Users } from 'lucide-react'
import type { GroupInvite } from '../../lib/types'

type Props = {
  invite: GroupInvite
  selected: boolean
  onClick: () => void
}

// One pending vehicle-group invite in the sidebar. Reads as unread (active dot)
// until handled, mirroring the connection-request row, but uses the group glyph
// and shows the tractor plate as the secondary detail.
export default function GroupInviteRow({ invite, selected, onClick }: Props) {
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
        selected ? 'bg-white/[0.06] text-text' : 'text-muted hover:bg-white/[0.025] hover:text-text'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-active" />
      <Users
        strokeWidth={1.6}
        className="shrink-0 text-faint"
        style={{ width: 'var(--sidebar-icon-size)', height: 'var(--sidebar-icon-size)' }}
      />
      <span
        className="flex-1 truncate text-text font-medium"
        style={{ fontSize: 'var(--sidebar-conv-font-size)' }}
      >
        {invite.groupName ?? 'Vehicle group'}
      </span>
      {invite.tractorPlate && (
        <span
          className="font-mono text-faint shrink-0"
          style={{ fontSize: 'var(--sidebar-conv-meta-font-size)' }}
        >
          {invite.tractorPlate}
        </span>
      )}
    </button>
  )
}
