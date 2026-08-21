import { useEffect, useState } from 'react'
import { Clock3, Loader2, MessageCircle, UserCheck, UserPlus } from 'lucide-react'
import type { PublicProfile } from '../lib/types'
import { api, ApiError, type ProfilePatch } from '../lib/api'
import { avatarUrl } from '../lib/avatarCache'
import { statusMeta, OFFLINE } from '../lib/availability'
import { usePresence } from '../hooks/usePresence'
import { ICON_ACTION_BASE, ICON_ACTION_IDLE } from './HeaderIconButton'
import { ROLE_LABEL } from './settings/ProfileSidebarPanel'
import { PanelCloseHeader } from './settings/panelChrome'
import {
  PANEL_BODY,
  PANEL_SURFACE,
  PROFILE_HERO_SIZE,
  ProfileHero,
  ProfileSection,
  StatusPill,
} from './settings/profileChrome'
import Avatar from './Avatar'
import AvatarPhotoEditor from './AvatarPhotoEditor'
import { EditableField } from './forms'
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
  /** Render in ChatView's shared right-hand panel slot on desktop. */
  sidePanel?: boolean
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
  sidePanel = false,
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

  // Viewing YOUR OWN card: the same fields My profile exposes become editable
  // here too, through the same endpoint — so the panel is never a dead-end copy
  // of your profile. Identity fields (name, role, work email) stay locked
  // everywhere, and someone else's card is always read-only.
  const isSelf = userId === currentUserId
  async function saveOwnField(patch: ProfilePatch) {
    const { profile: saved } = await api.profile.update(patch)
    // Mirror the saved values onto the public shape this panel renders.
    setProfile((current) =>
      current
        ? {
            ...current,
            jobTitle: saved.jobTitle,
            workPhone: saved.workPhone,
            nativeLanguage: saved.nativeLanguage,
            otherLanguages: saved.otherLanguages,
          }
        : current,
    )
  }

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
        className={
          sidePanel
            ? 'fixed inset-0 z-40 xl:hidden'
            : 'fixed inset-0 z-40 bg-black/65 backdrop-blur-[1px]'
        }
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
        className={`panel-fade-in ${
          sidePanel
            ? `fixed top-0 right-0 bottom-0 z-40 flex w-full max-w-[25rem] flex-col overflow-hidden ${PANEL_SURFACE}
               shadow-drawer
               xl:static xl:z-auto xl:w-[clamp(22.5rem,26vw,26.25rem)] xl:max-w-none xl:shrink-0
               xl:rounded-panel xl:shadow-none xl:border xl:border-line`
            : `fixed left-1/2 top-1/2 z-50 h-[calc(100dvh-1.5rem)] max-h-[44rem]
               w-[calc(100%-1.5rem)] max-w-[30rem] -translate-x-1/2 -translate-y-1/2
               rounded-modal border border-line ${PANEL_SURFACE}
               shadow-modal flex flex-col overflow-hidden`
        }`}
      >
        <PanelCloseHeader title="Profile" onClose={onClose} closeLabel="Close profile" />

        {failed ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm text-faint">Could not load this profile.</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="text-base text-text font-semibold hover:underline underline-offset-4"
            >
              Try again
            </button>
          </div>
        ) : !profile ? (
          <div className="flex-1 flex items-center justify-center">
            <Spinner variant="md" />
          </div>
        ) : (
          <div className={PANEL_BODY}>
            {/* Identity hero — the shared one, so this card and My profile are
                the same object at the same size. Viewing the photo (lightbox)
                only; no photo-management controls for someone else's account. */}
            <ProfileHero
              image={
                <AvatarPhotoEditor
                  size={PROFILE_HERO_SIZE}
                  hasImage={profile.hasAvatar}
                  canEdit={false}
                  noun="profile photo"
                  viewSrc={profile.hasAvatar ? avatarUrl('user', profile.id) : undefined}
                  viewTitle={displayName}
                  onFile={() => {}}
                  onRemove={() => {}}
                >
                  <Avatar userId={profile.id} name={displayName} size={PROFILE_HERO_SIZE} />
                </AvatarPhotoEditor>
              }
              title={displayName}
              subtitle={
                profile.deleted
                  ? 'Deleted account'
                  : roleLabel || profile.jobTitle
                    ? `${roleLabel ?? ''}${
                        profile.jobTitle ? `${roleLabel ? ' · ' : ''}${profile.jobTitle}` : ''
                      }`
                    : undefined
              }
              // Availability — the same pill as My profile, minus the menu
              // (read-only). Drivers carry no availability.
              status={
                !profile.deleted && !isDriver && status ? (
                  <StatusPill label={status.label} color={status.color} />
                ) : undefined
              }
              error={actionError}
              actions={
                !profile.deleted && relationship.kind !== 'self' ? (
                  <>
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
                  </>
                ) : undefined
              }
            />

            {profile.deleted ? (
              // Anonymized account: name only — every personal detail was
              // removed with the account, so there is nothing more to show.
              <p className="text-sm text-faint text-center leading-[1.45] px-2">
                This account was deleted. Its profile details are no longer
                available.
              </p>
            ) : (
              <>
                {/* Identity + permission fields (name, role, work email) are
                    read-only for everyone. The rest is editable ONLY on your own
                    card, through the same endpoint My profile uses. */}
                <ProfileSection label="Work details">
                  <EditableField label="Role" value={roleLabel} hint="Set by an admin" />
                  {groupRole && (
                    <EditableField
                      label="Group role"
                      value={groupRole === 'admin' ? 'Admin' : 'Member'}
                      hint="In this group"
                    />
                  )}
                  <EditableField
                    label="Job title / function"
                    value={profile.jobTitle}
                    editable={isSelf}
                    placeholder="e.g. Fleet Manager"
                    onSave={isSelf ? (v) => saveOwnField({ jobTitle: v || null }) : undefined}
                  />
                  <EditableField
                    label="Work phone"
                    value={profile.workPhone}
                    editable={isSelf}
                    placeholder="+40…"
                    onSave={isSelf ? (v) => saveOwnField({ workPhone: v || null }) : undefined}
                  />
                  <EditableField label="Work email" value={profile.email} />
                </ProfileSection>

                {!isDriver && (
                  <ProfileSection label="Languages">
                    <EditableField
                      label="Native language"
                      value={profile.nativeLanguage}
                      editable={isSelf}
                      placeholder="e.g. Romanian"
                      onSave={
                        isSelf ? (v) => saveOwnField({ nativeLanguage: v || null }) : undefined
                      }
                    />
                    <EditableField
                      label="Other spoken languages"
                      value={languagesValue}
                      editable={isSelf}
                      hint={isSelf ? 'Comma-separated' : undefined}
                      placeholder="e.g. English, German"
                      onSave={
                        isSelf
                          ? (v) =>
                              saveOwnField({
                                otherLanguages: v
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean)
                                  .slice(0, 15),
                              })
                          : undefined
                      }
                    />
                  </ProfileSection>
                )}

                <ProfileSection label="Company">
                  <EditableField label="Workspace" value={profile.company} />
                  <EditableField label="Member since" value={memberSince} />
                </ProfileSection>
              </>
            )}
          </div>
        )}
      </aside>
    </>
  )
}
