import type { ReactNode } from 'react'

// ── Zero-height identity slot for sidebar rows ───────────────────────────────
// Lets the avatar be LARGER than the row's two-line text block without adding
// row height: the outer span contributes 0px to the flex row (h-0, centred), so
// row density stays set by the text and --sidebar-row-height alone while the
// avatar bleeds symmetrically into the row's existing vertical padding. The
// inner span is the `relative` anchor, so presence/status dots positioned
// against it keep their exact geometry relative to the avatar. Used by every
// rail row (conversations, contacts, connection requests, group invites) so the
// identity column reads identically everywhere.
export default function IdentitySlot({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 flex h-0 items-center">
      <span className="relative flex">{children}</span>
    </span>
  )
}
