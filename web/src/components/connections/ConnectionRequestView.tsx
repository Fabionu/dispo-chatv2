import { useState } from 'react'
import type { Connection } from '../../lib/types'
import { api, ApiError } from '../../lib/api'

type Props = {
  connection: Connection
  onAccepted: (otherUserId: string) => void | Promise<void>
  onDeclined: () => void | Promise<void>
}

// Main-pane view for a single pending connection request. Wears the same
// header + body + bottom-bar shape as ChatView so it slots in alongside chats
// without breaking the rhythm of the workspace.
export default function ConnectionRequestView({ connection, onAccepted, onDeclined }: Props) {
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const u = connection.otherUser

  async function accept() {
    setBusy('accept')
    setError(null)
    try {
      await api.connections.accept(connection.id)
      await onAccepted(u.id)
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
          <div className="text-[11px] text-muted truncate">
            Connection request from {u.workspace.name}
          </div>
        </div>
        <span className="font-mono text-[11px] text-muted border border-white/[0.08] rounded-chip px-2 py-0.5 shrink-0">
          Pending
        </span>
      </header>

      {/* Body — chat-style message area */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto w-full xl:max-w-[960px] 2xl:max-w-[1040px]">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-3 py-3">
              <div className="h-px flex-1 bg-white/[0.06]" />
              <span className="eyebrow">{formatDay(connection.requestedAt)}</span>
              <div className="h-px flex-1 bg-white/[0.06]" />
            </div>

            <div className="flex flex-col items-start mt-2.5">
              <div className="text-[11px] text-muted mb-1 px-1">{u.displayName}</div>
              <div className="max-w-[78%] px-3 pt-1.5 pb-1 text-[13px] leading-[1.5] flex flex-col bg-surface border border-white/[0.08] text-text rounded-[7px] rounded-bl-[2px]">
                <span className="whitespace-pre-wrap break-words">
                  {connection.message ?? 'wants to connect with your workspace.'}
                </span>
                <span className="text-[10.5px] text-muted leading-none mt-1 self-end">
                  {formatTime(connection.requestedAt)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom action bar — composer-shaped */}
      <div className="px-5 pb-4 pt-1 shrink-0">
        <div className="mx-auto w-full xl:max-w-[960px] 2xl:max-w-[1040px]">
          {error && <div className="text-[11.5px] text-alert mb-1.5">{error}</div>}
          <div className="flex items-center gap-2 rounded-card border border-white/[0.08] bg-white/[0.02] px-3 py-2">
            <span className="flex-1 text-[12px] text-muted truncate">
              Respond to {firstName(u.displayName)}’s request
            </span>
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

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? 'them'
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
