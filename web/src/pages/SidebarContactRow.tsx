import type { WorkspaceMember } from '../lib/types'
import Avatar from '../components/Avatar'
import { useViewMode } from '../lib/viewMode'

// One company colleague who has no open DM yet, shown inline in the unified rail
// list (All + DMs filters). Visually a quiet people-row (avatar + name) matching
// the rail's row metrics; clicking it opens or creates a DM. No unread/presence
// affordances — it's a directory entry. Once a DM exists the colleague renders as
// a full conversation row (GroupRow) instead, so they never appear twice.
export default function ContactRow({
  member,
  size,
  onClick,
}: {
  member: WorkspaceMember
  size: number
  onClick: () => void
}) {
  const viewMode = useViewMode()

  // ── Normal view: the same breathable row as a DM/GroupRow ──────────────────
  // 40px avatar, clean name on line 1, a quiet role subtitle on line 2. No
  // company name and no timestamp (a contact has no thread yet), so the name
  // row stays clean and the preview line's right side is simply empty.
  if (viewMode === 'normal') {
    const NORMAL_AVATAR = 44
    const role = member.role ? member.role.charAt(0).toUpperCase() + member.role.slice(1) : ''
    return (
      <button
        onClick={onClick}
        title={`Message ${member.displayName}`}
        className="w-full flex items-center gap-3 px-3 py-2.5 min-h-[3.875rem] rounded-chip text-left text-muted hover:bg-white/[0.025] hover:text-text transition-colors"
      >
        <Avatar userId={member.id} name={member.displayName} size={NORMAL_AVATAR} />
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="flex-1 truncate text-[0.96875rem] text-text/90">{member.displayName}</span>
          </span>
          {role && (
            <span className="flex items-center gap-2">
              <span className="flex-1 truncate text-[0.875rem] text-faint">{role}</span>
            </span>
          )}
        </span>
      </button>
    )
  }

  // ── Compact view: the original quiet single-line directory entry ───────────
  return (
    <button
      onClick={onClick}
      title={`Message ${member.displayName}`}
      style={{
        minHeight: 'var(--sidebar-row-height)',
        gap: 'var(--sidebar-row-gap)',
        paddingLeft: 'var(--sidebar-row-pad-x)',
        paddingRight: 'var(--sidebar-row-pad-x)',
        paddingTop: 'var(--sidebar-row-pad-y)',
        paddingBottom: 'var(--sidebar-row-pad-y)',
      }}
      className="w-full flex items-center rounded-chip text-left text-muted hover:bg-white/[0.025] hover:text-text transition-colors"
    >
      <Avatar userId={member.id} name={member.displayName} size={size} />
      <span className="min-w-0 flex-1 truncate" style={{ fontSize: 'var(--sidebar-conv-font-size)' }}>
        {member.displayName}
      </span>
    </button>
  )
}
