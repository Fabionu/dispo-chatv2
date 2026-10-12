import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  Copy,
  Info,
  Link2,
  Loader2,
  Mail,
  Monitor,
  Palette,
  Play,
  Users,
} from 'lucide-react'
import {
  useDensity,
  getStoredDensity,
  setDensity,
  clearDensityOverride,
  type Density,
} from '../../lib/density'
import { MESSAGE_STYLE_LABEL, setMessageStyle, useMessageStyle, type MessageStyle } from '../../lib/messageStyle'
import {
  useAnimations,
  setAnimations,
  useComposerEffect,
  setComposerEffect,
  type ComposerEffect,
} from '../../lib/animations'
import { useAuth } from '../../auth/AuthContext'
import { setTheme, useTheme, type Theme } from '../../lib/theme'
import { api, ApiError } from '../../lib/api'
import type { Role, WorkspaceInvite, WorkspaceInviteCreated, WorkspaceMember } from '../../lib/types'
import { ROLE_LABEL } from './ProfileSidebarPanel'
import { PanelHeader } from './panelChrome'
import { SIDEBAR_PANEL_SURFACE } from './profileChrome'
import { MENU_CONTAINER, menuItemClass } from '../menuStyles'
import { RowTile } from '../../pages/sidebarBits'
import { NavRow, RadioMark, Segmented, SettingsSection, Switch } from './sectionChrome'
import { usePresence } from '../../hooks/usePresence'
import AppMark from '../AppMark'
import {
  NOTIFICATION_SOUNDS,
  playNotificationSound,
  setNotificationSound,
  useNotificationSound,
  type NotificationSound,
} from '../../lib/notificationSound'
import {
  disableBrowserNotifications,
  enableBrowserNotifications,
  useBrowserNotifications,
} from '../../lib/browserNotifications'

// Roles an invite can grant, in menu order (the default first, admin last as the
// most privileged). Labels come from the shared ROLE_LABEL map so every surface
// names roles identically; the short hints describe each role in the picker.
const INVITE_ROLE_ORDER: readonly Role[] = ['dispatcher', 'driver', 'partner', 'admin']
const INVITE_ROLE_HINT: Record<Role, string> = {
  dispatcher: 'Plans trips, manages vehicles and members.',
  driver: 'Drives assigned trips on the phone app.',
  partner: 'Outside partner with limited access.',
  admin: 'Full company administration.',
}
// The role a new invite defaults to — matches the server default so an admin who
// doesn't touch the picker gets the previous behaviour.
const DEFAULT_INVITE_ROLE: Role = 'dispatcher'

type Props = {
  onBack: () => void
  /** Names the back target of the FIRST level (the category list). */
  backLabel?: string
}

// The settings categories. New ones drop in as another nav row + detail view.
type Category = 'appearance' | 'notifications' | 'members' | 'about'

// The app version, shared by the About detail and the category list summary.
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.3.2'

const DENSITY_LABEL: Record<Density, string> = {
  compact: 'Compact',
  default: 'Standard',
  comfortable: 'Comfortable',
}

