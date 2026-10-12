import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { GroupMember } from '../../lib/types'
import { AVAILABILITY, statusMeta, OFFLINE } from '../../lib/availability'
import { RowMeta } from '../../pages/sidebarBits'
import { ROLE_LABEL } from '../settings/ProfileSidebarPanel'
import Avatar from '../Avatar'
import Spinner from '../Spinner'
import { MENU_CONTAINER, MENU_SEPARATOR, menuItemClass } from '../menuStyles'

// ── One line of the room's crew ──────────────────────────────────────────────
// RosterRow is the shell EVERY person in the Crew tab sits on — a joined member
// and a pending invitee alike, so the invite list reads as the tail of one list.
//
//   ⬤  Marcus Reyes                                         ⋯
//      Driver │ Online
//   ⬤  Olivia Park  You                         [Room admin]
//      Dispatcher │ Online
//   ○   Ana Ionescu                               Cancel invite
//      Invited, hasn't joined yet
//
// Reworked 2026-10-12 from the "Profile & group info rework" canvas. The row
// was one line and deliberately badge-free; the approved design gives it a
// second line that answers what the first could not — what this person does,
// whether they are from another company, and whether they are reachable now —
// and marks the room admins with a quiet bordered tag so they can be spotted
// in a column. "Room" admin, because the company role is on the second line
// and the two used to be confused.
//
// The identity half is ONE control (avatar + name open the profile). `trailing`
// is whatever that row can do — the ⋯ menu, a busy spinner, or Cancel invite.
export function RosterTag({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-6 shrink-0 items-center rounded-btn border border-line px-2 text-sm font-medium text-muted">
      {children}
    </span>
  )
}

export function RosterRow({
  userId,
  name,
  hasAvatar,
  avatarVersion,
  sub,
  tag,
  dot,
  self = false,
  pending = false,
  onOpen,
  trailing,
}: {
  userId: string
  name: string
  /** From the roster when it knows (see Avatar): skips a request for someone
   *  with no photo, and shares the cached URL of someone with one. */
  hasAvatar?: boolean
  avatarVersion?: string | null
  /** The quiet second line (role │ company │ presence). */
  sub?: ReactNode
  /** Right-aligned tag. Omit it when there is nothing distinguishing to say. */
  tag?: ReactNode
  /** Presence dot, or null for people who have none (invitees). */
  dot?: { color: string; label: string } | null
  /** Marks your own row with a quiet "You". */
  self?: boolean
  /** An invitee: dimmed name, outlined avatar. */
  pending?: boolean
  /** Opens the read-only profile. Omitted for invitees — there is nothing to
   *  open until they accept. */
  onOpen?: () => void
  trailing?: ReactNode
}) {
  const identity = (
    <>
      <span className={`relative shrink-0 ${pending ? 'opacity-60' : ''}`}>
        <Avatar
          userId={userId}
          name={name}
          hasAvatar={hasAvatar}
          version={avatarVersion}
          size={36}
          fallback="initials"
        />
        {/* Ringed like the sidebar's identity dot, so presence reads the same
            wherever it appears. */}
        {dot && (
          <span
            title={dot.label}
            className="absolute -bottom-px -right-px h-[0.6875rem] w-[0.6875rem] rounded-full border-2 border-panel"
            style={{ backgroundColor: dot.color }}
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span
            className={`truncate text-lg font-semibold leading-tight group-hover/id:underline underline-offset-2 ${
              pending ? 'text-muted' : ''
            }`}
          >
            {name}
          </span>
          {self && <span className="shrink-0 text-sm text-muted">You</span>}
        </span>
        {sub && <span className="mt-0.5 block text-sm text-muted">{sub}</span>}
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
          className="group/id flex min-w-0 flex-1 items-center gap-3 rounded-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          {identity}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{identity}</div>
      )}
      {tag}
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  )
}

