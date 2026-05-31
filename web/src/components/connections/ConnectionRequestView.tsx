import { useState } from 'react'
import type { Connection, ConnectionUser } from '../../lib/types'
import { api, ApiError } from '../../lib/api'
import Avatar from '../Avatar'

type Props = {
  connection: Connection
  onAccepted: (otherUser: ConnectionUser) => void | Promise<void>
  onDeclined: () => void | Promise<void>
}

// Main-pane detail view for a single pending connection request. Reads as an
// operational approval screen — not an in-chat invite bubble: the requester's
// identity is centered in the content area, and the Accept/Decline decision
// lives in a fixed action bar at the bottom of the pane (composer-like), not
// inside a message row.
export default function ConnectionRequestView({ connection, onAccepted, onDeclined }: Props) {
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const u = connection.otherUser

  async function accept() {
    setBusy('accept')
    setError(null)
    try {
      await api.connections.accept(connection.id)
      await onAccepted(u)
    } catch (err) {
      setError(messageFor(err))
      setBusy(null)
    }
  }

  async function decline() {
    setBusy('decline')
    setError(null)
    try {
      await api.connections.decline(connection.id)
      await onDeclined()
    } catch (err) {
      setError(messageFor(err))
      setBusy(null)
    }
  }

  return (
    <>
      {/* Header — mirrors ChatView */}
      <header className="h-[var(--header-height)] flex items-center justify-between px-5 border-b border-white/[0.06] bg-rail shrink-0">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold truncate">{u.displayName}</div>
          <div className="text-[11px] text-muted truncate">{u.workspace.name}</div>
        </div>
        <span className="font-mono text-[11px] text-muted border border-white/[0.08] rounded-chip px-2 py-0.5 shrink-0">
          Pending
        </span>
      </header>

      {/* Centered identity block */}
      <div className="flex-1 overflow-y-auto flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-[420px] flex flex-col items-center text-center">
          <Avatar userId={u.id} name={u.displayName} size={88} />

          <div className="mt-1.5">
            <span className="eyebrow text-faint">Connection request</span>
          </div>

          <h2 className="mt-2 text-[21px] font-semibold tracking-[-0.3px] leading-tight">
            {u.displayName}
          </h2>
          <div className="mt-1 text-[13px] text-muted">{u.workspace.name}</div>
          {u.email && <div className="mt-0.5 text-[12px] text-faint">{u.email}</div>}

          {connection.message && (
            <div className="mt-5 w-full max-w-[360px] rounded-card border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 text-left">
              <div className="eyebrow text-faint mb-1">Message</div>
              <p className="text-[12.5px] text-text leading-[1.5] break-words whitespace-pre-wrap">
                {connection.message}
              </p>
            </div>
          )}

          <div className="mt-5 text-[11px] text-faint">
            Requested {formatDay(connection.requestedAt)}
          </div>
        </div>
      </div>

      {/* Bottom action bar — fixed at the foot of the pane, composer-like */}
      <div className="shrink-0 border-t border-white/[0.06] bg-rail px-6 py-3.5">
        <div className="mx-auto w-full max-w-[440px]">
          {error && (
            <div className="text-[11.5px] text-alert text-center mb-2">{error}</div>
          )}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => void decline()}
              disabled={busy !== null}
              className="flex-1 h-10 rounded-btn border border-white/[0.14] text-text text-[13px] font-medium hover:bg-white/[0.04] disabled:opacity-50 transition-colors"
            >
              {busy === 'decline' ? 'Declining…' : 'Decline'}
            </button>
            <button
              onClick={() => void accept()}
              disabled={busy !== null}
              className="flex-1 h-10 rounded-btn bg-text text-bg text-[13px] font-semibold hover:bg-text/90 disabled:opacity-50 transition-colors"
            >
              {busy === 'accept' ? 'Accepting…' : 'Accept'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError && err.code === 'not_pending') {
    return 'That request was already handled.'
  }
  return 'Something went wrong. Try again.'
}

function formatDay(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'today'
  if (d.toDateString() === yesterday.toDateString()) return 'yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}
