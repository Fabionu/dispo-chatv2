import { useEffect, useState, type FormEvent } from 'react'
import { Eye, Loader2, Lock, Plus, Trash2, X } from 'lucide-react'
import type { AvailabilityStatus, Profile, Role } from '../../lib/types'
import { api, type ProfilePatch } from '../../lib/api'
import StatusSelect from './StatusSelect'
import { SettingsSection } from './sectionChrome'
import Avatar from '../Avatar'
import { avatarUrl, clearAvatarCache } from '../../lib/avatarCache'
import { RowMeta } from '../../pages/sidebarBits'
import { usePhotoEditor } from '../AvatarPhotoEditor'
import { EditableField } from '../forms'
import { useAuth } from '../../auth/AuthContext'
import AvatarCropModal from './AvatarCropModal'

type Props = {
  // Prefetched profile (warmed at app mount) so the drawer renders instantly
  // instead of flashing a "Loading…" state. When present we skip the fetch.
  initialProfile?: Profile | null
  // Auto-away presence (idle / tab hidden). Mentioned under Availability.
  away?: boolean
  // Bubble saved data up so the sidebar user footer (avatar + name) updates
  // immediately. A new photo arrives as a new `profile.avatarVersion`, which is
  // a new image URL everywhere that reads it.
  onSaved: (profile: Profile) => void
  /** Opens your own card the way colleagues open it (the user-details panel). */
  onPreview?: () => void
}

// Workspace-role display labels — shared with the read-only user details panel
// (UserProfilePanel) so both surfaces name roles identically.
export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  dispatcher: 'Dispatcher',
  driver: 'Driver',
  partner: 'Partner',
}

// Offered under "Add language" — the languages a European road-freight team
// most often shares. Anything else is typed.
const LANGUAGE_SUGGESTIONS = [
  'English',
  'German',
  'French',
  'Italian',
  'Spanish',
  'Polish',
  'Romanian',
  'Hungarian',
  'Dutch',
  'Czech',
  'Bulgarian',
  'Turkish',
]

