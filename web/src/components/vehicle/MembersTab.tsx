import { useState } from 'react'
import { Check, UserPlus } from 'lucide-react'
import type { GroupMember, GroupPendingInvitee } from '../../lib/types'
import Spinner from '../Spinner'
import Avatar from '../Avatar'
import MemberRow, { RosterRow } from './MemberRow'
import { SettingsSection, TextAction } from '../settings/sectionChrome'
import { ROLE_LABEL } from '../settings/ProfileSidebarPanel'

// ── Group info → Crew ─────────────────────────────────────────────────────────
// The roster, split by the one thing that matters in a VEHICLE room: who drives
// this truck. Reworked 2026-10-12 from the "Profile & group info rework"
// canvas: the driver assignment moved here from the Info tab (it used to be a
// field there while this tab only mirrored it), so "who drives" is read and
// changed in one place:
//
//   [ Invite to this room ]
//   Drives this truck  1                  Change
//   Members  3
//   Waiting to join  1
//
// The split is a stable partition of the list the server already sorted (admins
// first, then display name). State (busy ids, errors, pending list) and the
// side-effecting handlers live in the parent GroupInfoPanel.
export default function MembersTab({
  members,
  membersLoading,
  currentUserId,
  viewerWorkspace,
  canManage,
  canManageRoles,
  adminCount,
  roleBusyId,
  online,
  error,
  assignedDriverIds,
  pending,
  pendingLoading,
  onInvite,
  onSetRole,
  onRemove,
  onMessage,
  onOpenProfile,
  onCancelInvite,
  onSaveDrivers,
}: {
  members: GroupMember[]
  membersLoading: boolean
  currentUserId: string
  viewerWorkspace?: string | null
  canManage: boolean
  canManageRoles: boolean
  adminCount: number
  roleBusyId: string | null
  online: Set<string>
  error: string | null
  /** Persistent driver assignment for this vehicle room (vehicleDriverIds). */
  assignedDriverIds: string[]
  pending: GroupPendingInvitee[]
  pendingLoading: boolean
  onInvite: () => void
  onSetRole: (userId: string, role: 'admin' | 'member') => void
  onRemove: (userId: string) => void
  onMessage: (member: GroupMember) => void
  onOpenProfile: (member: GroupMember) => void
  onCancelInvite: (inviteId: string) => void
  /** Replace the assignment. Membership is re-validated server-side. */
  onSaveDrivers: (ids: string[]) => Promise<void>
}) {
  const [picking, setPicking] = useState(false)
  const assigned = new Set(assignedDriverIds)
  const drivers = members.filter((m) => assigned.has(m.id))
  const others = members.filter((m) => !assigned.has(m.id))

  const renderMember = (m: GroupMember) => (
    <MemberRow
      key={m.id}
      member={m}
      // The presence set never lists the viewer; you are online by definition.
      online={m.id === currentUserId || online.has(m.id)}
      isSelf={m.id === currentUserId}
      viewerWorkspace={viewerWorkspace}
      canManageRoles={canManageRoles}
      isLastAdmin={m.role === 'admin' && adminCount <= 1}
      busy={roleBusyId === m.id}
      actionsDisabled={roleBusyId !== null}
      onSetRole={onSetRole}
      onRemove={onRemove}
      onMessage={onMessage}
      onOpenProfile={onOpenProfile}
    />
  )

  // The WHOLE roster waits: the headings carry counts, so rendering them
  // against an empty array would flash "0" before the real number. An error
  // still shows — cancelling an invite can fail while the roster refetches.
  if (membersLoading) {
    return (
      <div className="space-y-2">
        <div className="flex justify-center py-8">
          <Spinner size={16} />
        </div>
        {error && <div className="px-2 text-sm text-alert">{error}</div>}
      </div>
    )
  }

  const showPending = canManage && (pendingLoading || pending.length > 0)

  return (
    <div className="flex flex-col">
      {canManage && (
        <div className="pt-5">
          <button
            type="button"
            onClick={onInvite}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-btn border border-line-2 text-lg font-semibold transition-colors hover:bg-white/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            <UserPlus size="1rem" strokeWidth={1.9} />
            Invite to this room
          </button>
        </div>
      )}

      <SettingsSection
        title="Drives this truck"
        aside={drivers.length || undefined}
        action={
          canManage && !picking ? (
            <TextAction onClick={() => setPicking(true)}>{drivers.length ? 'Change' : 'Assign'}</TextAction>
          ) : undefined
        }
      >
        {picking ? (
          <DriverPicker
            members={members}
            assignedIds={assignedDriverIds}
            onCancel={() => setPicking(false)}
            onSave={async (ids) => {
              await onSaveDrivers(ids)
              setPicking(false)
            }}
          />
        ) : drivers.length > 0 ? (
          <div className="-mx-2 flex flex-col">{drivers.map(renderMember)}</div>
        ) : (
          <p className="text-base text-faint">
            No driver assigned. The driver’s phone app shows the trips of the rooms they drive.
          </p>
        )}
      </SettingsSection>

      <SettingsSection title="Members" aside={others.length} last={!showPending}>
        {others.length > 0 ? (
          <div className="-mx-2 flex flex-col">{others.map(renderMember)}</div>
        ) : (
          <p className="text-base text-faint">Everyone in this room drives this truck.</p>
        )}
        {error && <p className="text-sm text-alert">{error}</p>}
      </SettingsSection>

      {/* Pending invites (manage-capable only) — the same RosterRow as a joined
          member, outlined and dimmed, so the list reads as one roster. */}
      {showPending && (
        <SettingsSection title="Waiting to join" aside={pending.length || undefined} last>
          {pendingLoading ? (
            <div className="flex justify-center py-4">
              <Spinner size={16} />
            </div>
          ) : (
            <div className="-mx-2 flex flex-col">
              {pending.map((p) => (
                <RosterRow
                  key={p.id}
                  userId={p.userId}
                  name={p.displayName}
                  pending
                  sub="Invited, hasn’t joined yet"
                  trailing={
                    <TextAction tone="alert" onClick={() => void onCancelInvite(p.id)}>
                      Cancel invite
                    </TextAction>
                  }
                />
              ))}
            </div>
          )}
        </SettingsSection>
      )}
    </div>
  )
}

