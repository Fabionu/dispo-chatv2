import { useEffect, useState } from 'react'
import type { CompanyProfile } from '../../lib/types'
import { api, type CompanyProfilePatch } from '../../lib/api'
import CompanyLogo from '../CompanyLogo'
import AvatarPhotoEditor from '../AvatarPhotoEditor'
import { EditableField, EditableTextarea } from '../forms'
import { PanelHeader } from './panelChrome'
import {
  PANEL_BODY,
  PANEL_SURFACE,
  PROFILE_HERO_SIZE,
  ProfileHero,
  ProfileSection,
} from './profileChrome'

type Props = {
  onBack: () => void
  /** Names the back target (this panel is reached from the rail's bottom row). */
  backLabel?: string
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
export default function CompanySidebarPanel({ onBack, backLabel = 'Back', onSaved }: Props) {
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
    <div className={`flex flex-col h-full ${PANEL_SURFACE}`}>
      <PanelHeader title="Company profile" onBack={onBack} backLabel={backLabel} />

      {!company ? (
        <div className="flex-1 flex items-center justify-center text-sm text-faint">
          {error ?? 'Loading…'}
        </div>
      ) : (
        <div className={PANEL_BODY}>
          {/* Logo + name — the logo is the hero, at the same size as every other
              profile surface. It previews in a lightbox (View); admins also
              change/remove it via the hover three-dots menu in the logo's corner
              (no form-style buttons). Non-admins can view but not manage. */}
          <ProfileHero
            image={
              <AvatarPhotoEditor
                size={PROFILE_HERO_SIZE}
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
                <CompanyLogo
                  size={PROFILE_HERO_SIZE}
                  version={logoVersion}
                  className="!rounded-full"
                />
              </AvatarPhotoEditor>
            }
            title={company.name}
            subtitle={canEdit ? undefined : 'Managed by a workspace admin'}
            error={error}
          />

          {/* Registration */}
          <ProfileSection label="Registration">
            {/* Company name is the official identity captured at signup — locked
                after creation for everyone (no verified rename flow). Read-only. */}
            <EditableField label="Company name" value={company.name} hint="Set at signup" />
            {/* Legal name locks ONCE SET: an admin can fill it in while empty, but
                once saved it becomes the official entity name and can't change. */}
            <EditableField
              label="Legal name"
              value={company.legalName}
              editable={canEdit && !company.legalName}
              placeholder="Registered legal entity"
              hint={company.legalName ? 'Locked once set' : undefined}
              onSave={(v) => saveField({ legalName: v || null })}
            />
            <EditableField
              label="VAT / tax ID"
              value={company.vatId}
              editable={canEdit}
              placeholder="e.g. RO12345678"
              onSave={(v) => saveField({ vatId: v || null })}
            />
            <EditableField
              label="Website"
              value={company.website}
              editable={canEdit}
              placeholder="https://…"
              onSave={(v) => saveField({ website: v || null })}
            />
          </ProfileSection>

          {/* Location */}
          <ProfileSection label="Location">
            <EditableField
              label="Country"
              value={company.country}
              editable={canEdit}
              placeholder="e.g. Romania"
              onSave={(v) => saveField({ country: v || null })}
            />
            <EditableField
              label="City"
              value={company.city}
              editable={canEdit}
              onSave={(v) => saveField({ city: v || null })}
            />
            <EditableTextarea
              label="Operational address"
              value={company.operationalAddress}
              editable={canEdit}
              placeholder="Street, number, postal code"
              onSave={(v) => saveField({ operationalAddress: v || null })}
            />
          </ProfileSection>

          {/* Dispatch */}
          <ProfileSection label="Dispatch">
            {/* Dispatch email is a company contact identity → locks ONCE SET:
                settable while empty, then frozen (anti-impersonation). */}
            <EditableField
              label="Dispatch email"
              value={company.dispatchEmail}
              editable={canEdit && !company.dispatchEmail}
              placeholder="dispatch@…"
              hint={company.dispatchEmail ? 'Locked once set' : undefined}
              onSave={(v) => saveField({ dispatchEmail: v || null })}
            />
            <EditableField
              label="Dispatch phone"
              value={company.dispatchPhone}
              editable={canEdit}
              placeholder="+40…"
              onSave={(v) => saveField({ dispatchPhone: v || null })}
            />
          </ProfileSection>
        </div>
      )}
    </div>
  )
}
