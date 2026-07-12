import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Info,
  Link2,
  Loader2,
  Palette,
  Plus,
  Trash2,
  Users,
} from 'lucide-react'
import {
  useMessageDisplay,
  setMessageDisplay,
  type MessageDisplay,
} from '../../lib/messageDisplay'
import {
  useDensity,
  getStoredDensity,
  setDensity,
  clearDensityOverride,
  type Density,
} from '../../lib/density'
import { useAuth } from '../../auth/AuthContext'
import { api, ApiError } from '../../lib/api'
import type { Role, WorkspaceInvite, WorkspaceInviteCreated } from '../../lib/types'
import { ROLE_LABEL } from './ProfileSidebarPanel'
import { ICON_ACTION_BASE, ICON_ACTION_IDLE } from '../HeaderIconButton'
import { MENU_CONTAINER, menuItemClass } from '../menuStyles'

// Roles an invite can grant, in menu order (the default first, admin last as the
// most privileged). Labels come from the shared ROLE_LABEL map so every surface
// names roles identically; the short hints describe each role in the picker.
const INVITE_ROLE_ORDER: readonly Role[] = ['dispatcher', 'driver', 'partner', 'admin']
const INVITE_ROLE_HINT: Record<Role, string> = {
  dispatcher: 'Plans trips, manages vehicles and members',
  driver: 'Drives assigned trips (mobile driver access)',
  partner: 'External partner with limited access',
  admin: 'Full company administration',
}
// The role a new invite defaults to — matches the server default so an admin who
// doesn't touch the picker gets the previous behaviour.
const DEFAULT_INVITE_ROLE: Role = 'dispatcher'

type Props = { onBack: () => void }

// The settings categories. New ones (Notifications, Integrations …) drop in as
// another CategoryRow + detail view.
type Category = 'appearance' | 'members' | 'about'

// The app version, shared by the About detail and the category list summary.
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.3.2'

// Workspace settings as a sidebar drawer — consistent with "My profile" /
// "Company profile" (replaces the conversation list; the chat stays on the
// right) and rendered inside the sidebar card so it shares the same shell.
//
// Two-level, category-based UX: the FIRST screen lists settings CATEGORIES as
// rows of ONE grouped card (a deliberate settings menu, not floating cards),
// each showing its LIVE value as the subtitle; clicking one opens that
// category's DETAIL view. Holds APP/DISPLAY preferences ONLY — never personal
// profile fields (those live in "My profile"). Each appearance setting is a
// device-local pref persisted in localStorage by its lib module — changing it
// in a detail view applies live.
export default function WorkspaceSettingsPanel({ onBack }: Props) {
  // Which category's detail is open (null = the category list). Local UI state;
  // no routing needed — the drawer is a self-contained master/detail.
  const [category, setCategory] = useState<Category | null>(null)
  // Only workspace admins manage company members; the row is hidden otherwise
  // (the server enforces this too). Auth is always signed-in inside this panel.
  const auth = useAuth()
  const isAdmin = auth.status === 'signed_in' && auth.user.role === 'admin'
  // Live values for the category-list subtitles (the hooks subscribe, so the
  // summaries refresh when the user returns from a detail view).
  const messageDisplay = useMessageDisplay()
  const densityOverride = getStoredDensity()

  // ── Detail views ────────────────────────────────────────────────────────────
  if (category) {
    const title = { appearance: 'Appearance', members: 'Company members', about: 'About' }[category]
    return (
      <div className="flex flex-col h-full">
        <PanelHeader
          title={title}
          onBack={() => setCategory(null)}
          backLabel="Back to Workspace settings"
        />
        <div className="flex-1 overflow-y-auto px-4 py-5">
          {category === 'appearance' ? (
            <AppearanceSettings />
          ) : category === 'members' ? (
            <CompanyMembersSettings />
          ) : (
            <AboutSettings />
          )}
        </div>
      </div>
    )
  }

  // ── Category list ───────────────────────────────────────────────────────────
  const appearanceValue = `${messageDisplay === 'bubble' ? 'Bubbles' : 'Plain stream'} · ${
    densityOverride ? DENSITY_LABEL[densityOverride] : 'Auto'
  } density`

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Workspace settings" onBack={onBack} backLabel="Back to inbox" />
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="rounded-card border border-white/[0.06] bg-white/[0.015] divide-y divide-white/[0.05] overflow-hidden">
          <CategoryRow
            icon={<Palette size="1rem" strokeWidth={1.8} />}
            title="Appearance"
            value={appearanceValue}
            onClick={() => setCategory('appearance')}
          />
          {isAdmin && (
            <CategoryRow
              icon={<Users size="1rem" strokeWidth={1.8} />}
              title="Company members"
              value="Invite people with a secure link"
              onClick={() => setCategory('members')}
            />
          )}
          <CategoryRow
            icon={<Info size="1rem" strokeWidth={1.8} />}
            title="About"
            value={`Version ${APP_VERSION}`}
            onClick={() => setCategory('about')}
          />
        </div>
        <p className="text-[0.6875rem] text-faint mt-2.5 px-1 leading-[1.5]">
          Appearance preferences are saved in this browser and apply to this device only.
        </p>
      </div>
    </div>
  )
}

