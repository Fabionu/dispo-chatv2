import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { Group } from '../../lib/types'
import { groupLabel } from '../../lib/types'
import { api, ApiError } from '../../lib/api'
import Modal from '../Modal'
import Avatar from '../Avatar'
import GroupAvatar from '../GroupAvatar'
import type { LocalMessage } from './types'

type Props = {
  fromGroupId: string
  message: LocalMessage
  onClose: () => void
  // Fired after a successful forward so the parent can surface a confirmation.
  onForwarded: (toGroupId: string) => void
}

// Picks a destination conversation and forwards the given message into it.
// Text and attachments are copied server-side; the forward arrives in the
// target group over the socket like any other message.
export default function ForwardModal({ fromGroupId, message, onClose, onForwarded }: Props) {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.groups
      .list()
      .then((res) => {
        if (!cancelled) setGroups(res.groups.filter((g) => g.id !== fromGroupId))
      })
      .catch(() => {
        if (!cancelled) setError('Could not load conversations.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fromGroupId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups.filter((g) => groupLabel(g).toLowerCase().includes(q))
  }, [groups, query])

  async function forwardTo(g: Group) {
    setBusyId(g.id)
    setError(null)
    try {
      await api.groups.forwardMessage(fromGroupId, message.id, g.id)
      onForwarded(g.id)
      onClose()
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'not_a_member'
          ? "You're no longer in that conversation."
          : 'Could not forward the message.',
      )
      setBusyId(null)
    }
  }

  const previewText = message.body
    ? message.body
    : (message.attachments?.length ?? 0) > 0
      ? 'Attachment'
      : ''

  return (
    <Modal title="Forward message" subtitle="Choose a conversation to send this to." onClose={onClose}>
      <div className="space-y-3">
        {previewText && (
          <div className="pl-2 border-l-2 border-active/60 bg-white/[0.025] rounded-[0.1875rem] px-2 py-1.5">
            <div className="text-[0.75rem] text-muted truncate italic">{previewText}</div>
          </div>
        )}

        <label className="flex items-center gap-2 h-8 px-2.5 rounded-chip border border-white/[0.06] bg-white/[0.02] focus-within:border-white/[0.16] transition-colors cursor-text">
          <Search size="0.75rem" strokeWidth={1.6} className="text-faint shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder="Filter conversations…"
            className="bg-transparent text-[0.78125rem] flex-1 outline-none placeholder:text-faint min-w-0"
          />
        </label>

        <div className="max-h-72 overflow-y-auto -mx-1">
          {loading ? (
            <div className="px-2 py-3 text-[0.75rem] text-faint">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="px-2 py-3 text-[0.75rem] text-faint">No conversations found.</div>
          ) : (
            filtered.map((g) => (
              <button
                key={g.id}
                onClick={() => void forwardTo(g)}
                disabled={busyId !== null}
                className="w-full flex items-center justify-between gap-2.5 px-2 py-2 rounded-chip hover:bg-white/[0.02] transition-colors text-left disabled:opacity-50"
              >
                {/* Same identity slot as the conversation rail: a DM shows the
                    peer's photo (initials fallback), a vehicle group its uploaded
                    image (generic multi-user glyph fallback). */}
                {g.type === 'direct' ? (
                  <Avatar
                    userId={g.directPeer?.id ?? ''}
                    name={g.directPeer?.name ?? groupLabel(g)}
                    size={32}
                  />
                ) : (
                  <GroupAvatar groupId={g.id} hasAvatar={Boolean(g.hasAvatar)} size={32} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.78125rem] truncate">{groupLabel(g)}</span>
                  <span className="block text-[0.6875rem] text-faint truncate">
                    {g.type === 'vehicle' ? 'Vehicle group' : 'Direct message'}
                  </span>
                </span>
                {busyId === g.id && (
                  <span className="text-[0.6875rem] text-muted shrink-0">Sending…</span>
                )}
              </button>
            ))
          )}
        </div>

        {error && <div className="text-[0.75rem] text-alert">{error}</div>}
      </div>
    </Modal>
  )
}
