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
      className={`w-full flex items-center gap-2 pl-2 pr-2 py-1.5 rounded-chip text-left transition-colors ${
        selected ? 'bg-white/[0.06] text-text' : 'text-muted hover:bg-white/[0.025] hover:text-text'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-active" />
      <Users size={15} strokeWidth={1.6} className="shrink-0 text-faint" />
      <span className="flex-1 truncate text-[13px] text-text font-medium">
        {invite.groupName ?? 'Vehicle group'}
      </span>
      {invite.tractorPlate && (
        <span className="font-mono text-[10px] text-faint shrink-0">{invite.tractorPlate}</span>
      )}
    </button>
  )
}