// "My profile" — the content of its window (WindowShell, opened from the
// account window; user 2026-10-29/30 canvases). The frame brings the title and
// the close button; this is the identity card and the sections under it.
//
// Reworked 2026-10-12 from the "Profile & group info rework" canvas into the
// section language of Workspace settings. The banner stays (it is where the
// photo is managed). What changed: availability is a direct three-way choice
// instead of a pill menu in the banner; the two fields you can change sit in
// one card with an always-visible Edit; languages are removable tags instead
// of a comma-separated text field; the four identity facts nobody can change
// here (name, email, role, company) are one card marked Locked with a single
// reason, instead of being mixed into the editable rows with a hint each; and
// deleting the account is confirmed in place.
export default function ProfileSidebarPanel({
  initialProfile,
  away = false,
  onSaved,
  onPreview,
}: Props) {
  const [profile, setProfile] = useState<Profile | null>(initialProfile ?? null)
  const [availability, setAvailability] = useState<AvailabilityStatus>(
    initialProfile?.availabilityStatus ?? 'available',
  )
  const [error, setError] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  // The picked image awaiting crop confirmation. Set on selection (no immediate
  // upload); cleared on cancel or after a successful cropped upload.
  const [cropFile, setCropFile] = useState<File | null>(null)
  // Account deletion: a guarded, destructive action confirmed in place — the
  // first press arms it, the second (a different, filled button) commits.
  const auth = useAuth()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    // Seeded from the cache → render instantly, no fetch. Only fetch when we
    // opened before the prefetch finished (rare).
    if (initialProfile) return
    api.profile
      .get()
      .then(({ profile }) => {
        setProfile(profile)
        setAvailability(profile.availabilityStatus)
      })
      .catch(() => setError('Could not load your profile.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isDriver = profile?.role === 'driver'

  // Persist one profile change. Throws on failure so the calling control keeps
  // its state and surfaces a retryable error.
  async function savePatch(patch: ProfilePatch) {
    const { profile: p } = await api.profile.update(patch)
    setProfile(p)
    onSaved(p)
  }

  async function uploadCroppedAvatar(cropped: File) {
    const { profile: p } = await api.profile.uploadAvatar(cropped)
    // Purge every cached state for this user's old image (incl. the no-version
    // key used where the version isn't known) so the new picture shows
    // everywhere; the profile's new avatarVersion is a new URL for the rest.
    clearAvatarCache('user', p.id)
    setProfile(p)
    onSaved(p)
    setCropFile(null)
  }

  async function removeAvatar() {
    setError(null)
    try {
      const { profile: p } = await api.profile.removeAvatar()
      clearAvatarCache('user', p.id)
      setProfile(p)
      onSaved(p)
    } catch {
      setError('Could not remove the image.')
    }
  }

  // Availability applies immediately (a quick toggle, not a form field).
  async function changeAvailability(next: AvailabilityStatus) {
    if (next === availability) return
    const before = availability
    setAvailability(next)
    setStatusError(null)
    try {
      await savePatch({ availabilityStatus: next })
    } catch {
      setAvailability(before)
      setStatusError('Could not change your availability. Try again.')
    }
  }

  // Permanently anonymize the caller's own account. Messages and conversations
  // are preserved server-side (the author shows as "user_deleted_…"); only the
  // personal details are scrubbed. On success the server has already cleared the
  // cookie — we sign out locally to drop to the signed-out screen. This unmounts
  // the panel, so there's no success state to reset.
  async function deleteAccount() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.profile.delete()
      await auth.signOut()
    } catch {
      setDeleting(false)
      setConfirmDelete(false)
      setDeleteError('Could not delete your account. Try again.')
    }
  }

  // Photo viewing + management for the hero: the pencil (Change / Remove) and
  // the lightbox. Called unconditionally — it is a hook — with the "no profile
  // yet" case folded into `hasImage: false`.
  const editor = usePhotoEditor({
    hasImage: profile?.hasAvatar ?? false,
    canEdit: true,
    noun: 'profile photo',
    viewSrc: profile?.hasAvatar ? avatarUrl('user', profile.id, profile.avatarVersion) : undefined,
    viewTitle: profile?.displayName,
    onFile: (file) => {
      setError(null)
      setCropFile(file)
    },
    onRemove: removeAvatar,
    onError: setError,
  })

  const previewButton = onPreview && (
    <button
      type="button"
      onClick={onPreview}
      title="See your card the way colleagues see it"
      className="flex h-[2.125rem] items-center gap-1.5 rounded-btn border border-line-2 px-3 text-base font-semibold text-text transition-colors hover:bg-white/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      <Eye size="0.875rem" strokeWidth={1.9} />
      Preview card
    </button>
  )

  const photo = (
    <Avatar
      userId={profile?.id ?? ''}
      name={profile?.displayName ?? ''}
      size={72}
      version={profile?.avatarVersion}
      hasAvatar={profile?.hasAvatar}
      fallback="initials"
    />
  )

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        {!profile ? (
          <div className="flex-1 flex items-center justify-center text-sm text-faint">
            {error ?? 'Loading…'}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable] px-4 pt-1 pb-8">
            {/* Identity card (user, 2026-10-30 canvas): who you are on top —
                photo with its Options pencil, name, title │ role │ company and
                the sign-in email — with Preview card beside it; your status as
                one compact field row underneath. */}
            <div className="rounded-card border border-line bg-white/2">
              <div className="flex items-center gap-4 py-4 pl-[1.125rem] pr-4">
                <div className="relative shrink-0">
                  {editor.openPreview ? (
                    <button
                      type="button"
                      onClick={editor.openPreview}
                      aria-label="View your profile photo"
                      className="block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                    >
                      {photo}
                    </button>
                  ) : (
                    photo
                  )}
                  <div className="absolute -bottom-1 -right-1 origin-bottom-right scale-[0.7]">
                    {editor.optionsButton}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-2xl font-bold leading-tight tracking-[-0.02em]">
                    {profile.displayName}
                  </h2>
                  <div className="mt-1 text-base text-muted">
                    <RowMeta
                      segments={[profile.jobTitle ?? '', ROLE_LABEL[profile.role], profile.company].filter(Boolean)}
                      whole
                    />
                  </div>
                  <div className="mt-0.5 truncate text-sm text-faint">{profile.email}</div>
                </div>
                {previewButton && <div className="shrink-0 self-start">{previewButton}</div>}
              </div>
              {!isDriver && (
                <div className="flex items-center gap-3 border-t border-line py-2 pl-[1.125rem] pr-2.5">
                  <span className="shrink-0 text-base text-muted">Status</span>
                  <StatusSelect
                    value={availability}
                    onChange={(v) => void changeAvailability(v)}
                    title={
                      away
                        ? 'You show as Away right now: idle or this tab is hidden'
                        : 'Shown next to your name across the company'
                    }
                  />
                </div>
              )}
            </div>
            {(error || statusError) && (
              <p className="mt-2 px-1 text-sm leading-[1.4] text-alert">{error ?? statusError}</p>
            )}
            {editor.chrome}

            <div className="px-1">
              <SettingsSection
                title="Contact details"
                description="Colleagues and partners see these on your card."
              >
                <div className="overflow-hidden rounded-card border border-line divide-y divide-line">
                  <EditableField
                    variant="card"
                    label="Job title"
                    value={profile.jobTitle}
                    editable
                    placeholder="e.g. Fleet manager"
                    onSave={(v) => savePatch({ jobTitle: v || null })}
                  />
                  <EditableField
                    variant="card"
                    label="Work phone"
                    type="tel"
                    value={profile.workPhone}
                    editable
                    placeholder="+40 …"
                    onSave={(v) => savePatch({ workPhone: v || null })}
                  />
                </div>
              </SettingsSection>

              {!isDriver && (
                <SettingsSection
                  title="Languages"
                  description="On your card, so people know which languages they can write to you in."
                >
                  <LanguagesSetting
                    native={profile.nativeLanguage}
                    others={profile.otherLanguages}
                    onSave={savePatch}
                  />
                </SettingsSection>
              )}

              <SettingsSection
                title="Sign-in and role"
                action={
                  <span className="flex items-center gap-1.5 py-1.5 text-sm text-faint">
                    <Lock size="0.75rem" strokeWidth={2} aria-hidden />
                    Locked
                  </span>
                }
                description={`Set when your account was created. If one is wrong, ask an admin at ${profile.company}.`}
              >
                <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] rounded-card border border-line px-3.5">
                  {(
                    [
                      ['Name', profile.displayName],
                      ['Work email', profile.email],
                      ['Role', ROLE_LABEL[profile.role]],
                      ['Company', profile.company],
                    ] as const
                  ).map(([label, value], i) => (
                    <div key={label} className={`contents ${i === 0 ? '' : '[&>*]:border-t [&>*]:border-line'}`}>
                      <dt className="flex h-11 items-center text-base text-muted">{label}</dt>
                      <dd className="flex h-11 min-w-0 items-center justify-end">
                        <span className="max-w-full truncate text-base font-medium">{value}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </SettingsSection>

              <SettingsSection
                last
                title="Delete account"
                description="Removes your name, photo and details. Your messages stay in their conversations and show as a deleted user."
              >
                {confirmDelete ? (
                  <div className="flex flex-col gap-3 rounded-card border border-alert p-3.5">
                    <span className="text-lg font-semibold">This can’t be undone.</span>
                    <span className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        disabled={deleting}
                        className="h-9 rounded-btn border border-line-2 px-3 text-base font-semibold transition-colors hover:bg-white/6 disabled:opacity-60"
                      >
                        Keep my account
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteAccount()}
                        disabled={deleting}
                        className="inline-flex h-9 items-center gap-1.5 rounded-btn bg-alert px-3 text-base font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
                      >
                        {deleting && <Loader2 size="0.8125rem" strokeWidth={2.2} className="animate-spin" />}
                        Delete for good
                      </button>
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex h-9 items-center gap-1.5 self-start rounded-btn border border-alert/40 px-3 text-base font-semibold text-alert transition-colors hover:bg-alert/10"
                  >
                    <Trash2 size="0.8125rem" strokeWidth={1.9} />
                    Delete my account
                  </button>
                )}
                {deleteError && <p className="text-sm text-alert">{deleteError}</p>}
              </SettingsSection>
            </div>
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
    </>
  )
}

// Languages as tags: the native one first (marked), then the others, each
// removable; "Add language" opens suggestions plus a field for anything else.
// Every change saves at once — there is no form to submit.
function LanguagesSetting({
  native,
  others,
  onSave,
}: {
  native: string | null
  others: string[]
  onSave: (patch: ProfilePatch) => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const all = [...(native ? [native] : []), ...others]
  const has = (name: string) => all.some((l) => l.toLowerCase() === name.toLowerCase())
  const suggestions = LANGUAGE_SUGGESTIONS.filter((l) => !has(l)).slice(0, 6)

  async function run(patch: ProfilePatch) {
    setBusy(true)
    setError(null)
    try {
      await onSave(patch)
      return true
    } catch {
      setError('Could not save your languages. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  function remove(name: string) {
    if (name === native) void run({ nativeLanguage: null })
    else void run({ otherLanguages: others.filter((l) => l !== name) })
  }

  async function add(raw: string) {
    const name = raw.trim()
    if (!name || has(name)) {
      setDraft('')
      return
    }
    // The first language anyone adds is their native one.
    const ok = await run(native ? { otherLanguages: [...others, name].slice(0, 15) } : { nativeLanguage: name })
    if (ok) {
      setDraft('')
      setAdding(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void add(draft)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {all.map((name) => (
          <span
            key={name}
            className="flex h-8 items-center gap-1.5 rounded-btn border border-line pl-3 pr-0.5 text-base font-medium"
          >
            {name}
            {name === native && <span className="text-sm font-normal text-muted">Native</span>}
            <button
              type="button"
              onClick={() => remove(name)}
              disabled={busy}
              aria-label={`Remove ${name}`}
              className="flex h-[1.625rem] w-[1.625rem] items-center justify-center rounded-btn text-faint transition-colors hover:bg-white/6 hover:text-text disabled:opacity-50"
            >
              <X size="0.75rem" strokeWidth={2.2} />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          aria-expanded={adding}
          className="flex h-8 items-center gap-1.5 rounded-btn border border-line-2 px-3 text-base font-semibold transition-colors hover:bg-white/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <Plus size="0.8125rem" strokeWidth={2} />
          Add language
        </button>
      </div>

      {adding && (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-white/2 p-3">
          {suggestions.length > 0 && (
            <>
              <span className="text-sm text-muted">Suggestions</span>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((name) => (
                  <button
                    key={name}
                    type="button"
                    disabled={busy}
                    onClick={() => void add(name)}
                    className="h-[1.875rem] rounded-btn border border-line bg-bg px-2.5 text-base font-medium transition-colors hover:border-line-2 disabled:opacity-50"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </>
          )}
          <form onSubmit={submit} className="flex gap-1.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Another language"
              aria-label="Another language"
              disabled={busy}
              className="h-9 min-w-0 flex-1 rounded-card border border-line-2 bg-transparent px-3 text-base text-text outline-none placeholder:text-faint focus:border-text/60"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="h-9 shrink-0 rounded-btn bg-text px-3 text-base font-semibold text-bg transition-opacity disabled:opacity-40"
            >
              Add
            </button>
          </form>
        </div>
      )}
      {error && <p className="text-sm text-alert">{error}</p>}
    </div>
  )
}
