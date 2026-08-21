// Per-author colour for the left rule of an incoming message.
//
// WHY THIS EXISTS. A message in the reworked timeline is a label, a rule and an
// indent — no avatar, no bubble, no fill. Ownership is carried by SIDE (mine
// right, theirs left) and by the rule's weight (`line-2` vs `line`), which is a
// channel with exactly two values. That is enough for a direct message and not
// nearly enough for a vehicle room, where five other people's messages all
// arrive as the same 1px grey rule and the only thing telling them apart is a
// name set in a small mono label. This spends the one channel still free — the
// hue of that hairline — so a run of messages from one person is recognisable
// before a single word is read.
//
// It stays a HAIRLINE. The colour is one pixel wide: enough to identify, far
// too little to turn a deliberately monochrome thread into a colour-coded one.
// The name is always present too, so nothing here is the sole carrier of who
// said something.

// The palette lives in index.css as --author-0 … --author-7 (both themes). Eight
// is the ceiling for hues that stay honestly distinguishable at 1px; past that
// they start reading as "some blue" rather than as a specific person.
export const AUTHOR_COLOR_SLOTS = 8

function slotVar(slot: number): string {
  return `rgb(var(--author-${slot % AUTHOR_COLOR_SLOTS}))`
}

// FNV-1a. Used only for an author who is NOT in the roster any more — someone
// who left the room but whose messages are still in the thread. Their colour
// has to come from somewhere stable, and their id is all that's left.
function hashSlot(authorId: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < authorId.length; i++) {
    h ^= authorId.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % AUTHOR_COLOR_SLOTS
}

// Build the room's author → colour resolver.
//
// Slots are handed out by POSITION IN THE ROSTER SORTED BY ID, not by hashing
// the id. Hashing looks tidier and is wrong here: with eight slots and six
// members the chance that two of them collide is over 90%, and two people
// sharing a colour in the one room where you need to tell them apart defeats
// the whole feature. Sorting by id instead of by join order or by whatever
// order the API returned means every member of the room sees the same person in
// the same colour, and the assignment survives re-renders and reloads.
//
// A member joining or leaving can shift the slots of the members after them in
// the sort. That is rare, and the alternative — never reusing a slot — would
// exhaust the palette in a room that has churned a few times.
export function authorRuleColors(memberIds: string[]): (authorId: string) => string {
  const slots = new Map<string, string>()
  const sorted = [...memberIds].sort()
  sorted.forEach((id, i) => slots.set(id, slotVar(i)))
  return (authorId: string) => slots.get(authorId) ?? slotVar(hashSlot(authorId))
}
