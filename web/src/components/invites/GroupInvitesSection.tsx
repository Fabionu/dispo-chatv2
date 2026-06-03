import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { GroupInvite } from '../../lib/types'
import GroupInviteRow from './GroupInviteRow'

type Props = {
  invites: GroupInvite[]
  selectedId: string | null
  onSelect: (inviteId: string) => void
}

// Collapsible "Group invites" rail section — a sibling of (and separate from)
// the cross-company "Connection requests" section. Owns its open/closed state
// and auto-expands the first time an invite appears, until the user toggles it.
export default function GroupInvitesSection({ invites, selectedId, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const toggledRef = useRef(false)
  const count = invites.length

  useEffect(() => {
    if (toggledRef.current) return
    if (count > 0) setOpen(true)
  }, [count])

  // Hide the section entirely when there are no pending invites — it only
  // matters when there's something to act on.
  if (count === 0) return null

  function toggle() {
    toggledRef.current = true
    setOpen((v) => !v)
  }

  return (
    <div>
      <button
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-2 mb-1.5 py-0.5 rounded-chip hover:bg-white/[0.02] transition-colors"
      >
        <ChevronDown
          size={10}
          strokeWidth={2}
          className={`text-faint shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
        />
        <span
          className="eyebrow flex-1 text-left"
          style={{ fontSize: 'var(--sidebar-section-font-size)' }}
        >
          Group invites
        </span>
        <span className="font-mono text-[10px] font-semibold bg-active text-bg rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center shrink-0">
          {count}
        </span>
      </button>

      {open && (
        <div className="space-y-0.5">
          {invites.map((inv) => (
            <GroupInviteRow
              key={inv.id}
              invite={inv}
              selected={selectedId === inv.id}
              onClick={() => onSelect(inv.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
