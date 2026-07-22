export type TypingUser = { id: string; name: string }

const firstName = (name: string) => name.split(' ')[0] || name

/** Shared copy for the chat bubble, header, and conversation-list preview. */
export function typingStatusText(users: TypingUser[], compact = false): string {
  if (users.length === 0) return ''
  if (compact) {
    return users.length === 1 ? 'typing…' : `${users.length} people are typing…`
  }
  if (users.length === 1) return `${firstName(users[0].name)} is typing…`
  if (users.length === 2) {
    return `${firstName(users[0].name)} and ${firstName(users[1].name)} are typing…`
  }
  return `${firstName(users[0].name)}, ${firstName(users[1].name)} and ${users.length - 2} more are typing…`
}
