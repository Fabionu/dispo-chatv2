import { CircleUser, LogOut, Settings } from 'lucide-react'
import type { User } from '../../auth/AuthContext'
import type { Profile } from '../../lib/types'
import { AWAY, statusMeta } from '../../lib/availability'
import Avatar from '../Avatar'
import { PanelHeader, CategoryRow, PANEL_GROUP_CARD } from './panelChrome'
import {
  PANEL_BODY,
  PROFILE_HERO_SIZE,
  ProfileHero,
  SIDEBAR_PANEL_SURFACE,
  StatusPill,
} from './profileChrome'
import { ROLE_LABEL } from './ProfileSidebarPanel'

type Props = {
  user: User
  /** Prefetched profile — supplies the live availability status for the dot. */
  profile: Profile | null
  /** Auto-away presence (idle / tab hidden). */
  away: boolean
  /** Busts the avatar image cache after the user changes their photo. */
  avatarVersion: number
  onBack: () => void
  onOpenProfile: () => void
  onOpenSettings: () => void
  onSignOut: () => void
}

// The account root of the rail's drill-in stack, opened from the user half of
// the sidebar's bottom row. It replaces the floating account dropdown the footer
// used to raise: the same four destinations, but as a sidebar VIEW — so the
// account lives at the same level as the profile / company / settings panels it
// leads to, instead of a popover that covers the conversation list.
//
// Level 1 of the stack (Back → the conversation list); "My profile" and
// "Workspace settings" drill one level deeper and come back here.
export default function AccountSidebarPanel({
  user,
  profile,
  away,
  avatarVersion,
  onBack,
  onOpenProfile,
  onOpenSettings,
  onSignOut,
}: Props) {
  // Drivers have no availability, so no status line — same rule as the rail's
  // identity row and the profile panel.
  const status = user.role === 'driver' ? null : away ? AWAY : profile ? statusMeta(profile.availabilityStatus) : null

  return (
    <div className={`flex flex-col h-full ${SIDEBAR_PANEL_SURFACE}`}>
      <PanelHeader title="Account" onBack={onBack} backLabel="Back to conversations" />

      <div className={PANEL_BODY}>
        {/* Identity — the shared hero every profile surface uses. */}
        <ProfileHero
          image={
            <Avatar
              userId={user.id}
              name={user.displayName}
              size={PROFILE_HERO_SIZE}
              version={avatarVersion}
            />
          }
          title={user.displayName}
          subtitle={ROLE_LABEL[user.role]}
          status={
            status && (
              <StatusPill
                label={status.label}
                color={status.color}
                suffix={away ? <span className="opacity-70">· auto</span> : undefined}
              />
            )
          }
        />

        <div className={PANEL_GROUP_CARD}>
          <CategoryRow
            icon={<CircleUser size="1rem" strokeWidth={1.8} />}
            title="My profile"
            value="Photo, work details, languages"
            onClick={onOpenProfile}
          />
          <CategoryRow
            icon={<Settings size="1rem" strokeWidth={1.8} />}
            title="Workspace settings"
            value="Appearance, notifications, about"
            onClick={onOpenSettings}
          />
        </div>

        {/* Sign out sits apart from the navigation group — it leaves the app
            rather than opening anything, and carries the app's single
            destructive treatment (alert text, quiet alert-tinted hover). */}
        <button
          onClick={onSignOut}
          className="w-full flex items-center gap-3 rounded-card border border-line bg-white/2 px-3.5 py-3 text-left transition-colors hover:bg-alert/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <span className="h-8 w-8 shrink-0 flex items-center justify-center rounded-btn border border-alert/20 bg-alert/[0.06] text-alert">
            <LogOut size="1rem" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-medium text-alert leading-tight">Sign out</span>
            <span className="block text-sm text-faint mt-0.5 leading-[1.4] truncate">
              End this session on this device
            </span>
          </span>
        </button>
      </div>
    </div>
  )
}