// A settings CATEGORY entry: one row of the grouped list card — leading glyph
// chip, title over its live current value, trailing chevron. Rows share the
// card's border and are separated by hairlines; hover brightens the row only,
// so the group reads as one calm menu.
function CategoryRow({
  icon,
  title,
  value,
  onClick,
}: {
  icon: ReactNode
  title: string
  value: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03]"
    >
      <span className="h-8 w-8 shrink-0 flex items-center justify-center rounded-btn border border-white/[0.06] bg-white/[0.02] text-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.8125rem] font-medium text-text leading-tight">{title}</span>
        <span className="block text-[0.71875rem] text-faint mt-0.5 leading-[1.4] truncate">
          {value}
        </span>
      </span>
      <ChevronRight size="1rem" strokeWidth={1.8} className="shrink-0 text-faint" />
    </button>
  )
}

// Appearance detail: both display preferences in ONE hairline-divided card,
// with the device-local note as a quiet footnote underneath.
function AppearanceSettings() {
  return (
    <div>
      <div className="rounded-card border border-white/[0.06] bg-white/[0.015] px-4 divide-y divide-white/[0.05]">
        <MessageDisplaySetting />
        <DensitySetting />
      </div>
      <p className="text-[0.6875rem] text-faint mt-2 px-1 leading-[1.5]">
        Saved in this browser — applies to this device only.
      </p>
    </div>
  )
}

