import { useEffect, useState } from 'react'
import { CircleUser, LogOut, Settings } from 'lucide-react'
import type { User } from '../../auth/AuthContext'
import type { AvailabilityStatus, Profile } from '../../lib/types'
import { api } from '../../lib/api'
import { AVAILABILITY, AWAY, statusMeta } from '../../lib/availability'
import { avatarUrl } from '../../lib/avatarCache'
import { useTheme } from '../../lib/theme'
import { MESSAGE_STYLE_LABEL, useMessageStyle } from '../../lib/messageStyle'
import { useBrowserNotifications } from '../../lib/browserNotifications'
import { RowMeta } from '../../pages/sidebarBits'
import Avatar from '../Avatar'
import { usePhotoEditor } from '../AvatarPhotoEditor'
import { PanelHeader } from './panelChrome'
import { SIDEBAR_PANEL_SURFACE } from './profileChrome'
import { NavRow, Segmented, SettingsSection } from './sectionChrome'
import { ROLE_LABEL } from './ProfileSidebarPanel'

type Props = {
  user: User
  /** Prefetched profile — supplies the live availability status for the dot. */
  profile: Profile | null
  /** Auto-away presence (idle / tab hidden). */
  away: boolean
  /** The signed-in company, for the identity line. */
  companyName: string
  onBack: () => void
  onOpenProfile: () => void
  onOpenSettings: () => void
  onSignOut: () => void
  /** A status change saved here flows up like a My profile save does. */
  onProfileSaved: (profile: Profile) => void
}

