import type { GroupInvite } from '../../lib/types'
import { RowMeta, RowTile } from '../../pages/sidebarBits'

type Props = {
  invite: GroupInvite
  selected: boolean
  onClick: () => void
}

// One pending vehicle-group invite in the sidebar. Same shape as a real
// vehicle-room row, tile included — but the tile is always the generic room
// glyph: `hasAvatar` is deliberately not passed, because you are not a member of
// this group yet and the avatar endpoint is member-gated. Asking would buy a
// guaranteed 403 for every invite in the list.
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
      className={`w-full flex items-center border-l-2 text-left transition-colors ${
        selected
          ? 'border-text bg-white/8 text-text'
          : 'border-transparent text-muted hover:bg-white/8 hover:text-text'
      }`}
    >
      <RowTile kind="group" id={invite.groupId} />
      <span className="flex-1 min-w-0 flex flex-col gap-px">
        <span
          className="truncate leading-tight text-text font-semibold"
          style={{ fontSize: 'var(--sidebar-conv-font-size)' }}
        >
          {invite.groupName ?? 'Vehicle group'}
        </span>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1">
            <RowMeta segments={[invite.tractorPlate ?? 'Pending invitation']} />
          </span>
          <span className="eyebrow shrink-0 border px-1.5 py-0.5 leading-none">Invite</span>
        </span>
      </span>
    </button>
  )
}
