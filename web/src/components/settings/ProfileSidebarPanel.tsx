import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, ChevronDown, Trash2, Upload } from 'lucide-react'
import type { AvailabilityStatus, Profile, Role } from '../../lib/types'
import { api, type ProfilePatch } from '../../lib/api'
import { clearAvatarCache } from '../../lib/avatarCache'
import { AVAILABILITY, AWAY, statusMeta } from '../../lib/availability'
import Avatar from '../Avatar'
import EditableRow from '../EditableRow'
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

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  dispatcher: 'Dispatcher',
  driver: 'Driver',
  partner: 'Partner',
}
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

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
  const fileRef = useRef<HTMLInputElement>(null)

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

  // Selecting an image opens the crop step (no immediate upload). The confirmed
  // crop is uploaded via uploadCroppedAvatar.
  function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('Please choose an image file.')
    if (file.size > MAX_IMAGE_BYTES) return setError('Image too large (max 10MB).')
    setError(null)
    setCropFile(file)
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

  const languagesValue = profile && profile.otherLanguages.length ? profile.otherLanguages.join(', ') : ''

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header — matches the rail's header height, with a back affordance. */}
        <div className="h-[var(--header-height)] flex items-center gap-2 px-3 border-b border-white/[0.05] shrink-0">
          <button
            onClick={onBack}
            aria-label="Back to inbox"
            className="h-8 w-8 flex items-center justify-center rounded-chip text-muted hover:text-text hover:bg-white/[0.04] transition-colors shrink-0"
          >
            <ArrowLeft size={16} strokeWidth={1.8} />
          </button>
          <span className="text-[13px] font-semibold">Profile</span>
        </div>

        {!profile ? (
          <div className="flex-1 flex items-center justify-center text-[12px] text-faint">
            {error ?? 'Loading…'}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
            {/* Identity */}
            <div className="flex flex-col items-center text-center">
              <Avatar userId={profile.id} name={profile.displayName} size={72} version={avatarVersion} />
              <div className="mt-2.5 text-[16px] font-semibold tracking-[-0.2px]">
                {profile.displayName}
              </div>
              <div className="mt-0.5 text-[12px] text-muted">
                {ROLE_LABEL[profile.role]}
                {profile.jobTitle ? ` · ${profile.jobTitle}` : ''}
              </div>
              {!isDriver && <StatusSelect value={availability} away={away} onChange={setStatus} />}
              {/* Image controls — your own profile, so always available. */}
              <div className="mt-3 flex items-center gap-1.5">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={onPickAvatar}
                  className="hidden"
                />
                <SmallButton onClick={() => fileRef.current?.click()}>
                  <Upload size={12} strokeWidth={1.8} />
                  {profile.hasAvatar ? 'Change photo' : 'Upload photo'}
                </SmallButton>
                {profile.hasAvatar && (
                  <SmallButton onClick={removeAvatar} tone="danger">
                    <Trash2 size={12} strokeWidth={1.8} />
                    Remove
                  </SmallButton>
                )}
              </div>
              {error && <div className="text-[11.5px] text-alert mt-2">{error}</div>}
            </div>

            {/* Work details — each editable row changes on its own. */}
            <Section label="Work details">
              <EditableRow
                label="Display name"
                value={profile.displayName}
                editable
                required
                onSave={(v) => savePatch({ displayName: v })}
              />
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
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-opacity hover:opacity-90"
        style={{ color: display.color, backgroundColor: `${display.color}22` }}
      >
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: display.color }} />
        {display.label}
        {away && <span className="opacity-70">· auto</span>}
        <ChevronDown size={12} strokeWidth={2} className="-mr-0.5 opacity-70" />
      </button>

      {open && (
        <>
          {/* Click-away backdrop. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="listbox"
            className="absolute left-1/2 -translate-x-1/2 mt-1.5 z-20 w-[150px] rounded-card border border-white/[0.1] bg-surface py-1"
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
                <span className="flex-1 text-[12px] text-text">{a.label}</span>
                {a.value === value && <Check size={13} strokeWidth={2} className="text-muted shrink-0" />}
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

function SmallButton({
  children,
  onClick,
  tone = 'default',
}: {
  children: ReactNode
  onClick: () => void
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      onClick={onClick}
      className={`h-7 px-2.5 inline-flex items-center gap-1.5 rounded-btn border text-[11.5px] transition-colors ${
        tone === 'danger'
          ? 'border-white/[0.12] text-muted hover:text-alert hover:border-alert/40'
          : 'border-white/[0.14] text-text hover:bg-white/[0.04]'
      }`}
    >
      {children}
    </button>
  )
}