// One entry in a member's actions menu. `separator` draws a faint divider above
// the item; `tone: 'danger'` renders it as an alert (destructive) action;
// `hint` shows a small trailing note (e.g. "Last admin") on a disabled item
// explaining why it can't be used.
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
  viewerWorkspace,
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
  /** The viewer's company — a member from another one is named on line two. */
  viewerWorkspace?: string | null
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
    // Capture + stop, so Esc closes the menu without also closing the panel.
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [menuOpen])

  const isAdmin = member.role === 'admin'
  const isDriver = member.userRole === 'driver'
  // Presence: online people show their availability colour (drivers, who set
  // none, show plain green); offline is the dim grey. Mirrors the sidebar dots.
  const availability = statusMeta(member.availabilityStatus ?? 'available')
  const dot = online ? (isDriver ? AVAILABILITY[0] : availability) : OFFLINE
  const presence = online
    ? isDriver || member.availabilityStatus === 'available' || !member.availabilityStatus
      ? 'Online'
      : availability.label
    : 'Offline'
  const outsideCompany =
    member.workspace && viewerWorkspace && member.workspace !== viewerWorkspace ? member.workspace : null

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
    actions.push({ label: 'Send message', onClick: () => run(() => onMessage(member)) })
    actions.push({ label: 'View profile', onClick: () => run(() => onOpenProfile(member)) })
  }
  // Self-service leave for non-managers (managers reach the same action through
  // their own "Remove from room" below). The server logs a "X left the group"
  // activity row. A sole admin can't leave (it would orphan the room).
  if (isSelf && !canManageRoles) {
    actions.push({
      label: 'Leave room',
      onClick: () => run(() => onRemove(member.id)),
      tone: 'danger',
      disabled: isAdmin && isLastAdmin,
      hint: isAdmin && isLastAdmin ? 'Last admin' : undefined,
    })
  }
  if (canManageRoles) {
    if (isAdmin) {
      actions.push({
        label: 'Remove room admin',
        onClick: () => run(() => onSetRole(member.id, 'member')),
        disabled: isLastAdmin,
        hint: isLastAdmin ? 'Last admin' : undefined,
      })
    } else {
      actions.push({
        label: 'Make room admin',
        onClick: () => run(() => onSetRole(member.id, 'admin')),
      })
    }
    actions.push({
      label: isSelf ? 'Leave room' : 'Remove from room',
      onClick: () => run(() => onRemove(member.id)),
      tone: 'danger',
      // The last admin can't be removed (it would orphan the room) — covers a
      // sole admin trying to remove themselves, too.
      disabled: isAdmin && isLastAdmin,
      hint: isAdmin && isLastAdmin ? 'Last admin' : undefined,
      separator: actions.length > 0,
    })
  }

  return (
    <RosterRow
      userId={member.id}
      name={member.displayName}
      hasAvatar={member.hasAvatar}
      avatarVersion={member.avatarVersion}
      self={isSelf}
      dot={{ color: dot.color, label: online ? presence : 'Offline' }}
      sub={
        <RowMeta
          segments={[member.userRole ? ROLE_LABEL[member.userRole] : null, outsideCompany, presence]}
          whole
        />
      }
      // The member's role IN THIS ROOM — never their company role, which is
      // on line two. Only admins are marked.
      tag={isAdmin ? <RosterTag>Room admin</RosterTag> : undefined}
      onOpen={() => onOpenProfile(member)}
      trailing={
        actions.length === 0 ? undefined : busy ? (
          <span className="flex h-8 w-8 items-center justify-center">
            <Spinner size={14} />
          </span>
        ) : (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              disabled={actionsDisabled}
              aria-label={`Actions for ${member.displayName}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={`rounded-btn flex h-8 w-8 items-center justify-center text-muted transition-colors hover:bg-white/10 hover:text-text disabled:cursor-default disabled:opacity-30 ${
                menuOpen ? 'bg-white/10 text-text' : ''
              }`}
            >
              <MoreHorizontal size="1rem" strokeWidth={2} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className={`absolute right-0 top-[calc(100%+4px)] z-20 min-w-[12.5rem] ${MENU_CONTAINER}`}
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
