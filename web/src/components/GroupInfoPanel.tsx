import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreVertical, UserPlus, X } from 'lucide-react'
import type { Group, GroupMember, GroupPendingInvitee, Role } from '../lib/types'
import { groupLabel, tractorPlate, trailerPlate } from '../lib/types'
import { api, ApiError } from '../lib/api'
import { statusMeta, OFFLINE } from '../lib/availability'
import { usePresence } from '../hooks/usePresence'
import Avatar from './Avatar'
import GroupAvatar from './GroupAvatar'
import EditableRow from './EditableRow'
import Spinner from './Spinner'

type Props = {
  group: Group
  currentUserId: string
  members: GroupMember[]
  membersLoading: boolean
  // Whether the caller may edit details / invite. The server re-enforces the
  // full rule; this only gates the controls' visibility.
  canManage: boolean
  onClose: () => void
  // Open the shared invite picker (owned by ChatView so it can sit above chat).
  onInvite: () => void
  // Refetch the members list after a role change so badges/menus update live.
  onMembersChanged: () => void
  // Open (or reuse) a 1:1 DM with a member — used by the "Send private message"
  // member action. Reuses the parent's existing direct-message creation flow;
  // throws an ApiError (e.g. `connection_required`) the panel surfaces inline.
  onMessageMember: (member: GroupMember) => Promise<void>
  // Patch the parent group after a details edit so the header reflects it live.
  onGroupUpdated: (partial: Partial<Group>) => void
}

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  dispatcher: 'Dispatcher',
  driver: 'Driver',
  partner: 'Partner',
}