// Workspace settings as a sidebar drill-in — consistent with "My profile" /
// "Company profile" (replaces the conversation list; the chat stays on the
// right).
//
// REWORK (2026-10-12, from the "Workspace settings rework" canvas): the list is
// grouped by WHO a setting affects — "Your preferences" are saved on this
// device, "<company>" applies to everyone in it, "App" is about the build — and
// every detail says the same in its header (This device / Whole company), so
// the old footnote ("saved in this browser…") under each card is gone. Details
// are hairline-separated sections (title, one line of why, then the control),
// with visual pickers wherever a choice is visual (theme, message style).
export default function WorkspaceSettingsPanel({ onBack, backLabel = 'Back' }: Props) {
  // Which category's detail is open (null = the category list). Local UI state;
  // no routing needed — the drawer is a self-contained master/detail.
  const [category, setCategory] = useState<Category | null>(null)
  // Only workspace admins manage company members; the row is hidden otherwise
  // (the server enforces this too). Auth is always signed-in inside this panel.
  const auth = useAuth()
  const isAdmin = auth.status === 'signed_in' && auth.user.role === 'admin'
  const companyName = auth.status === 'signed_in' ? auth.workspace.name : 'Company'
  // Live values for the nav-row summaries (the hooks subscribe, so the
  // summaries refresh when the user returns from a detail view).
  const theme = useTheme()
  const messageStyle = useMessageStyle()
  const notificationSound = useNotificationSound()
  const browserNotifications = useBrowserNotifications()
  const densityOverride = getStoredDensity()

  // The Members row says how many people and pending invites there are. Fetched
  // when the list shows (admins only), so it is fresh after a detail visit.
  const [memberSummary, setMemberSummary] = useState<string[] | null>(null)
  useEffect(() => {
    if (!isAdmin || category) return
    let live = true
    Promise.all([api.workspace.members(), api.workspaceInvites.list()])
      .then(([{ members }, { invites }]) => {
        if (!live) return
        const pending = invites.filter((invite) => invite.status === 'active').length
        // /workspace/members lists everyone EXCEPT the caller (it feeds the
        // contacts rail), so the viewer is counted back in.
        const meId = auth.status === 'signed_in' ? auth.user.id : ''
        const count = members.length + (members.some((m) => m.id === meId) ? 0 : 1)
        setMemberSummary([
          `${count} ${count === 1 ? 'person' : 'people'}`,
          pending > 0 ? `${pending} invite${pending === 1 ? '' : 's'} pending` : 'No pending invites',
        ])
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [isAdmin, category])

  // ── Detail views ────────────────────────────────────────────────────────────
  // Every screen of this panel — each detail AND the list — enters with
  // `panel-fade-in`, keyed on the category so React remounts the root when it
  // changes (the sidebar's drill-in wrapper only fades the TOP-level view).
  if (category) {
    const title = {
      appearance: 'Appearance',
      notifications: 'Notifications',
      members: 'Members',
      about: 'About',
    }[category]
    const scope = category === 'members' ? 'company' : category === 'about' ? null : 'device'
    return (
      <div key={category} className={`panel-fade-in flex flex-col h-full ${SIDEBAR_PANEL_SURFACE}`}>
        <PanelHeader
          title={title}
          onBack={() => setCategory(null)}
          backLabel="Back to Workspace settings"
          action={scope ? <ScopeTag scope={scope} /> : undefined}
        />
        <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable] px-5 pb-8">
          {category === 'appearance' ? (
            <AppearanceSettings />
          ) : category === 'notifications' ? (
            <NotificationSettings />
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
  const soundLabel =
    NOTIFICATION_SOUNDS.find((sound) => sound.value === notificationSound)?.label ?? 'Soft Pop'

  return (
    <div key="list" className={`panel-fade-in flex flex-col h-full ${SIDEBAR_PANEL_SURFACE}`}>
      <PanelHeader title="Workspace settings" onBack={onBack} backLabel={backLabel} />
      <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable] px-2.5 pt-2 pb-6 flex flex-col gap-6">
        <NavGroup title="Your preferences" scope="This device">
          <NavRow
            icon={<Palette size="1.0625rem" strokeWidth={1.7} />}
            title="Appearance"
            value={[
              theme === 'light' ? 'Light' : 'Dark',
              MESSAGE_STYLE_LABEL[messageStyle],
              densityOverride ? `${DENSITY_LABEL[densityOverride]} density` : 'Auto density',
            ]}
            onClick={() => setCategory('appearance')}
          />
          <NavRow
            icon={<Bell size="1.0625rem" strokeWidth={1.7} />}
            title="Notifications"
            value={[browserNotifications.enabled ? 'On' : 'Off', soundLabel]}
            onClick={() => setCategory('notifications')}
          />
        </NavGroup>

        {isAdmin && (
          <NavGroup title={companyName} scope="Everyone in the company">
            <NavRow
              icon={<Users size="1.0625rem" strokeWidth={1.7} />}
              title="Members"
              value={memberSummary ?? ['People and invite links']}
              onClick={() => setCategory('members')}
            />
          </NavGroup>
        )}

        <NavGroup title="App">
          <NavRow
            icon={<Info size="1.0625rem" strokeWidth={1.7} />}
            title="About"
            value={[`Version ${APP_VERSION}`]}
            onClick={() => setCategory('about')}
          />
        </NavGroup>
      </div>
    </div>
  )
}

// ── Navigation pieces ─────────────────────────────────────────────────────────

// One group of the settings list: its name, and — on the right — who it
// affects. The scope is the point of the grouping, so it is said once here
// rather than as a footnote under every card.
function NavGroup({ title, scope, children }: { title: string; scope?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-3 px-3 pb-1.5">
        <h2 className="min-w-0 truncate text-base font-semibold text-text">{title}</h2>
        {scope && <span className="shrink-0 text-sm text-faint">{scope}</span>}
      </div>
      {children}
    </section>
  )
}


// Who a detail's changes reach, in its header: this browser, or the company.
function ScopeTag({ scope }: { scope: 'device' | 'company' }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 pr-1 text-sm text-faint">
      {scope === 'device' ? (
        <Monitor size="0.875rem" strokeWidth={1.8} />
      ) : (
        <Building2 size="0.875rem" strokeWidth={1.8} />
      )}
      {scope === 'device' ? 'This device' : 'Whole company'}
    </span>
  )
}

// ── Appearance ─────────────────────────────────────────────────────────────

function AppearanceSettings() {
  return (
    <>
      <ThemeSetting />
      <MessageStyleSetting />
      <DensitySetting />
      <MotionSetting />
    </>
  )
}

// Each theme drawn as itself — a rail, two incoming blocks and my own — so the
// choice is seen, not read. The swatches are literal on purpose: a light
// preview has to look light while the app around it is dark.
const THEME_PREVIEW: Record<Theme, { label: string; ground: string; line: string; bubble: string; own: string }> = {
  dark: { label: 'Dark', ground: '#000000', line: '#2C2C2C', bubble: '#1A1A1A', own: '#2A2A2A' },
  light: { label: 'Light', ground: '#FFFFFF', line: '#D0D7E0', bubble: '#F1F4F8', own: '#E2E7EE' },
}

function ThemeSetting() {
  const theme = useTheme()
  return (
    <SettingsSection title="Theme" description="The palette for the whole app.">
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-3">
        {(Object.keys(THEME_PREVIEW) as Theme[]).map((value) => {
          const preview = THEME_PREVIEW[value]
          const on = theme === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setTheme(value)}
              className="group flex flex-col gap-2 text-left focus-visible:outline-none"
            >
              <span
                aria-hidden
                className={`flex h-24 overflow-hidden rounded-card border-2 transition-colors group-focus-visible:ring-2 group-focus-visible:ring-white/20 ${
                  on ? 'border-text' : 'border-line group-hover:border-line-2'
                }`}
                style={{ background: preview.ground }}
              >
                <span
                  className="flex w-[34%] flex-col gap-1.5 px-2 py-2.5"
                  style={{ borderRight: `1px solid ${preview.line}` }}
                >
                  {[80, 60, 70].map((w) => (
                    <span key={w} className="h-[5px] rounded-full" style={{ width: `${w}%`, background: preview.line }} />
                  ))}
                </span>
                <span className="flex flex-1 flex-col justify-end gap-[5px] px-2 py-2.5">
                  <span className="h-3 w-[70%] rounded" style={{ background: preview.bubble }} />
                  <span className="h-3 w-[55%] rounded" style={{ background: preview.bubble }} />
                  <span className="h-3 w-[60%] self-end rounded" style={{ background: preview.own }} />
                </span>
              </span>
              <span className="flex items-center gap-2 text-lg font-medium">
                <RadioMark on={on} />
                {preview.label}
              </span>
            </button>
          )
        })}
      </div>
    </SettingsSection>
  )
}

// How a message is DRAWN in the thread (lib/messageStyle.ts). Each option
// carries a thumbnail of a two-message thread in that style, in the live
// theme's own tokens, so the three read side by side as what they are.
const MESSAGE_STYLES: { value: MessageStyle; hint: string }[] = [
  { value: 'timeline', hint: 'A coloured rule, no box around the text.' },
  { value: 'bubble', hint: 'Rounded blocks with the sender above.' },
  { value: 'dense', hint: 'One line per message: time, sender, text.' },
]

function MessageStyleSetting() {
  const style = useMessageStyle()
  return (
    <SettingsSection title="Message style" description="How messages are drawn in every conversation.">
      <div role="radiogroup" aria-label="Message style" className="flex flex-col gap-2">
        {MESSAGE_STYLES.map((option) => {
          const on = option.value === style
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setMessageStyle(option.value)}
              className={`flex items-center gap-3.5 rounded-card border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
                on ? 'border-text bg-white/4' : 'border-line hover:border-line-2'
              }`}
            >
              <MessageStylePreview style={option.value} />
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold">{MESSAGE_STYLE_LABEL[option.value]}</span>
                <span className="mt-0.5 block text-base leading-[1.4] text-muted">{option.hint}</span>
              </span>
              <span className="mr-1.5">
                <RadioMark on={on} />
              </span>
            </button>
          )
        })}
      </div>
    </SettingsSection>
  )
}

