import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { CompanyProfile } from '../../lib/types'
import { api, type CompanyProfilePatch } from '../../lib/api'
import CompanyLogo from '../CompanyLogo'
import AvatarPhotoEditor from '../AvatarPhotoEditor'
import EditableRow from '../EditableRow'

type Props = {
  onBack: () => void
  // Bubble saved data up so the workspace header (name + logo) updates
  // immediately. `version` busts the logo image cache.
  onSaved: (company: CompanyProfile, logoVersion: number) => void
}

// Company / workspace profile as a sidebar drawer — consistent with "My
// profile" (replaces the conversation list; the chat stays on the right) and
// rendered inside the sidebar card, so it shares the same shell.
//
// Reads as clean information by default: every detail is a label/value row, not
// a form box. Admins edit each field INDIVIDUALLY (its own pencil → inline input
// → Save/Cancel, like the profile/group panels); non-admins simply see read-only
// rows — never disabled-looking inputs.
export default function CompanySidebarPanel({ onBack, onSaved }: Props) {
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

  return (
    <div className="flex flex-col h-full">
      {/* Header — matches the rail's header height, with a back affordance. */}
      <div className="h-[var(--header-height)] flex items-center gap-2 px-3 shrink-0">
        <button
          onClick={onBack}
          aria-label="Back to inbox"
          className="h-8 w-8 flex items-center justify-center rounded-chip text-muted hover:text-text hover:bg-white/[0.04] transition-colors shrink-0"
        >
          <ArrowLeft size={16} strokeWidth={1.8} />
        </button>
        <span className="text-[13px] font-semibold">Company profile</span>
      </div>

      {!company ? (
        <div className="flex-1 flex items-center justify-center text-[12px] text-faint">
          {error ?? 'Loading…'}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* Logo + name — the logo is the hero, integrated into the card. The
              logo previews in a lightbox (View); admins also change/remove it via
              the hover three-dots menu in the logo's corner (no form-style
              buttons). Non-admins can view but not manage. */}
          <div className="flex flex-col items-center text-center pt-1">
            <AvatarPhotoEditor
              size={72}
              shape="circle"
              hasImage={company.hasLogo}
              canEdit={canEdit}
              noun="logo"
              viewSrc={
                company.hasLogo ? `/api/company-profile/logo?v=${logoVersion}` : undefined
              }
              viewTitle={company.name}
              onFile={uploadLogo}
              onRemove={removeLogo}
              onError={setError}
            >
              <CompanyLogo size={72} version={logoVersion} className="!rounded-full" />
            </AvatarPhotoEditor>
            <div className="mt-2.5 text-[16px] font-semibold tracking-[-0.2px]">{company.name}</div>
            {!canEdit && (
              <div className="mt-1 text-[11px] text-faint">Managed by a workspace admin</div>
            )}
            {error && <div className="text-[11.5px] text-alert mt-2">{error}</div>}
          </div>

          {/* Registration */}
          <Section label="Registration">
            {/* Company name is the official identity captured at signup — locked
                after creation for everyone (no verified rename flow). Read-only. */}
            <EditableRow label="Company name" value={company.name} hint="Set at signup" />
            {/* Legal name locks ONCE SET: an admin can fill it in while empty, but
                once saved it becomes the official entity name and can't change. */}
            <EditableRow
              label="Legal name"
              value={company.legalName}
              editable={canEdit && !company.legalName}
              placeholder="Registered legal entity"
              hint={company.legalName ? 'Locked once set' : undefined}
              onSave={(v) => saveField({ legalName: v || null })}
            />
            <EditableRow
              label="VAT / tax ID"
              value={company.vatId}
              editable={canEdit}
              placeholder="e.g. RO12345678"
              onSave={(v) => saveField({ vatId: v || null })}
            />
            <EditableRow
              label="Website"
              value={company.website}
              editable={canEdit}
              placeholder="https://…"
              onSave={(v) => saveField({ website: v || null })}
            />
          </Section>

          {/* Location */}
          <Section label="Location">
            <EditableRow
              label="Country"
              value={company.country}
              editable={canEdit}
              placeholder="e.g. Romania"
              onSave={(v) => saveField({ country: v || null })}
            />
            <EditableRow
              label="City"
              value={company.city}
              editable={canEdit}
              onSave={(v) => saveField({ city: v || null })}
            />
            <EditableRow
              label="Operational address"
              value={company.operationalAddress}
              editable={canEdit}
              multiline
              placeholder="Street, number, postal code"
              onSave={(v) => saveField({ operationalAddress: v || null })}
            />
          </Section>

          {/* Dispatch */}
          <Section label="Dispatch">
            {/* Dispatch email is a company contact identity → locks ONCE SET:
                settable while empty, then frozen (anti-impersonation). */}
            <EditableRow
              label="Dispatch email"
              value={company.dispatchEmail}
              editable={canEdit && !company.dispatchEmail}
              placeholder="dispatch@…"
              hint={company.dispatchEmail ? 'Locked once set' : undefined}
              onSave={(v) => saveField({ dispatchEmail: v || null })}
            />
            <EditableRow
              label="Dispatch phone"
              value={company.dispatchPhone}
              editable={canEdit}
              placeholder="+40…"
              onSave={(v) => saveField({ dispatchPhone: v || null })}
            />
          </Section>
        </div>
      )}
    </div>
  )
}

// ── Compact, sidebar-native bits ────────────────────────────────────────────
// Matches the profile panel's Section: an eyebrow label over a stack of
// EditableRows (each carries its own hairline divider), no boxy wrapper.
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-2">{label}</div>
      {children}
    </div>
  )
}