// Right-side panel with a vehicle group's operational details and membership.
// Native to the chat UI (same rail background/border/spacing as the workspace
// sidebar), not a browser modal. On desktop (xl+) it's a real in-flow column
// beside the chat, so the conversation reflows narrower and stays fully usable;
// below xl it falls back to an overlay drawer with a transparent click-away.
//
// Reads as clean information by default — each detail is a label/value row, not
// a form box. Managers (admins / dispatchers) edit fields INDIVIDUALLY: each row
// has its own pencil → inline input → Save/Cancel, so changes are made one field
// at a time. The identity hero is a GENERATED vehicle icon (the same slot as the
// header/sidebar) — vehicle rooms have no uploaded/custom image, so there is no
// image upload/crop/remove UI here.
export default function GroupInfoPanel({
  group,
  currentUserId,
  members,
  membersLoading,
  canManage,
  onClose,
  onInvite,
  onMembersChanged,
  onMessageMember,
  onGroupUpdated,
}: Props) {
  const [error, setError] = useState<string | null>(null)
  // The member whose role is currently being changed (drives the row spinner).
  const [roleBusyId, setRoleBusyId] = useState<string | null>(null)

  // Group role vs workspace role: managing GROUP roles needs the caller to be a
  // GROUP admin or a WORKSPACE admin (stricter than inviting — dispatchers can
  // invite but not promote). Resolved from the caller's own member row.
  const me = members.find((m) => m.id === currentUserId)
  const canManageRoles = me?.role === 'admin' || me?.userRole === 'admin'
  // How many group admins exist — used to block demoting the last one.
  const adminCount = members.filter((m) => m.role === 'admin').length

  // Live online/offline presence — the SAME global socket source the sidebar DM
  // dots use, so both reflect the same state at the same time. A member's
  // availability colour shows only while they're online; offline members get the
  // dim grey dot. This updates live while the panel is open (no refresh), and
  // re-subscribes cleanly when the panel closes or the group changes (the hook
  // unsubscribes on unmount; GroupInfoPanel mounts per open/per group).
  const { online } = usePresence()

  // Compact vehicle line under the member count: "Tractor … · Trailer …",
  // dropping whichever plate isn't set (empty when neither exists).
  const vehicleMeta = [
    tractorPlate(group) && `Tractor ${tractorPlate(group)}`,
    trailerPlate(group) && `Trailer ${trailerPlate(group)}`,
  ]
    .filter(Boolean)
    .join(' · ')

  async function setMemberRole(targetId: string, role: 'admin' | 'member') {
    setRoleBusyId(targetId)
    setError(null)
    try {
      await api.groups.setMemberRole(group.id, targetId, role)
      // Refetch in the parent → updated members flow back down as props. The
      // server also broadcasts group:members_changed for other open clients.
      onMembersChanged()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'last_admin') {
        setError('A group must keep at least one admin.')
      } else {
        setError(role === 'admin' ? 'Could not make admin.' : 'Could not remove admin.')
      }
    } finally {
      setRoleBusyId(null)
    }
  }

  async function removeMember(targetId: string) {
    setRoleBusyId(targetId)
    setError(null)
    try {
      await api.groups.removeMember(group.id, targetId)
      // Same flow as a role change — refetch in the parent so the updated
      // roster flows back down; the server also broadcasts members_changed.
      onMembersChanged()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'last_admin') {
        setError('A group must keep at least one admin.')
      } else {
        setError('Could not remove this member.')
      }
    } finally {
      setRoleBusyId(null)
    }
  }

  // "Send private message" — reuse the parent's DM creation/navigation flow.
  // A missing cross-workspace connection surfaces as a themed inline error.
  async function messageMember(target: GroupMember) {
    setError(null)
    try {
      await onMessageMember(target)
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'connection_required'
          ? 'Connect with this person before messaging.'
          : 'Could not open a private conversation.',
      )
    }
  }

  // Pending invites — only loadable by manage-capable callers (the endpoint
  // 403s otherwise), so we fetch only when canManage.
  const [pending, setPending] = useState<GroupPendingInvitee[]>([])
  const [pendingLoading, setPendingLoading] = useState(canManage)

  // Esc closes the drawer (matches the rest of the app's overlays).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Load pending invites (manage-capable only).
  useEffect(() => {
    if (!canManage) return
    let cancelled = false
    setPendingLoading(true)
    api.groups
      .pendingInvites(group.id)
      .then((r) => {
        if (!cancelled) setPending(r.invites)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPendingLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [group.id, canManage])

  // Persist one detail field. Throws on failure so the row keeps its editor
  // open and shows a retryable error.
  async function saveField(
    patch: Partial<{ name: string; description: string | null; tractorPlate: string | null; trailerPlate: string | null }>,
  ) {
    const { group: updated } = await api.groups.update(group.id, patch)
    onGroupUpdated({ name: updated.name, description: updated.description, meta: updated.meta })
  }

  async function cancelInvite(inviteId: string) {
    const prev = pending
    setPending((p) => p.filter((i) => i.id !== inviteId))
    try {
      await api.groupInvites.cancel(inviteId)
    } catch {
      setPending(prev)
      setError('Could not cancel the invite.')
    }
  }

  return (
    <>
      {/* Click-away — only as an overlay drawer on narrow screens (< xl). On
          desktop the panel is a real in-flow column, so there's no backdrop and
          the chat behind it stays fully clickable. */}
      <div className="fixed inset-0 z-40 xl:hidden" onClick={onClose} aria-hidden />

      <aside
        role="dialog"
        aria-label="Group info"
        // Narrow screens: a fixed right-edge drawer (overlay) up to full width.
        // xl+ : a static, in-flow right column that sits beside the chat as its
        // own subtle CARD — same rail bg + border + radius as the sidebar/chat
        // cards, with a gap from the chat (the row's xl:gap-3) — so the chat
        // reflows narrower and the panel matches the app's card shell.
        className="fixed top-0 right-0 bottom-0 z-40 w-full max-w-[400px] shadow-[-16px_0_48px_rgba(0,0,0,0.4)] bg-rail border-l border-white/[0.08] flex flex-col
                   xl:static xl:z-auto xl:w-[clamp(360px,26vw,420px)] xl:max-w-none xl:shrink-0 xl:shadow-none
                   xl:border xl:border-white/[0.08] xl:rounded-[11px] xl:overflow-hidden"
      >
        {/* Header — same height as the chat header so the two line up. */}
        <div className="h-[var(--header-height)] flex items-center justify-between px-4 border-b border-white/[0.06] shrink-0">
          <span className="text-[13px] font-semibold">Group info</span>
          <button
            onClick={onClose}
            aria-label="Close group info"
            className="h-8 w-8 flex items-center justify-center rounded-chip text-muted hover:text-text hover:bg-white/[0.04] transition-colors"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* Identity — a GENERATED vehicle icon hero (same slot as the header /
              sidebar). Vehicle rooms have no uploaded image, so there's no
              upload/crop/remove control here. */}
          <div className="relative flex flex-col items-center text-center pt-1">
            <GroupAvatar size={120} />
            <div className="mt-3 text-[16px] font-semibold tracking-[-0.2px]">
              {groupLabel(group)}
            </div>
            <div className="mt-0.5 text-[12px] text-muted">
              {members.length} member{members.length === 1 ? '' : 's'}
            </div>
            {vehicleMeta && (
              <div className="mt-1 text-[11.5px] text-faint">{vehicleMeta}</div>
            )}
            {error && <div className="text-[11.5px] text-alert mt-2">{error}</div>}
          </div>

          {/* Details — each row edits individually (managers only). */}
          <Section label="Details">
            <EditableRow
              label="Group name"
              value={group.name}
              editable={canManage}
              required
              onSave={(v) => saveField({ name: v })}
            />
            <EditableRow
              label="Tractor plate"
              value={tractorPlate(group)}
              editable={canManage}
              placeholder="e.g. B-123-ABC"
              onSave={(v) => saveField({ tractorPlate: v || null })}
            />
            <EditableRow
              label="Trailer plate"
              value={trailerPlate(group)}
              editable={canManage}
              placeholder="e.g. B-456-XYZ"
              onSave={(v) => saveField({ trailerPlate: v || null })}
            />
            <EditableRow
              label="Description"
              value={group.description}
              editable={canManage}
              multiline
              placeholder="Optional notes about this vehicle"
              onSave={(v) => saveField({ description: v || null })}
            />
          </Section>

          {/* Members — count already shown under the group name, so the section
              title stays plain (no duplicate "· N"). */}
          <Section
            label="Members"
            action={
              canManage ? (
                <button
                  onClick={onInvite}
                  className="inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-text transition-colors"
                >
                  <UserPlus size={12} strokeWidth={1.8} />
                  Invite
                </button>
              ) : undefined
            }
          >
            {membersLoading ? (
              <div className="flex justify-center py-4">
                <Spinner size={16} />
              </div>
            ) : (
              <div className="-mx-1">
                {members.map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    online={online.has(m.id)}
                    isSelf={m.id === currentUserId}
                    canManageRoles={canManageRoles}
                    isLastAdmin={m.role === 'admin' && adminCount <= 1}
                    busy={roleBusyId === m.id}
                    actionsDisabled={roleBusyId !== null}
                    onSetRole={setMemberRole}
                    onRemove={removeMember}
                    onMessage={messageMember}
                  />
                ))}
              </div>
            )}
            {error && <div className="text-[11.5px] text-alert px-2 pt-1">{error}</div>}
          </Section>

          {/* Pending invites (manage-capable only) */}
          {canManage && (pendingLoading || pending.length > 0) && (
            <Section label={`Pending invites${pending.length ? ` · ${pending.length}` : ''}`}>
              {pendingLoading ? (
                <div className="flex justify-center py-4">
                  <Spinner size={16} />
                </div>
              ) : (
                <div className="-mx-1">
                  {pending.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-2.5 px-2 py-2 rounded-chip hover:bg-white/[0.02] transition-colors"
                    >
                      <Avatar userId={p.userId} name={p.displayName} size={28} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] truncate">{p.displayName}</div>
                        <div className="text-[11px] text-faint">Invitation pending</div>
                      </div>
                      <button
                        onClick={() => void cancelInvite(p.id)}
                        className="shrink-0 text-[11px] text-muted hover:text-alert px-2 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}
        </div>
      </aside>
    </>
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

function MemberRow({
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
  // Secondary line: the member's WORKSPACE role (distinct from the group role
  // badge on the right), so the two are never confused.
  const roleLabel = member.userRole ? ROLE_LABEL[member.userRole] : null

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
    <div className="flex items-center gap-2.5 px-2 py-2 rounded-chip hover:bg-white/[0.02] transition-colors">
      <div className="relative shrink-0">
        <Avatar userId={member.id} name={member.displayName} size={28} />
        {showDot && dot && (
          <span
            title={dot.label}
            className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-rail"
            style={{ backgroundColor: dot.color }}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] truncate">
          {member.displayName}
          {isSelf && <span className="text-faint"> (you)</span>}
        </div>
        {roleLabel && <div className="text-[11px] text-faint truncate">{roleLabel}</div>}
      </div>

      {/* Group-role badge (distinct from the workspace role above). */}
      <span
        className={`shrink-0 text-[10px] rounded-chip px-1.5 py-0.5 border ${
          isAdmin
            ? 'text-active border-active/30 bg-active/10'
            : 'text-muted border-white/[0.08]'
        }`}
      >
        {isAdmin ? 'Admin' : 'Member'}
      </span>

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
              className="h-7 w-7 flex items-center justify-center rounded-chip text-muted hover:text-text hover:bg-white/[0.04] transition-colors disabled:opacity-30 disabled:cursor-default"
            >
              <MoreVertical size={14} strokeWidth={1.8} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+4px)] z-20 min-w-[136px] rounded-card border border-white/[0.1] bg-surface overflow-hidden py-1"
                style={{ boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}
              >
                {actions.map((a, i) => (
                  <div key={i}>
                    {a.separator && <div className="my-1 h-px bg-white/[0.06]" />}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={a.onClick}
                      disabled={a.disabled}
                      title={a.hint}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-left whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent ${
                        a.tone === 'danger'
                          ? 'text-alert hover:bg-alert/10'
                          : 'text-text hover:bg-white/[0.04]'
                      }`}
                    >
                      <span className="flex-1">{a.label}</span>
                      {a.hint && <span className="text-[10px] text-faint shrink-0">{a.hint}</span>}
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

// ── Compact, panel-native bits ──────────────────────────────────────────────
function Section({
  label,
  action,
  children,
}: {
  label: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="eyebrow">{label}</span>
        {action}
      </div>
      {children}
    </div>
  )
}