// Drawer header — matches the rail's header height, with a back affordance. The
// back target differs per level (list → inbox, detail → list), so it's passed
// in along with an accessible label.
function PanelHeader({
  title,
  onBack,
  backLabel,
}: {
  title: string
  onBack: () => void
  backLabel: string
}) {
  return (
    <div className="h-[var(--header-height)] flex items-center gap-2 px-3 shrink-0">
      <button
        onClick={onBack}
        aria-label={backLabel}
        className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE} shrink-0`}
      >
        <ArrowLeft size="1.25rem" strokeWidth={1.8} />
      </button>
      <span className="text-[0.8125rem] font-semibold">{title}</span>
    </div>
  )
}

// Message display style: bubbles vs the plain "operational log" stream.
// Applies live to every open conversation via the messageDisplay listeners.
function MessageDisplaySetting() {
  const messageDisplay = useMessageDisplay()
  return (
    <SettingBlock
      label="Message display"
      description="Bubbles align messages left and right; plain stream reads like a log."
    >
      <Segmented
        value={messageDisplay}
        options={[
          { value: 'bubble', label: 'Bubbles' },
          { value: 'plain', label: 'Plain stream' },
        ]}
        onChange={(v) => setMessageDisplay(v as MessageDisplay)}
      />
    </SettingBlock>
  )
}

const DENSITY_LABEL: Record<Density, string> = {
  compact: 'Compact',
  default: 'Standard',
  comfortable: 'Comfortable',
}

// Interface density: the manual override for lib/density's UI-scale tiers.
// "Auto" (the default) clears the override and follows the screen size; picking
// a tier pins it on this device. The choice mirrors localStorage, so it's local
// state seeded from getStoredDensity() — useDensity() supplies the live tier so
// the Auto description can say what it resolves to right now.
function DensitySetting() {
  const [choice, setChoice] = useState<Density | 'auto'>(() => getStoredDensity() ?? 'auto')
  const live = useDensity()

  function change(v: string) {
    if (v === 'auto') clearDensityOverride()
    else setDensity(v as Density)
    setChoice(v as Density | 'auto')
  }

  return (
    <SettingBlock
      label="Interface density"
      description={
        choice === 'auto'
          ? `Sizes text and controls. Auto follows your screen — currently ${DENSITY_LABEL[live]}.`
          : 'Sizes text and controls. Auto follows your screen size.'
      }
    >
      <Segmented
        value={choice}
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'compact', label: 'Compact' },
          { value: 'default', label: 'Standard' },
          { value: 'comfortable', label: 'Comfortable' },
        ]}
        onChange={change}
      />
    </SettingBlock>
  )
}

// App/version/build metadata in a clean, read-only label/value card. Values
// come from optional build-time env (injected by CI) and fall back to the
// package version / "Not available" so nothing sensitive is exposed.
function AboutSettings() {
  const mode: string = import.meta.env.MODE
  const environment = mode.charAt(0).toUpperCase() + mode.slice(1)
  const buildDate = import.meta.env.VITE_BUILD_DATE ?? 'Not available'
  const commitRaw = import.meta.env.VITE_COMMIT_SHA ?? 'Not available'
  // Show a short SHA when a full one is provided; leave the fallback untouched.
  const commit =
    commitRaw !== 'Not available' && commitRaw.length > 10 ? commitRaw.slice(0, 7) : commitRaw

  return (
    <div className="rounded-card border border-white/[0.06] bg-white/[0.015] px-4 py-1.5">
      <FieldRow label="App version" value={APP_VERSION} />
      <FieldRow label="Environment" value={environment} />
      <FieldRow label="Build date" value={buildDate} />
      <FieldRow label="Commit" value={commit} mono />
    </div>
  )
}

// ── Company members (admin) ─────────────────────────────────────────────────
// Generate single-use, 15-minute invite links and review recent ones. The raw
// link is shown ONCE (right after generation); the list afterwards carries only
// status + timing, mirroring the server (which stores just a token hash).
function CompanyMembersSettings() {
  const [invites, setInvites] = useState<WorkspaceInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  // The just-created link, surfaced prominently with copy + countdown. Cleared
  // on the next generate so only the freshest link shows its raw token.
  const [fresh, setFresh] = useState<WorkspaceInviteCreated | null>(null)
  // Role the NEXT generated invite will grant. Chosen before generating; the
  // server validates + stores it and applies it when the invitee registers.
  const [role, setRole] = useState<Role>(DEFAULT_INVITE_ROLE)

  const load = useCallback(async () => {
    try {
      const { invites } = await api.workspaceInvites.list()
      setInvites(invites)
      setLoadError(false)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function generate() {
    setGenerating(true)
    setGenError(null)
    try {
      const { invite } = await api.workspaceInvites.create(role)
      setFresh(invite)
      await load()
    } catch (err) {
      setGenError(
        err instanceof ApiError && err.code === 'too_many_requests'
          ? 'Too many links generated. Try again later.'
          : 'Could not generate a link. Try again.',
      )
    } finally {
      setGenerating(false)
    }
  }

  // Change the role a still-pending invite will grant. Optimistic — update the
  // row (and the fresh card, if it's the same invite) immediately, then reconcile
  // from the server; on failure, reload to restore the true value.
  async function changeInviteRole(id: string, next: Role) {
    setInvites((prev) => prev.map((i) => (i.id === id ? { ...i, role: next } : i)))
    if (fresh && fresh.id === id) setFresh({ ...fresh, role: next })
    try {
      await api.workspaceInvites.setRole(id, next)
    } catch {
      void load()
    }
  }

  async function revoke(id: string) {
    // Optimistic: flip to expired locally, then reconcile.
    setInvites((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'expired' } : i)))
    if (fresh && id === fresh.id) setFresh(null)
    try {
      await api.workspaceInvites.revoke(id)
    } finally {
      void load()
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Generate + link ──────────────────────────────────────────────────
          One card for the whole create flow: role picker and Generate as a
          single row, the role hint underneath, and — past a hairline — the
          link slot (the fresh link with copy/countdown, or a quiet explainer
          while no link exists). */}
      <section>
        <div className="eyebrow mb-2">New invite link</div>
        <div className="rounded-card border border-white/[0.06] bg-white/[0.015] p-3.5">
          <label htmlFor="invite-role" className="block text-[0.71875rem] text-muted">
            Invite as
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <RoleSelect id="invite-role" value={role} onChange={setRole} disabled={generating} />
            </div>
            <button
              onClick={generate}
              disabled={generating}
              className="shrink-0 h-9 px-3.5 flex items-center gap-1.5 rounded-btn bg-text text-bg font-semibold text-[0.78125rem] hover:bg-text/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {generating ? (
                <Loader2 size="0.875rem" strokeWidth={2.2} className="animate-spin" />
              ) : (
                <Plus size="0.875rem" strokeWidth={2.2} />
              )}
              Generate
            </button>
          </div>
          <p className="text-[0.6875rem] text-faint mt-1.5 leading-[1.45]">
            {INVITE_ROLE_HINT[role]}
          </p>
          {genError && <div className="mt-2 text-[0.71875rem] text-alert">{genError}</div>}

          <div className="mt-3 pt-3 border-t border-white/[0.05]">
            {fresh ? (
              <FreshInviteLink invite={fresh} />
            ) : (
              <div className="flex items-start gap-2 text-[0.6875rem] text-faint leading-[1.45]">
                <Link2 size="0.8125rem" strokeWidth={1.8} className="shrink-0 mt-px" />
                <span>
                  Your link appears here once generated — single-use, valid for 15 minutes.
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Recent invites ─────────────────────────────────────────────────── */}
      <section>
        <div className="eyebrow mb-2">Recent invites</div>
        {loading ? (
          <div className="flex items-center gap-2 text-[0.75rem] text-faint px-1 py-1">
            <Loader2 size="0.8125rem" className="animate-spin" /> Loading invites…
          </div>
        ) : loadError ? (
          <div className="text-[0.75rem] text-alert px-1 py-1">Could not load invites.</div>
        ) : invites.length === 0 ? (
          <div className="rounded-card border border-white/[0.06] bg-white/[0.015] px-3.5 py-3 text-[0.71875rem] text-faint leading-[1.45]">
            No invites yet — generate a link above to add your first member.
          </div>
        ) : (
          // No overflow-hidden — the row role dropdown must be able to open past
          // the card edge; first/last rows round their own hover corners instead.
          <div className="rounded-card border border-white/[0.06] bg-white/[0.015] divide-y divide-white/[0.05]">
            {invites.map((inv) => (
              <InviteListRow
                key={inv.id}
                invite={inv}
                onRevoke={() => revoke(inv.id)}
                onChangeRole={(next) => void changeInviteRole(inv.id, next)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// A live-updating "now" tick (default 1s) for invite countdowns.
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

// mm:ss remaining until `expiresAt`, or null once elapsed.
function remaining(expiresAt: string, now: number): string | null {
  const ms = new Date(expiresAt).getTime() - now
  if (ms <= 0) return null
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// The freshly-generated link, rendered in the link slot of the "New invite
// link" card: copyable, with a live countdown. This is the only place the raw
// link is ever shown, hence the "shown only once" note.
function FreshInviteLink({ invite }: { invite: WorkspaceInviteCreated }) {
  const now = useNow()
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const left = remaining(invite.expiresAt, now)

  async function copy() {
    let ok = false
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(invite.url)
      ok = true
    } catch {
      // The async Clipboard API can be missing or permission-denied (embedded
      // webviews, older browsers) — select the field and use the legacy command.
      const el = inputRef.current
      if (el) {
        el.focus()
        el.select()
        ok = document.execCommand('copy')
      }
    }
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[0.71875rem] font-medium text-done">
          <span className="h-1.5 w-1.5 rounded-full bg-done" aria-hidden />
          Link ready — shown only once
        </div>
        <RoleBadge role={invite.role} />
      </div>
      <div className="mt-2 flex items-center gap-1">
        <input
          ref={inputRef}
          readOnly
          value={invite.url}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 h-9 bg-black/20 border border-white/[0.06] rounded-btn px-2.5 text-[0.71875rem] text-text font-mono truncate outline-none transition-colors focus:border-white/[0.16]"
        />
        <button
          onClick={copy}
          title={copied ? 'Copied' : 'Copy link'}
          aria-label="Copy invite link"
          className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE} shrink-0`}
        >
          {copied ? (
            <Check size="1rem" strokeWidth={2.4} className="text-done" />
          ) : (
            <Copy size="1rem" strokeWidth={1.8} />
          )}
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[0.6875rem] text-faint">
        {left ? (
          <span>
            Single-use · expires in <span className="tabular-nums text-muted">{left}</span>
          </span>
        ) : (
          <span className="text-alert">This link has expired.</span>
        )}
        <span
          aria-live="polite"
          className={`text-done transition-opacity ${copied ? 'opacity-100' : 'opacity-0'}`}
        >
          Copied
        </span>
      </div>
    </div>
  )
}

