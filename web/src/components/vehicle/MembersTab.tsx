import { UserPlus } from 'lucide-react'
import type { GroupMember, GroupPendingInvitee } from '../../lib/types'
import Avatar from '../Avatar'
import Spinner from '../Spinner'
import MemberRow from './MemberRow'
import PanelSection from './PanelSection'

// The group-info panel's "Members" tab: the roster (each row with its manage
// menu) plus the pending-invites list for manage-capable viewers. Purely
// presentational — all state (busy ids, errors, pending list) and side-effecting
// handlers live in the parent GroupInfoPanel and flow in as props, so behaviour
// is identical to the previous inline version.
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
  pending: GroupPendingInvitee[]
  pendingLoading: boolean
  onInvite: () => void
  onSetRole: (userId: string, role: 'admin' | 'member') => void
  onRemove: (userId: string) => void
  onMessage: (member: GroupMember) => void
  onOpenProfile: (member: GroupMember) => void
  onCancelInvite: (inviteId: string) => void
}) {
  return (
    <div className="space-y-5">
      {/* Members — count already shown in the hero, so the section
          title stays plain (no duplicate "· N"). */}
      <PanelSection
        label="Members"
        action={
          canManage ? (
            <button
              onClick={onInvite}
              className="inline-flex items-center gap-1 text-[0.71875rem] text-muted hover:text-text transition-colors"
            >
              <UserPlus size="0.75rem" strokeWidth={1.8} />
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
                onSetRole={onSetRole}
                onRemove={onRemove}
                onMessage={onMessage}
                onOpenProfile={onOpenProfile}
              />
            ))}
          </div>
        )}
        {error && <div className="text-[0.71875rem] text-alert px-2 pt-1">{error}</div>}
      </PanelSection>

      {/* Pending invites (manage-capable only) */}
      {canManage && (pendingLoading || pending.length > 0) && (
        <PanelSection label={`Pending invites${pending.length ? ` · ${pending.length}` : ''}`}>
          {pendingLoading ? (
            <div className="flex justify-center py-4">
              <Spinner size={16} />
            </div>
          ) : (
            <div className="-mx-1">
              {pending.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 px-2 py-2 rounded-chip hover:bg-white/[0.02] transition-colors"
                >
                  <Avatar userId={p.userId} name={p.displayName} size={34} />
                  <div className="min-w-0 flex-1 flex flex-col gap-px">
                    <div className="text-[0.875rem] leading-tight truncate">{p.displayName}</div>
                    <div className="text-[0.75rem] leading-tight text-faint truncate">Invitation pending</div>
                  </div>
                  <button
                    onClick={() => void onCancelInvite(p.id)}
                    className="shrink-0 text-[0.75rem] text-muted hover:text-alert px-2 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          )}
        </PanelSection>
      )}
    </div>
  )
}
