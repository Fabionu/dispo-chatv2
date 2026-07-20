import type { GroupInvite } from '../../lib/types'
import GroupAvatar from '../GroupAvatar'
import IdentitySlot from '../IdentitySlot'

type Props = {
  invite: GroupInvite
  // Identity-slot diameter in design px (tracks display density).
  size: number
  selected: boolean
  onClick: () => void
}

// One pending vehicle-group invite in the sidebar. Uses the same rounded-square
// vehicle identity slot as a real vehicle-room row (so an invite reads as a room,
// not a person) and shows the tractor plate as the quiet secondary detail.
export default function GroupInviteRow({ invite, size, selected, onClick }: Props) {
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
        <GroupAvatar shape="rounded" size={size} />
      </IdentitySlot>
      <span className="flex-1 min-w-0 flex flex-col gap-px">
        <span
          className="truncate leading-tight text-text font-semibold"
          style={{ fontSize: 'var(--sidebar-conv-font-size)' }}
        >
          {invite.groupName ?? 'Vehicle group'}
        </span>
        <span className="flex items-center gap-2">
          <span
            className="flex-1 min-w-0 truncate leading-tight font-mono text-faint"
            style={{ fontSize: 'var(--sidebar-conv-meta-font-size)' }}
          >
            {invite.tractorPlate ?? 'Pending invitation'}
          </span>
          <span className="shrink-0 h-[1.0625rem] px-1.5 rounded-full bg-white/[0.07] text-muted text-[0.625rem] font-semibold leading-none flex items-center justify-center">
            Invite
          </span>
        </span>
      </span>
    </button>
  )
}