// The account root of the rail's drill-in stack, opened from the user half of
// the sidebar's bottom row (Back → the conversation list; My profile and
// Workspace settings drill one level deeper and come back here).
//
// Reworked 2026-10-12 from the "Profile & group info rework" canvas. The photo
// banner gave a three-destination menu 400px of picture; it is a compact
// identity row now (the banner stays where the photo is managed, in My
// profile). The one thing people come here to DO — say whether they are
// available — used to be a read-only pill whose control lived a level deeper;
// it is a direct three-way choice here.
export default function AccountSidebarPanel({
  user,
  profile,
  away,
  companyName,
  onBack,
  onOpenProfile,
  onOpenSettings,
  onSignOut,
  onProfileSaved,
}: Props) {
  const isDriver = user.role === 'driver'
  const [availability, setAvailability] = useState<AvailabilityStatus>(
    profile?.availabilityStatus ?? 'available',
  )
  const [error, setError] = useState<string | null>(null)

  // The prefetched profile can land after the panel opened.
  useEffect(() => {
    if (profile) setAvailability(profile.availabilityStatus)
  }, [profile?.availabilityStatus])

  async function changeAvailability(next: AvailabilityStatus) {
    if (next === availability) return
    const before = availability
    setAvailability(next)
    setError(null)
    try {
      const { profile: saved } = await api.profile.update({ availabilityStatus: next })
      onProfileSaved(saved)
    } catch {
      setAvailability(before)
      setError('Could not change your availability. Try again.')
    }
  }

  // Drivers have no availability — same rule as the rail's identity row.
  const dot = isDriver ? null : away ? AWAY : statusMeta(availability)

  // The photo is viewable here (lightbox) but managed one level down, in My
  // profile — so no pencil, no file input.
  const hasAvatar = profile?.hasAvatar ?? true
  const avatarVersion = profile?.avatarVersion
  const viewer = usePhotoEditor({
    hasImage: hasAvatar,
    canEdit: false,
    noun: 'profile photo',
    viewSrc: hasAvatar ? avatarUrl('user', user.id, avatarVersion) : undefined,
    viewTitle: user.displayName,
    onFile: () => {},
    onRemove: () => {},
  })

  // Live summaries for the two drill-in rows.
  const theme = useTheme()
  const messageStyle = useMessageStyle()
  const notifications = useBrowserNotifications()
  const languageCount = profile
    ? (profile.nativeLanguage ? 1 : 0) + profile.otherLanguages.length
    : 0
  const profileSummary = profile
    ? [
        profile.jobTitle || 'No job title',
        languageCount === 0
          ? 'No languages'
          : `${languageCount} language${languageCount === 1 ? '' : 's'}`,
      ]
    : ['Photo, contact details, languages']

  const photo = (
    <span className="relative block shrink-0">
      <Avatar
        userId={user.id}
        name={user.displayName}
        size={64}
        version={avatarVersion}
        hasAvatar={profile?.hasAvatar}
        fallback="initials"
      />
      {dot && (
        <span
          title={dot.label}
          className="absolute bottom-0 right-0 h-4 w-4 rounded-full border-[3px] border-sidebar"
          style={{ backgroundColor: dot.color }}
        />
      )}
    </span>
  )

  return (
    <div className={`flex flex-col h-full ${SIDEBAR_PANEL_SURFACE}`}>
      <PanelHeader title="Account" onBack={onBack} backLabel="Back to conversations" />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
        <div className="flex items-center gap-4 px-5 pt-6 pb-5">
          {viewer.openPreview ? (
            <button
              type="button"
              onClick={viewer.openPreview}
              aria-label="View your profile photo"
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
              {photo}
            </button>
          ) : (
            photo
          )}
          <div className="min-w-0">
            <div className="truncate text-2xl font-bold tracking-[-0.02em]">{user.displayName}</div>
            <div className="mt-1 text-base text-muted">
              <RowMeta segments={[ROLE_LABEL[user.role], companyName]} whole />
            </div>
          </div>
        </div>
        {viewer.chrome}

        <div className="px-5">
          {!isDriver && (
            <div className="border-t border-line">
              <SettingsSection
                title="Availability"
                description={
                  away
                    ? 'Shown next to your name across the company. You show as Away right now, because you are idle or this tab is hidden.'
                    : 'Shown next to your name across the company. While you are idle or this tab is hidden, you show as Away.'
                }
              >
                <Segmented
                  fill
                  label="Availability"
                  value={availability}
                  options={AVAILABILITY.map((a) => ({ value: a.value, label: a.label, dot: a.color }))}
                  onChange={(v) => void changeAvailability(v as AvailabilityStatus)}
                />
                {error && <p className="text-sm text-alert">{error}</p>}
              </SettingsSection>
            </div>
          )}
        </div>

        {isDriver && <div className="mx-5 border-t border-line" />}
        <nav aria-label="Account" className="flex flex-col gap-0.5 px-2 py-3">
          <NavRow
            icon={<CircleUser size="1.0625rem" strokeWidth={1.7} />}
            title="My profile"
            value={profileSummary}
            onClick={onOpenProfile}
          />
          <NavRow
            icon={<Settings size="1.0625rem" strokeWidth={1.7} />}
            title="Workspace settings"
            value={[
              theme === 'light' ? 'Light' : 'Dark',
              MESSAGE_STYLE_LABEL[messageStyle],
              notifications.enabled ? 'Notifications on' : 'Notifications off',
            ]}
            onClick={onOpenSettings}
          />
        </nav>

        {/* Sign out sits apart, at the foot — it leaves the app rather than
            opening anything, and carries the app's destructive tone. */}
        <div className="mt-auto border-t border-line px-2 pt-2 pb-4">
          <button
            type="button"
            onClick={onSignOut}
            className="group flex w-full items-center gap-3 rounded-card px-3 py-2.5 text-left transition-colors hover:bg-alert/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            <span className="flex h-[2.375rem] w-[2.375rem] shrink-0 items-center justify-center rounded-tile border border-alert/30 text-alert">
              <LogOut size="1.0625rem" strokeWidth={1.7} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-semibold leading-tight text-alert">Sign out</span>
              <span className="mt-1 block truncate text-base text-muted">End this session in this browser</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
