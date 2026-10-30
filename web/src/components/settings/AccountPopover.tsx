import { useEffect, useState } from 'react'
import { AppWindow, Building2, CircleUser, LogOut, Settings, Users, X } from 'lucide-react'
import type { User } from '../../auth/AuthContext'
import type { AvailabilityStatus, Profile } from '../../lib/types'
import { api } from '../../lib/api'
import { AWAY, statusMeta } from '../../lib/availability'
import { avatarUrl } from '../../lib/avatarCache'
import { useTheme } from '../../lib/theme'
import { MESSAGE_STYLE_LABEL, useMessageStyle } from '../../lib/messageStyle'
import { useBrowserNotifications } from '../../lib/browserNotifications'
import { RowMeta } from '../../pages/sidebarBits'
import Avatar from '../Avatar'
import { usePhotoEditor } from '../AvatarPhotoEditor'
import { NavRow } from './sectionChrome'
import { ROLE_LABEL } from './ProfileSidebarPanel'
import StatusSelect from './StatusSelect'

type Props = {
  user: User
  /** Prefetched profile — supplies the live availability status for the dot. */
  profile: Profile | null
  /** Auto-away presence (idle / tab hidden). */
  away: boolean
  /** The signed-in company, for the identity line and the Company row. */
  companyName: string
  onClose: () => void
  onOpenProfile: () => void
  onOpenCompany: () => void
  onOpenSettings: () => void
  /** Admins only — the row is hidden when this is absent. */
  onOpenMembers?: () => void
  onSignOut: () => void
  /** A status change saved here flows up like a My profile save does. */
  onProfileSaved: (profile: Profile) => void
}

// The account window, opened from the photo at the right end of the top bar
// (user, 2026-10-29 canvas). It used to be the root of the rail's drill-in
// stack; it floats now, and it is the ONE way into everything about you and
// your company — Company and Settings lost their own nav buttons to it.
//
// Status is one compact row: the label and a collapsed field (StatusSelect).
// Every row below opens its own window (WindowShell) — My profile, Company,
// Members (admins only, user 2026-10-30: it belongs here, not in Workspace
// settings) and Workspace settings — so each carries a window glyph, not a
// drill-in chevron.
export default function AccountPopover({
  user,
  profile,
  away,
  companyName,
  onClose,
  onOpenProfile,
  onOpenCompany,
  onOpenSettings,
  onOpenMembers,
  onSignOut,
  onProfileSaved,
}: Props) {
  const isDriver = user.role === 'driver'
  const [availability, setAvailability] = useState<AvailabilityStatus>(
    profile?.availabilityStatus ?? 'available',
  )
  const [error, setError] = useState<string | null>(null)

  // The prefetched profile can land after the window opened.
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

  // The Members row says how many people and pending invites there are —
  // fetched when the window opens, for admins only (the server gates it too).
  const [membersSummary, setMembersSummary] = useState<string[] | null>(null)
  const showMembers = Boolean(onOpenMembers)
  useEffect(() => {
    if (!showMembers) return
    let live = true
    Promise.all([api.workspace.members(), api.workspaceInvites.list()])
      .then(([{ members }, { invites }]) => {
        if (!live) return
        const pending = invites.filter((invite) => invite.status === 'active').length
        // /workspace/members lists everyone EXCEPT the caller, so they are
        // counted back in.
        const count = members.length + (members.some((m) => m.id === user.id) ? 0 : 1)
        setMembersSummary([
          `${count} ${count === 1 ? 'person' : 'people'}`,
          pending > 0 ? `${pending} invite${pending === 1 ? '' : 's'} pending` : 'No pending invites',
        ])
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [showMembers, user.id])

  // Drivers have no availability — same rule as the top bar's photo dot.
  const dot = isDriver ? null : away ? AWAY : statusMeta(availability)

  // The photo is viewable here (lightbox) but managed in My profile.
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

  // Live summaries for the drill-in rows.
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

  const windowGlyph = (
    <AppWindow
      size="1rem"
      strokeWidth={1.8}
      aria-label="Opens in a window"
      className="shrink-0 text-faint transition-colors group-hover:text-muted"
    />
  )

  const photo = (
    <span className="relative block shrink-0">
      <Avatar
        userId={user.id}
        name={user.displayName}
        size={56}
        version={avatarVersion}
        hasAvatar={profile?.hasAvatar}
        fallback="initials"
      />
      {dot && (
        <span
          title={dot.label}
          className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-[3px] border-surface"
          style={{ backgroundColor: dot.color }}
        />
      )}
    </span>
  )

  return (
    <div className="flex max-h-[calc(100vh-4.5rem)] flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pl-4 pr-1.5">
        <span className="text-base font-semibold">Account</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close account"
          title="Close"
          className="rounded-btn flex h-8 w-8 items-center justify-center text-muted transition-colors hover:bg-white/8 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <X size="1rem" strokeWidth={1.8} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-3.5 px-4 pt-4 pb-3.5">
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

        {!isDriver && (
          <div className="border-t border-line py-2 pl-4 pr-2.5">
            <div className="flex items-center gap-3">
              <span className="shrink-0 text-base text-muted">Status</span>
              <StatusSelect
                value={availability}
                onChange={(v) => void changeAvailability(v)}
                title={away ? 'You show as Away right now: idle or this tab is hidden' : 'Shown next to your name across the company'}
              />
            </div>
            {error && <p className="pt-1.5 text-sm text-alert">{error}</p>}
          </div>
        )}

        <nav aria-label="Account" className="flex flex-col gap-0.5 border-t border-line px-1.5 py-2">
          <NavRow
            icon={<CircleUser size="1.0625rem" strokeWidth={1.7} />}
            title="My profile"
            value={profileSummary}
            onClick={onOpenProfile}
            trailing={windowGlyph}
          />
          <NavRow
            icon={<Building2 size="1.0625rem" strokeWidth={1.7} />}
            title="Company"
            value={[companyName, 'Registration, location, dispatch']}
            onClick={onOpenCompany}
            trailing={windowGlyph}
          />
          {onOpenMembers && (
            <NavRow
              icon={<Users size="1.0625rem" strokeWidth={1.7} />}
              title="Members"
              tag="Admin"
              value={membersSummary ?? ['People and invite links']}
              onClick={onOpenMembers}
              trailing={windowGlyph}
            />
          )}
          <NavRow
            icon={<Settings size="1.0625rem" strokeWidth={1.7} />}
            title="Workspace settings"
            value={[
              theme === 'light' ? 'Light' : 'Dark',
              MESSAGE_STYLE_LABEL[messageStyle],
              notifications.enabled ? 'Notifications on' : 'Notifications off',
            ]}
            onClick={onOpenSettings}
            trailing={windowGlyph}
          />
        </nav>

        {/* Sign out sits apart, at the foot — it leaves the app rather than
            opening anything, and carries the app's destructive tone. */}
        <div className="border-t border-line px-1.5 py-1.5">
          <button
            type="button"
            onClick={onSignOut}
            className="group flex w-full items-center gap-3 rounded-card px-3 py-2 text-left transition-colors hover:bg-alert/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
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
