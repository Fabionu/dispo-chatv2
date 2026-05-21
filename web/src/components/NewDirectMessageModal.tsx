import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { WorkspaceMember } from '../lib/types'
import { api } from '../lib/api'
import Modal from './Modal'

type Props = {
  onClose: () => void
  onCreated: (groupId: string) => void
}

// Internal-only DM picker: lists colleagues in the same workspace. Messaging
// someone at another company goes through the directory + connection flow
// (separate slice) — not reachable from here yet.
export default function NewDirectMessageModal({ onClose, onCreated }: Props) {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.workspace
      .members()
      .then((r) => setMembers(r.members))
      .catch(() => setError('Could not load teammates.'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (m) => m.displayName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    )
  }, [members, query])

  async function pick(member: WorkspaceMember) {
    setBusyId(member.id)
    setError(null)
    try {
      const { group } = await api.groups.createDirect(member.id)
      onCreated(group.id)
    } catch {
      setError('Could not open the conversation.')
      setBusyId(null)
    }
  }

  return (
    <Modal
      title="New direct message"
      subtitle="Start a 1:1 with a teammate in your workspace."
      onClose={onClose}
    >
      <div className="space-y-3">
        <label className="flex items-center gap-2 h-8 px-2.5 rounded-chip border border-white/[0.06] bg-white/[0.02] focus-within:border-white/[0.16] transition-colors cursor-text">
          <Search size={12} strokeWidth={1.6} className="text-faint shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder="Search teammates…"
            className="bg-transparent text-[12.5px] flex-1 outline-none placeholder:text-faint min-w-0"
          />
        </label>

        <div className="max-h-64 overflow-y-auto -mx-1">
          {loading ? (
            <div className="px-2 py-3 text-[12px] text-faint">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="px-2 py-3 text-[12px] text-faint">
              {members.length === 0 ? 'No other teammates yet.' : 'No matches.'}
            </div>
          ) : (
            filtered.map((m) => (
              <button
                key={m.id}
                onClick={() => void pick(m)}
                disabled={busyId !== null}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-chip hover:bg-white/[0.03] transition-colors text-left disabled:opacity-50"
              >
                <div className="h-7 w-7 rounded-full bg-active/30 border border-active/40 flex items-center justify-center shrink-0 text-[10px] font-semibold uppercase font-mono">
                  {initials(m.displayName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] truncate">{m.displayName}</div>
                  <div className="text-[11px] text-faint truncate">{m.email}</div>
                </div>
                {busyId === m.id && <span className="text-[11px] text-muted">Opening…</span>}
              </button>
            ))
          )}
        </div>

        {error && <div className="text-[12px] text-alert">{error}</div>}
      </div>
    </Modal>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0] ?? '').join('').toUpperCase() || '?'
}
