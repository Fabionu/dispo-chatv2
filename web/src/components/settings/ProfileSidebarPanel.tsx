import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, ChevronDown, Loader2, Trash2 } from 'lucide-react'
import type { AvailabilityStatus, Profile, Role } from '../../lib/types'
import { api, type ProfilePatch } from '../../lib/api'
import { ICON_ACTION_BASE, ICON_ACTION_IDLE } from '../HeaderIconButton'
import { useAuth } from '../../auth/AuthContext'
import { avatarUrl, clearAvatarCache } from '../../lib/avatarCache'
import { AVAILABILITY, AWAY, statusMeta } from '../../lib/availability'
import Avatar from '../Avatar'
import AvatarPhotoEditor from '../AvatarPhotoEditor'
import EditableRow from '../EditableRow'
import ConfirmDialog from '../ConfirmDialog'
import AvatarCropModal from './AvatarCropModal'

type Props = {
  // Prefetched profile (warmed at app mount) so the drawer renders instantly
  // instead of flashing a "Loading…" state. When present we skip the fetch.
  initialProfile?: Profile | null
  // Auto-away presence (idle / tab hidden). Overrides the manual status display
  // without changing the stored value.
  away?: boolean
  onBack: () => void
  // Bubble saved data up so the sidebar user footer (avatar + name) updates
  // immediately. `version` busts the avatar image cache.
  onSaved: (profile: Profile, avatarVersion: number) => void
}

// Workspace-role display labels — shared with the read-only user details panel
// (UserProfilePanel) so both surfaces name roles identically.
export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  dispatcher: 'Dispatcher',
  driver: 'Driver',
  partner: 'Partner',
}