// One row in the recent-invites list, styled like the app's member rows: a
// circular glyph chip (with a green corner dot while the link is live, echoing
// the presence dot on avatars), name/status over a detail line, then the
// trailing controls. An active invite's role is editable inline (a compact
// select) and revocable — revoke is two-step (icon → explicit "Revoke") so a
// stray click can't kill a link. A used/expired invite shows its role
// read-only — the member already exists with that role, so it can't change here.
function InviteListRow({
  invite,
  onRevoke,
  onChangeRole,
}: {
  invite: WorkspaceInvite
  onRevoke: () => void
  onChangeRole: (role: Role) => void
}) {
  const now = useNow(30_000)
  // Arm-then-confirm for revoke; disarms by itself if the admin walks away.
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(false), 3000)
    return () => clearTimeout(t)
  }, [confirming])

  const active = invite.status === 'active'
  const left = active ? remaining(invite.expiresAt, now) : null
  const by = invite.createdByName ? ` · by ${invite.createdByName}` : ''
  const primary =
    invite.status === 'used' ? (invite.usedByName ?? 'Invite used') : 'Invite link'
  const secondary = active
    ? `Active · ${left ? `expires in ${left}` : 'expiring…'}${by}`
    : invite.status === 'used'
      ? `Joined the company${invite.createdByName ? ` · invited by ${invite.createdByName}` : ''}`
      : `Expired · not used${by}`

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.02] transition-colors first:rounded-t-card last:rounded-b-card">
      <div className="relative shrink-0">
        <span className="h-[2.125rem] w-[2.125rem] flex items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.02] text-muted">
          {invite.status === 'used' ? (
            <Check size="0.9375rem" strokeWidth={2} />
          ) : (
            <Link2
              size="0.9375rem"
              strokeWidth={1.8}
              className={invite.status === 'expired' ? 'opacity-50' : undefined}
            />
          )}
        </span>
        {active && (
          <span
            title="Active"
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-rail bg-done"
          />
        )}
      </div>
      <div className="min-w-0 flex-1 flex flex-col gap-px">
        <div
          className={`text-[0.8125rem] leading-tight truncate ${
            invite.status === 'expired' ? 'text-muted' : 'text-text'
          }`}
        >
          {primary}
        </div>
        <div className="text-[0.6875rem] leading-tight text-faint truncate">{secondary}</div>
      </div>
      {active ? (
        <>
          <RoleSelect
            value={invite.role}
            onChange={onChangeRole}
            compact
            ariaLabel="Change invite role"
          />
          {confirming ? (
            <button
              onClick={() => {
                setConfirming(false)
                onRevoke()
              }}
              className="shrink-0 h-7 px-2.5 rounded-btn text-[0.6875rem] font-semibold text-alert bg-alert/10 hover:bg-alert/15 transition-colors"
            >
              Revoke
            </button>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              title="Revoke link"
              aria-label="Revoke link"
              className="shrink-0 h-7 w-7 flex items-center justify-center rounded-full text-muted hover:text-alert hover:bg-alert/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
              <Trash2 size="0.875rem" strokeWidth={1.8} />
            </button>
          )}
        </>
      ) : (
        <RoleBadge role={invite.role} />
      )}
    </div>
  )
}

