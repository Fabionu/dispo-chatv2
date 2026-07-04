import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Check,
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
import { useViewMode, setViewMode, type ViewMode } from '../../lib/viewMode'
import {
  useMessageDisplay,
  setMessageDisplay,
  type MessageDisplay,
} from '../../lib/messageDisplay'
import { useAuth } from '../../auth/AuthContext'
import { api, ApiError } from '../../lib/api'
import type { WorkspaceInvite, WorkspaceInviteCreated } from '../../lib/types'
import { ICON_ACTION_BASE, ICON_ACTION_IDLE } from '../HeaderIconButton'

type Props = { onBack: () => void }

// The settings categories. New ones (Notifications, Integrations …) drop in as
// another CategoryCard + detail view.
type Category = 'appearance' | 'members' | 'about'

// Workspace settings as a sidebar drawer — consistent with "My profile" /
// "Company profile" (replaces the conversation list; the chat stays on the
// right) and rendered inside the sidebar card so it shares the same shell.
//
// Two-level, category-based UX: the FIRST screen lists settings CATEGORIES as
// cards; clicking one opens that category's DETAIL view. Holds APP/DISPLAY
// preferences ONLY — never personal profile fields (those live in "My
// profile"). Each setting is a device-local pref persisted in localStorage by
// its lib module — toggling in a detail view applies live.
export default function WorkspaceSettingsPanel({ onBack }: Props) {
  // Which category's detail is open (null = the category list). Local UI state;
  // no routing needed — the drawer is a self-contained master/detail.
  const [category, setCategory] = useState<Category | null>(null)
  // Only workspace admins manage company members; the card is hidden otherwise
  // (the server enforces this too). Auth is always signed-in inside this panel.
  const auth = useAuth()
  const isAdmin = auth.status === 'signed_in' && auth.user.role === 'admin'

  // ── Detail: Company members ────────────────────────────────────────────────
  if (category === 'members') {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader
          title="Company members"
          onBack={() => setCategory(null)}
          backLabel="Back to Workspace settings"
        />
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <CompanyMembersSettings />
        </div>
      </div>
    )
  }

  // ── Detail: Appearance ─────────────────────────────────────────────────────
  if (category === 'appearance') {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader
          title="Appearance"
          onBack={() => setCategory(null)}
          backLabel="Back to Workspace settings"
        />
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <AppearanceSettings />
        </div>
      </div>
    )
  }

  // ── Detail: About ───────────────────────────────────────────────────────────
  if (category === 'about') {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader
          title="About"
          onBack={() => setCategory(null)}
          backLabel="Back to Workspace settings"
        />
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <AboutSettings />
        </div>
      </div>
    )
  }

  // ── Category list ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Workspace settings" onBack={onBack} backLabel="Back to inbox" />
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-2.5">
        {isAdmin && (
          <CategoryCard
            icon={<Users size="1rem" strokeWidth={1.8} />}
            title="Company members"
            description="Invite people to your company with a secure link."
            onClick={() => setCategory('members')}
          />
        )}
        <CategoryCard
          icon={<Palette size="1rem" strokeWidth={1.8} />}
          title="Appearance"
          description="Conversation list density and message style."
          onClick={() => setCategory('appearance')}
        />
        <CategoryCard
          icon={<Info size="1rem" strokeWidth={1.8} />}
          title="About"
          description="Version and build information."
          onClick={() => setCategory('about')}
        />
      </div>
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

// A settings CATEGORY entry on the list screen: a subtle bordered card with a
// leading glyph, a title + short description, and a trailing chevron. Brightens
// on hover so it reads as tappable, while staying compact and native to the
// dark theme.
function CategoryCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-card border border-white/[0.07] bg-white/[0.015] px-3 py-3 text-left transition-colors hover:bg-white/[0.03] hover:border-white/[0.12]"
    >
      <span className="h-8 w-8 shrink-0 flex items-center justify-center rounded-[0.4375rem] border border-white/[0.06] bg-white/[0.02] text-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.8125rem] font-semibold text-text leading-tight">{title}</span>
        <span className="block text-[0.71875rem] text-faint mt-0.5 leading-[1.4]">{description}</span>
      </span>
      <ChevronRight size="1rem" strokeWidth={1.8} className="shrink-0 text-faint" />
    </button>
  )
}

