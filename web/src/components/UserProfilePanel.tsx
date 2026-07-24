import { useEffect, useState } from 'react'
import { Clock3, Loader2, MessageCircle, UserCheck, UserPlus, X } from 'lucide-react'
import type { PublicProfile } from '../lib/types'
import { api, ApiError } from '../lib/api'
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
  /** Current viewer's company name, used to distinguish trusted colleagues
   *  (who can message directly) from cross-company connection flows. */
  currentWorkspaceName: string
  /** The target's role IN THE CURRENT GROUP ('admin' | 'member'), when the
   *  panel was opened from a vehicle-room context. Omitted for DMs. */
  groupRole?: 'admin' | 'member'
  /** Open or create a direct conversation, then navigate to it. */
  onMessage: (userId: string, name: string) => Promise<void>
  onClose: () => void
}

type Relationship =
  | { kind: 'loading' }
  | { kind: 'self' | 'same_workspace' | 'accepted' | 'none' | 'pending_sent' }
  | { kind: 'pending_received'; connectionId: string }

// Read-only user details panel, opened by clicking a user's avatar (chat
// messages, DM header, group members list). EXACTLY the Group info panel's
// container pattern: on desktop (xl+) a real in-flow right column — its own
// rail-toned rounded card beside the chat, which reflows narrower — and below
// xl a fixed right-edge overlay drawer with a transparent click-away. It
// occupies the same single right-hand column slot as Group info / Add trip
// (ChatView hides those while this is open, keeping their state mounted).
//
// Profile fields stay read-only: label/value rows match "My profile" but have
// no pencil affordances. The compact hero actions are relationship-aware and
// only navigate/message or manage a connection; they never edit profile data.
// Missing values render as the standard muted "Not set".
export default function UserProfilePanel({
  userId,
  name,
  currentUserId,
  currentWorkspaceName,
  groupRole,
  onMessage,
  onClose,
}: Props) {
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [failed, setFailed] = useState(false)
  // Bump to refetch after a failed load ("Try again").
  const [attempt, setAttempt] = useState(0)
  const [relationship, setRelationship] = useState<Relationship>({ kind: 'loading' })
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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

  // Resolve the cross-company relationship once the profile tells us which
  // workspace the target belongs to. Same-company users bypass connections;
  // external users map to the existing accepted/pending slices.
  useEffect(() => {
    if (userId === currentUserId) {
      setRelationship({ kind: 'self' })
      return
    }
    if (!profile) return
    if (profile.company === currentWorkspaceName) {
      setRelationship({ kind: 'same_workspace' })
      return
    }

    let cancelled = false
    setRelationship({ kind: 'loading' })
    api.connections
      .list()
      .then((connections) => {
        if (cancelled) return
        if (connections.accepted.some((c) => c.otherUser.id === userId)) {
          setRelationship({ kind: 'accepted' })
          return
        }
        const received = connections.pendingReceived.find((c) => c.otherUser.id === userId)
        if (received) {
          setRelationship({ kind: 'pending_received', connectionId: received.id })
          return
        }
        if (connections.pendingSent.some((c) => c.otherUser.id === userId)) {
          setRelationship({ kind: 'pending_sent' })
          return
        }
        setRelationship({ kind: 'none' })
      })
      .catch(() => {
        if (!cancelled) setRelationship({ kind: 'none' })
      })
    return () => {
      cancelled = true
    }
  }, [currentUserId, currentWorkspaceName, profile, userId])

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

  async function openDirectMessage() {
    if (!profile || actionBusy) return
    setActionBusy(true)
    setActionError(null)
    try {
      await onMessage(profile.id, displayName)
    } catch {
      setActionError('Could not open the direct conversation.')
    } finally {
      setActionBusy(false)
    }
  }

  async function requestConnection() {
    if (actionBusy) return
    setActionBusy(true)
    setActionError(null)
    try {
      await api.connections.request(userId)
      setRelationship({ kind: 'pending_sent' })
    } catch (error) {
      setActionError(
        error instanceof ApiError && error.code === 'previously_declined'
          ? 'This connection request was previously declined.'
          : 'Could not send the connection request.',
      )
    } finally {
      setActionBusy(false)
    }
  }

  async function acceptConnection(connectionId: string) {
    if (actionBusy) return
    setActionBusy(true)
    setActionError(null)
    try {
      await api.connections.accept(connectionId)
      setRelationship({ kind: 'accepted' })
    } catch {
      setActionError('Could not accept the connection request.')
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <>
      {/* Click-away — only as an overlay drawer on narrow screens (< xl). On
          desktop the panel is a real in-flow column, so there's no backdrop and
          the chat beside it stays fully clickable. Same as Group info. */}
      <div
        className="fixed inset-0 z-40 bg-black/65 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="User profile"
        // Narrow screens: a fixed right-edge drawer (overlay). xl+: a static,
        // in-flow right column beside the chat — same rail background, width,
        // and panel radius as the Group info column, so it reads as the same
        // card surface with the standard gap from the chat (the row's xl:gap-3).
        className="fixed left-1/2 top-1/2 z-50 h-[calc(100dvh-1.5rem)] max-h-[44rem] w-[calc(100%-1.5rem)] max-w-[30rem]
                   -translate-x-1/2 -translate-y-1/2 rounded-modal border border-white/[0.08]
                   bg-rail shadow-[0_32px_80px_rgba(0,0,0,0.65)] flex flex-col overflow-hidden"
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
              {!profile.deleted && relationship.kind !== 'self' && (
                <div className="mt-3 flex items-center justify-center gap-1">
                  {actionBusy ? (
                    <span className={`${ICON_ACTION_BASE} text-muted`} aria-label="Working">
                      <Loader2 size="1rem" strokeWidth={1.8} className="animate-spin" />
                    </span>
                  ) : relationship.kind === 'same_workspace' || relationship.kind === 'accepted' ? (
                    <button
                      type="button"
                      onClick={() => void openDirectMessage()}
                      aria-label={`Message ${displayName}`}
                      title={`Message ${displayName}`}
                      className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE}`}
                    >
                      <MessageCircle size="1.0625rem" strokeWidth={1.8} />
                    </button>
                  ) : relationship.kind === 'pending_received' ? (
                    <button
                      type="button"
                      onClick={() => void acceptConnection(relationship.connectionId)}
                      aria-label={`Accept connection from ${displayName}`}
                      title="Accept connection"
                      className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE}`}
                    >
                      <UserCheck size="1.0625rem" strokeWidth={1.8} />
                    </button>
                  ) : relationship.kind === 'pending_sent' ? (
                    <button
                      type="button"
                      disabled
                      aria-label={`Connection request to ${displayName} is pending`}
                      title="Connection request pending"
                      className={`${ICON_ACTION_BASE} text-muted`}
                    >
                      <Clock3 size="1.0625rem" strokeWidth={1.8} />
                    </button>
                  ) : relationship.kind === 'none' ? (
                    <button
                      type="button"
                      onClick={() => void requestConnection()}
                      aria-label={`Connect with ${displayName}`}
                      title={`Connect with ${displayName}`}
                      className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE}`}
                    >
                      <UserPlus size="1.0625rem" strokeWidth={1.8} />
                    </button>
                  ) : (
                    <span className={`${ICON_ACTION_BASE} text-faint`} aria-label="Checking connection">
                      <Loader2 size="1rem" strokeWidth={1.8} className="animate-spin" />
                    </span>
                  )}
                </div>
              )}
              {actionError && (
                <p className="mt-1.5 text-[0.6875rem] leading-[1.4] text-alert">{actionError}</p>
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
