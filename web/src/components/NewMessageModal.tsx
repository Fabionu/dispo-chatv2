import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import type { DirectoryUser } from '../lib/types'
import { api, ApiError } from '../lib/api'
import Modal from './Modal'

type Props = {
  onClose: () => void
  onOpenGroup: (groupId: string) => void
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
      onOpenGroup(group.id)
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

  return (
    <Modal
      title="New message"
      subtitle="Search anyone on Dispo-chat by name, email, or company."
      onClose={onClose}
    >
      <div className="space-y-3">
        <label className="flex items-center gap-2 h-8 px-2.5 rounded-chip border border-white/[0.06] bg-white/[0.02] focus-within:border-white/[0.16] transition-colors cursor-text">
          <Search size={12} strokeWidth={1.6} className="text-faint shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder="Search people…"
            className="bg-transparent text-[12.5px] flex-1 outline-none placeholder:text-faint min-w-0"
          />
        </label>

        <div className="max-h-72 overflow-y-auto -mx-1">
          {query.trim().length < 2 ? (
            <div className="px-2 py-3 text-[12px] text-faint">
              Type at least 2 characters to search.
            </div>
          ) : loading ? (
            <div className="px-2 py-3 text-[12px] text-faint">Searching…</div>
          ) : searched && results.length === 0 ? (
            <div className="px-2 py-3 text-[12px] text-faint">No people found.</div>
          ) : (
            results.map((u) => (
              <ResultRow
                key={u.id}
                user={u}
                busy={busyId === u.id}
                disabled={busyId !== null}
                justRequested={requested.has(u.id)}
                onMessage={() => void message(u)}
                onConnect={() => void connect(u)}
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
    <div className="flex items-center gap-2.5 px-2 py-2 rounded-chip hover:bg-white/[0.02] transition-colors">
      <div className="h-7 w-7 rounded-full bg-active/30 border border-active/40 flex items-center justify-center shrink-0 text-[10px] font-semibold uppercase font-mono">
        {initials(user.displayName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] truncate">{user.displayName}</div>
        <div className="text-[11px] text-faint truncate">
          {user.sameWorkspace ? 'Your company' : user.workspace.name} · {user.email}
        </div>
      </div>

      {canMessage ? (
        <RowButton primary busy={busy} disabled={disabled} onClick={onMessage}>
          {busy ? 'Opening…' : 'Message'}
        </RowButton>
      ) : pending ? (
        <span className="text-[11px] text-muted px-2 shrink-0">Request sent</span>
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
      className={`shrink-0 text-[11.5px] font-medium rounded-chip px-2.5 py-1 transition-colors disabled:opacity-50 ${
        primary
          ? 'bg-text text-bg font-semibold hover:bg-text/90'
          : 'border border-white/[0.14] text-text hover:bg-white/[0.04]'
      }`}
    >
      {children}
    </button>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0] ?? '').join('').toUpperCase() || '?'
}
