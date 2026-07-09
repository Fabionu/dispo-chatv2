import { useEffect, useState, type ReactNode } from 'react'
import { Search, SearchX } from 'lucide-react'
import type { DirectoryUser, Group } from '../lib/types'
import { api, ApiError } from '../lib/api'
import Avatar from './Avatar'
import Modal from './Modal'
import Spinner from './Spinner'

type Props = {
  onClose: () => void
  onOpenGroup: (group: Group) => void
}

// Platform-wide people search. Finding someone is the same regardless of
// company; the action differs:
//   - same company, or already connected → message immediately
//   - someone at another company         → send a connection request first
export default function NewMessageModal({ onClose, onOpenGroup }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Users we've just sent a request to this session — overrides the row state
  // without re-fetching.
  const [requested, setRequested] = useState<Set<string>>(new Set())

  // Debounced search — fires ~280ms after the last keystroke.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearched(false)
      setLoading(false)
      return
    }
    setLoading(true)
    const handle = setTimeout(() => {
      api.directory
        .searchUsers(q)
        .then((r) => {
          setResults(r.users)
          setSearched(true)
        })
        .catch(() => setError('Search failed. Try again.'))
        .finally(() => setLoading(false))
    }, 280)
    return () => clearTimeout(handle)
  }, [query])

  async function message(u: DirectoryUser) {
    setBusyId(u.id)
    setError(null)
    try {
      const { group } = await api.groups.createDirect(u.id)
      const now = new Date().toISOString()
      // Build an optimistic Group from the row we already have, so the rail
      // shows the DM instantly while refreshGroups() reconciles.
      onOpenGroup({
        id: group.id,
        type: 'direct',
        name: null,
        description: null,
        meta: {},
        lastMessageAt: null,
        lastReadAt: now,
        createdAt: now,
        memberCount: 2,
        unreadCount: 0,
        directPeer: { id: u.id, name: u.displayName, workspace: u.workspace.name },
      })
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'connection_required'
          ? 'Connect with this person before messaging.'
          : 'Could not open the conversation.',
      )
      setBusyId(null)
    }
  }

  async function connect(u: DirectoryUser) {
    setBusyId(u.id)
    setError(null)
    try {
      await api.connections.request(u.id)
      setRequested((prev) => new Set(prev).add(u.id))
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'previously_declined'
          ? 'That connection request was previously declined.'
          : 'Could not send the request.',
      )
    } finally {
      setBusyId(null)
    }
  }

  // Titled to match its opener (the sidebar's "Add connection" menu item);
  // same-company / already-connected people can still be messaged directly
  // from their row.
  return (
    <Modal
      title="Add connection"
      subtitle="Search anyone on Dispo-chat by name, email, or company."
      onClose={onClose}
    >
      <div className="space-y-3">
        {/* Search field — the app's standard input recipe (card radius, faint
            fill, calm focus), sized as the modal's primary control. */}
        <label className="flex items-center gap-2.5 h-9 px-3 rounded-card border border-white/[0.06] bg-white/[0.04] focus-within:border-white/[0.16] focus-within:bg-white/[0.05] transition-colors cursor-text">
          <Search size="0.875rem" strokeWidth={1.6} className="text-faint shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder="Search people…"
            className="bg-transparent text-[0.8125rem] flex-1 outline-none placeholder:text-faint min-w-0"
          />
        </label>

        {/* Results region. A fixed minimum height keeps the modal from
            collapsing/jumping as it moves between the hint, loading, empty and
            result states; only a long result list grows it (then scrolls). */}
        <div className="max-h-72 min-h-[8.5rem] overflow-y-auto -mx-2 flex flex-col">
          {query.trim().length < 2 ? (
            <EmptyState icon={<Search size="0.9375rem" strokeWidth={1.6} className="text-faint" />}>
              <p className="text-[0.75rem] text-muted">Start typing to search</p>
              <p className="text-[0.6875rem] text-faint mt-0.5">
                At least 2 characters — name, email, or company.
              </p>
            </EmptyState>
          ) : loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Spinner label="Searching…" />
            </div>
          ) : searched && results.length === 0 ? (
            <EmptyState icon={<SearchX size="0.9375rem" strokeWidth={1.6} className="text-faint" />}>
              <p className="text-[0.75rem] text-muted">No people found</p>
              <p className="text-[0.6875rem] text-faint mt-0.5">
                Try a different name, email, or company.
              </p>
            </EmptyState>
          ) : (
            <div className="py-0.5">
              {results.map((u) => (
                <ResultRow
                  key={u.id}
                  user={u}
                  busy={busyId === u.id}
                  disabled={busyId !== null}
                  justRequested={requested.has(u.id)}
                  onMessage={() => void message(u)}
                  onConnect={() => void connect(u)}
                />
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="text-[0.75rem] text-alert border border-alert/30 bg-alert/5 rounded-card px-3 py-2">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}

// Centered, compact empty-state block shared by the pre-search hint and the
// no-results state, so the region reads as designed rather than as stray
// disabled text. A small glyph tile anchors it; copy stays two quiet lines.
function EmptyState({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-4">
      <div className="h-9 w-9 rounded-full border border-white/[0.06] bg-white/[0.03] flex items-center justify-center mb-2.5">
        {icon}
      </div>
      {children}
    </div>
  )
}

function ResultRow({
  user,
  busy,
  disabled,
  justRequested,
  onMessage,
  onConnect,
}: {
  user: DirectoryUser
  busy: boolean
  disabled: boolean
  justRequested: boolean
  onMessage: () => void
  onConnect: () => void
}) {
  const canMessage = user.sameWorkspace || user.connection?.status === 'accepted'
  const pending = justRequested || user.connection?.status === 'pending'

  return (
    <div className="flex items-center gap-2.5 px-2 py-2 rounded-card hover:bg-white/[0.04] transition-colors">
      <Avatar userId={user.id} name={user.displayName} size={28} />
      <div className="min-w-0 flex-1">
        <div className="text-[0.78125rem] text-text truncate">{user.displayName}</div>
        <div className="text-[0.6875rem] text-faint truncate">
          {user.sameWorkspace ? 'Your company' : user.workspace.name} · {user.email}
        </div>
      </div>

      {canMessage ? (
        <RowButton primary busy={busy} disabled={disabled} onClick={onMessage}>
          {busy ? 'Opening…' : 'Message'}
        </RowButton>
      ) : pending ? (
        <span className="text-[0.6875rem] text-muted px-2 shrink-0">Request sent</span>
      ) : (
        <RowButton busy={busy} disabled={disabled} onClick={onConnect}>
          {busy ? 'Sending…' : 'Connect'}
        </RowButton>
      )}
    </div>
  )
}

function RowButton({
  children,
  primary,
  busy,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  primary?: boolean
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={`shrink-0 text-[0.71875rem] font-medium rounded-btn px-2.5 py-1 transition-colors disabled:opacity-50 ${
        primary
          ? 'bg-text text-bg font-semibold hover:bg-text/90'
          : 'border border-white/[0.14] text-text hover:bg-white/[0.04]'
      }`}
    >
      {children}
    </button>
  )
}
