import { useState } from 'react'
import { Truck } from 'lucide-react'
import type { GroupInvite } from '../../lib/types'
import { api, ApiError } from '../../lib/api'

type Props = {
  invite: GroupInvite
  onAccepted: (groupId: string) => void | Promise<void>
  onDeclined: () => void | Promise<void>
}

// Main-pane detail view for a single pending vehicle-group invite. Operational
// approval screen consistent with the connection-request redesign: the vehicle
// identity (name + tractor/trailer plates) is centered, who invited you is
// shown, and Accept/Decline live in a fixed bottom action bar.
export default function GroupInviteView({ invite, onAccepted, onDeclined }: Props) {
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    setBusy('accept')
    setError(null)
    try {
      const { groupId } = await api.groupInvites.accept(invite.id)
      await onAccepted(groupId)
    } catch (err) {
      setError(messageFor(err))
      setBusy(null)
    }
  }

  async function decline() {
    setBusy('decline')
    setError(null)
    try {
      await api.groupInvites.decline(invite.id)
      await onDeclined()
    } catch (err) {
      setError(messageFor(err))
      setBusy(null)
    }
  }

  const title = invite.groupName ?? 'Vehicle group'

  return (
    <>
      {/* Header — mirrors ChatView / ConnectionRequestView */}
      <header className="h-[var(--header-height)] flex items-center justify-between px-5 shrink-0">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold truncate">{title}</div>
          <div className="text-[11px] text-muted truncate">Vehicle group invitation</div>
        </div>
        <span className="font-mono text-[11px] text-muted border border-white/[0.08] rounded-chip px-2 py-0.5 shrink-0">
          Pending
        </span>
      </header>

      {/* Centered vehicle identity block */}
      <div className="flex-1 overflow-y-auto flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-[420px] flex flex-col items-center text-center">
          <div className="h-[88px] w-[88px] rounded-full bg-active/20 border border-active/40 flex items-center justify-center">
            <Truck size={38} strokeWidth={1.5} className="text-active" />
          </div>

          <div className="mt-3">
            <span className="eyebrow text-faint">Group invitation</span>
          </div>

          <h2 className="mt-2 text-[21px] font-semibold tracking-[-0.3px] leading-tight">{title}</h2>
          <div className="mt-1 text-[13px] text-muted">
            Invited by {invite.invitedByName}
          </div>

          {(invite.tractorPlate || invite.trailerPlate) && (
            <div className="mt-5 w-full max-w-[360px] grid grid-cols-2 gap-2">
              <PlateCard label="Tractor" value={invite.tractorPlate} />
              <PlateCard label="Trailer" value={invite.trailerPlate} />
            </div>
          )}

          <div className="mt-5 text-[11px] text-faint">Invited {formatDay(invite.createdAt)}</div>
        </div>
      </div>

      {/* Bottom action bar — fixed at the foot of the pane, composer-like */}
      <div className="shrink-0 border-t border-white/[0.06] bg-rail px-6 py-3.5">
        <div className="mx-auto w-full max-w-[440px]">
          {error && <div className="text-[11.5px] text-alert text-center mb-2">{error}</div>}
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

function PlateCard({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-card border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-left">
      <div className="eyebrow text-faint mb-1">{label}</div>
      <div className="font-mono text-[13px] text-text truncate">{value || '—'}</div>
    </div>
  )
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError && err.code === 'not_pending') {
    return 'That invitation was already handled.'
  }
  if (err instanceof ApiError && err.code === 'not_found') {
    return 'That invitation is no longer available.'
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
