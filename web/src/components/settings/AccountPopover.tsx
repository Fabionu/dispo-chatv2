import { useEffect, useRef, useState } from 'react'
import { AppWindow, Building2, Check, ChevronDown, CircleUser, LogOut, Settings, X } from 'lucide-react'
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
import { NavRow } from './sectionChrome'
import { ROLE_LABEL } from './ProfileSidebarPanel'

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
  onSignOut: () => void
  /** A status change saved here flows up like a My profile save does. */
  onProfileSaved: (profile: Profile) => void
}

// The account window, opened from the photo at the right end of the top bar
// (user, 2026-10-29 canvas). It used to be the root of the rail's drill-in
// stack; it floats now, and it is the ONE way into everything about you and
// your company — Company and Settings lost their own nav buttons to it.
//
// Status is one collapsed field showing the current choice; pressing it drops
// the three options under it (user, 2026-10-29: "a field from where we select
// it"). My profile opens in its own window (ProfileWindow); Company and
// Workspace settings still open in the sidebar.
export default function AccountPopover({
  user,
  profile,
  away,
  companyName,
  onClose,
  onOpenProfile,
  onOpenCompany,
  onOpenSettings,
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
          <div className="border-t border-line px-2 pt-2 pb-2.5">
            <div className="px-2.5 pt-1 pb-1 text-xs font-medium text-faint">Status</div>
            <StatusSelect value={availability} onChange={(v) => void changeAvailability(v)} />
            <p className="px-2.5 pt-1.5 text-xs leading-snug text-faint">
              {away
                ? 'You show as Away right now, because you are idle or this tab is hidden.'
                : 'Away is set for you while you are idle or this tab is hidden.'}
            </p>
            {error && <p className="px-2.5 pt-1 text-sm text-alert">{error}</p>}
          </div>
        )}

        <nav aria-label="Account" className="flex flex-col gap-0.5 border-t border-line px-1.5 py-2">
          <NavRow
            icon={<CircleUser size="1.0625rem" strokeWidth={1.7} />}
            title="My profile"
            value={profileSummary}
            onClick={onOpenProfile}
            trailing={
              <AppWindow
                size="1rem"
                strokeWidth={1.8}
                aria-label="Opens in a window"
                className="shrink-0 text-faint transition-colors group-hover:text-muted"
              />
            }
          />
          <NavRow
            icon={<Building2 size="1.0625rem" strokeWidth={1.7} />}
            title="Company"
            value={[companyName, 'Profile, people, places']}
            onClick={onOpenCompany}
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

// The Status field: collapsed, it shows the current choice with a chevron;
// open, the three options drop under it as a small menu. Escape or a press
// outside closes it (Escape is consumed so the account window stays open).
function StatusSelect({
  value,
  onChange,
}: {
  value: AvailabilityStatus
  onChange: (next: AvailabilityStatus) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = statusMeta(value)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [open])

  return (
    <div ref={ref} className="relative px-0.5">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Status: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
        className={`rounded-btn flex h-9 w-full items-center gap-2.5 border pl-3 pr-2.5 text-left text-base font-medium text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
          open ? 'border-line-2 bg-white/4' : 'border-line hover:border-line-2'
        }`}
      >
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: current.color }} />
        <span className="flex-1">{current.label}</span>
        <ChevronDown
          size="0.9375rem"
          strokeWidth={1.8}
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Availability"
          className="panel-fade-in absolute inset-x-0.5 top-[calc(100%+0.25rem)] z-10 flex flex-col gap-px rounded-card border border-line bg-surface p-1 shadow-overlay"
        >
          {AVAILABILITY.map((a) => {
            const on = a.value === value
            return (
              <button
                key={a.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  setOpen(false)
                  onChange(a.value)
                }}
                className={`rounded-btn flex h-8 w-full items-center gap-2.5 px-2.5 text-left text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
                  on ? 'bg-white/8 font-medium text-text' : 'text-muted hover:bg-white/6 hover:text-text'
                }`}
              >
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: a.color }} />
                <span className="flex-1">{a.label}</span>
                {on && <Check size="0.9375rem" strokeWidth={2} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