function MessageStylePreview({ style }: { style: MessageStyle }) {
  const green = 'rgb(var(--author-3))'
  const blue = 'rgb(var(--author-0))'
  return (
    <span
      aria-hidden
      className="flex h-16 w-[6.5rem] shrink-0 flex-col justify-end gap-[5px] rounded-btn border border-line bg-bg p-2"
    >
      {style === 'timeline' ? (
        <>
          <span className="flex flex-col gap-[3px] border-l-2 pl-[5px]" style={{ borderColor: 'rgb(var(--author-3) / 0.6)' }}>
            <span className="h-1 w-[26px] rounded-full" style={{ background: green }} />
            <span className="h-1 w-[62px] rounded-full bg-line-2" />
          </span>
          <span className="flex flex-col items-end border-r-2 border-text pr-[5px]">
            <span className="h-1 w-[50px] rounded-full bg-muted" />
          </span>
        </>
      ) : style === 'bubble' ? (
        <>
          <span className="flex flex-col items-start gap-[3px]">
            <span className="h-1 w-[26px] rounded-full" style={{ background: green }} />
            <span className="h-4 w-[62px] rounded-[5px] bg-white/10" />
          </span>
          <span className="h-3.5 w-[50px] self-end rounded-[5px] bg-white/16" />
        </>
      ) : (
        ([
          [green, 56],
          [blue, 40],
          [green, 50],
          ['rgb(var(--color-text))', 34],
        ] as const).map(([color, width], index) => (
          <span key={index} className="flex items-center gap-1">
            <span className="h-1 w-2.5 rounded-full bg-line-2" />
            <span className="h-1 w-4 rounded-full" style={{ background: color }} />
            <span className="h-1 rounded-full bg-muted" style={{ width }} />
          </span>
        ))
      )}
    </span>
  )
}

