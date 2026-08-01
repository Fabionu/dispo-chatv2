import { UserPlus } from 'lucide-react'
import type { GroupMember, GroupPendingInvitee } from '../../lib/types'
import Spinner from '../Spinner'
import MemberRow, { RosterRow, RosterLabel } from './MemberRow'
import { ProfileSection } from '../settings/profileChrome'

// ── The vehicle room's "Members" tab ────────────────────────────────────────
// The roster, grouped by the one thing that actually matters in a VEHICLE room:
// who drives this truck. That fact lived only in the Info tab's "Assigned
// drivers" field, so a dispatcher opening Members saw a flat list in which the
// driver, the fleet manager and a silent observer were indistinguishable — the
// list answered "who is in the room" but never "who is on the truck".
//
//   Assigned drivers · 1     ← mirrors the Info tab's field, same wording
//   Other members · 4
//   Pending invites · 1
//
// The split is a stable partition of the list the server already sorted (admins
// first, then display name), so ordering inside each group is unchanged and the
// two surfaces never disagree about who is assigned.
//
// Purely presentational — all state (busy ids, errors, pending list) and
// side-effecting handlers live in the parent GroupInfoPanel and flow in as
// props, so behaviour is identical to the previous flat version.
export default function MembersTab({
  members,
  membersLoading,
  currentUserId,
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
}: {
  members: GroupMember[]
  membersLoading: boolean
  currentUserId: string
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
}) {
  const assigned = new Set(assignedDriverIds)
  const drivers = members.filter((m) => assigned.has(m.id))
  const others = members.filter((m) => !assigned.has(m.id))

  const renderMember = (m: GroupMember) => (
    <MemberRow
      key={m.id}
      member={m}
      online={online.has(m.id)}
      isSelf={m.id === currentUserId}
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

  // The WHOLE roster waits, not just the list inside a section: the headings now
  // carry counts, so rendering them against an empty array would flash
  // "Members · 0" before settling on the real number. An error still shows —
  // cancelling an invite can fail while the roster is refetching.
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

  return (
    <div className="space-y-5">
      {/* Assigned drivers — omitted entirely when nobody is assigned, so a room
          without a driver shows one plain roster rather than an empty heading.
          Assigning happens in the Info tab; this is the read-out. */}
      {drivers.length > 0 && (
        <ProfileSection bare label={`Assigned drivers · ${drivers.length}`}>
          <div className="-mx-1">{drivers.map(renderMember)}</div>
        </ProfileSection>
      )}

      {/* Section counts are per-group and no longer duplicate the hero's total
          the way a single "Members" heading did — they say how the roster is
          split, which is the whole point of splitting it. */}
      <ProfileSection
        bare
        label={drivers.length > 0 ? `Other members · ${others.length}` : `Members · ${others.length}`}
        action={
          canManage ? (
            <button
              onClick={onInvite}
              className="inline-flex items-center gap-1 text-sm text-muted hover:text-text transition-colors"
            >
              <UserPlus size="0.75rem" strokeWidth={1.8} />
              Invite
            </button>
          ) : undefined
        }
      >
        {others.length > 0 ? (
          <div className="-mx-1">{others.map(renderMember)}</div>
        ) : (
          <div className="px-1 py-2 text-sm text-faint">
            Everyone in this room is assigned to the vehicle.
          </div>
        )}
        {error && <div className="px-2 pt-1 text-sm text-alert">{error}</div>}
      </ProfileSection>

      {/* Pending invites (manage-capable only) — the same RosterRow as a joined
          member, minus the presence dot and the profile link, so the tail of the
          roster reads as one list instead of a second, differently-built one. */}
      {canManage && (pendingLoading || pending.length > 0) && (
        <ProfileSection bare label={`Pending invites${pending.length ? ` · ${pending.length}` : ''}`}>
          {pendingLoading ? (
            <div className="flex justify-center py-4">
              <Spinner size={16} />
            </div>
          ) : (
            <div className="-mx-1">
              {pending.map((p) => (
                <RosterRow
                  key={p.id}
                  userId={p.userId}
                  name={p.displayName}
                  tag={<RosterLabel>Pending</RosterLabel>}
                  trailing={
                    <button
                      onClick={() => void onCancelInvite(p.id)}
                      className="h-7 rounded-btn px-2 text-sm text-muted transition-colors hover:bg-alert/10 hover:text-alert"
                    >
                      Cancel
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </ProfileSection>
      )}
    </div>
  )
}
