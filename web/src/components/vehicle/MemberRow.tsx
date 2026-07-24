import { useEffect, useRef, useState } from 'react'
import { MoreVertical } from 'lucide-react'
import type { GroupMember } from '../../lib/types'
import { statusMeta, OFFLINE } from '../../lib/availability'
import Avatar from '../Avatar'
import Spinner from '../Spinner'
import { MENU_CONTAINER, MENU_SEPARATOR, menuItemClass } from '../menuStyles'

// One entry in a member's text-based actions menu. `separator` draws a faint
// divider above the item; `tone: 'danger'` renders it as an alert (destructive)
// action; `hint` shows a small trailing note (e.g. "Last admin") on a disabled
// item explaining why it can't be used.
type MemberAction = {
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'danger'
  separator?: boolean
  hint?: string
}

export default function MemberRow({
  member,
  online,
  isSelf,
  canManageRoles,
  isLastAdmin,
  busy,
  actionsDisabled,
  onSetRole,
  onRemove,
  onMessage,
  onOpenProfile,
}: {
  member: GroupMember
  // Live presence for this member (from the parent's usePresence). Drives the
  // dot colour so it updates without a refetch.
  online: boolean
  isSelf: boolean
  canManageRoles: boolean
  isLastAdmin: boolean
  busy: boolean
  actionsDisabled: boolean
  onSetRole: (userId: string, role: 'admin' | 'member') => void
  onRemove: (userId: string) => void
  onMessage: (member: GroupMember) => void
  // Open the read-only user-details panel for this member (avatar click).
  onOpenProfile: (member: GroupMember) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const isAdmin = member.role === 'admin'
  // Presence dot (drivers have no meaningful status, so no dot). Live: the
  // member's availability colour shows only while online; offline → dim grey.
  // Mirrors the sidebar DM dots so both reflect the same state simultaneously.
  const showDot = member.userRole !== 'driver'
  const dot = online ? statusMeta(member.availabilityStatus ?? 'available') : OFFLINE
  // Secondary line: the member's role IN THIS GROUP (admin / member) — NOT their
  // company/workspace role. Plain text under the name (no badge).
  const groupRoleLabel = isAdmin ? 'Admin' : 'Member'

  function run(fn: () => void) {
    setMenuOpen(false)
    fn()
  }

  // Build the per-member action list. UI gating mirrors the server rules (the
  // endpoints re-enforce all of them): DM only for other people; role changes
  // and removal only for managers; the last admin can be neither demoted nor
  // removed.
  const actions: MemberAction[] = []
  if (!isSelf) {
    actions.push({ label: 'Send private message', onClick: () => run(() => onMessage(member)) })
  }
  // Self-service leave for non-managers (managers reach the same action through
  // their own "Remove from group" below). The server logs a "X left the group"
  // activity row. A sole admin can't leave (it would orphan the group).
  if (isSelf && !canManageRoles) {
    actions.push({
      label: 'Leave group',
      onClick: () => run(() => onRemove(member.id)),
      tone: 'danger',
      disabled: isAdmin && isLastAdmin,
      hint: isAdmin && isLastAdmin ? 'Last admin' : undefined,
    })
  }
  if (canManageRoles) {
    if (isAdmin) {
      actions.push({
        label: 'Remove admin',
        onClick: () => run(() => onSetRole(member.id, 'member')),
        disabled: isLastAdmin,
        hint: isLastAdmin ? 'Last admin' : undefined,
      })
    } else {
      actions.push({
        label: 'Make admin',
        onClick: () => run(() => onSetRole(member.id, 'admin')),
      })
    }
    actions.push({
      label: 'Remove from group',
      onClick: () => run(() => onRemove(member.id)),
      tone: 'danger',
      // The last admin can't be removed (it would orphan the group) — covers a
      // sole admin trying to remove themselves, too.
      disabled: isAdmin && isLastAdmin,
      hint: isAdmin && isLastAdmin ? 'Last admin' : undefined,
      separator: true,
    })
  }

  return (
    <div className="flex items-center gap-3 px-2 py-2 rounded-chip hover:bg-white/[0.02] transition-colors">
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => onOpenProfile(member)}
          aria-label={`View ${member.displayName}'s profile`}
          title={member.displayName}
          className="block rounded-full cursor-pointer transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <Avatar userId={member.id} name={member.displayName} size={34} />
        </button>
        {showDot && dot && (
          <span
            title={dot.label}
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-rail"
            style={{ backgroundColor: dot.color }}
          />
        )}
      </div>
      <button
        type="button"
        onClick={() => onOpenProfile(member)}
        className="min-w-0 flex-1 flex flex-col gap-px text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        <span className="text-[0.875rem] leading-tight truncate hover:underline underline-offset-2">
          {member.displayName}
          {isSelf && <span className="text-faint"> (you)</span>}
        </span>
        {/* Group role (admin / member) as plain text — never the workspace role. */}
        <span className="text-[0.75rem] leading-tight text-faint truncate">{groupRoleLabel}</span>
      </button>

      {/* Compact text-based actions menu. The small ⋮ trigger keeps the row
          clean (no always-visible buttons); a row spinner replaces it while a
          role/removal request is in flight. Only rendered when there's at least
          one action available to this viewer. */}
      {actions.length > 0 &&
        (busy ? (
          <span className="shrink-0 h-7 w-7 flex items-center justify-center">
            <Spinner size={14} />
          </span>
        ) : (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              disabled={actionsDisabled}
              aria-label={`Manage ${member.displayName}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="h-7 w-7 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.04] transition-colors disabled:opacity-30 disabled:cursor-default"
            >
              <MoreVertical size="0.875rem" strokeWidth={1.8} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className={`absolute right-0 top-[calc(100%+4px)] z-20 min-w-[8.5rem] ${MENU_CONTAINER}`}
              >
                {actions.map((a, i) => (
                  <div key={i}>
                    {a.separator && <div className={MENU_SEPARATOR} />}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={a.onClick}
                      disabled={a.disabled}
                      title={a.hint}
                      className={menuItemClass(a.tone === 'danger' ? 'danger' : 'default')}
                    >
                      <span className="flex-1">{a.label}</span>
                      {a.hint && <span className="text-[0.625rem] text-faint shrink-0">{a.hint}</span>}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
    </div>
  )
}
