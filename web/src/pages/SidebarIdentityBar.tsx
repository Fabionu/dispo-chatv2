import type { ReactNode } from 'react'
import type { User, Workspace } from '../auth/AuthContext'
import type { Profile } from '../lib/types'
import { AWAY, statusMeta } from '../lib/availability'
import Avatar from '../components/Avatar'
import CompanyLogo from '../components/CompanyLogo'

type Props = {
  user: User
  workspace: Workspace
  /** Prefetched profile — supplies the availability colour for the status dot. */
  profile: Profile | null
  /** Auto-away presence (idle / tab hidden): greys the dot without changing the
   *  stored status. */
  away: boolean
  /** Avatar / logo diameter for the active density tier. */
  size: number
  avatarVersion: number
  logoVersion: number
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
// The row sits outside the scroller (see Workspace) and is always reachable. Each
// half owns its own hover / focus / active surface so the two never light up
// together, and both truncate rather than wrap, which keeps them usable at the
// narrowest rail width.
export default function SidebarIdentityBar({
  user,
  workspace,
  profile,
  away,
  size,
  avatarVersion,
  logoVersion,
  onOpenAccount,
  onOpenCompany,
}: Props) {
  // Drivers have no availability, so they get no dot.
  const status = user.role === 'driver' ? null : away ? AWAY : profile ? statusMeta(profile.availabilityStatus) : null

  return (
    <div className="shrink-0 grid grid-cols-2 gap-1 px-1.5 pt-1.5 pb-1.5 border-t border-white/6">
      <button
        type="button"
        onClick={onOpenAccount}
        title={`${user.displayName} — account`}
        aria-label={`Account: ${user.displayName}`}
        className={IDENTITY_CELL}
      >
        <span className="relative shrink-0">
          <Avatar userId={user.id} name={user.displayName} size={size} version={avatarVersion} />
          {status && (
            <span
              title={status.label}
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-sidebar"
              style={{ backgroundColor: status.color }}
            />
          )}
        </span>
        <IdentityText primary={user.displayName} secondary={user.role} capitalize />
      </button>

      <button
        type="button"
        onClick={onOpenCompany}
        title={`${workspace.name} — company profile`}
        aria-label={`Company profile: ${workspace.name}`}
        className={IDENTITY_CELL}
      >
        <CompanyLogo size={size} version={logoVersion} className="!rounded-full" />
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
}: {
  primary: string
  secondary: ReactNode
  capitalize?: boolean
}) {
  return (
    <span className="min-w-0 flex-1">
      <span
        className="block truncate font-medium leading-tight text-text"
        style={{ fontSize: 'var(--sidebar-row-font-size)' }}
      >
        {primary}
      </span>
      <span
        className={`block truncate leading-tight text-muted ${capitalize ? 'capitalize' : ''}`}
        style={{ fontSize: 'var(--sidebar-meta-font-size)' }}
      >
        {secondary}
      </span>
    </span>
  )
}
