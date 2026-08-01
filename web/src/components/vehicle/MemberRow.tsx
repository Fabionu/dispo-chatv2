import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreVertical } from 'lucide-react'
import type { GroupMember } from '../../lib/types'
import { statusMeta, OFFLINE } from '../../lib/availability'
import Avatar from '../Avatar'
import Spinner from '../Spinner'
import { MENU_CONTAINER, MENU_SEPARATOR, menuItemClass } from '../menuStyles'

// ── One line of the group's roster ──────────────────────────────────────────
// RosterRow is the shell EVERY person in the Members tab sits on — a joined
// member and a pending invitee alike. They used to be two hand-built layouts
// that drifted (different hover, no presence dot on invitees, a bare text link
// for Cancel), which made the pending list read like a different feature bolted
// underneath the roster instead of the tail of one list.
//
//   ⬤  Fabio Tofan                              Admin     ⋮
//   ⬤  Dev Dispatcher (you)                               ⋮
//   ○   Maria Stancu                          Pending  Cancel
//
// ONE line per person. Every row used to carry a second line whose entire
// content was the word "Admin" or the word "Member" — a full extra line of type
// on every row to repeat, six times over, the fact that a member is a member.
// It made the roster twice as tall as it needed to be and buried the only thing
// worth spotting: who the admins are. The role moved to the end of the row and
// is drawn ONLY when it says something — nothing there means "member", the way
// every roster reads. (It is still the group role, never the workspace role.)
//
// It is plain text, NOT a badge: a pill puts a border, a fill and uppercase
// weight around a word that is meant to be quieter than the name it sits beside,
// and this panel's roster has never spoken in badges. Right-aligned rather than
// trailing the name, so the labels form a column the eye can run down instead of
// landing wherever each name happens to end.
//
// The identity half is ONE control, not two: the avatar and the name used to be
// separate buttons firing the same action, which doubled the tab stops on every
// row for no gain. `trailing` is whatever that row can do — the ⋮ menu, a busy
// spinner, or Cancel for an invite.
export function RosterLabel({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-sm leading-tight text-muted">{children}</span>
}

export function RosterRow({
  userId,
  name,
  tag,
  dot,
  self = false,
  onOpen,
  trailing,
}: {
  userId: string
  name: string
  /** Right-aligned label. Omit it when there is nothing distinguishing to say. */
  tag?: ReactNode
  /** Presence dot, or null for people who have none (drivers, invitees). */
  dot?: { color: string; label: string } | null
  /** Appends a quiet "(you)" to the name. */
  self?: boolean
  /** Opens the read-only profile. Omitted for invitees — there is nothing to
   *  open until they accept. */
  onOpen?: () => void
  trailing?: ReactNode
}) {
  const identity = (
    <>
      <span className="relative shrink-0">
        <Avatar userId={userId} name={name} size={28} />
        {/* Ringed like the sidebar's identity dot, so presence reads the same
            wherever it appears. */}
        {dot && (
          <span
            title={dot.label}
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-rail"
            style={{ backgroundColor: dot.color }}
          />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-lg leading-tight group-hover/id:underline underline-offset-2">
        {name}
        {self && <span className="text-faint"> (you)</span>}
      </span>
    </>
  )

  return (
    <div className="flex items-center gap-2 rounded-card px-2 py-1.5 transition-colors hover:bg-white/4">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`View ${name}'s profile`}
          className="group/id flex min-w-0 flex-1 items-center gap-2.5 rounded-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          {identity}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2.5">{identity}</div>
      )}
      {tag}
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  )
}

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
    <RosterRow
      userId={member.id}
      name={member.displayName}
      self={isSelf}
      dot={showDot ? dot : null}
      // The member's role IN THIS GROUP — never their company/workspace role.
      // Only admins are marked: everyone else is a member by definition, and
      // printing "Member" on every row said nothing while costing a whole line.
      tag={isAdmin ? <RosterLabel>Admin</RosterLabel> : undefined}
      onOpen={() => onOpenProfile(member)}
      // Compact text-based actions menu. The small ⋮ trigger keeps the row clean
      // (no always-visible buttons); a row spinner replaces it while a
      // role/removal request is in flight. Only rendered when there's at least
      // one action available to this viewer. Its hover fill sits a step above
      // the row's, so the button still reads as a target on a hovered row.
      trailing={
        actions.length === 0 ? undefined : busy ? (
          <span className="flex h-7 w-7 items-center justify-center">
            <Spinner size={14} />
          </span>
        ) : (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              disabled={actionsDisabled}
              aria-label={`Manage ${member.displayName}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-text disabled:cursor-default disabled:opacity-30"
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
                      {a.hint && <span className="shrink-0 text-2xs text-faint">{a.hint}</span>}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      }
    />
  )
}