// Appearance detail content. Kept deliberately calm: a short muted lead-in, then
// ONE light card grouping the display controls under a quiet "Conversation
// layout" heading. Settings are separated by generous spacing rather than
// dividers, so nothing competes. Subscribes to the prefs only while mounted.
function AppearanceSettings() {
  const viewMode = useViewMode()
  const messageDisplay = useMessageDisplay()

  return (
    <div className="space-y-5">
      <p className="text-[0.75rem] text-faint leading-[1.5]">
        Personalize how conversations look on this device.
      </p>

      <div className="rounded-card border border-white/[0.06] bg-white/[0.015] px-4 py-4">
        <div className="text-[0.71875rem] text-muted mb-4">Conversation layout</div>
        <div className="space-y-5">
          <SettingBlock
            label="List density"
            description="Choose how much space each conversation uses."
          >
            <Segmented
              value={viewMode}
              options={[
                { value: 'compact', label: 'Compact' },
                { value: 'normal', label: 'Normal' },
              ]}
              onChange={(v) => setViewMode(v as ViewMode)}
            />
          </SettingBlock>
          <SettingBlock
            label="Message display"
            description="Bubbles align messages left/right; plain stream reads as a log."
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
        </div>
      </div>
    </div>
  )
}

// About detail content: app/version/build metadata in a clean label/value
// card. Values come from optional build-time env (injected by CI) and fall back
// to the package version / "Not available" so nothing sensitive is exposed.
function AboutSettings() {
  const appVersion = import.meta.env.VITE_APP_VERSION ?? '0.3.2'
  const environment = import.meta.env.MODE
  const buildDate = import.meta.env.VITE_BUILD_DATE ?? 'Not available'
  const commitRaw = import.meta.env.VITE_COMMIT_SHA ?? 'Not available'
  // Show a short SHA when a full one is provided; leave the fallback untouched.
  const commit =
    commitRaw !== 'Not available' && commitRaw.length > 10 ? commitRaw.slice(0, 7) : commitRaw

  return (
    <div className="space-y-5">
      <p className="text-[0.75rem] text-faint leading-[1.5]">Version and build information for this app.</p>

      <div className="rounded-card border border-white/[0.06] bg-white/[0.015] px-4 py-1.5">
        <FieldRow label="App version" value={appVersion} />
        <FieldRow label="Environment" value={environment} />
        <FieldRow label="Build date" value={buildDate} />
        <FieldRow label="Commit" value={commit} mono />
      </div>
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
      const { invite } = await api.workspaceInvites.create()
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
      <p className="text-[0.75rem] text-faint leading-[1.5]">
        Invite people to join <span className="text-muted">your company</span>. Each link works
        once, expires after 15 minutes, and can’t be reused after someone signs up.
      </p>

      <button
        onClick={generate}
        disabled={generating}
        className="w-full h-9 flex items-center justify-center gap-2 rounded-btn bg-text text-bg font-semibold text-[0.78125rem] hover:bg-text/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {generating ? (
          <Loader2 size="0.875rem" strokeWidth={2.2} className="animate-spin" />
        ) : (
          <Plus size="0.875rem" strokeWidth={2.2} />
        )}
        Generate invite link
      </button>

      {genError && (
        <div className="text-[0.75rem] text-alert border border-alert/30 bg-alert/5 rounded-btn px-3 py-2">
          {genError}
        </div>
      )}

      {fresh && <FreshInviteCard invite={fresh} />}

      {/* Recent invites */}
      <div>
        <div className="text-[0.71875rem] text-muted mb-2">Recent invites</div>
        {loading ? (
          <div className="flex items-center gap-2 text-[0.75rem] text-faint px-1 py-2">
            <Loader2 size="0.8125rem" className="animate-spin" /> Loading…
          </div>
        ) : loadError ? (
          <div className="text-[0.75rem] text-alert px-1 py-2">Could not load invites.</div>
        ) : invites.length === 0 ? (
          <div className="text-[0.75rem] text-faint px-1 py-2">No invites yet.</div>
        ) : (
          <div className="rounded-card border border-white/[0.06] bg-white/[0.015] divide-y divide-white/[0.05]">
            {invites.map((inv) => (
              <InviteListRow key={inv.id} invite={inv} onRevoke={() => revoke(inv.id)} />
            ))}
          </div>
        )}
      </div>
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