// Choose who drives this truck: the room's members (drivers first) as
// toggles, saved together. Marks who DRIVES this room operationally — it does
// not change anyone's company role.
function DriverPicker({
  members,
  assignedIds,
  onCancel,
  onSave,
}: {
  members: GroupMember[]
  assignedIds: string[]
  onCancel: () => void
  onSave: (ids: string[]) => Promise<void>
}) {
  const [draft, setDraft] = useState<string[]>(assignedIds)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  const ordered = [...members].sort((a, b) => {
    const ad = a.userRole === 'driver' ? 0 : 1
    const bd = b.userRole === 'driver' ? 0 : 1
    if (ad !== bd) return ad - bd
    return a.displayName.localeCompare(b.displayName)
  })

  const before = new Set(assignedIds)
  const changed = draft.length !== before.size || draft.some((id) => !before.has(id))

  async function save() {
    if (!changed) return onCancel()
    setSaving(true)
    setError(false)
    try {
      await onSave(draft)
    } catch {
      setError(true)
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex max-h-72 flex-col overflow-y-auto rounded-card border border-line p-1">
        {ordered.length === 0 ? (
          <p className="px-2 py-3 text-center text-base text-faint">No members to assign yet.</p>
        ) : (
          ordered.map((m) => {
            const on = draft.includes(m.id)
            return (
              <button
                key={m.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={saving}
                onClick={() => setDraft((d) => (on ? d.filter((x) => x !== m.id) : [...d, m.id]))}
                className={`flex h-11 items-center gap-2.5 rounded-btn px-2 text-left transition-colors ${
                  on ? 'bg-white/6' : 'hover:bg-white/4'
                }`}
              >
                <Avatar
                  userId={m.id}
                  name={m.displayName}
                  size={28}
                  hasAvatar={m.hasAvatar}
                  version={m.avatarVersion}
                  fallback="initials"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg">{m.displayName}</span>
                  {m.userRole && (
                    <span className="block text-sm leading-tight text-faint">{ROLE_LABEL[m.userRole]}</span>
                  )}
                </span>
                <span
                  aria-hidden
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-btn border transition-colors ${
                    on ? 'border-transparent bg-text text-bg' : 'border-line-2 text-transparent'
                  }`}
                >
                  <Check size="0.75rem" strokeWidth={2.4} />
                </span>
              </button>
            )
          })
        )}
      </div>
      {error && <p className="text-sm text-alert">Could not save the drivers. Try again.</p>}
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-7 rounded-btn border border-line-2 px-2.5 text-sm font-semibold transition-colors hover:bg-white/6 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="h-7 rounded-btn bg-text px-3 text-sm font-semibold text-bg transition-opacity disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
