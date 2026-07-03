export type TypingUser = { id: string; name: string }

// Compact "… is typing" line with three pulsing dots. Handles one, two, or
// many simultaneous typers (groups) without getting long.
export default function TypingIndicator({ users }: { users: TypingUser[] }) {
  if (users.length === 0) return null

  const first = (n: string) => n.split(' ')[0] || n
  let text: string
  if (users.length === 1) {
    text = `${first(users[0].name)} is typing`
  } else if (users.length === 2) {
    text = `${first(users[0].name)} and ${first(users[1].name)} are typing`
  } else {
    text = `${first(users[0].name)}, ${first(users[1].name)} and ${users.length - 2} more are typing`
  }

  return (
    <div
      className="flex items-center gap-1.5 text-[0.6875rem] text-muted h-4"
      aria-live="polite"
    >
      <span className="flex items-center gap-0.5" aria-hidden="true">
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </span>
      <span className="truncate">{text}</span>
    </div>
  )
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1 w-1 rounded-full bg-active/80 animate-bounce"
      style={{ animationDelay: delay, animationDuration: '1s' }}
    />
  )
}
