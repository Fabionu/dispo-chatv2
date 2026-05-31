import { useEffect, useRef } from 'react'
import { AtSign } from 'lucide-react'
import type { GroupMember } from '../../lib/types'
import Avatar from '../Avatar'

type Props = {
  members: GroupMember[]
  activeIndex: number
  onHover: (index: number) => void
  onSelect: (member: GroupMember) => void
}

// Compact member picker shown above the composer while typing an @-mention.
// Selection lives in the parent (so keyboard nav and the textarea stay in
// sync); this component just renders the filtered list and reports hover/click.
// Mouse selection uses onMouseDown + preventDefault so the textarea never loses
// focus mid-pick.
export default function MentionPicker({ members, activeIndex, onHover, onSelect }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the highlighted row in view during arrow-key navigation.
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (members.length === 0) return null

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Mention a member"
      className="absolute bottom-full left-0 mb-1.5 w-[260px] max-h-[200px] overflow-y-auto rounded-card border border-white/[0.12] bg-surface py-1 z-20"
      style={{ boxShadow: '0 16px 40px rgba(0,0,0,0.55)' }}
    >
      {members.map((m, i) => {
        const active = i === activeIndex
        return (
          <button
            key={m.id}
            type="button"
            role="option"
            aria-selected={active}
            onMouseDown={(e) => {
              // Keep textarea focus; perform the insert ourselves.
              e.preventDefault()
              onSelect(m)
            }}
            onMouseEnter={() => onHover(i)}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors ${
              active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.03]'
            }`}
          >
            <Avatar userId={m.id} name={m.displayName} size={24} />
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] text-text truncate">{m.displayName}</span>
              {m.workspace && (
                <span className="block text-[10.5px] text-faint truncate">{m.workspace}</span>
              )}
            </span>
            <AtSign size={12} strokeWidth={1.8} className="text-faint shrink-0" />
          </button>
        )
      })}
    </div>
  )
}
