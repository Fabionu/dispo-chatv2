import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, CheckCheck, Clock } from 'lucide-react'
import Avatar from '../Avatar'
import { formatDay, formatTime } from './messageUtils'

// One potential reader of a sent message — a group member other than the
// author. `lastReadAt` is their conversation "read up to" marker; the message
// is considered seen iff lastReadAt >= the message's createdAt.
export type Reader = {
  id: string
  displayName: string
  hasAvatar?: boolean
  lastReadAt?: string | null
}

type Props = {
  // Everyone who could read this message (all members except me).
  others: Reader[]
  // The message's createdAt — the boundary each reader's marker is compared to.
  createdAt: string
  // Optimistic send still in flight — show a clock, no receipts yet.
  pending?: boolean
}

// Spec colours (kept local so they're explicit and don't drift):
//   muted read text  → #8F8A98   accent (fully read) → #D8A47F
const MUTED = '#8F8A98'
const ACCENT = '#D8A47F'

// Compact "seen at" label: just the time today, otherwise day + time.
function seenAt(iso: string): string {
  const day = formatDay(iso)
  const time = formatTime(iso)
  return day === 'Today' ? time : `${day}, ${time}`
}

// WhatsApp/Teams-style read indicator for my own sent messages. Renders the
// checkmark glyph in the bubble footer; clicking opens a small themed popover
// listing who has seen the message (with the time) and who hasn't yet.
//
// Colour rule (no faked state — all derived from real read markers):
//   • pending          → clock (still sending)
//   • delivered, unread→ double check, muted
//   • fully read       → double check, accent
//     (DM: the one peer has seen it; group: ALL other members have — a partial
//      group read stays muted.)
export default function ReadReceipts({ others, createdAt, pending }: Props) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  if (pending) {
    return (
      <span className="inline-flex items-center" aria-label="Sending" title="Sending…">
        <Clock size={13} strokeWidth={2} style={{ color: MUTED }} />
      </span>
    )
  }

  const created = new Date(createdAt).getTime()
  const seen = others
    .filter((r) => r.lastReadAt && new Date(r.lastReadAt).getTime() >= created)
    .sort((a, b) => (a.lastReadAt! < b.lastReadAt! ? -1 : 1))
  const notSeen = others.filter(
    (r) => !(r.lastReadAt && new Date(r.lastReadAt).getTime() >= created),
  )
  const fullyRead = others.length > 0 && notSeen.length === 0

  // No known peers yet (member list not loaded / solo group): show a plain
  // muted "delivered" double-check with no popover.
  if (others.length === 0) {
    return (
      <span className="inline-flex items-center" aria-label="Sent" title="Sent">
        <CheckCheck size={14} strokeWidth={2} style={{ color: MUTED }} />
      </span>
    )
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        aria-label={fullyRead ? 'Read — see who' : 'Delivered — see who has read'}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center"
      >
        <CheckCheck size={14} strokeWidth={2} style={{ color: fullyRead ? ACCENT : MUTED }} />
      </button>
      {open && (
        <ReceiptsPopover
          anchorEl={btnRef.current}
          seen={seen}
          notSeen={notSeen}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

// The floating, theme-matched list. Portaled + fixed-positioned so it escapes
// the scroll container and is clamped inside the chat pane (never under the
// sidebar) and the viewport. Opens above the checkmark, flipping below when
// there's no room.
function ReceiptsPopover({
  anchorEl,
  seen,
  notSeen,
  onClose,
}: {
  anchorEl: HTMLElement | null
  seen: Reader[]
  notSeen: Reader[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; visible: boolean }>({
    top: 0,
    left: 0,
    visible: false,
  })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !anchorEl) return
    const r = el.getBoundingClientRect()
    const a = anchorEl.getBoundingClientRect()
    const sidebarW =
      parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')) || 0
    const minLeft = Math.max(8, sidebarW + 8)

    // Bottom boundary: stop short of the composer/input so the popover never
    // covers it. Falls back to the viewport edge when the composer isn't found.
    const composer = document.querySelector('[data-composer]')
    const bottomLimit = composer
      ? composer.getBoundingClientRect().top - 8
      : window.innerHeight - 8

    let left = a.right - r.width
    // Prefer opening BELOW the checkmark (at the bottom of the bubble)…
    let top = a.bottom + 6
    // …but flip above if that would overlap the composer / run off-screen.
    if (top + r.height > bottomLimit) {
      const above = a.top - r.height - 6
      top = above >= 8 ? above : Math.max(8, bottomLimit - r.height)
    }
    if (left + r.width > window.innerWidth - 8) left = window.innerWidth - r.width - 8
    if (left < minLeft) left = minLeft
    if (top < 8) top = 8
    setPos({ top, left, visible: true })
  }, [anchorEl, seen.length, notSeen.length])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      if (anchorEl?.contains(t)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorEl, onClose])

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Read receipts"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 60,
        visibility: pos.visible ? 'visible' : 'hidden',
      }}
      className="w-[232px] max-h-[300px] overflow-y-auto rounded-card border border-white/[0.08] bg-surface py-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.55)]"
    >
      {seen.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 px-3 pb-1 pt-0.5">
            <CheckCheck size={12} strokeWidth={2} style={{ color: ACCENT }} />
            <span className="text-[10px] uppercase tracking-[0.08em] text-faint">
              Seen by {seen.length}
            </span>
          </div>
          {seen.map((r) => (
            <div key={r.id} className="flex items-stretch gap-2.5 px-3 py-1">
              <Avatar userId={r.id} name={r.displayName} size={30} />
              {/* Name + time share one column: name to the avatar's top edge,
                  time to its bottom edge (justify-between over the avatar height). */}
              <div className="min-w-0 flex-1 flex flex-col justify-between py-px">
                <div className="text-[12.5px] text-text truncate leading-tight">{r.displayName}</div>
                <div className="text-[10.5px] text-muted truncate leading-tight">
                  {r.lastReadAt ? seenAt(r.lastReadAt) : ''}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {notSeen.length > 0 && (
        <>
          {seen.length > 0 && <div className="my-1 h-px bg-white/[0.06]" />}
          <div className="flex items-center gap-1.5 px-3 pb-1 pt-0.5">
            <Check size={12} strokeWidth={2} className="text-faint" />
            <span className="text-[10px] uppercase tracking-[0.08em] text-faint">Not seen yet</span>
          </div>
          {notSeen.map((r) => (
            <div key={r.id} className="flex items-center gap-2.5 px-3 py-1 opacity-60">
              <Avatar userId={r.id} name={r.displayName} size={30} />
              {/* Same compact row, no timestamp. */}
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-muted truncate leading-tight">
                  {r.displayName}
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>,
    document.body,
  )
}
