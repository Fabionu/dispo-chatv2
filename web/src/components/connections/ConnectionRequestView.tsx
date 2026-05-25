import { useState } from 'react'
import type { Connection, ConnectionUser } from '../../lib/types'
import { api, ApiError } from '../../lib/api'

type Props = {
  connection: Connection
  onAccepted: (otherUser: ConnectionUser) => void | Promise<void>
  onDeclined: () => void | Promise<void>
}

// Main-pane view for a single pending connection request. Wears ChatView's
// header + scrollable body shell, but the body contains one inline "invite"
// row attributed to the requester — Accept/Decline live inside the row, not
// in a separate bottom action bar.
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
      <header className="h-12 flex items-center justify-between px-5 border-b border-white/[0.06] shrink-0">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold truncate">{u.displayName}</div>
          <div className="text-[11px] text-muted truncate">{u.workspace.name}</div>
        </div>
        <span className="font-mono text-[11px] text-muted border border-white/[0.08] rounded-chip px-2 py-0.5 shrink-0">
          Pending
        </span>
      </header>

      {/* Body — chat-style area with a single in-chat invite row */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto w-full xl:max-w-[960px] 2xl:max-w-[1040px]">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-3 py-3">
              <div className="h-px flex-1 bg-white/[0.06]" />
              <span className="eyebrow">{formatDay(connection.requestedAt)}</span>
              <div className="h-px flex-1 bg-white/[0.06]" />
            </div>

            <div className="flex items-start gap-2.5 mt-2.5">
              <div className="h-7 w-7 rounded-full bg-active/30 border border-active/40 flex items-center justify-center shrink-0 text-[10px] font-semibold uppercase font-mono mt-0.5">
                {initials(u.displayName)}
              </div>
              <div className="min-w-0 flex-1 flex flex-col items-start">
                <div className="text-[11px] text-muted mb-1 px-1">
                  {u.displayName}
                  <span className="text-faint"> · {formatTime(connection.requestedAt)}</span>
                </div>

                {/* Invite row — chat bubble shape, horizontal layout, actions inline */}
                <div className="w-full max-w-[640px] bg-surface border border-white/[0.08] rounded-[7px] rounded-bl-[2px] px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-text leading-[1.35]">
                      Connection request
                    </div>
                    <div className="text-[11.5px] text-muted leading-[1.4] break-words">
                      {connection.message ?? 'wants to connect with your workspace.'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    <button
                      onClick={() => void decline()}
                      disabled={busy !== null}
                      className="text-[12px] font-medium rounded-btn px-3 py-1 border border-white/[0.14] text-text hover:bg-white/[0.04] disabled:opacity-50 transition-colors"
                    >
                      {busy === 'decline' ? 'Declining…' : 'Decline'}
                    </button>
                    <button
                      onClick={() => void accept()}
                      disabled={busy !== null}
                      className="text-[12px] font-semibold rounded-btn px-3 py-1 bg-text text-bg hover:bg-text/90 disabled:opacity-50 transition-colors"
                    >
                      {busy === 'accept' ? 'Accepting…' : 'Accept'}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="text-[11.5px] text-alert mt-1.5 px-1">{error}</div>
                )}
              </div>
            </div>
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0] ?? '').join('').toUpperCase() || '?'
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDay(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}
