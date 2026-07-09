import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { PublicProfile } from '../lib/types'
import { api } from '../lib/api'
import { avatarUrl } from '../lib/avatarCache'
import { statusMeta, OFFLINE } from '../lib/availability'
import { usePresence } from '../hooks/usePresence'
import { ICON_ACTION_BASE, ICON_ACTION_IDLE } from './HeaderIconButton'
import { ROLE_LABEL } from './settings/ProfileSidebarPanel'
import Avatar from './Avatar'
import AvatarPhotoEditor from './AvatarPhotoEditor'
import EditableRow from './EditableRow'
import PanelSection from './vehicle/PanelSection'
import Spinner from './Spinner'

type Props = {
  /** The user whose profile is shown. */
  userId: string
  /** Display name already known from the click context (message author, DM
   *  peer, member row) — renders the hero immediately while the fetch runs. */
  name: string
  /** The signed-in viewer. Presence snapshots cover *peers* only, so viewing
   *  your own profile treats you as online (you're using the app). */
  currentUserId: string
  /** The target's role IN THE CURRENT GROUP ('admin' | 'member'), when the
   *  panel was opened from a vehicle-room context. Omitted for DMs. */
  groupRole?: 'admin' | 'member'
  onClose: () => void
}

// Read-only user details panel, opened by clicking a user's avatar (chat
// messages, DM header, group members list). EXACTLY the Group info panel's
// container pattern: on desktop (xl+) a real in-flow right column — its own
// rail-toned rounded card beside the chat, which reflows narrower — and below
// xl a fixed right-edge overlay drawer with a transparent click-away. It
// occupies the same single right-hand column slot as Group info / Add trip
// (ChatView hides those while this is open, keeping their state mounted).
//
// Strictly read-only: label/value rows identical to "My profile", but with no
// pencil affordances anywhere. Missing values render as the standard muted
// "Not set". Editing your own profile stays where it always was — the
// "My profile" sidebar drawer.
export default function UserProfilePanel({ userId, name, currentUserId, groupRole, onClose }: Props) {
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [failed, setFailed] = useState(false)
  // Bump to refetch after a failed load ("Try again").
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    api.users
      .profile(userId)
      .then(({ profile }) => {
        if (!cancelled) setProfile(profile)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [userId, attempt])

  // Esc closes THIS panel only. Capture-phase + stopPropagation so an open
  // Group info panel underneath (which also listens for Escape on document)
  // doesn't close at the same time — the topmost surface wins.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Live presence — the SAME socket-driven source the sidebar DM dots and the
  // group members list read, so all three always agree. The hook resyncs a
  // fresh snapshot on mount and tracks presence:update deltas, so the pill
  // flips live while the panel is open.
  const { online } = usePresence()
  const isOnline = userId === currentUserId || online.has(userId)

  const displayName = profile?.displayName ?? name
  const roleLabel = profile?.role ? ROLE_LABEL[profile.role] : null
  // Live presence wins over the stored profile preference: a disconnected user
  // shows Offline no matter what status they last selected; only while online
  // does their chosen availability (Available / Busy / Off duty) show.
  // (Mirrors MemberRow / SidebarGroupRow's `online ? statusMeta(...) : OFFLINE`.)
  const status: { label: string; color: string } | null = !isOnline
    ? OFFLINE
    : profile?.availabilityStatus
      ? statusMeta(profile.availabilityStatus)
      : null
  const isDriver = profile?.role === 'driver'
  const memberSince = profile?.memberSince
    ? new Date(profile.memberSince).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      })
    : null
  const languagesValue =
    profile && profile.otherLanguages.length ? profile.otherLanguages.join(', ') : ''

  return (
    <>
      {/* Click-away — only as an overlay drawer on narrow screens (< xl). On
          desktop the panel is a real in-flow column, so there's no backdrop and
          the chat beside it stays fully clickable. Same as Group info. */}
      <div className="fixed inset-0 z-40 xl:hidden" onClick={onClose} aria-hidden />

      <aside
        role="dialog"
        aria-label="User profile"
        // Narrow screens: a fixed right-edge drawer (overlay). xl+: a static,
        // in-flow right column beside the chat — same rail background, width,
        // and panel radius as the Group info column, so it reads as the same
        // card surface with the standard gap from the chat (the row's xl:gap-3).
        className="fixed top-0 right-0 bottom-0 z-40 w-full max-w-[25rem] shadow-[-16px_0_48px_rgba(0,0,0,0.4)] bg-rail flex flex-col
                   xl:static xl:z-auto xl:w-[clamp(22.5rem,26vw,26.25rem)] xl:max-w-none xl:shrink-0 xl:shadow-none
                   xl:rounded-panel xl:overflow-hidden"
      >
        {/* Header — same seam as the other right/side panels. */}
        <div className="h-[var(--header-height)] flex items-center justify-between px-4 shrink-0">
          <span className="text-[0.8125rem] font-semibold">Profile</span>
          <button
            onClick={onClose}
            aria-label="Close profile"
            className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE} shrink-0`}
          >
            <X size="1.125rem" strokeWidth={1.8} />
          </button>
        </div>

        {failed ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-[0.75rem] text-faint">Could not load this profile.</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="text-[0.78125rem] text-text font-semibold hover:underline underline-offset-4"
            >
              Try again
            </button>
          </div>
        ) : !profile ? (
          <div className="flex-1 flex items-center justify-center">
            <Spinner variant="md" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
            {/* Identity hero — mirrors My profile: avatar, name, role · job
                title, status pill. Viewing the photo (lightbox) only; no
                photo-management controls for someone else's account. */}
            <div className="flex flex-col items-center text-center pt-1">
              <AvatarPhotoEditor
                size={96}
                hasImage={profile.hasAvatar}
                canEdit={false}
                noun="profile photo"
                viewSrc={profile.hasAvatar ? avatarUrl('user', profile.id) : undefined}
                viewTitle={displayName}
                onFile={() => {}}
                onRemove={() => {}}
              >
                <Avatar userId={profile.id} name={displayName} size={96} />
              </AvatarPhotoEditor>
              <div className="mt-3 text-[1rem] font-semibold tracking-[-0.2px]">
                {displayName}
              </div>
              {profile.deleted ? (
                <div className="mt-0.5 text-[0.75rem] text-muted">Deleted account</div>
              ) : (
                (roleLabel || profile.jobTitle) && (
                  <div className="mt-0.5 text-[0.75rem] text-muted">
                    {roleLabel}
                    {profile.jobTitle ? `${roleLabel ? ' · ' : ''}${profile.jobTitle}` : ''}
                  </div>
                )
              )}
              {/* Availability — the same pill as My profile, minus the menu
                  (read-only). Drivers carry no availability. */}
              {!profile.deleted && !isDriver && status && (
                <span
                  className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.71875rem] font-medium"
                  style={{ color: status.color, backgroundColor: `${status.color}22` }}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: status.color }}
                  />
                  {status.label}
                </span>
              )}
            </div>

            {profile.deleted ? (
              // Anonymized account: name only — every personal detail was
              // removed with the account, so there is nothing more to show.
              <p className="text-[0.71875rem] text-faint text-center leading-[1.45] px-2">
                This account was deleted. Its profile details are no longer
                available.
              </p>
            ) : (
              <>
                <PanelSection label="Work details">
                  <EditableRow label="Role" value={roleLabel} />
                  {groupRole && (
                    <EditableRow
                      label="Group role"
                      value={groupRole === 'admin' ? 'Admin' : 'Member'}
                      hint="In this group"
                    />
                  )}
                  <EditableRow label="Job title / function" value={profile.jobTitle} />
                  <EditableRow label="Work phone" value={profile.workPhone} />
                  <EditableRow label="Work email" value={profile.email} />
                </PanelSection>

                {!isDriver && (
                  <PanelSection label="Languages">
                    <EditableRow label="Native language" value={profile.nativeLanguage} />
                    <EditableRow label="Other spoken languages" value={languagesValue} />
                  </PanelSection>
                )}

                <PanelSection label="Company">
                  <EditableRow label="Workspace" value={profile.company} />
                  <EditableRow label="Member since" value={memberSince} />
                </PanelSection>
              </>
            )}
          </div>
        )}
      </aside>
    </>
  )
}