// "My profile" rendered as a sidebar drawer (replaces the conversation list)
// rather than a floating modal — the chat stays visible on the right.
//
// Reads as clean information by default: work details, languages and company
// are label/value rows, not form boxes. Each editable field is changed
// INDIVIDUALLY — its own pencil → inline input → Save/Cancel — so there's no
// single all-or-nothing form mode. Role and work email are identity/permission
// fields: always read-only, never inputs.
export default function ProfileSidebarPanel({ initialProfile, away = false, onBack, onSaved }: Props) {
  const [profile, setProfile] = useState<Profile | null>(initialProfile ?? null)
  const [availability, setAvailability] = useState<AvailabilityStatus>(
    initialProfile?.availabilityStatus ?? 'available',
  )
  const [error, setError] = useState<string | null>(null)
  const [avatarVersion, setAvatarVersion] = useState(0)
  // The picked image awaiting crop confirmation. Set on selection (no immediate
  // upload); cleared on cancel or after a successful cropped upload.
  const [cropFile, setCropFile] = useState<File | null>(null)
  // Account-deletion flow: a guarded, destructive action. `confirmDelete` shows
  // the confirm dialog; `deleting` disables the trigger while the request runs.
  const auth = useAuth()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    // Seeded from the cache → render instantly, no fetch. Only fetch when we
    // opened before the prefetch finished (rare).
    if (initialProfile) return
    api.profile
      .get()
      .then(({ profile }) => hydrate(profile))
      .catch(() => setError('Could not load your profile.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function hydrate(p: Profile) {
    setProfile(p)
    setAvailability(p.availabilityStatus)
  }

  const isDriver = profile?.role === 'driver'

  // Persist a single profile field. Throws on failure so the calling row keeps
  // its editor open and surfaces a retryable error.
  async function savePatch(patch: ProfilePatch) {
    const { profile: p } = await api.profile.update(patch)
    setProfile(p)
    onSaved(p, avatarVersion)
  }

  async function uploadCroppedAvatar(cropped: File) {
    const { profile: p } = await api.profile.uploadAvatar(cropped)
    // Purge every cached state for this user's old image (incl. the no-version
    // key used by message rows) so the new picture shows everywhere; the bumped
    // version below busts any browser/HTTP cache too.
    clearAvatarCache('user', p.id)
    const v = avatarVersion + 1
    setAvatarVersion(v)
    setProfile(p)
    onSaved(p, v)
    setCropFile(null)
  }

  async function removeAvatar() {
    setError(null)
    try {
      const { profile: p } = await api.profile.removeAvatar()
      clearAvatarCache('user', p.id)
      const v = avatarVersion + 1
      setAvatarVersion(v)
      setProfile(p)
      onSaved(p, v)
    } catch {
      setError('Could not remove the image.')
    }
  }

  // Availability changes apply immediately (a quick toggle, not a form field).
  async function setStatus(s: AvailabilityStatus) {
    setAvailability(s)
    setError(null)
    try {
      const { profile: p } = await api.profile.update({ availabilityStatus: s })
      setProfile(p)
      onSaved(p, avatarVersion)
    } catch {
      setError('Could not update status.')
    }
  }

  // Permanently anonymize the caller's own account. Messages and conversations
  // are preserved server-side (the author shows as "user_deleted_…"); only the
  // personal details are scrubbed. On success the server has already cleared the
  // cookie — we sign out locally to drop to the signed-out screen. This unmounts
  // the panel, so there's no success state to reset.
  async function deleteAccount() {
    setDeleting(true)
    setError(null)
    try {
      await api.profile.delete()
      await auth.signOut()
    } catch {
      setDeleting(false)
      setConfirmDelete(false)
      setError('Could not delete your account. Please try again.')
    }
  }

  const languagesValue = profile && profile.otherLanguages.length ? profile.otherLanguages.join(', ') : ''

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header — matches the rail's header height, with a back affordance. */}
        <div className="h-[var(--header-height)] flex items-center gap-2 px-3 shrink-0">
          <button
            onClick={onBack}
            aria-label="Back to inbox"
            className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE} shrink-0`}
          >
            <ArrowLeft size="1.25rem" strokeWidth={1.8} />
          </button>
          <span className="text-[0.8125rem] font-semibold">Profile</span>
        </div>

        {!profile ? (
          <div className="flex-1 flex items-center justify-center text-[0.75rem] text-faint">
            {error ?? 'Loading…'}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
            {/* Identity — the avatar is the hero. Change/remove via the image
                overlay + the More menu (top-right); no form-style buttons. */}
            <div className="relative flex flex-col items-center text-center pt-1">
              <AvatarPhotoEditor
                size={96}
                hasImage={profile.hasAvatar}
                canEdit
                noun="profile photo"
                viewSrc={profile.hasAvatar ? avatarUrl('user', profile.id, avatarVersion) : undefined}
                viewTitle={profile.displayName}
                onFile={(file) => {
                  setError(null)
                  setCropFile(file)
                }}
                onRemove={removeAvatar}
                onError={setError}
              >
                <Avatar
                  userId={profile.id}
                  name={profile.displayName}
                  size={96}
                  version={avatarVersion}
                />
              </AvatarPhotoEditor>
              <div className="mt-3 text-[1rem] font-semibold tracking-[-0.2px]">
                {profile.displayName}
              </div>
              <div className="mt-0.5 text-[0.75rem] text-muted">
                {ROLE_LABEL[profile.role]}
                {profile.jobTitle ? ` · ${profile.jobTitle}` : ''}
              </div>
              {!isDriver && <StatusSelect value={availability} away={away} onChange={setStatus} />}
              {error && <div className="text-[0.71875rem] text-alert mt-2">{error}</div>}
            </div>

            {/* Work details — each editable row changes on its own. */}
            <Section label="Work details">
              {/* Display name is identity — captured at signup and locked after
                  creation (identity consistency / anti-abuse). Read-only. */}
              <EditableRow label="Display name" value={profile.displayName} hint="Set at signup" />
              {/* Role is permission-based — read-only. */}
              <EditableRow label="Role" value={ROLE_LABEL[profile.role]} hint="Set by an admin" />
              <EditableRow
                label="Job title / function"
                value={profile.jobTitle}
                editable
                placeholder="e.g. Fleet Manager"
                onSave={(v) => savePatch({ jobTitle: v || null })}
              />
              <EditableRow
                label="Work phone"
                value={profile.workPhone}
                editable
                placeholder="+40…"
                onSave={(v) => savePatch({ workPhone: v || null })}
              />
              {/* Email is identity — read-only. */}
              <EditableRow label="Work email" value={profile.email} hint="Used to sign in" />
            </Section>

            {/* Languages (not shown for drivers). */}
            {!isDriver && (
              <Section label="Languages">
                <EditableRow
                  label="Native language"
                  value={profile.nativeLanguage}
                  editable
                  placeholder="e.g. Romanian"
                  onSave={(v) => savePatch({ nativeLanguage: v || null })}
                />
                <EditableRow
                  label="Other spoken languages"
                  value={languagesValue}
                  editable
                  hint="Comma-separated"
                  placeholder="e.g. English, German"
                  onSave={(v) =>
                    savePatch({
                      otherLanguages: v
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .slice(0, 15),
                    })
                  }
                />
              </Section>
            )}

            {/* Company (read-only context) */}
            <Section label="Company">
              <EditableRow label="Workspace" value={profile.company} />
            </Section>

            {/* Danger zone — account deletion. Anonymizes the account; chat
                history is preserved but personal details are removed. */}
            <Section label="Danger zone">
              <div className="rounded-card border border-alert/20 bg-alert/[0.04] px-3.5 py-3">
                <div className="text-[0.78125rem] text-text font-medium leading-tight">
                  Delete account
                </div>
                <p className="text-[0.71875rem] text-faint mt-1 leading-[1.45]">
                  Permanently removes your name, photo and profile details. Your messages stay in
                  conversations but show as a deleted user. This can’t be undone.
                </p>
                <button
                  onClick={() => setConfirmDelete(true)}
                  disabled={deleting}
                  className="mt-3 inline-flex items-center gap-1.5 h-8 px-3 rounded-btn border border-alert/40 text-alert text-[0.75rem] font-semibold hover:bg-alert/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {deleting ? (
                    <Loader2 size="0.8125rem" strokeWidth={2.2} className="animate-spin" />
                  ) : (
                    <Trash2 size="0.8125rem" strokeWidth={1.9} />
                  )}
                  Delete my account
                </button>
              </div>
            </Section>
          </div>
        )}
      </div>

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onConfirm={uploadCroppedAvatar}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete your account?"
          message="This permanently removes your name, photo and profile details. Your messages stay in conversations but will show as a deleted user. This can’t be undone."
          confirmLabel="Delete account"
          tone="alert"
          onConfirm={deleteAccount}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}

// Status selector — sits under the name. The chip reflects the current status
// (or "Away" when auto-away is active) and opens a small colour-coded menu.
// Selecting applies instantly.
function StatusSelect({
  value,
  away,
  onChange,
}: {
  value: AvailabilityStatus
  away: boolean
  onChange: (s: AvailabilityStatus) => void
}) {
  const [open, setOpen] = useState(false)
  const meta = statusMeta(value)
  const display = away ? AWAY : meta

  return (
    <div className="relative mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.71875rem] font-medium transition-opacity hover:opacity-90"
        style={{ color: display.color, backgroundColor: `${display.color}22` }}
      >
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: display.color }} />
        {display.label}
        {away && <span className="opacity-70">· auto</span>}
        <ChevronDown size="0.75rem" strokeWidth={2} className="-mr-0.5 opacity-70" />
      </button>

      {open && (
        <>
          {/* Click-away backdrop. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="listbox"
            className="absolute left-1/2 -translate-x-1/2 mt-1.5 z-20 w-[9.375rem] rounded-card border border-white/[0.1] bg-surface py-1"
            style={{ boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}
          >
            {AVAILABILITY.map((a) => (
              <button
                key={a.value}
                role="option"
                aria-selected={a.value === value}
                onClick={() => {
                  setOpen(false)
                  if (a.value !== value) onChange(a.value)
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/[0.04] transition-colors"
              >
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
                <span className="flex-1 text-[0.75rem] text-text">{a.label}</span>
                {a.value === value && <Check size="0.8125rem" strokeWidth={2} className="text-muted shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Compact, sidebar-native bits ────────────────────────────────────────────
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-2">{label}</div>
      {children}
    </div>
  )
}