// The freshly-generated link: copyable, with a live countdown. This is the only
// place the raw link is ever shown.
function FreshInviteCard({ invite }: { invite: WorkspaceInviteCreated }) {
  const now = useNow()
  const [copied, setCopied] = useState(false)
  const left = remaining(invite.expiresAt, now)

  async function copy() {
    try {
      await navigator.clipboard?.writeText(invite.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — the field is selectable as a fallback */
    }
  }

  return (
    <div className="rounded-card border border-active/30 bg-active/[0.06] px-3.5 py-3 space-y-2.5">
      <div className="flex items-center gap-2 text-[0.75rem] font-semibold text-active">
        <Link2 size="0.875rem" strokeWidth={2} /> Invite link ready
      </div>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={invite.url}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 bg-black/20 border border-white/[0.08] rounded-btn px-2.5 py-2 text-[0.71875rem] text-text font-mono truncate focus:outline-none focus:border-white/[0.2]"
        />
        <button
          onClick={copy}
          className="shrink-0 h-[2.125rem] px-3 flex items-center gap-1.5 rounded-btn bg-white/[0.06] text-text text-[0.75rem] font-medium hover:bg-white/[0.1] transition-colors"
        >
          {copied ? (
            <Check size="0.8125rem" strokeWidth={2.4} className="text-done" />
          ) : (
            <Copy size="0.8125rem" strokeWidth={1.8} />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="text-[0.6875rem] text-muted">
        {left ? (
          <>
            Single-use · expires in <span className="tabular-nums text-text">{left}</span>
          </>
        ) : (
          <span className="text-alert">This link has expired.</span>
        )}
      </div>
    </div>
  )
}

// One row in the recent-invites list: status badge, who/when, and a revoke
// action while the link is still active.
function InviteListRow({ invite, onRevoke }: { invite: WorkspaceInvite; onRevoke: () => void }) {
  const now = useNow(30_000)
  const left = invite.status === 'active' ? remaining(invite.expiresAt, now) : null
  const detail =
    invite.status === 'used'
      ? invite.usedByName
        ? `Joined by ${invite.usedByName}`
        : 'Used'
      : invite.status === 'expired'
        ? 'Expired'
        : left
          ? `Expires in ${left}`
          : 'Expiring…'

  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5">
      <StatusBadge status={invite.status} />
      <div className="min-w-0 flex-1">
        <div className="text-[0.75rem] text-text leading-tight truncate">{detail}</div>
        <div className="text-[0.6875rem] text-faint mt-0.5 truncate">
          {invite.createdByName ? `By ${invite.createdByName}` : 'Invite'}
        </div>
      </div>
      {invite.status === 'active' && (
        <button
          onClick={onRevoke}
          title="Revoke link"
          aria-label="Revoke link"
          className="shrink-0 h-7 w-7 flex items-center justify-center rounded-chip text-muted hover:text-alert hover:bg-white/[0.05] transition-colors"
        >
          <Trash2 size="0.875rem" strokeWidth={1.8} />
        </button>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: WorkspaceInvite['status'] }) {
  const map = {
    active: { label: 'Active', cls: 'text-done border-done/30 bg-done/10' },
    used: { label: 'Used', cls: 'text-muted border-white/[0.12] bg-white/[0.04]' },
    expired: { label: 'Expired', cls: 'text-faint border-white/[0.08] bg-white/[0.02]' },
  }[status]
  return (
    <span
      className={`shrink-0 text-[0.625rem] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${map.cls}`}
    >
      {map.label}
    </span>
  )
}

// A compact label/value line: label muted on the left, value on the right.
// Rows are separated by a hairline divider (none after the last).
function FieldRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-white/[0.05] last:border-0">
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

// One setting inside a section: a clean label + short description stacked over
// its control. No borders or dividers of its own — spacing alone sets it apart.
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
    <div>
      <div className="text-[0.8125rem] text-text leading-tight">{label}</div>
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
    <div className="inline-flex gap-0.5 rounded-[0.5rem] bg-black/20 p-0.5">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`h-7 px-3.5 rounded-[0.375rem] text-[0.75rem] transition-colors ${
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