// Interface density: the manual override for lib/density's UI scale. "Auto"
// (the default) clears the override and follows the screen; picking a step
// pins it on this device. useDensity() supplies the live step so the Auto line
// can say what it resolves to right now.
function DensitySetting() {
  const [choice, setChoice] = useState<Density | 'auto'>(() => getStoredDensity() ?? 'auto')
  const live = useDensity()

  function change(v: string) {
    if (v === 'auto') clearDensityOverride()
    else setDensity(v as Density)
    setChoice(v as Density | 'auto')
  }

  return (
    <SettingsSection
      title="Density"
      description={
        choice === 'auto'
          ? `Auto follows your screen size. Right now that means ${DENSITY_LABEL[live]}.`
          : 'Fixed on this device until you change it.'
      }
    >
      <Segmented
        fill
        value={choice}
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'compact', label: 'Compact' },
          { value: 'default', label: 'Standard' },
          { value: 'comfortable', label: 'Comfortable' },
        ]}
        onChange={change}
      />
    </SettingsSection>
  )
}

const COMPOSER_FX_DESCRIPTION: Record<ComposerEffect, string> = {
  ink: 'Each letter fades in as you type it.',
  pulse: 'A line runs out from the middle of the message box on each keystroke.',
  none: 'The message box stays still while you type.',
}

// Motion: the universal switch first, the composer's effect under it — the
// second is greyed out while the first is off, and its stored choice is kept,
// so turning animations back on restores it rather than resetting it.
function MotionSetting() {
  const animations = useAnimations()
  const effect = useComposerEffect()
  const off = animations === 'off'
  return (
    <SettingsSection title="Motion" description="Your system's reduce-motion setting always wins." last>
      <div className="rounded-card border border-line">
        <div className="flex items-center gap-3.5 p-3.5">
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-medium">Interface animations</span>
            <span className="mt-0.5 block text-base leading-[1.4] text-muted">
              {off ? 'Everything appears instantly.' : 'Panels, menus and message actions ease in.'}
            </span>
          </span>
          <Switch
            checked={!off}
            label="Interface animations"
            onChange={(next) => setAnimations(next ? 'on' : 'off')}
          />
        </div>
        <div
          className={`flex flex-col gap-2.5 border-t border-line p-3.5 transition-opacity ${off ? 'opacity-50' : ''}`}
          aria-disabled={off || undefined}
        >
          <span>
            <span className="block text-lg font-medium">Typing effect</span>
            <span className="mt-0.5 block text-base leading-[1.4] text-muted">
              {off ? 'Off while interface animations are off.' : COMPOSER_FX_DESCRIPTION[effect]}
            </span>
          </span>
          <div className={off ? 'pointer-events-none' : ''}>
            <Segmented
              fill
              value={effect}
              options={[
                { value: 'none', label: 'None' },
                { value: 'ink', label: 'Fade' },
                { value: 'pulse', label: 'Pulse' },
              ]}
              onChange={(value) => setComposerEffect(value as ComposerEffect)}
            />
          </div>
        </div>
      </div>
    </SettingsSection>
  )
}

// ── Notifications ─────────────────────────────────────────────────────────────

