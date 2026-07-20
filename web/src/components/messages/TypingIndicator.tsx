import { useEffect, useState } from 'react'
import Avatar from '../Avatar'

export type TypingUser = { id: string; name: string }

// Temporary incoming-style bubble in the measured composer lane, immediately
// above the input. The outer grid animates its real height, so ChatView expands
// the list's bottom reserve and the conversation lifts/settles with the state.
// Multiple typers share one identity stack and one compact dots bubble.
export default function TypingIndicator({ users }: { users: TypingUser[] }) {
  // Keep the last active set mounted very briefly after the socket says typing
  // stopped. That gives the capsule time to ease away instead of blinking out;
  // a new typing event during the exit cancels it immediately.
  const [displayedUsers, setDisplayedUsers] = useState(users)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (users.length > 0) {
      setDisplayedUsers(users)
      setLeaving(false)
      return
    }
    if (displayedUsers.length === 0) return

    setLeaving(true)
    const timer = window.setTimeout(() => {
      setDisplayedUsers([])
      setLeaving(false)
    }, 160)
    return () => window.clearTimeout(timer)
  }, [users, displayedUsers.length])

  const first = (n: string) => n.split(' ')[0] || n
  const text =
    displayedUsers.length === 1
      ? `${first(displayedUsers[0].name)} is typing`
      : displayedUsers.length === 2
        ? `${first(displayedUsers[0].name)} and ${first(displayedUsers[1].name)} are typing`
        : displayedUsers.length > 2
          ? `${first(displayedUsers[0].name)}, ${first(displayedUsers[1].name)} and ${displayedUsers.length - 2} more are typing`
          : ''
  const identityWidth =
    displayedUsers.length > 2 ? 'w-[4.25rem]' : displayedUsers.length === 2 ? 'w-12' : 'w-8'

  return (
    <div
      className={`typing-indicator-slot ${users.length > 0 ? 'typing-indicator-slot-visible' : ''}`}
    >
      <div className="min-h-0 overflow-hidden">
        {displayedUsers.length > 0 && (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={`${leaving ? 'typing-indicator-exit' : 'typing-indicator-enter'} flex max-w-[min(82%,48rem)] items-end gap-2.5 pt-1 pb-2`}
          >
            <span
              className={`flex ${identityWidth} shrink-0 -space-x-2 pb-0.5`}
              aria-hidden="true"
            >
              {displayedUsers.slice(0, 2).map((user, index) => (
                <span
                  key={user.id}
                  className="typing-avatar-enter relative rounded-full ring-2 ring-rail"
                  style={{ zIndex: 2 - index, animationDelay: `${index * 70}ms` }}
                >
                  <Avatar userId={user.id} name={user.name} size={28} />
                </span>
              ))}
              {displayedUsers.length > 2 && (
                <span className="relative z-0 flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-rail bg-surface-2 px-1 text-[0.53125rem] font-semibold text-muted">
                  +{displayedUsers.length - 2}
                </span>
              )}
            </span>
            <span className="flex min-w-0 flex-col items-start gap-1">
              <span className="max-w-full truncate px-1 text-[0.75rem] font-medium leading-none text-muted">
                {text}
              </span>
              {/* Same neutral skin and sender-side tail as an incoming message
                  bubble; the content is only the live composing rhythm. */}
              <span className="flex h-8 items-center gap-1 rounded-[0.5rem] rounded-bl-[0.1875rem] bg-surface-2 px-3" aria-hidden="true">
                <Dot delay="0ms" />
                <Dot delay="160ms" />
                <Dot delay="320ms" />
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="typing-dot h-1 w-1 rounded-full bg-muted"
      style={{ animationDelay: delay }}
    />
  )
}
