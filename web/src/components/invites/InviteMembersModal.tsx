import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { getSocket } from '../../lib/socket'
import Avatar from '../Avatar'
import Modal from '../Modal'
import Spinner from '../Spinner'

type Props = {
  groupId: string
  groupName: string | null
  // Ids already in the group — shown as "Member" and not invitable.
  existingMemberIds: string[]
  onClose: () => void
}

// A person the caller can invite: someone in their own company, OR an accepted
// cross-company connection. `company` labels external people so they're
// distinguishable from colleagues.
type Invitable = {
  id: string
  displayName: string
  email: string
  company: string | null
  external: boolean
}

// Invite people into a vehicle group. The list merges the caller's workspace
// directory with their accepted connections (cross-company), since vehicle
// groups may include connected users from other companies. Sending is per-row
// and reflects immediately ("Invited"). Uses the shared themed Modal.
export default function InviteMembersModal({
  groupId,
  groupName,
  existingMemberIds,
  onClose,
}: Props) {
  const [people, setPeople] = useState<Invitable[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Ids with a pending invite (preloaded) or just invited this session.
  const [pending, setPending] = useState<Set<string>>(new Set())

  const memberSet = useMemo(() => new Set(existingMemberIds), [existingMemberIds])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.workspace.members(),
      api.connections.list(),
      // Pending invites are a nicety — never let them blank the whole picker.
      api.groups.pendingInvites(groupId).catch(() => ({ invites: [] })),
    ])
      .then(([ws, conns, pend]) => {
        if (cancelled) return
        // Workspace colleagues first, then accepted connections; dedupe by id
        // (a colleague always wins over a same-person connection row).
        const byId = new Map<string, Invitable>()
        for (const m of ws.members) {
          byId.set(m.id, {
            id: m.id,
            displayName: m.displayName,
            email: m.email,
            company: null,
            external: false,
          })
        }
        for (const c of conns.accepted) {
          const u = c.otherUser
          if (byId.has(u.id)) continue
          byId.set(u.id, {
            id: u.id,
            displayName: u.displayName,
            email: u.email,
            company: u.workspace.name,
            external: true,
          })
        }
        setPeople([...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)))
        setPending(new Set(pend.invites.map((i) => i.userId)))
      })
      .catch(() => {
        if (!cancelled) setError('Could not load people to invite.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [groupId])

  // Live: keep the "Invited" state in sync if the group's invite set changes
  // while this picker is open — another admin invites someone, or an invite is
  // accepted / declined / cancelled. The server emits `group:invites_changed` to
  // the group room; we refetch the pending set so rows reconcile (a just-accepted
  // person also flips to "Member" via the parent-refreshed existingMemberIds).
  const refetchPending = useCallback(() => {
    api.groups
      .pendingInvites(groupId)
      .then((r) => setPending(new Set(r.invites.map((i) => i.userId))))
      .catch(() => {})
  }, [groupId])

  useEffect(() => {
    const socket = getSocket()
    function onInvitesChanged(p: { groupId: string }) {
      if (p.groupId === groupId) refetchPending()
    }
    socket.on('group:invites_changed', onInvitesChanged)
    return () => {
      socket.off('group:invites_changed', onInvitesChanged)
    }
  }, [groupId, refetchPending])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      people.filter(
        (p) =>
          !q ||
          p.displayName.toLowerCase().includes(q) ||
          p.email.toLowerCase().includes(q) ||
          (p.company?.toLowerCase().includes(q) ?? false),
      ),
    [people, q],
  )

  async function invite(p: Invitable) {
    setBusyId(p.id)
    setError(null)
    try {
      const res = await api.groups.invite(groupId, [p.id])
      // Treat invited OR already-invited/already-member as "now handled".
      setPending((prev) => new Set(prev).add(p.id))
      if (res.invited.length === 0 && res.skipped[0]?.reason === 'not_invitable') {
        setError('That user can’t be invited to this group.')
      }
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'forbidden'
          ? 'You don’t have permission to invite to this group.'
          : 'Could not send the invite.',
      )
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal
      title="Invite members"
      subtitle={groupName ? `Add people to ${groupName}` : 'Add people to this vehicle group'}
      onClose={onClose}
    >
      <div className="space-y-3">
        <label className="flex items-center gap-2 h-8 px-2.5 rounded-chip border border-white/[0.06] bg-white/[0.02] focus-within:border-white/[0.16] transition-colors cursor-text">
          <Search size={12} strokeWidth={1.6} className="text-faint shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder="Search colleagues or connections…"
            className="bg-transparent text-[12.5px] flex-1 outline-none placeholder:text-faint min-w-0"
          />
        </label>

        <div className="max-h-72 overflow-y-auto -mx-1">
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner size={18} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-2 py-3 text-[12px] text-faint">
              {people.length === 0
                ? 'No colleagues or connections to invite yet.'
                : 'No people found.'}
            </div>
          ) : (
            filtered.map((p) => (
              <ResultRow
                key={p.id}
                person={p}
                isMember={memberSet.has(p.id)}
                isPending={pending.has(p.id)}
                busy={busyId === p.id}
                disabled={busyId !== null}
                onInvite={() => void invite(p)}
              />
            ))
          )}
        </div>

        {error && <div className="text-[12px] text-alert">{error}</div>}
      </div>
    </Modal>
  )
}

function ResultRow({
  person,
  isMember,
  isPending,
  busy,
  disabled,
  onInvite,
}: {
  person: Invitable
  isMember: boolean
  isPending: boolean
  busy: boolean
  disabled: boolean
  onInvite: () => void
}) {
  // Secondary line: company name for external connections, email otherwise.
  const detail = person.external ? person.company ?? person.email : person.email
  return (
    <div className="flex items-center gap-2.5 px-2 py-2 rounded-chip hover:bg-white/[0.02] transition-colors">
      <Avatar userId={person.id} name={person.displayName} size={28} />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] truncate">{person.displayName}</div>
        <div className="text-[11px] text-faint truncate">{detail}</div>
      </div>

      {person.external && (
        <span className="text-[10px] text-faint border border-white/[0.08] rounded-chip px-1.5 py-0.5 shrink-0">
          Connection
        </span>
      )}

      {isMember ? (
        <span className="text-[11px] text-muted px-2 shrink-0">Member</span>
      ) : isPending ? (
        <span className="text-[11px] text-muted px-2 shrink-0">Invited</span>
      ) : (
        <button
          onClick={onInvite}
          disabled={disabled || busy}
          className="shrink-0 text-[11.5px] font-semibold rounded-chip px-2.5 py-1 bg-text text-bg hover:bg-text/90 transition-colors disabled:opacity-50"
        >
          {busy ? 'Inviting…' : 'Invite'}
        </button>
      )}
    </div>
  )
}