// The role picker — a custom listbox on the app's shared menu recipe
// (menuStyles), replacing the native <select> so the open menu matches every
// other project dropdown (no browser-default option rows). The closed trigger
// reads as a standard field; the menu anchors to it (same width in the default
// variant, right-aligned in `compact` — the small variant used inline in a
// list row; the default fills its container in the generate card).
function RoleSelect({
  value,
  onChange,
  id,
  disabled = false,
  compact = false,
  ariaLabel,
}: {
  value: Role
  onChange: (role: Role) => void
  id?: string
  disabled?: boolean
  compact?: boolean
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape — same pattern as the app's other anchored
  // menus (MemberRow's actions menu).
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={`relative ${compact ? 'shrink-0' : ''}`}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-card border bg-white/[0.03] text-text text-left outline-none transition-colors hover:border-white/[0.16] focus-visible:border-white/[0.22] disabled:opacity-50 disabled:cursor-default ${
          open ? 'border-white/[0.22]' : 'border-white/[0.08]'
        } ${compact ? 'h-7 w-[6.25rem] px-2 text-[0.6875rem]' : 'h-9 w-full px-2.5 text-[0.78125rem]'}`}
      >
        <span className="flex-1 min-w-0 truncate">{ROLE_LABEL[value]}</span>
        <ChevronDown
          size={compact ? '0.75rem' : '0.875rem'}
          strokeWidth={1.8}
          className={`shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel ?? 'Role'}
          className={`absolute top-full mt-1 z-20 ${MENU_CONTAINER} ${
            compact ? 'right-0 w-[8.5rem]' : 'left-0 right-0'
          }`}
        >
          {INVITE_ROLE_ORDER.map((r) => (
            <button
              key={r}
              type="button"
              role="option"
              aria-selected={r === value}
              onClick={() => {
                setOpen(false)
                if (r !== value) onChange(r)
              }}
              className={menuItemClass()}
            >
              <span className="flex-1 min-w-0 truncate">{ROLE_LABEL[r]}</span>
              {r === value && (
                <Check size="0.8125rem" strokeWidth={2} className="text-muted shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// A quiet, read-only role pill for used/expired invites and the fresh-link card.
function RoleBadge({ role }: { role: Role }) {
  return (
    <span className="shrink-0 text-[0.625rem] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border border-white/[0.1] bg-white/[0.04] text-muted">
      {ROLE_LABEL[role]}
    </span>
  )
}

// A compact label/value line: label muted on the left, value on the right.
// Rows are separated by a hairline divider (none after the last).
function FieldRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-white/[0.03] last:border-0">
      <span className="shrink-0 text-[0.75rem] text-muted">{label}</span>
      <span
        title={value}
        className={`min-w-0 truncate text-right text-text ${
          mono ? 'font-mono text-[0.71875rem] tabular-nums' : 'text-[0.78125rem]'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

// One setting inside the Appearance card: a clean label + short description
// stacked over its control. Blocks stack in a divide-y card, so each carries
// its own vertical padding; the card's hairlines do the separating.
function SettingBlock({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="py-3.5">
      <div className="text-[0.8125rem] text-text font-medium leading-tight">{label}</div>
      <div className="text-[0.71875rem] text-faint mt-0.5 leading-[1.4]">{description}</div>
      <div className="mt-2.5">{children}</div>
    </div>
  )
}

// A light segmented control: a quietly recessed track with a soft accent-tinted
// pill for the active option — clear, but calmer than a fully-filled button.
// The setting's label/description live in the SettingBlock above it.
function Segmented({
  value,
  options,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-card bg-black/20 p-0.5">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`h-7 px-3.5 rounded-btn text-[0.75rem] transition-colors ${
              active
                ? 'bg-active/15 text-active font-semibold'
                : 'text-muted hover:text-text hover:bg-white/[0.03]'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
