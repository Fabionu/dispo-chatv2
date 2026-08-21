import type { WorkspaceMember } from '../lib/types'
import { RowMeta } from './sidebarBits'

// One company colleague who has no open DM yet, shown inline in the unified rail
// list (All + Direct filters). Name over their role in the mono meta line,
// matching the conversation-row metrics; clicking it opens the user's profile
// modal, whose Message action opens or creates a DM. No unread/presence
// affordances — it's a directory entry. Once a DM exists the colleague renders
// as a full conversation row (GroupRow) instead, so they never appear twice.
export default function ContactRow({
  member,
  onClick,
}: {
  member: WorkspaceMember
  onClick: () => void
}) {
  const role = member.role ? member.role.charAt(0).toUpperCase() + member.role.slice(1) : ''
  return (
    <button
      onClick={onClick}
      title={`View ${member.displayName}'s profile`}
      aria-label={`View ${member.displayName}'s profile`}
      style={{
        minHeight: 'var(--sidebar-row-height)',
        gap: 'var(--sidebar-row-gap)',
        paddingLeft: 'var(--sidebar-row-pad-x)',
        paddingRight: 'var(--sidebar-row-pad-x)',
        paddingTop: 'var(--sidebar-row-pad-y)',
        paddingBottom: 'var(--sidebar-row-pad-y)',
      }}
      className="w-full flex items-center border-l-2 border-transparent text-left text-muted hover:bg-white/8 hover:text-text transition-colors"
    >
      <span className="min-w-0 flex-1 flex flex-col gap-px">
        <span
          className="truncate leading-tight text-text/90 font-medium"
          style={{ fontSize: 'var(--sidebar-conv-font-size)' }}
        >
          {member.displayName}
        </span>
        <RowMeta segments={[role]} />
      </span>
    </button>
  )
}
