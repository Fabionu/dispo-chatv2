import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Trash2, Upload } from 'lucide-react'
import type { CompanyProfile } from '../../lib/types'
import { api } from '../../lib/api'
import CompanyLogo from '../CompanyLogo'

type Props = {
  onBack: () => void
  // Bubble saved data up so the workspace header (name + logo) updates
  // immediately. `version` busts the logo image cache.
  onSaved: (company: CompanyProfile, logoVersion: number) => void
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const FIELDS: { key: string; label: string; placeholder?: string; mono?: boolean }[] = [
  { key: 'name', label: 'Company name' },
  { key: 'legalName', label: 'Legal name' },
  { key: 'vatId', label: 'VAT / tax ID', mono: true },
  { key: 'website', label: 'Website', placeholder: 'https://…' },
  { key: 'country', label: 'Country' },
  { key: 'city', label: 'City' },
  { key: 'operationalAddress', label: 'Operational address' },
  { key: 'dispatchEmail', label: 'Dispatch email' },
  { key: 'dispatchPhone', label: 'Dispatch phone' },
]

// Company / workspace profile as a sidebar drawer — consistent with "My
// profile" (replaces the conversation list; the chat stays on the right).
// Editable only by admins; shown read-only otherwise.
export default function CompanySidebarPanel({ onBack, onSaved }: Props) {
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logoVersion, setLogoVersion] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.company
      .get()
      .then(({ company }) => hydrate(company))
      .catch(() => setError('Could not load the company profile.'))
  }, [])

  function hydrate(c: CompanyProfile) {
    setCompany(c)
    setForm({
      name: c.name ?? '',
      legalName: c.legalName ?? '',
      vatId: c.vatId ?? '',
      website: c.website ?? '',
      country: c.country ?? '',
      city: c.city ?? '',
      operationalAddress: c.operationalAddress ?? '',
      dispatchEmail: c.dispatchEmail ?? '',
      dispatchPhone: c.dispatchPhone ?? '',
    })
  }

  const canEdit = company?.canEdit ?? false
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('Please choose an image file.')
    if (file.size > MAX_IMAGE_BYTES) return setError('Image too large (max 10MB).')
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

  async function save() {
    if (!form.name.trim()) return setError('Company name is required.')
    setSaving(true)
    setError(null)
    try {
      const { company: c } = await api.company.update({
        name: form.name.trim(),
        legalName: form.legalName.trim() || null,
        vatId: form.vatId.trim() || null,
        website: form.website.trim() || null,
        country: form.country.trim() || null,
        city: form.city.trim() || null,
        operationalAddress: form.operationalAddress.trim() || null,
        dispatchEmail: form.dispatchEmail.trim() || null,
        dispatchPhone: form.dispatchPhone.trim() || null,
      })
      setCompany(c)
      onSaved(c, logoVersion)
    } catch {
      setError('Could not save the company profile.')
    } finally {
      setSaving(false)
    }
  }

  return (
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
        <span className="text-[13px] font-semibold">Company profile</span>
      </div>

      {!company ? (
        <div className="flex-1 flex items-center justify-center text-[12px] text-faint">
          {error ?? 'Loading…'}
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
            {!canEdit && (
              <div className="text-[11px] text-muted bg-white/[0.03] border border-white/[0.06] rounded-btn px-3 py-2">
                Only workspace admins can edit the company profile.
              </div>
            )}

            {/* Logo + name */}
            <div className="flex flex-col items-center text-center">
              <CompanyLogo size={64} version={logoVersion} className="!rounded-card" />
              <div className="mt-2.5 text-[16px] font-semibold tracking-[-0.2px]">{company.name}</div>
              {canEdit && (
                <div className="mt-3 flex items-center gap-1.5">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={onPickLogo}
                    className="hidden"
                  />
                  <SmallButton onClick={() => fileRef.current?.click()}>
                    <Upload size={12} strokeWidth={1.8} />
                    {company.hasLogo ? 'Change' : 'Upload'}
                  </SmallButton>
                  {company.hasLogo && (
                    <SmallButton onClick={removeLogo} tone="danger">
                      <Trash2 size={12} strokeWidth={1.8} />
                      Remove
                    </SmallButton>
                  )}
                </div>
              )}
            </div>

            <Section label="Registration">
              {FIELDS.slice(0, 4).map((f) => (
                <Field key={f.key} label={f.label}>
                  <input
                    value={form[f.key]}
                    onChange={set(f.key)}
                    disabled={!canEdit}
                    placeholder={f.placeholder}
                    className={`modal-input ${f.mono ? 'font-mono' : ''}`}
                  />
                </Field>
              ))}
            </Section>

            <Section label="Location">
              {FIELDS.slice(4, 7).map((f) => (
                <Field key={f.key} label={f.label}>
                  <input value={form[f.key]} onChange={set(f.key)} disabled={!canEdit} className="modal-input" />
                </Field>
              ))}
            </Section>

            <Section label="Dispatch">
              {FIELDS.slice(7).map((f) => (
                <Field key={f.key} label={f.label}>
                  <input value={form[f.key]} onChange={set(f.key)} disabled={!canEdit} className="modal-input" />
                </Field>
              ))}
            </Section>
          </div>

          {/* Sticky save bar (admins only). */}
          {canEdit && (
            <div className="shrink-0 border-t border-white/[0.05] px-4 py-3">
              {error && <div className="text-[11.5px] text-alert text-center mb-2">{error}</div>}
              <button
                onClick={() => void save()}
                disabled={saving}
                className="w-full h-9 rounded-btn bg-text text-bg text-[12.5px] font-semibold hover:bg-text/90 disabled:opacity-60 transition-colors"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Compact, sidebar-native form bits ───────────────────────────────────────
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-2">{label}</div>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] text-muted mb-1">{label}</label>
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
