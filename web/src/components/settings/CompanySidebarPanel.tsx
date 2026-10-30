import { useEffect, useState, type ComponentProps } from 'react'
import type { CompanyProfile } from '../../lib/types'
import { api, type CompanyProfilePatch } from '../../lib/api'
import { Box } from 'lucide-react'
import { usePhotoEditor } from '../AvatarPhotoEditor'
import { EditableField } from '../forms'
import { RowMeta } from '../../pages/sidebarBits'
import { SettingsSection } from './sectionChrome'

type Props = {
  // Bubble saved data up so the workspace header (name + logo) updates
  // immediately. `version` busts the logo image cache.
  onSaved: (company: CompanyProfile, logoVersion: number) => void
}

// Company profile — the content of its window (WindowShell, opened from the
// account window; user 2026-10-30 canvas), in My profile's language: an
// identity card, then sections of equal-height label │ value rows.
//
// Reads as clean information by default: every detail is a label/value row, not
// a form box. Admins edit each field INDIVIDUALLY (its own pencil → inline input
// → Save/Cancel, like the profile/group panels); non-admins simply see read-only
// rows — never disabled-looking inputs.
export default function CompanySidebarPanel({ onSaved }: Props) {
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logoVersion, setLogoVersion] = useState(0)

  useEffect(() => {
    api.company
      .get()
      .then(({ company }) => setCompany(company))
      .catch(() => setError('Could not load the company profile.'))
  }, [])

  const canEdit = company?.canEdit ?? false

  // Persist a single field. Throws on failure so the EditableRow keeps its
  // editor open and shows a retryable error (partial PATCH is supported server
  // side, so only the changed column is written).
  async function saveField(patch: CompanyProfilePatch) {
    const { company: c } = await api.company.update(patch)
    setCompany(c)
    onSaved(c, logoVersion)
  }

  // The file is already type/size-validated by AvatarPhotoEditor before it
  // reaches here. There's no crop step for logos — upload directly.
  async function uploadLogo(file: File) {
    setError(null)
    try {
      const { company: c } = await api.company.uploadLogo(file)
      const v = logoVersion + 1
      setLogoVersion(v)
      setCompany(c)
      onSaved(c, v)
    } catch {
      setError('Could not upload the logo.')
    }
  }

  async function removeLogo() {
    setError(null)
    try {
      const { company: c } = await api.company.removeLogo()
      const v = logoVersion + 1
      setLogoVersion(v)
      setCompany(c)
      onSaved(c, v)
    } catch {
      setError('Could not remove the logo.')
    }
  }

  // The logo's viewing + management, for the hero's two slots.
  const logoSrc = company?.hasLogo ? `/api/company-profile/logo?v=${logoVersion}` : undefined
  const editor = usePhotoEditor({
    hasImage: company?.hasLogo ?? false,
    canEdit,
    noun: 'logo',
    viewSrc: logoSrc,
    viewTitle: company?.name,
    onFile: uploadLogo,
    onRemove: removeLogo,
    onError: setError,
  })

  const field = (props: Omit<ComponentProps<typeof EditableField>, 'variant'>) => (
    <EditableField variant="columns" {...props} />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!company ? (
        <div className="flex-1 flex items-center justify-center text-sm text-faint">
          {error ?? 'Loading…'}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable] px-4 pt-1 pb-8">
          {/* Identity card — the same shape as My profile's: the logo (a square
              tile, since a logo is artwork, not a face) with its Options pencil,
              the name, where the company is and its website; underneath, what
              you can do here. */}
          <div className="rounded-card border border-line bg-white/2">
            <div className="flex items-center gap-4 py-4 pl-[1.125rem] pr-4">
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={editor.openPreview}
                  disabled={!editor.openPreview}
                  aria-label={logoSrc ? `View the ${company.name} logo` : `${company.name} has no logo`}
                  className="flex h-[4.5rem] w-[4.5rem] items-center justify-center overflow-hidden rounded-card border border-line bg-surface-2 text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                >
                  {logoSrc ? (
                    <img src={logoSrc} alt="" className="h-full w-full object-contain p-2" />
                  ) : (
                    <Box size="1.875rem" strokeWidth={1.4} />
                  )}
                </button>
                <div className="absolute -bottom-1 -right-1 origin-bottom-right scale-[0.7]">
                  {editor.optionsButton}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-2xl font-bold leading-tight tracking-[-0.02em]">{company.name}</h2>
                <div className="mt-1 text-base text-muted">
                  <RowMeta segments={[company.city ?? '', company.country ?? ''].filter(Boolean)} whole />
                </div>
                {company.website && <div className="mt-0.5 truncate text-sm text-faint">{company.website}</div>}
              </div>
            </div>
            <div className="flex h-12 items-center gap-3 border-t border-line pl-[1.125rem] pr-4">
              <span className="shrink-0 text-base text-muted">Your role</span>
              <span className="min-w-0 flex-1 truncate text-base font-medium">
                {canEdit ? 'Admin — you can edit the company details' : 'Managed by a workspace admin'}
              </span>
            </div>
          </div>
          {error && <p className="mt-2 px-1 text-sm text-alert">{error}</p>}
          {editor.chrome}

          <div className="px-1">
            <SettingsSection
              title="Registration"
              description="The company’s official identity. Name and legal name can’t change once set."
            >
              <div className={ROWS}>
                {/* Company name is the identity captured at signup — locked for
                    everyone (no verified rename flow). */}
                {field({ label: 'Company name', value: company.name, hint: 'Set at signup' })}
                {/* Legal name locks ONCE SET: fillable while empty, then frozen. */}
                {field({
                  label: 'Legal name',
                  value: company.legalName,
                  editable: canEdit && !company.legalName,
                  placeholder: 'Registered legal entity',
                  hint: company.legalName ? 'Locked once set' : undefined,
                  onSave: (v) => saveField({ legalName: v || null }),
                })}
                {field({
                  label: 'VAT / tax ID',
                  value: company.vatId,
                  editable: canEdit,
                  placeholder: 'e.g. RO12345678',
                  onSave: (v) => saveField({ vatId: v || null }),
                })}
                {field({
                  label: 'Website',
                  value: company.website,
                  editable: canEdit,
                  placeholder: 'https://…',
                  onSave: (v) => saveField({ website: v || null }),
                })}
              </div>
            </SettingsSection>

            <SettingsSection title="Location" description="Where the company operates from.">
              <div className={ROWS}>
                {field({
                  label: 'Country',
                  value: company.country,
                  editable: canEdit,
                  placeholder: 'e.g. Romania',
                  onSave: (v) => saveField({ country: v || null }),
                })}
                {field({
                  label: 'City',
                  value: company.city,
                  editable: canEdit,
                  onSave: (v) => saveField({ city: v || null }),
                })}
                {field({
                  label: 'Address',
                  value: company.operationalAddress,
                  editable: canEdit,
                  placeholder: 'Street, number, postal code',
                  onSave: (v) => saveField({ operationalAddress: v || null }),
                })}
              </div>
            </SettingsSection>

            <SettingsSection last title="Dispatch" description="How partners reach your dispatch desk.">
              <div className={ROWS}>
                {/* Dispatch email is a company contact identity → locks ONCE SET
                    (anti-impersonation). */}
                {field({
                  label: 'Dispatch email',
                  value: company.dispatchEmail,
                  editable: canEdit && !company.dispatchEmail,
                  placeholder: 'dispatch@…',
                  hint: company.dispatchEmail ? 'Locked once set' : undefined,
                  onSave: (v) => saveField({ dispatchEmail: v || null }),
                })}
                {field({
                  label: 'Dispatch phone',
                  value: company.dispatchPhone,
                  editable: canEdit,
                  placeholder: '+40…',
                  onSave: (v) => saveField({ dispatchPhone: v || null }),
                })}
              </div>
            </SettingsSection>
          </div>
        </div>
      )}
    </div>
  )
}

// One card of equal-height label │ value rows (user, 2026-10-30: "every section
// should have equal height").
const ROWS = 'overflow-hidden rounded-card border border-line divide-y divide-line'