function NotificationSettings() {
  const selected = useNotificationSound()
  const browserNotifications = useBrowserNotifications()
  const [requestingPermission, setRequestingPermission] = useState(false)

  async function toggleBrowserNotifications() {
    if (requestingPermission || !browserNotifications.supported) return
    setRequestingPermission(true)
    try {
      if (browserNotifications.enabled) await disableBrowserNotifications()
      else await enableBrowserNotifications()
    } finally {
      setRequestingPermission(false)
    }
  }

  const unsupported = !browserNotifications.supported
  const blocked = browserNotifications.permission === 'denied'
  const on = browserNotifications.enabled
  // One status card that says the state in words first, then what it means or
  // how to get out of it — "blocked" is the case that needs the instructions.
  const title = unsupported
    ? 'Not available in this browser'
    : blocked
      ? 'Blocked by your browser'
      : on
        ? 'Notifications are on'
        : 'Notifications are off'
  const detail = unsupported
    ? 'This browser does not support system notifications.'
    : blocked
      ? 'Allow notifications for this site in your browser’s site settings, then reload Dispo-chat.'
      : on
        ? 'New messages show as system notifications, also when Dispo-chat is closed. Closed-app alerts use your system sound.'
        : 'Turn this on and your browser will ask for permission once.'

  return (
    <>
      <SettingsSection title="System notifications">
        <div className={`flex flex-col gap-2.5 rounded-card border p-3.5 ${blocked ? 'border-alert/60' : 'border-line'}`}>
          <div className="flex items-center gap-3">
            <span className="flex min-w-0 flex-1 items-center gap-2 text-lg font-semibold">
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${blocked ? 'bg-alert' : on ? 'bg-driven' : 'bg-line-2'}`}
              />
              {title}
            </span>
            {!unsupported && !blocked && (
              <Switch
                checked={on}
                label="Allow notifications"
                disabled={requestingPermission}
                onChange={() => void toggleBrowserNotifications()}
              />
            )}
          </div>
          <p className="text-base leading-[1.45] text-muted">{detail}</p>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Sound"
        description="Plays when a message arrives in a conversation you're not looking at. Muted conversations always stay silent."
        last
      >
        <div role="radiogroup" aria-label="Notification sound" className="overflow-hidden rounded-card border border-line">
          {NOTIFICATION_SOUNDS.map((sound, index) => {
            const active = sound.value === selected
            return (
              <div
                key={sound.value}
                className={`flex items-center gap-0.5 pr-1 ${index > 0 ? 'border-t border-line' : ''} ${
                  active ? 'bg-white/4' : ''
                }`}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setNotificationSound(sound.value)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3.5 pr-1.5 text-left transition-colors hover:bg-white/4 focus-visible:outline-none focus-visible:bg-white/6"
                >
                  <RadioMark on={active} />
                  <span className="min-w-0">
                    <span className="block text-lg font-semibold leading-tight">{sound.label}</span>
                    <span className="mt-0.5 block text-sm leading-[1.4] text-muted">{sound.description}</span>
                  </span>
                </button>
                {sound.value !== 'none' && (
                  <button
                    type="button"
                    onClick={() => void playNotificationSound(sound.value as NotificationSound)}
                    aria-label={`Preview ${sound.label}`}
                    title={`Preview ${sound.label}`}
                    className="h-10 w-10 shrink-0 flex items-center justify-center rounded-btn text-muted transition-colors hover:bg-white/8 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                  >
                    <Play size="0.75rem" strokeWidth={1.9} fill="currentColor" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </SettingsSection>
    </>
  )
}

// ── Members (admin) ───────────────────────────────────────────────────────────
// Three blocks: invite someone (pick the role first, then an optional address —
// typed, the link goes by email; empty, you get a plain link to share yourself),
// the people already in the company, and the invite links with their state.
// The raw link is shown ONCE, right after it is created (the server keeps only a
// token hash), so the list afterwards carries status and timing only.
function CompanyMembersSettings() {
  const auth = useAuth()
  const meId = auth.status === 'signed_in' ? auth.user.id : ''
  const { online } = usePresence()

  const [invites, setInvites] = useState<WorkspaceInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [people, setPeople] = useState<WorkspaceMember[] | null>(null)
  const [peopleError, setPeopleError] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  // The just-created link, surfaced prominently with copy + countdown. Cleared
  // on the next generate so only the freshest link shows its raw token.
  const [fresh, setFresh] = useState<WorkspaceInviteCreated | null>(null)
  // Role the NEXT generated invite will grant. Chosen before generating; the
  // server validates + stores it and applies it when the invitee registers.
  const [role, setRole] = useState<Role>(DEFAULT_INVITE_ROLE)
  const [recipientEmail, setRecipientEmail] = useState('')
  const [showExpired, setShowExpired] = useState(false)

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
    api.workspace
      .members()
      .then(({ members }) => setPeople(members))
      .catch(() => setPeopleError(true))
  }, [load])

  // An empty address is not an error — it is the plain-link flow.
  const willEmail = recipientEmail.trim().length > 0

  async function generate() {
    setGenerating(true)
    setGenError(null)
    try {
      const { invite } = await api.workspaceInvites.create(
        role,
        willEmail ? recipientEmail.trim() : undefined,
      )
      setFresh(invite)
      setRecipientEmail('')
      await load()
    } catch (err) {
      setGenError(
        err instanceof ApiError && err.code === 'too_many_requests'
          ? 'Too many invitations sent. Try again later.'
          : err instanceof ApiError && err.code === 'invalid_email'
            ? 'Enter a valid email address.'
            : 'Could not create the invitation. Try again.',
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

  const current = invites.filter((invite) => invite.status !== 'expired')
  const expired = invites.filter((invite) => invite.status === 'expired')
  const waiting = invites.filter((invite) => invite.status === 'active').length
  // /workspace/members leaves the caller out (it feeds the contacts rail), so
  // the viewer is added back from the session and listed first.
  const me: WorkspaceMember | null =
    auth.status === 'signed_in'
      ? { id: auth.user.id, displayName: auth.user.displayName, email: auth.user.email, role: auth.user.role }
      : null
  const sortedPeople = people
    ? [
        ...(me && !people.some((p) => p.id === me.id) ? [me] : []),
        ...[...people].sort((a, b) =>
          a.id === meId ? -1 : b.id === meId ? 1 : a.displayName.localeCompare(b.displayName),
        ),
      ]
    : null

  return (
    <>
      <SettingsSection
        title="Invite someone"
        description="A link that works once and expires after 48 hours. Pick what they can do first."
      >
        <div role="radiogroup" aria-label="Role for the new member" className="grid grid-cols-2 gap-2">
          {INVITE_ROLE_ORDER.map((option) => {
            const on = option === role
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={generating}
                onClick={() => setRole(option)}
                className={`flex flex-col items-start gap-1 rounded-card border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:opacity-60 ${
                  on ? 'border-text bg-white/4' : 'border-line hover:border-line-2'
                }`}
              >
                <span className="flex items-center gap-2 text-lg font-semibold">
                  <RadioMark on={on} />
                  {ROLE_LABEL[option]}
                </span>
                <span className="text-sm leading-[1.35] text-muted">{INVITE_ROLE_HINT[option]}</span>
              </button>
            )
          })}
        </div>
        <label htmlFor="invite-email" className="sr-only">
          Email (optional)
        </label>
        <input
          id="invite-email"
          type="email"
          value={recipientEmail}
          onChange={(event) => {
            setRecipientEmail(event.target.value)
            setGenError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !generating) void generate()
          }}
          placeholder="Email (optional)"
          autoComplete="off"
          disabled={generating}
          className="h-11 w-full rounded-card border border-line-2 bg-transparent px-3.5 text-lg text-text outline-none transition-colors placeholder:text-faint focus:border-text disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void generate()}
          disabled={generating}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-btn bg-text text-lg font-semibold text-bg transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          {generating ? (
            <Loader2 size="1rem" strokeWidth={2.2} className="animate-spin" />
          ) : willEmail ? (
            <Mail size="1rem" strokeWidth={2.1} />
          ) : (
            <Link2 size="1rem" strokeWidth={2.1} />
          )}
          {willEmail ? 'Send invite' : 'Create invite link'}
        </button>
        {genError && <div className="text-base text-alert">{genError}</div>}
        {fresh && <FreshInviteLink invite={fresh} />}
      </SettingsSection>

      <SettingsSection title="People" aside={sortedPeople ? sortedPeople.length : undefined}>
        {peopleError ? (
          <p className="text-base text-alert">Could not load the people in this company.</p>
        ) : !sortedPeople ? (
          <div className="flex items-center gap-2 text-base text-muted">
            <Loader2 size="0.875rem" className="animate-spin" /> Loading people…
          </div>
        ) : (
          <ul className="flex flex-col">
            {sortedPeople.map((person) => {
              const isMe = person.id === meId
              // You are, by definition, here — presence only tracks others.
              const isOnline = isMe || online.has(person.id)
              return (
                <li key={person.id} className="flex items-center gap-3 py-2">
                  <span className="relative shrink-0">
                    <RowTile kind="user" id={person.id} name={person.displayName} size={36} />
                    <span
                      aria-hidden
                      className={`absolute -bottom-px -right-px h-2.5 w-2.5 rounded-full border-2 border-bg ${
                        isOnline ? 'bg-driven' : 'bg-line-2'
                      }`}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-semibold leading-tight">
                      {person.displayName}
                      {isMe && <span className="font-normal text-muted"> (you)</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-muted">
                      {isOnline ? 'Online' : 'Offline'}
                    </span>
                  </span>
                  <RoleBadge role={person.role as Role} />
                </li>
              )
            })}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection
        title="Invite links"
        aside={waiting > 0 ? `${waiting} waiting` : undefined}
        last
      >
        {loading ? (
          <div className="flex items-center gap-2 text-base text-muted">
            <Loader2 size="0.875rem" className="animate-spin" /> Loading invites…
          </div>
        ) : loadError ? (
          <p className="text-base text-alert">Could not load invites.</p>
        ) : invites.length === 0 ? (
          <p className="text-base leading-[1.45] text-muted">
            No invites yet. Create a link above to add your first member.
          </p>
        ) : (
          <div className="flex flex-col">
            {current.length === 0 && (
              <p className="pb-3 text-base text-muted">No links waiting to be used.</p>
            )}
            {current.map((invite) => (
              <InviteListRow
                key={invite.id}
                invite={invite}
                onRevoke={() => revoke(invite.id)}
                onChangeRole={(next) => void changeInviteRole(invite.id, next)}
              />
            ))}
            {showExpired &&
              expired.map((invite) => (
                <InviteListRow
                  key={invite.id}
                  invite={invite}
                  onRevoke={() => revoke(invite.id)}
                  onChangeRole={(next) => void changeInviteRole(invite.id, next)}
                />
              ))}
            {expired.length > 0 && (
              <button
                type="button"
                onClick={() => setShowExpired((v) => !v)}
                aria-expanded={showExpired}
                className="flex h-11 items-center gap-2 border-t border-line text-base font-medium text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:text-text"
              >
                <ChevronDown
                  size="0.875rem"
                  strokeWidth={2}
                  className={`transition-transform ${showExpired ? 'rotate-180' : ''}`}
                />
                {showExpired
                  ? 'Hide expired links'
                  : `Show ${expired.length} expired link${expired.length === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        )}
      </SettingsSection>
    </>
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

// Time remaining until `expiresAt` ("41 h 12 min", "12:30"), or null once elapsed.
function remaining(expiresAt: string, now: number): string | null {
  const ms = new Date(expiresAt).getTime() - now
  if (ms <= 0) return null
  const total = Math.floor(ms / 1000)
  if (total >= 3600) {
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    return `${hours} h ${minutes} min`
  }
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// The freshly-created link: the only place the raw link is ever shown, so it
// is the one thing in the panel drawn in the live colour.
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
    <div className="flex flex-col gap-2.5 rounded-card border border-driven/70 bg-white/2 p-3">
      <span className="flex items-center gap-2 text-base text-text">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-driven" />
        <span className="min-w-0 flex-1">
          {invite.emailSent
            ? `Invitation sent as ${ROLE_LABEL[invite.role]}`
            : invite.recipientEmail
              ? 'Link ready, but the email could not be sent. Share it yourself.'
              : `${ROLE_LABEL[invite.role]} link ready. It is shown only once.`}
        </span>
      </span>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          readOnly
          value={invite.url}
          aria-label="Invite link"
          onFocus={(e) => e.currentTarget.select()}
          className="h-9 min-w-0 flex-1 truncate rounded-btn border border-line bg-transparent px-2.5 text-base text-text tabular-nums outline-none transition-colors focus:border-line-2"
        />
        <button
          type="button"
          onClick={copy}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-btn border border-line-2 px-3 text-base font-semibold text-text transition-colors hover:bg-white/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          {copied ? <Check size="0.875rem" strokeWidth={2.4} /> : <Copy size="0.875rem" strokeWidth={1.9} />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <span className={`text-sm ${left ? 'text-muted' : 'text-alert'}`}>
        {left ? (
          <>
            Works once │ expires in <span className="tabular-nums">{left}</span>
          </>
        ) : (
          'This link has expired.'
        )}
      </span>
    </div>
  )
}

// One invite link: what it is and its state on the first line, who and how on
// the second, and — while it is still active — its role (changeable until it is
// used) and a two-step Revoke.
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
  const by = invite.createdByName ? ` │ by ${invite.createdByName}` : ''
  const primary =
    invite.status === 'used'
      ? (invite.usedByName ?? invite.recipientEmail ?? `${ROLE_LABEL[invite.role]} link`)
      : (invite.recipientEmail ?? `${ROLE_LABEL[invite.role]} link`)
  const secondary = active
    ? `${invite.emailSentAt ? 'Email sent' : invite.recipientEmail ? 'Email not sent' : 'Shared link'}${by}`
    : invite.status === 'used'
      ? `Joined as ${ROLE_LABEL[invite.role]}${invite.createdByName ? ` │ invited by ${invite.createdByName}` : ''}`
      : `${ROLE_LABEL[invite.role]} link │ never used${by}`
  const state = active ? (left ? `Active, ${left} left` : 'Expiring') : invite.status === 'used' ? 'Used' : 'Expired'
  const stateTone = active ? 'text-driven' : invite.status === 'used' ? 'text-muted' : 'text-faint'

  return (
    <div className="flex flex-col gap-1.5 border-t border-line py-3 first:border-t-0">
      <div className="flex items-center gap-2.5">
        <span
          className={`min-w-0 flex-1 truncate text-lg font-semibold ${invite.status === 'expired' ? 'text-muted' : 'text-text'}`}
        >
          {primary}
        </span>
        <span className={`flex shrink-0 items-center gap-1.5 text-sm font-medium tabular-nums ${stateTone}`}>
          <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-current" />
          {state}
        </span>
      </div>
      <span className="truncate text-sm text-muted">{secondary}</span>
      {active && (
        <div className="mt-1 flex items-center gap-2">
          <RoleSelect value={invite.role} onChange={onChangeRole} compact ariaLabel="Change invite role" />
          <button
            type="button"
            onClick={() => {
              if (!confirming) {
                setConfirming(true)
                return
              }
              setConfirming(false)
              onRevoke()
            }}
            className={`h-8 rounded-btn px-3 text-base font-semibold text-alert transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
              confirming ? 'bg-alert/10' : 'border border-line hover:bg-alert/10'
            }`}
          >
            {confirming ? 'Confirm revoke' : 'Revoke'}
          </button>
        </div>
      )}
    </div>
  )
}

