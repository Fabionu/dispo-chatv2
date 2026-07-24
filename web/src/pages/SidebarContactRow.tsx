import type { WorkspaceMember } from '../lib/types'
import Avatar from '../components/Avatar'
import IdentitySlot from '../components/IdentitySlot'

// One company colleague who has no open DM yet, shown inline in the unified rail
// list (All + Direct filters). A quiet people-row (circular avatar + name)
// matching the conversation-row metrics; clicking it opens the user's profile
// modal, whose Message action opens or creates a DM. No
// unread/presence affordances — it's a directory entry. Once a DM exists the
// colleague renders as a full conversation row (GroupRow) instead, so they never
// appear twice.
export default function ContactRow({
  member,
  size,
  onClick,
}: {
  member: WorkspaceMember
  size: number
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
      className="w-full flex items-center rounded-btn text-left text-muted hover:bg-white/[0.07] hover:text-text transition-colors"
    >
      <IdentitySlot>
        <Avatar userId={member.id} name={member.displayName} size={size} />
      </IdentitySlot>
      <span className="min-w-0 flex-1 flex flex-col gap-px">
        <span
          className="truncate leading-tight text-text/90 font-medium"
          style={{ fontSize: 'var(--sidebar-conv-font-size)' }}
        >
          {member.displayName}
        </span>
        {role && (
          <span
            className="truncate leading-tight text-faint"
            style={{ fontSize: 'var(--sidebar-conv-meta-font-size)' }}
          >
            {role}
          </span>
        )}
      </span>
    </button>
  )
}
