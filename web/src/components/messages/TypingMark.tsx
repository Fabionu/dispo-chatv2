// The typing mark: three small copper dots that light on an uneven beat — two in
// quick succession, then one after a pause, then a rest — which is how a person
// types and not how a loading spinner turns. It is the ONE thing every typing
// surface shares (the dock above the composer, the conversation-list row, the
// thread header), so "someone is typing" looks like the same event wherever you
// happen to be looking.
//
// Copper because `--color-active` is already the app's colour for content that is
// ARRIVING (the header and the rail set their typing text in it), and because it
// is the one warm note on a near-black field: the old grey dots at 30% were
// barely there.
//
// Decorative — the sentence beside it carries the meaning, and the dock is the
// live region. The motion lives in index.css (`.typing-mark`, `.typing-dot`),
// where the stillness rules for reduced motion and Settings → Animations also
// are; there is nothing to switch off here.
export default function TypingMark() {
  return (
    <span className="typing-mark" aria-hidden="true">
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </span>
  )
}