// The role picker — a custom listbox on the app's shared menu recipe
// (menuStyles), so the open menu matches every other dropdown in the app.
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
        className={`flex items-center gap-1.5 rounded-btn border bg-transparent text-text text-left outline-none transition-colors hover:border-line-2 focus-visible:border-line-2 disabled:opacity-50 disabled:cursor-default ${
          open ? 'border-line-2' : 'border-line'
        } ${compact ? 'h-8 w-[7.5rem] px-2.5 text-base' : 'h-9 w-full px-2.5 text-base'}`}
      >
        <span className="flex-1 min-w-0 truncate">{ROLE_LABEL[value]}</span>
        <ChevronDown
          size="0.875rem"
          strokeWidth={1.8}
          className={`shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel ?? 'Role'}
          className={`absolute top-full mt-1 z-20 ${MENU_CONTAINER} ${
            compact ? 'left-0 w-[9rem]' : 'left-0 right-0'
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

// A quiet, read-only role chip (a person's role; there is no API to change a
// member's company role from here yet, so it is a label, not a control).
function RoleBadge({ role }: { role: Role }) {
  return (
    <span className="shrink-0 rounded-chip border border-line px-2.5 py-1 text-sm font-medium text-text">
      {ROLE_LABEL[role] ?? role}
    </span>
  )
}

// ── About ─────────────────────────────────────────────────────────────────────

// Preferences this browser keeps for this app — what "Reset preferences" clears.
// Unsent drafts, notification permission and the push subscription are NOT on
// the list: losing a half-written message, or having to re-grant the browser,
// is not what anyone means by resetting how the app looks.
const PREFERENCE_KEYS = [
  'dispo:theme',
  'dispo:density',
  'dispo:msg-style-v3',
  'dispo:animations-v1',
  'dispo:composer-fx-v1',
  'dispo:notification-sound',
  'dispo:sidebar-collapsed',
  'dispo:trip-panel',
]

// The build, said plainly, with a one-click copy for problem reports; and what
// this browser stores, with a way to start over.
function AboutSettings() {
  const mode: string = import.meta.env.MODE
  const environment = mode.charAt(0).toUpperCase() + mode.slice(1)
  const buildDate = import.meta.env.VITE_BUILD_DATE ?? 'Not available'
  const commitRaw = import.meta.env.VITE_COMMIT_SHA ?? 'Not available'
  // Show a short SHA when a full one is provided; leave the fallback untouched.
  const commit =
    commitRaw !== 'Not available' && commitRaw.length > 10 ? commitRaw.slice(0, 7) : commitRaw
  const facts: [string, string][] = [
    ['Version', APP_VERSION],
    ['Environment', environment],
    ['Build date', buildDate],
    ['Commit', commit],
  ]

  const [copied, setCopied] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  useEffect(() => {
    if (!confirmReset) return
    const t = setTimeout(() => setConfirmReset(false), 3000)
    return () => clearTimeout(t)
  }, [confirmReset])

  async function copyDetails() {
    const text = ['Dispo-chat', ...facts.map(([label, value]) => `${label}: ${value}`)].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable — the facts are on screen to copy by hand.
    }
  }

  function resetPreferences() {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    try {
      for (const key of PREFERENCE_KEYS) localStorage.removeItem(key)
    } catch {
      // Storage unavailable: nothing was stored to begin with.
    }
    window.location.reload()
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      <div className="flex items-center gap-3.5">
        <AppMark size={40} />
        <span>
          <span className="block text-2xl font-bold tracking-[-0.02em]">Dispo-chat</span>
          <span className="block text-base text-muted">Version {APP_VERSION}</span>
        </span>
      </div>

      <section className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5">
          <h3 className="flex-1 text-lg font-semibold">This version</h3>
          <button
            type="button"
            onClick={() => void copyDetails()}
            className="flex h-9 items-center gap-1.5 rounded-btn border border-line-2 px-3 text-base font-semibold text-text transition-colors hover:bg-white/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            {copied ? <Check size="0.875rem" strokeWidth={2.4} /> : <Copy size="0.875rem" strokeWidth={1.9} />}
            {copied ? 'Copied' : 'Copy details'}
          </button>
        </div>
        <dl className="rounded-card border border-line px-3.5">
          {facts.map(([label, value], index) => (
            <div
              key={label}
              className={`flex items-center justify-between gap-3 py-3 ${index > 0 ? 'border-t border-line' : ''}`}
            >
              <dt className="shrink-0 text-base text-muted">{label}</dt>
              <dd title={value} className="min-w-0 truncate text-right text-base font-medium tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-sm leading-[1.45] text-faint">
          Paste these into a problem report so we know which build you are on.
        </p>
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className="text-lg font-semibold">Stored on this device</h3>
        <div className="flex flex-col gap-3 rounded-card border border-line p-3.5">
          <span>
            <span className="block text-lg font-medium">Appearance, notification sound and layout choices</span>
            <span className="mt-0.5 block text-base leading-[1.45] text-muted">
              They stay in this browser and are not shared with your other devices or your company.
              Resetting keeps your unsent drafts.
            </span>
          </span>
          <button
            type="button"
            onClick={resetPreferences}
            className={`h-9 self-start rounded-btn px-3 text-base font-semibold text-alert transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
              confirmReset ? 'bg-alert/10' : 'border border-line hover:bg-alert/10'
            }`}
          >
            {confirmReset ? 'Reset and reload' : 'Reset preferences'}
          </button>
        </div>
      </section>
    </div>
  )
}
