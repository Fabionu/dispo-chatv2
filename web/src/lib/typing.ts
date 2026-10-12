export type TypingUser = { id: string; name: string }

const firstName = (name: string) => name.split(' ')[0] || name

/**
 * One piece of the "who is typing" sentence. `user` is set on the pieces that
 * ARE a person's name, so a surface can set the names apart — the thread's dock
 * colours each one by its author — without parsing the string back apart.
 */
export type TypingPart = { text: string; user?: TypingUser }

/**
 * The sentence behind every typing surface (the dock above the composer, the
 * header, the conversation-list row), as parts. `compact` is for a surface that
 * already names the person next to it: a direct message's row and header.
 */
export function typingParts(users: TypingUser[], compact = false): TypingPart[] {
  if (users.length === 0) return []
  if (compact) {
    return [{ text: users.length === 1 ? 'typing' : `${users.length} people are typing` }]
  }
  const [a, b] = users
  if (users.length === 1) {
    return [{ text: firstName(a.name), user: a }, { text: ' is typing' }]
  }
  if (users.length === 2) {
    return [
      { text: firstName(a.name), user: a },
      { text: ' and ' },
      { text: firstName(b.name), user: b },
      { text: ' are typing' },
    ]
  }
  return [
    { text: firstName(a.name), user: a },
    { text: ', ' },
    { text: firstName(b.name), user: b },
    { text: ` and ${users.length - 2} more are typing` },
  ]
}

/**
 * The same sentence as plain text, for the header and the rail. It carries NO
 * trailing ellipsis: it used to ("Fabio is typing…"), when that was the only
 * way to say "still happening". Every surface now leads with the typing mark,
 * which says it better, and an ellipsis after the words read as a stutter beside
 * three animated dots.
 */
export function typingLabel(users: TypingUser[], compact = false): string {
  return typingParts(users, compact)
    .map((part) => part.text)
    .join('')
}
