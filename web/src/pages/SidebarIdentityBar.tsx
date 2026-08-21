import type { ReactNode } from 'react'
import type { User, Workspace } from '../auth/AuthContext'
import type { Profile } from '../lib/types'
import { AWAY, statusMeta } from '../lib/availability'

type Props = {
  user: User
  workspace: Workspace
  /** Prefetched profile — supplies the availability colour for the status dot. */
  profile: Profile | null
  /** Auto-away presence (idle / tab hidden): greys the dot without changing the
   *  stored status. */
  away: boolean
  /** Opens the Account view IN the sidebar (never a floating menu). */
  onOpenAccount: () => void
  /** Opens the existing company profile panel in the sidebar. */
  onOpenCompany: () => void
}

// The rail's fixed bottom row: WHO you are on the left, WHICH company you're in
// on the right, split exactly down the middle. Both halves are plain drill-in
// triggers into sidebar views — the account menu that used to pop out of the
// footer is gone, so nothing here floats over the conversation list.
//
// Neither half carries a picture any more (2026-08-20): the rail dropped every
// avatar, and a 37px portrait plus a company logo were most of this row's
// height in a rail that is now 380px wide. Name over a mono label carries the
// same information. The availability dot stays — it is live state, not
// decoration — and TRAILS the name, on the name's own line. In front of the
// name it was a child of the two-line cell, so it centred itself between the
// name and the role beneath: a mark about the person, floating in the gap
// between their two lines and indenting the name away from the company name
// opposite it. After the name, centred on that line, it reads as part of the
// name — the same placement a DM row uses in the list above (SidebarGroupRow).
//
// The row sits outside the scroller (see Workspace) and is always reachable. Each
// half owns its own hover / focus / active surface so the two never light up
// together, and both truncate rather than wrap, which keeps them usable at the
// narrowest rail width.
export default function SidebarIdentityBar({
  user,
  workspace,
  profile,
  away,
  onOpenAccount,
  onOpenCompany,
}: Props) {
  // Drivers have no availability, so they get no dot.
  const status = user.role === 'driver' ? null : away ? AWAY : profile ? statusMeta(profile.availabilityStatus) : null

  return (
    <div className="shrink-0 grid grid-cols-2 gap-1 px-1.5 pt-1.5 pb-1.5 border-t border-line">
      <button
        type="button"
        onClick={onOpenAccount}
        title={`${user.displayName} — account`}
        aria-label={`Account: ${user.displayName}`}
        className={IDENTITY_CELL}
      >
        <IdentityText
          primary={user.displayName}
          secondary={user.role}
          capitalize
          status={status}
        />
      </button>

      <button
        type="button"
        onClick={onOpenCompany}
        title={`${workspace.name} — company profile`}
        aria-label={`Company profile: ${workspace.name}`}
        className={IDENTITY_CELL}
      >
        <IdentityText primary={workspace.name} secondary="Company" />
      </button>
    </div>
  )
}

// One half of the row. `min-w-0` on the cell (and on the text block inside it)
// is what lets a long name truncate instead of pushing the grid track wider than
// its 50%.
const IDENTITY_CELL =
  'min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-btn text-left transition-colors ' +
  'hover:bg-white/8 active:bg-white/16 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20'

function IdentityText({
  primary,
  secondary,
  capitalize,
  status,
}: {
  primary: string
  secondary: ReactNode
  capitalize?: boolean
  /** Availability, drawn as a disc trailing the name. Omitted for the company
   *  half, which has no presence of its own. */
  status?: { label: string; color: string } | null
}) {
  return (
    <span className="min-w-0 flex-1">
      {/* The name line is a flex row so the disc can sit ON it. `items-center`
          against the name's line box, not the cell: the mark belongs to the
          name, so it centres on the name's text rather than on the two-line
          block. */}
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className="min-w-0 truncate font-medium leading-tight text-text"
          style={{ fontSize: 'var(--sidebar-row-font-size)' }}
        >
          {primary}
        </span>
        {status && (
          <span
            title={status.label}
            aria-label={status.label}
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: status.color }}
          />
        )}
      </span>
      {/* Mono: role and "Company" are labels for the name above them, not
          content of their own. `capitalize` is now redundant against the
          eyebrow's uppercase, so it only survives for non-role secondaries. */}
      <span className={`eyebrow block truncate leading-tight ${capitalize ? 'capitalize' : ''}`}>
        {secondary}
      </span>
    </span>
  )
}
