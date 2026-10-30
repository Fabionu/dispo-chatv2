import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Archive, MailOpen, Plus, Search, UserPlus, Users, X, Activity, CalendarClock, Route } from 'lucide-react'
import type { User, Workspace as WorkspaceT } from '../auth/AuthContext'
import type {
  Connection,
  ConnectionUser,
  Group,
  GroupInvite,
  Profile,
  ReplyToPreview,
  WorkspaceMember,
} from '../lib/types'
import { groupLabel, isUnread, tractorPlate } from '../lib/types'
import { api } from '../lib/api'
import { canManageRoom } from '../lib/roomPermissions'
import { getSocket } from '../lib/socket'
import { useMessageCacheActions } from '../hooks/useMessageCache'
import ChatView from '../components/ChatView'
import type { AttachmentWorkspaceTab } from '../components/messages/types'
import ConnectionRequestView from '../components/connections/ConnectionRequestView'
import ConnectionRequestsSection from '../components/connections/ConnectionRequestsSection'
import GroupInvitesSection from '../components/invites/GroupInvitesSection'
import GroupInviteView from '../components/invites/GroupInviteView'
import { MENU_CONTAINER, MENU_GLYPH, MENU_SEPARATOR } from '../components/menuStyles'
import Spinner from '../components/Spinner'
import CreateVehicleGroupModal from '../components/CreateVehicleGroupModal'
import NewMessageModal from '../components/NewMessageModal'
import AccountPopover from '../components/settings/AccountPopover'
import WindowShell from '../components/settings/WindowShell'
import ProfileSidebarPanel from '../components/settings/ProfileSidebarPanel'
import CompanySidebarPanel from '../components/settings/CompanySidebarPanel'
import WorkspaceSettingsPanel, { CompanyMembersSettings, ScopeTag } from '../components/settings/WorkspaceSettingsPanel'
import InboxView, { ROUTE_PLANNER_ENABLED, type WorkspaceToolId } from '../components/inbox/InboxView'
import { useIdle } from '../hooks/useIdle'
import { usePresence } from '../hooks/usePresence'
import { useConnections } from '../hooks/useConnections'
import { useGroupInvites } from '../hooks/useGroupInvites'
import { useWorkspaceGroups } from '../hooks/useWorkspaceGroups'
import { useUnreadTitle } from '../hooks/useUnreadTitle'
import {
} from '../lib/density'
import { getStoredSidebarCollapsed, setStoredSidebarCollapsed } from '../lib/sidebar'
import { preloadAvatar } from '../lib/avatarCache'
import { useAuth } from '../auth/AuthContext'
import GroupRow from './SidebarGroupRow'
import ContactRow from './SidebarContactRow'
import { FilterTab, FilterTabBar, ArchiveToggle, EmptyHint, MenuItem } from './sidebarBits'
import { optimisticDirectGroup } from './workspaceUtils'
import ConnectionStatusBanner from '../components/ConnectionStatusBanner'
import { NOTIFICATION_OPEN_EVENT } from '../lib/browserNotifications'
import UserProfilePanel from '../components/UserProfilePanel'
import WorkspaceTopBar, { type TopTab } from './WorkspaceTopBar'
import { AWAY, statusMeta } from '../lib/availability'
import { useTravellingMarker } from '../components/useTravellingMarker'

type Props = {
  user: User
  workspace: WorkspaceT
  onSignOut: () => Promise<void>
}

type NewGroupKind = 'vehicle' | 'direct'

// What the LEFT RAIL is showing. The rail is a small navigation stack, not a set
// of popovers: 'list' is the conversation list (home), and every other value is a
// drill-in view that REPLACES it inside the same panel, opened from the top
// bar's account window (which used to be the 'account' level here); each one's
// Back returns to the list:
//   list ← profile / company / settings
// The list's own state (selection, search text, filter, scroll offset) is held
// here in Workspace and therefore survives every drill-in unchanged.
type AccountWindow = 'profile' | 'company' | 'members' | 'settings'
const ACCOUNT_WINDOW_TITLE: Record<AccountWindow, string> = {
  profile: 'My profile',
  company: 'Company',
  members: 'Members',
  settings: 'Workspace settings',
}

// The top bar's open tabs, per user on this device. Validated on read: a
// malformed or foreign value yields an empty bar rather than a crash.
const OPEN_TABS_KEY = 'dispo:open-tabs:v1:'
function getStoredOpenTabs(userId: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_TABS_KEY + userId) ?? '[]')
    return Array.isArray(raw)
      ? raw.filter((k): k is string => typeof k === 'string' && /^(chat|tool):/.test(k))
      : []
  } catch {
    return []
  }
}
function setStoredOpenTabs(userId: string, tabs: string[]) {
  try {
    localStorage.setItem(OPEN_TABS_KEY + userId, JSON.stringify(tabs))
  } catch {
    /* storage unavailable — the tabs still work for this session */
  }
}

// Sidebar pill filter — which slice of the single unified list is shown.
//   'all'      → active (non-archived) vehicle rooms + DMs + company contacts
//   'archived' → archived conversations only (no contacts)
//   'groups'   → active vehicle/group rooms only
//   'dms'      → active direct messages + company contacts
//   'unread'   → everything still unread, rooms and DMs alike (no contacts —
//                a colleague without a thread has nothing to be unread)
// Archive/pin/mute/hide are per-user prefs (see group_members, migration 0023).
type SidebarFilter = 'all' | 'archived' | 'groups' | 'dms' | 'unread'

// One entry in the unified rail list: either a real conversation (vehicle room
// or DM Group) or a company colleague you don't have a DM with yet.
type SidebarRowItem =
  | { kind: 'group'; key: string; group: Group }
  | { kind: 'contact'; key: string; member: WorkspaceMember }

// What the main pane is currently showing. A group chat, a pending request, a
// pending invite, or the Inbox / workspace-home tools area. `null` is treated
// the same as `inbox` — both render the Inbox view (it's the default home).
type Selection =
  | { kind: 'group'; id: string }
  | { kind: 'request'; id: string }
  | { kind: 'invite'; id: string }
  | { kind: 'inbox' }
  | null

function initialSelection(): Selection {
  const params = new URLSearchParams(window.location.search)
  const groupId = params.get('notificationGroup')
  if (!groupId) return null
  params.delete('notificationGroup')
  const query = params.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  return { kind: 'group', id: groupId }
}

export default function Workspace({ user, workspace, onSignOut }: Props) {
  const { refresh } = useAuth()
  // Auto-away presence: grey "Away" on the footer status dot when idle / tab
  // hidden. Doesn't change the stored (manual) status — presence only.
  const away = useIdle()
  // Live online/offline presence of peers (DM status dots). `resyncPresence`
  // re-requests the server snapshot; we call it whenever the group set changes
  // (below), since a new co-member who's already online won't emit a transition.
  const { online: onlineIds, resync: resyncPresence } = usePresence()
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  // Collapsed left rail — frees the main area for wide chats. Persisted
  // so the choice survives reloads; collapsing/expanding never reloads the app or
  // touches the current selection.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed)
  const [modal, setModal] = useState<NewGroupKind | null>(null)
  const [profileTarget, setProfileTarget] = useState<{ id: string; name: string } | null>(null)
  // Prefetched once at mount so opening "My profile" is instant (the panel
  // remounts each open, so without this it would refetch every time and flash
  // a "Loading…" state). Kept fresh by the panel's onSaved.
  const [cachedProfile, setCachedProfile] = useState<Profile | null>(null)
  // Active members of the caller's own company (internal/trusted contacts).
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [selection, setSelection] = useState<Selection>(initialSelection)
  // Workspace tabs (user, 2026-10-15): a tool opened from the workspace home
  // (Route planner, Restriction calculator, Fleet status) is owned HERE, not by
  // the home view, so a trip to a chat does not close it. The + in a tool's
  // header pins it into the tab strip above the main pane, next to the last
  // conversation opened, so the user can flip between them freely.
  const [workspaceTool, setWorkspaceTool] = useState<WorkspaceToolId | null>(null)
  // The top bar's open tabs (see "Open tabs" below). Pinned tools are the
  // `tool:` entries of the same list, so a pin and a tab are one thing.
  const [openTabs, setOpenTabs] = useState<string[]>(() => getStoredOpenTabs(user.id))
  const pinnedTools = useMemo(
    () => openTabs.filter((k) => k.startsWith('tool:')).map((k) => k.slice(5) as WorkspaceToolId),
    [openTabs],
  )
  // The account window hanging from the top bar's photo.
  const [accountOpen, setAccountOpen] = useState(false)
  // The windows the account window opens (user, 2026-10-29/30 canvases) — My
  // profile, Company, Members (admins) and Workspace settings each open over
  // the workspace instead of as a drill-in that replaced the conversation list.
  const [accountWindow, setAccountWindow] = useState<AccountWindow | null>(null)
  // Which conversation row has its inline action strip expanded. Held here, not
  // per row, so opening one collapses whichever was open.
  const [rowActionsId, setRowActionsId] = useState<string | null>(null)
  // Sidebar quick-filter text. Filters the conversation lists by name (and a
  // vehicle's tractor plate) so "Jump to…" actually narrows the rail.
  const [query, setQuery] = useState('')
  // Sidebar pill filter — the single list below shows everything / only groups /
  // only DMs depending on this. Replaces the old visible section grouping.
  const [filter, setFilter] = useState<SidebarFilter>('all')
  // A quote to seed a DM's composer with, set when a DM is opened via "Reply
  // privately". Scoped to a group id so it only seeds that conversation.
  const [pendingReply, setPendingReply] = useState<{
    groupId: string
    reply: ReplyToPreview
  } | null>(null)
  // One-shot Workspace-home shortcut: selecting a room from the Add trip card
  // navigates there and asks the newly-mounted ChatView to open its existing
  // Add Trip panel immediately.
  const [pendingAddTripGroupId, setPendingAddTripGroupId] = useState<string | null>(null)
  // Same one-shot handshake for the sidebar row action "View user profile" /
  // "View group info": select the conversation, then let its ChatView open the
  // details surface that matches the conversation's type.
  const [pendingDetailsGroupId, setPendingDetailsGroupId] = useState<string | null>(null)
  // Shared chat-window attachment tabs. ChatView remounts per conversation, but
  // a PDF/image tab should remain available until the user explicitly closes it.
  const [attachmentTabs, setAttachmentTabs] = useState<AttachmentWorkspaceTab[]>([])

  const newMenuRef = useRef<HTMLDivElement>(null)
  const sidebarSlotRef = useRef<HTMLDivElement>(null)

  // Keep the animated-but-mounted sidebar out of keyboard navigation while its
  // grid track is collapsed. React 18's HTML typings do not expose `inert` as a
  // JSX prop yet, although the browser DOM property is supported.
  useEffect(() => {
    if (sidebarSlotRef.current) sidebarSlotRef.current.inert = sidebarCollapsed
  }, [sidebarCollapsed])
  // Mirror the currently-open group id into a ref so the socket handler (set up
  // once) can tell whether an arriving message belongs to the open chat without
  // re-subscribing on every selection change.
  const openGroupId = selection?.kind === 'group' ? selection.id : null
  const openGroupIdRef = useRef(openGroupId)
  openGroupIdRef.current = openGroupId

  // Deselect handler the groups hook calls when the OPEN conversation is
  // removed or hidden (kicked, or delete-for-me on another device).
  const clearSelection = useCallback(() => setSelection(null), [])
  const openNotificationGroup = useCallback(
    (groupId: string) => setSelection({ kind: 'group', id: groupId }),
    [],
  )

  useEffect(() => {
    const open = (event: Event) => {
      const groupId = (event as CustomEvent<{ groupId?: string }>).detail?.groupId
      if (groupId) openNotificationGroup(groupId)
    }
    window.addEventListener(NOTIFICATION_OPEN_EVENT, open)
    return () => window.removeEventListener(NOTIFICATION_OPEN_EVENT, open)
  }, [openNotificationGroup])

  // Conversation list + live socket sync + per-row pref actions.
  const {
    groups,
    typingByGroup,
    loadingGroups,
    refreshGroups,
    insertGroup,
    patchGroup,
    markGroupRead,
    togglePin,
    toggleArchive,
    toggleMute,
    handleMarkRead,
    handleMarkAllRead,
    handleMarkUnread,
    handleDeleteConversation,
  } = useWorkspaceGroups({
    userId: user.id,
    openGroupIdRef,
    onOpenGroupGone: clearSelection,
    onNotificationOpen: openNotificationGroup,
  })

  // The unread count in the browser tab. Fed the same list the sidebar draws,
  // so the two can never disagree about what is unread.
  useUnreadTitle(groups)

  // Cross-workspace connection requests + pending vehicle-group invitations.
  const { connections, connectionsError, refreshConnections } = useConnections()
  const { groupInvites, refreshGroupInvites } = useGroupInvites()

  // Workspace only issues prefetch commands; it must not subscribe the entire
  // shell/sidebar to every cached message or read-receipt change.
  const { prefetch } = useMessageCacheActions()

  // Warm the profile cache in the background so the "My profile" drawer opens
  // instantly the first time. Cheap, fire-and-forget.
  useEffect(() => {
    api.profile
      .get()
      .then(({ profile }) => setCachedProfile(profile))
      .catch(() => {})
  }, [])

  // Internal company contacts. Same-workspace members are trusted contacts you
  // can DM directly (no connection handshake — that's cross-company only), so we
  // surface the roster in the rail. The endpoint already excludes the caller and
  // deleted/anonymized users. Refetched live when a colleague joins (socket).
  const refreshMembers = useCallback(async () => {
    try {
      const { members } = await api.workspace.members()
      setMembers(members)
    } catch {
      /* leave the previous roster in place; the rail keeps working */
    }
  }, [])

  useEffect(() => {
    void refreshMembers()
  }, [refreshMembers])

  // Warm the cache for the few most-recent conversations once the rail is up,
  // so opening them is instant. Lightweight + idempotent: prefetch skips groups
  // already cached or in flight, and runs in the background without blocking.
  useEffect(() => {
    if (loadingGroups) return
    for (const g of groups.slice(0, 3)) prefetch(g.id)
  }, [loadingGroups, groups, prefetch])

  // Warm avatars for the most-recent conversations so the chat header shows the
  // peer/group image instantly on open. Bounded to the recent 20 (the list is
  // ordered by recency) so we never fan out to hundreds of requests; the session
  // cache (lib/avatarCache) dedupes in-flight warms and remembers loaded/missing
  // so revisits and misses never re-request. DM peers warm unconditionally; a
  // vehicle group only warms when it actually has an image (avoids needless
  // requests for the many groups without one).
  useEffect(() => {
    if (loadingGroups) return
    for (const g of groups.slice(0, 20)) {
      if (g.type === 'direct') {
        const peer = g.directPeer
        if (peer?.id && peer.hasAvatar !== false) void preloadAvatar('user', peer.id, peer.avatarVersion)
      } else if (g.hasAvatar) {
        void preloadAvatar('group', g.id, g.avatarVersion)
      }
    }
  }, [loadingGroups, groups])

  // Re-sync presence whenever the set of conversations changes. A new DM or an
  // accepted connection makes a new co-member visible to the presence snapshot;
  // if that peer is already online they never emit a `presence:update`, so a
  // fresh snapshot is the only way to light their dot without a page refresh.
  // Keyed on the sorted group-id signature so it fires on add/remove (initial
  // load, refreshGroups, optimistic DM open) — not on every unrelated re-render.
  const groupIdsKey = useMemo(
    () => groups.map((g) => g.id).sort().join(','),
    [groups],
  )
  useEffect(() => {
    if (loadingGroups) return
    resyncPresence()
  }, [groupIdsKey, loadingGroups, resyncPresence])

  // A colleague joined (or left) the company → refresh the internal contact
  // roster so the new person shows up in the rail without a reload. (The rest
  // of the rail's socket sync lives in useWorkspaceGroups.)
  useEffect(() => {
    const socket = getSocket()
    const onMembersChanged = () => void refreshMembers()
    socket.on('workspace:members_changed', onMembersChanged)
    socket.io.on('reconnect', onMembersChanged)
    return () => {
      socket.off('workspace:members_changed', onMembersChanged)
      socket.io.off('reconnect', onMembersChanged)
    }
  }, [refreshMembers])

  // Close the rail's actions menu on outside click / Esc. (The account window
  // is the top bar's, and closes itself the same way.)
  useEffect(() => {
    if (!newMenuOpen) return
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (newMenuRef.current && !newMenuRef.current.contains(t)) setNewMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setNewMenuOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [newMenuOpen])

  function startCreate(kind: NewGroupKind) {
    setNewMenuOpen(false)
    setModal(kind)
  }

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => {
      const next = !c
      setStoredSidebarCollapsed(next)
      return next
    })
  }, [])

  // Drop the given group into local state immediately, select it, and
  // reconcile against the server in the background. This is what makes new
  // chats appear instantly even on slow connections — the rail and main
  // pane don't wait for the follow-up GET /groups round trip.
  const openGroupOptimistically = useCallback(
    (group: Group) => {
      insertGroup(group)
      setSelection({ kind: 'group', id: group.id })
    },
    [insertGroup],
  )

  function handleCreated(group: Group) {
    setModal(null)
    openGroupOptimistically(group)
  }

  // Open (or create) a DM with an accepted connection. Used after accepting
  // a request, so the natural next step (talk to them) is one click closer.
  const openDirectFor = useCallback(
    async (otherUser: ConnectionUser) => {
      const { group } = await api.groups.createDirect(otherUser.id)
      openGroupOptimistically(
        optimisticDirectGroup(group.id, otherUser),
      )
    },
    [openGroupOptimistically],
  )

  // Open (or create) a DM with a company colleague from the contacts list.
  // Same-workspace DMs need no connection, so this always succeeds; the colleague
  // stays in the "Company" section, just upgraded from a directory row to a full
  // conversation row once the DM exists (refreshGroups reconciles).
  const openDirectWithMember = useCallback(
    async (member: WorkspaceMember) => {
      const { group } = await api.groups.createDirect(member.id)
      openGroupOptimistically(
        optimisticDirectGroup(group.id, {
          id: member.id,
          displayName: member.displayName,
          email: member.email,
          workspace: { id: workspace.id, name: workspace.name },
        }),
      )
    },
    [openGroupOptimistically, workspace.id, workspace.name],
  )

  const messageProfileUser = useCallback(
    async (userId: string, name: string) => {
      const member = members.find((candidate) => candidate.id === userId)
      if (member) {
        await openDirectWithMember(member)
      } else {
        const { group } = await api.groups.createDirect(userId)
        openGroupOptimistically(
          optimisticDirectGroup(group.id, {
            id: userId,
            displayName: name,
            email: '',
            workspace: { id: workspace.id, name: workspace.name },
          }),
        )
      }
      setProfileTarget(null)
    },
    [members, openDirectWithMember, openGroupOptimistically, workspace.id, workspace.name],
  )

  // Navigate to a private DM opened from a message action ("Reply privately"
  // / "Send message in private"). ChatView has already created the group
  // server-side; we drop an optimistic row in and reconcile in the background.
  const openDirectMessage = useCallback(
    (
      info: { groupId: string; peerId: string; peerName: string },
      reply?: ReplyToPreview,
    ) => {
      const now = new Date().toISOString()
      openGroupOptimistically({
        id: info.groupId,
        type: 'direct',
        name: null,
        description: null,
        meta: {},
        lastMessageAt: null,
        lastReadAt: now,
        createdAt: now,
        memberCount: 2,
        unreadCount: 0,
        directPeer: { id: info.peerId, name: info.peerName, workspace: null },
      })
      setPendingReply(reply ? { groupId: info.groupId, reply } : null)
    },
    [openGroupOptimistically],
  )

  async function handleAccepted(otherUser: ConnectionUser) {
    // Navigate to the new DM FIRST, then drop the now-stale pending request.
    // Refreshing first would briefly leave selection on a request that's no
    // longer in pendingReceived, flashing the "no longer pending" state.
    await openDirectFor(otherUser)
    await refreshConnections()
  }

  async function handleDeclined() {
    // Leave the request view before the row disappears from the list, for the
    // same reason as accept above.
    setSelection(null)
    await refreshConnections()
  }

  // Accepting a group invite: the server added us to group_members and emitted
  // group:added, but we also refresh explicitly so the Vehicles list is
  // up-to-date, drop the pending invite, then open the group immediately.
  async function handleInviteAccepted(groupId: string) {
    await refreshGroups()
    await refreshGroupInvites()
    setSelection({ kind: 'group', id: groupId })
  }

  async function handleInviteDeclined() {
    await refreshGroupInvites()
    setSelection(null)
  }

  const directGroups = useMemo(() => groups.filter((g) => g.type === 'direct'), [groups])

  // Company colleagues you don't YET have an open DM with → shown as quiet
  // directory rows. A member who already has a DM renders as a full conversation
  // row instead (their direct Group), so dedup against existing direct-group
  // peers to keep a person in the list exactly once — never duplicated.
  const companyContacts = useMemo(() => {
    const peerIds = new Set(
      directGroups.map((g) => g.directPeer?.id).filter((id): id is string => Boolean(id)),
    )
    return members.filter((m) => !peerIds.has(m.id))
  }, [members, directGroups])

  // Apply the quick-filter. Empty query → full lists. A vehicle also matches on
  // its tractor plate so you can jump by registration number.
  const q = query.trim().toLowerCase()
  const searching = q.length > 0
  const matchesQuery = useCallback(
    (g: Group) => {
      if (!q) return true
      if (groupLabel(g).toLowerCase().includes(q)) return true
      const plate = tractorPlate(g)
      return plate ? plate.toLowerCase().includes(q) : false
    },
    [q],
  )

  // Company contacts (no DM yet) matching the search, sorted by name so the
  // directory reads predictably. Surfaced in the All + DMs filters.
  const filteredContacts = useMemo(() => {
    const base = q
      ? companyContacts.filter((m) => m.displayName.toLowerCase().includes(q))
      : companyContacts
    return [...base].sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [companyContacts, q])

  // The unified, recency-ordered rail list for the active pill filter. `groups`
  // is already sorted newest-activity-first (byRecent), so conversation rows
  // inherit that order; photo-less company contacts (no thread yet) trail the
  // live conversations. 'groups' → vehicle rooms; 'dms' → DMs + contacts.
  const conversationItems = useMemo<SidebarRowItem[]>(() => {
    // First collect the groups that belong in the active filter. Archived
    // conversations live ONLY in the Archived filter; every other filter shows
    // active (non-archived) ones. `groups` is already recency-ordered.
    const matched: Group[] = []
    for (const g of groups) {
      const archived = Boolean(g.archivedAt)
      if (filter === 'archived') {
        if (!archived) continue
      } else {
        if (archived) continue
        if (filter === 'groups' && g.type !== 'vehicle') continue
        if (filter === 'dms' && g.type !== 'direct') continue
        // Unread cuts ACROSS the type filters: rooms and DMs alike, whatever is
        // still unread. `groups` carries live unread counts (socket-updated in
        // useWorkspaceGroups), so a conversation leaves this list the moment it
        // is read and re-enters when a new message lands — no refetch. This also
        // applies to the currently open conversation: the chat remains open in
        // the main pane, but its row no longer appears in an unread-only list.
        if (filter === 'unread' && !isUnread(g)) continue
      }
      if (!matchesQuery(g)) continue
      matched.push(g)
    }
    // Pinned conversations float to the top, preserving recency within the pinned
    // and the unpinned groups (Array.sort is stable). Contacts always trail.
    matched.sort((a, b) => Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt)))
    // The All view is two sections (rework, 2026-10-10): vehicle rooms, then
    // people. Stable, so pinned-then-recent still holds inside each. Search
    // stays one flat list of matches.
    if (filter === 'all' && !searching) {
      matched.sort((a, b) => Number(b.type === 'vehicle') - Number(a.type === 'vehicle'))
    }

    const items: SidebarRowItem[] = matched.map((g) => ({ kind: 'group', key: g.id, group: g }))
    // Company contacts (no DM yet) are directory entries, not conversations — so
    // they appear only in the All / Direct filters, never in Groups or Archived.
    if (filter === 'all' || filter === 'dms') {
      for (const m of filteredContacts) {
        items.push({ kind: 'contact', key: `contact:${m.id}`, member: m })
      }
    }
    return items
  }, [groups, filter, matchesQuery, filteredContacts, searching])
  const railSectioned = filter === 'all' && !searching

  // The bar that slides down the rail to whichever conversation is open. It is
  // ONE element measured against the list wrapper (see
  // components/useTravellingMarker) rather than a border on each row, so
  // changing conversation reads as the mark travelling rather than as one row
  // lighting up while another goes dark.
  //
  // Living inside the SCROLLED content is what makes it track the list for free:
  // offsetTop is measured against the wrapper, so the bar scrolls with its row
  // and needs no scroll listener.
  //
  // The re-measure key carries BOTH the selection and the rendered order. A
  // ResizeObserver on the wrapper catches rows entering and leaving (its height
  // changes), but not a reorder that keeps the same height — pinning a
  // conversation moves every row between it and the top without changing the
  // list's total height at all.
  const railBarKey = `${selection?.kind === 'group' ? selection.id : ''}|${conversationItems
    .map((item) => item.key)
    .join(',')}`
  const railBar = useTravellingMarker(railBarKey)

  // How many ACTIVE conversations are still unread — the Unread pill's live
  // count. Derived from the same `groups` state the rows read, so it moves the
  // instant a conversation is read, muted-or-not, room or DM.
  const unreadConversationCount = useMemo(
    () => groups.filter((g) => !g.archivedAt && isUnread(g)).length,
    [groups],
  )

  const pendingReceived = connections.pendingReceived

  const emptyListCopy =
    filter === 'groups'
      ? 'Create a vehicle chat to coordinate loads, documents, and updates over time.'
      : filter === 'dms'
        ? 'No direct messages or contacts yet.'
        : filter === 'archived'
          ? 'No archived conversations.'
          : filter === 'unread'
            ? 'Nothing unread — you’re all caught up.'
            : 'No conversations yet.'

  const selectedGroup = useMemo<Group | null>(() => {
    if (selection?.kind !== 'group') return null
    return groups.find((g) => g.id === selection.id) ?? null
  }, [groups, selection])

  const selectedRequest = useMemo<Connection | null>(() => {
    if (selection?.kind !== 'request') return null
    return pendingReceived.find((c) => c.id === selection.id) ?? null
  }, [pendingReceived, selection])

  const selectedInvite = useMemo<GroupInvite | null>(() => {
    if (selection?.kind !== 'invite') return null
    return groupInvites.find((i) => i.id === selection.id) ?? null
  }, [groupInvites, selection])

  // ── Open tabs (top bar) ────────────────────────────────────────────────
  // Every conversation you open gets a tab and keeps it until you close it;
  // a tool the user pins from the workspace home is a tab too. One ordered list
  // of keys (`chat:<groupId>` / `tool:<toolId>`), remembered per user on this
  // device so the working set survives a reload.
  useEffect(() => {
    if (!selectedGroup) return
    const key = `chat:${selectedGroup.id}`
    setOpenTabs((cur) => (cur.includes(key) ? cur : [...cur, key]))
  }, [selectedGroup])
  // A conversation that left the list (deleted, left, hidden on another device)
  // takes its tab with it — once the list has actually loaded.
  useEffect(() => {
    if (loadingGroups) return
    const ids = new Set(groups.map((g) => g.id))
    setOpenTabs((cur) => {
      const next = cur.filter((k) => !k.startsWith('chat:') || ids.has(k.slice(5)))
      return next.length === cur.length ? cur : next
    })
  }, [groups, loadingGroups])
  useEffect(() => {
    setStoredOpenTabs(user.id, openTabs)
  }, [user.id, openTabs])

  // The Inbox / workspace home is showing whenever nothing else is selected —
  // i.e. selection is `inbox` or `null`. Drives the header's active state and
  // the main-pane fallback below.
  const inboxActive = !selectedGroup && !selectedRequest && !selectedInvite

  // Whether the user dispatches for their company at all (admin / dispatcher) —
  // gates the "Add trip" entry points that then ask WHICH room. Managing one
  // particular room is the per-room rule in lib/roomPermissions.
  const canInviteMembers = user.role === 'admin' || user.role === 'dispatcher'
  const roomViewer = useMemo(
    () => ({ role: user.role, workspaceId: workspace.id }),
    [user.role, workspace.id],
  )
  const availableVehicleRooms = useMemo(
    () => groups.filter((group) => group.type === 'vehicle' && !group.archivedAt),
    [groups],
  )
  // Rooms a trip can be added to from a picker: only those this user manages,
  // so a partner's room never shows up as a target the server would refuse.
  const tripTargetRooms = useMemo(
    () => availableVehicleRooms.filter((room) => canManageRoom(room, roomViewer)),
    [availableVehicleRooms, roomViewer],
  )

  const addTripFromWorkspace = useCallback((groupId: string) => {
    setPendingAddTripGroupId(groupId)
    setSelection({ kind: 'group', id: groupId })
  }, [])

  const openAttachmentTab = useCallback((tab: AttachmentWorkspaceTab) => {
    setAttachmentTabs((current) =>
      current.some((item) => item.attachment.id === tab.attachment.id)
        ? current
        : [...current, tab],
    )
  }, [])

  const closeAttachmentTab = useCallback((attachmentId: string) => {
    setAttachmentTabs((current) =>
      current.filter((item) => item.attachment.id !== attachmentId),
    )
  }, [])

  const replyToAttachmentTab = useCallback((groupId: string, reply: ReplyToPreview) => {
    setPendingReply({ groupId, reply })
    setSelection({ kind: 'group', id: groupId })
  }, [])

  // A window opened from the account window closes the account window behind it.
  const openFromAccount = (view: AccountWindow) => {
    setAccountOpen(false)
    setAccountWindow(view)
  }

  const TOOL_TABS: Record<WorkspaceToolId, { label: string; icon: React.ReactNode }> = {
    route: { label: 'Route planner', icon: <Route size="1.0625rem" strokeWidth={1.75} /> },
    restrictions: { label: 'Restrictions', icon: <CalendarClock size="1.0625rem" strokeWidth={1.75} /> },
    fleet: { label: 'Fleet status', icon: <Activity size="1.0625rem" strokeWidth={1.75} /> },
  }
  const topTabs: TopTab[] = openTabs.flatMap((key): TopTab[] => {
    if (key.startsWith('tool:')) {
      const id = key.slice(5) as WorkspaceToolId
      const tool = id === 'route' && !ROUTE_PLANNER_ENABLED ? undefined : TOOL_TABS[id]
      return tool ? [{ key, kind: 'tool', label: tool.label, icon: tool.icon }] : []
    }
    const g = groups.find((x) => x.id === key.slice(5))
    if (!g) return []
    const unread = g.unreadCount ?? 0
    return g.type === 'direct'
      ? [{
          key,
          kind: 'person',
          label: groupLabel(g),
          unread,
          person: g.directPeer
            ? {
                id: g.directPeer.id,
                name: g.directPeer.name ?? groupLabel(g),
                hasAvatar: g.directPeer.hasAvatar,
                avatarVersion: g.directPeer.avatarVersion,
              }
            : undefined,
        }]
      : [{ key, kind: 'vehicle', label: tractorPlate(g) ?? groupLabel(g), unread }]
  })
  const activeTabKey = selectedGroup
    ? `chat:${selectedGroup.id}`
    : inboxActive && workspaceTool && openTabs.includes(`tool:${workspaceTool}`)
      ? `tool:${workspaceTool}`
      : ''
  const selectTab = (key: string) => {
    if (key.startsWith('tool:')) {
      setSelection({ kind: 'inbox' })
      setWorkspaceTool(key.slice(5) as WorkspaceToolId)
    } else {
      setSelection({ kind: 'group', id: key.slice(5) })
    }
  }
  // Closing the live tab moves to its neighbour (the next one, else the one
  // before), the way a browser does; closing the last returns to the
  // workspace home.
  const closeTab = (key: string) => {
    const index = openTabs.indexOf(key)
    const rest = openTabs.filter((k) => k !== key)
    setOpenTabs(rest)
    if (key !== activeTabKey) return
    const neighbour = rest[Math.min(index, rest.length - 1)]
    if (neighbour) {
      selectTab(neighbour)
    } else {
      if (key.startsWith('tool:')) setWorkspaceTool(null)
      setSelection({ kind: 'inbox' })
    }
  }
  const myStatus =
    user.role === 'driver' ? null : away ? AWAY : statusMeta(cachedProfile?.availabilityStatus ?? 'available')

  // App shell: edge to edge, one field colour. The top bar spans the width;
  // under it the sidebar and the main pane, where the chat floats as its card.
  return (
    <div
      className={`workspace-shell h-screen w-full bg-bg text-text overflow-hidden ${
        sidebarCollapsed ? 'workspace-shell--collapsed' : ''
      }`}
    >
      <ConnectionStatusBanner />
      {/* Persistent application navigation + the open tabs. Unlike the
          conversation sidebar it never disappears, so Workspace, your account
          and every open conversation stay reachable from anywhere. */}
      <WorkspaceTopBar
        collapsed={sidebarCollapsed}
        // Chat is "the rail is showing conversations AND one is open". With
        // nothing selected the main pane IS the workspace inbox, which is what
        // the Workspace entry means — so the two never light up together.
        chatActive={!inboxActive}
        workspaceActive={inboxActive}
        me={{
          id: user.id,
          name: user.displayName,
          hasAvatar: cachedProfile?.hasAvatar,
          avatarVersion: cachedProfile?.avatarVersion,
        }}
        statusColor={myStatus?.color ?? null}
        tabs={topTabs}
        activeKey={activeTabKey}
        onSelectTab={selectTab}
        onCloseTab={closeTab}
        accountOpen={accountOpen}
        onAccountOpenChange={setAccountOpen}
        account={
          <AccountPopover
            user={user}
            profile={cachedProfile}
            away={away}
            companyName={workspace.name}
            onClose={() => setAccountOpen(false)}
            onOpenProfile={() => openFromAccount('profile')}
            onOpenCompany={() => openFromAccount('company')}
            onOpenSettings={() => openFromAccount('settings')}
            onOpenMembers={user.role === 'admin' ? () => openFromAccount('members') : undefined}
            onSignOut={() => void onSignOut()}
            onProfileSaved={(p) => {
              setCachedProfile(p)
              void refresh()
            }}
          />
        }
        onToggleSidebar={toggleSidebar}
        // Back to the conversation list, and ONLY that. It deliberately does
        // not touch `selection`: coming back from Settings or the inbox should
        // return you to the rail you left, with whatever conversation you had
        // open still open. Expanding a collapsed sidebar first, since restoring
        // a list nobody can see would do nothing visible.
        onOpenChat={() => {
          setNewMenuOpen(false)
          if (sidebarCollapsed) {
            setStoredSidebarCollapsed(false)
            setSidebarCollapsed(false)
          }
        }}
        onOpenWorkspace={() => {
          setNewMenuOpen(false)
          setSelection({ kind: 'inbox' })
        }}
      />

      <div
        ref={sidebarSlotRef}
        className="workspace-sidebar-slot min-w-0 overflow-hidden"
        aria-hidden={sidebarCollapsed}
      >
      {/* Left rail — the same field as everything else, separated from the
          thread by the hairline on its right edge. It only ever shows the
          conversation list now: the account's panels open as windows. */}
      <aside className="workspace-sidebar-panel relative h-full min-w-0 overflow-hidden bg-bg">
        <div className="h-full min-h-0 flex flex-col">
        {/* Top toolbar — ONE row: the search field takes the width, the new-thread
            control sits inline at its right as a square `+`.
            It used to be a full-width bordered `New thread` button STACKED above
            the search, which spent a whole row of a 380px rail on a label for an
            action that is universally a plus. Inline, the row reads the way the
            rail's rows do — content first, affordance at the trailing edge — and
            the list starts one row higher.
            2026-10-30 canvas: both are SOFT FILLED and the same height, so the row
            reads as one control strip — no outlines until the field has focus
            (then it drops to the field colour with a hairline), and the `+` is a
            filled square in the same tone. */}
        <div
          className="px-3 pt-2.5 flex items-center gap-2 shrink-0"
          style={{ paddingBottom: 'var(--sidebar-toolbar-gap)' }}
        >
          <label
            htmlFor="rail-search"
            className="min-w-0 flex-1 h-[var(--sidebar-search-height)] flex items-center gap-2 px-3 cursor-text rounded-card border border-transparent bg-white/6 transition-colors hover:bg-white/8 focus-within:border-line-2 focus-within:bg-bg"
          >
            <Search size="0.9375rem" strokeWidth={1.8} className="text-muted shrink-0" />
            <input
              id="rail-search"
              // The field carries no visible label (the magnifier + placeholder
              // do the work), so it names itself for assistive tech.
              aria-label="Search conversations"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder="Search plates, people, messages"
              style={{ fontSize: 'calc(var(--sidebar-meta-font-size) - 1px)' }}
              className="bg-transparent flex-1 outline-none placeholder:text-faint min-w-0"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="text-faint hover:text-text shrink-0 transition-colors"
              >
                <X size="0.8125rem" strokeWidth={1.8} />
              </button>
            )}
          </label>

          <div className="relative shrink-0" ref={newMenuRef}>
            <button
              onClick={() => setNewMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={newMenuOpen}
              // The label is gone from the surface, so it lives here — the glyph
              // alone is not an accessible name, and the tooltip is what tells a
              // new user what the square does.
              aria-label="New thread"
              title="New thread"
              className={`h-[var(--sidebar-search-height)] w-[var(--sidebar-search-height)] flex items-center justify-center rounded-card border text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
                newMenuOpen ? 'border-line-2 bg-white/10' : 'border-transparent bg-white/6 hover:bg-white/10'
              }`}
            >
              <Plus size="1rem" strokeWidth={2} />
            </button>

            {newMenuOpen && (
              <div
                role="menu"
                // Hug the widest label exactly. Inline width:max-content (rather
                // than a utility class) is immune to purge/override and to the
                // abs-positioning shrink-to-fit of the narrow button wrapper.
                style={{ width: 'max-content', maxWidth: '13.75rem' }}
                // RIGHT-anchored, unlike the stacked version's left-0: the
                // trigger now sits at the rail's right edge, and a menu opening
                // rightward from there would run straight off it.
                className={`absolute right-0 top-[calc(100%+6px)] ${MENU_CONTAINER} z-20`}
              >
                <MenuItem icon={<Users {...MENU_GLYPH} />} onClick={() => startCreate('vehicle')}>
                  Vehicle room
                </MenuItem>
                <MenuItem icon={<UserPlus {...MENU_GLYPH} />} onClick={() => startCreate('direct')}>
                  Add connection
                </MenuItem>
                <div className={MENU_SEPARATOR} />
                <MenuItem
                  icon={<MailOpen {...MENU_GLYPH} />}
                  onClick={() => {
                    setNewMenuOpen(false)
                    void handleMarkAllRead()
                  }}
                >
                  Mark all as read
                </MenuItem>
              </div>
            )}
          </div>
        </div>

        {/* Filters — Archived leads the segmented control (everything / vehicle
            rooms / direct / unread) as a compact icon toggle. Opening Archived
            clears the type selection; picking a type leaves Archived.
            Fixed, like the toolbar above it — only the list scrolls. The pills
            wrap rather than overflow at the narrowest rail width. The space
            above comes from --sidebar-toolbar-gap so the search field and this
            row keep ONE agreed distance (see index.css).

            FilterTabBar owns the row itself: exactly one of these five is live
            at a time, and it draws the single bar that slides between them. */}
        <FilterTabBar activeKey={filter}>
          <FilterTab active={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </FilterTab>
          {/* Named for what is IN them (rework, 2026-10-10): every group is a
              vehicle room, every direct conversation is a person. */}
          <FilterTab active={filter === 'groups'} onClick={() => setFilter('groups')}>
            Vehicles
          </FilterTab>
          <FilterTab active={filter === 'dms'} onClick={() => setFilter('dms')}>
            People
          </FilterTab>
          {/* Unread cuts across the three type pills: every conversation with
              something new, room or DM. Its count is live (socket unread
              updates), so it empties as you read. */}
          <FilterTab
            active={filter === 'unread'}
            onClick={() => setFilter('unread')}
            badge={unreadConversationCount || undefined}
          >
            Unread
          </FilterTab>
          <ArchiveToggle
            active={filter === 'archived'}
            label={filter === 'archived' ? 'Show conversations' : 'Show archived'}
            onClick={() => setFilter((f) => (f === 'archived' ? 'all' : 'archived'))}
          >
            <Archive size="0.8125rem" strokeWidth={1.8} />
          </ArchiveToggle>
        </FilterTabBar>

        {/* Rail list. Pending actionable items keep their OWN separated,
            collapsible sections (Connection requests / Group invites) at the top
            — unchanged from before — followed by ONE pill-filtered, recency-
            ordered conversation + contact stream (no per-type section headers).
            Sections use the larger inter-section gap; the unified list inside its
            wrapper stays tight. */}
        <nav
          className="flex-1 min-h-0 overflow-y-auto px-1.5 pt-3 pb-1.5 flex flex-col"
          style={{ gap: 'var(--sidebar-section-gap)' }}
        >
          {loadingGroups ? (
            // Centre the loader in the available list area (consistent with the
            // chat pane, one size down) rather than a small top row.
            <div className="h-full flex items-center justify-center">
              <Spinner variant="md" />
            </div>
          ) : (
            <>
              {/* Separated pending sections — shown above the list regardless of
                  the active pill, hidden while searching so results read as pure
                  matches, and hidden in the Archived view (pure archived list). */}
              {!searching && filter !== 'archived' && (
                <ConnectionRequestsSection
                  pendingReceived={pendingReceived}
                  error={connectionsError}
                  onRetry={() => void refreshConnections()}
                  selectedId={selection?.kind === 'request' ? selection.id : null}
                  onSelect={(id) => setSelection({ kind: 'request', id })}
                />
              )}
              {!searching && filter !== 'archived' && (
                <GroupInvitesSection
                  invites={groupInvites}
                  selectedId={selection?.kind === 'invite' ? selection.id : null}
                  onSelect={(id) => setSelection({ kind: 'invite', id })}
                />
              )}

              {/* The unified conversation + contact stream for the active filter.
                  `relative` is load-bearing: it makes this wrapper the
                  offsetParent the travelling bar is measured against. */}
              <div ref={railBar.trackRef} className="relative flex flex-col gap-1">
                {railBar.rect && (
                  <span
                    aria-hidden
                    // 2px wide, sitting in the transparent border channel every
                    // row reserves (see SidebarGroupRow) — so the bar arriving
                    // never shifts a row's text. Mounted only once a position is
                    // known: a transition has no previous value to run from on
                    // the frame an element is inserted, so it appears beside the
                    // open conversation and only travels on later changes.
                    className="travelling-marker pointer-events-none absolute left-0 top-0 bg-text motion-reduce:transition-none"
                    style={{
                      // 2px in PX, not the rem scale, because it has to fill the
                      // `border-l-2` channel exactly — Tailwind border widths are
                      // px, so a rem width would under- or overshoot the channel
                      // by a fraction on every density tier but the default.
                      width: 2,
                      height: railBar.rect.h,
                      transform: `translate(${railBar.rect.x}px, ${railBar.rect.y}px)`,
                    }}
                  />
                )}
                {conversationItems.length === 0 ? (
                  searching ? (
                    <EmptyHint>No conversations match “{query.trim()}”.</EmptyHint>
                  ) : (
                    <EmptyHint>{emptyListCopy}</EmptyHint>
                  )
                ) : (
                  conversationItems.map((item, index) => {
                    const isVehicle = item.kind === 'group' && item.group.type === 'vehicle'
                    const prev = conversationItems[index - 1]
                    const prevVehicle = prev?.kind === 'group' && prev.group.type === 'vehicle'
                    const heading =
                      railSectioned && (index === 0 || prevVehicle !== isVehicle)
                        ? isVehicle
                          ? 'Vehicles'
                          : 'People'
                        : null
                    return (
                    <Fragment key={item.key}>
                    {heading && (
                      <h2
                        className={`text-base font-medium text-muted ${index === 0 ? 'pt-1' : 'pt-4'} pb-1`}
                        style={{ paddingLeft: 'calc(var(--sidebar-row-pad-x) + 2px)' }}
                      >
                        {heading}
                      </h2>
                    )}
                    {item.kind === 'group' ? (
                      <GroupRow
                        group={item.group}
                        typingUsers={typingByGroup[item.group.id] ?? []}
                        online={onlineIds}
                        currentUserId={user.id}
                        selected={selection?.kind === 'group' && selection.id === item.group.id}
                        actionsOpen={rowActionsId === item.group.id}
                        onActionsOpenChange={(open) =>
                          setRowActionsId(open ? item.group.id : null)
                        }
                        onClick={() => {
                          setRowActionsId(null)
                          setSelection({ kind: 'group', id: item.group.id })
                        }}
                        onTogglePin={togglePin}
                        onToggleArchive={toggleArchive}
                        onToggleMute={toggleMute}
                        onMarkRead={handleMarkRead}
                        onMarkUnread={handleMarkUnread}
                        onDelete={handleDeleteConversation}
                        onViewDetails={(g) => {
                          setRowActionsId(null)
                          setSelection({ kind: 'group', id: g.id })
                          setPendingDetailsGroupId(g.id)
                        }}
                      />
                    ) : (
                      <ContactRow
                        member={item.member}
                        onClick={() =>
                          setProfileTarget({ id: item.member.id, name: item.member.displayName })
                        }
                      />
                    )}
                    </Fragment>
                    )
                  })
                )}
              </div>
            </>
          )}
        </nav>

        </div>
      </aside>
      </div>

      {/* Main — the thread. Same field again; the rail's right-edge hairline is
          the only thing between them. Drawers and modals that open over it use
          `surface`, the one remaining tone step, because they COVER content and
          have to stay distinguishable from it. */}
      <main className="workspace-main flex flex-col min-w-0 bg-bg overflow-hidden">
        {selectedGroup ? (
          <ChatView
            key={selectedGroup.id}
            group={selectedGroup}
            currentUserId={user.id}
            currentWorkspaceName={workspace.name}
            onRead={markGroupRead}
            onOpenDirectMessage={openDirectMessage}
            initialReplyContext={
              pendingReply?.groupId === selectedGroup.id ? pendingReply.reply : null
            }
            onConsumeInitialReply={() => setPendingReply(null)}
            initialAddTripOpen={pendingAddTripGroupId === selectedGroup.id}
            onConsumeInitialAddTrip={() => setPendingAddTripGroupId(null)}
            initialDetailsOpen={pendingDetailsGroupId === selectedGroup.id}
            onConsumeInitialDetails={() => setPendingDetailsGroupId(null)}
            vehicleRooms={tripTargetRooms}
            onAddTripInGroup={addTripFromWorkspace}
            attachmentTabs={attachmentTabs}
            onOpenAttachmentTab={openAttachmentTab}
            onCloseAttachmentTab={closeAttachmentTab}
            onReplyToAttachmentTab={replyToAttachmentTab}
            canInviteMembers={canInviteMembers}
            roomViewer={roomViewer}
            onGroupUpdated={patchGroup}
          />
        ) : (
          <div className="flex-1 flex flex-col min-w-0 bg-chat">
            {selectedRequest ? (
              <ConnectionRequestView
                key={selectedRequest.id}
                connection={selectedRequest}
                onAccepted={handleAccepted}
                onDeclined={handleDeclined}
              />
            ) : selection?.kind === 'request' ? (
              // The selected request vanished from pendingReceived (cancelled by
              // the sender, or accepted/declined on another device). Show an
              // explicit state instead of silently dropping to the Inbox.
              <div className="flex-1 flex items-center justify-center px-6">
                <div className="text-center max-w-[20rem]">
                  <p className="text-base text-muted">This invitation is no longer pending.</p>
                  <button
                    type="button"
                    onClick={() => setSelection(null)}
                    className="mt-3 text-base text-text font-semibold hover:underline underline-offset-4"
                  >
                    Back to inbox
                  </button>
                </div>
              </div>
            ) : selectedInvite ? (
              <GroupInviteView
                key={selectedInvite.id}
                invite={selectedInvite}
                onAccepted={handleInviteAccepted}
                onDeclined={handleInviteDeclined}
              />
            ) : (
              <InboxView
                tool={workspaceTool}
                onToolChange={setWorkspaceTool}
                pinnedTools={pinnedTools}
                onTogglePin={(id) =>
                  setOpenTabs((cur) =>
                    cur.includes(`tool:${id}`) ? cur.filter((k) => k !== `tool:${id}`) : [...cur, `tool:${id}`],
                  )
                }
                workspaceName={workspace.name}
                vehicleRooms={availableVehicleRooms}
                tripRooms={tripTargetRooms}
                canAddTrip={canInviteMembers}
                onAddTrip={addTripFromWorkspace}
                onCreateVehicleRoom={() => setModal('vehicle')}
                onAddConnection={() => setModal('direct')}
                onOpenVehicleRoom={(groupId) => setSelection({ kind: 'group', id: groupId })}
              />
            )}
          </div>
        )}
      </main>

      {/* Modals */}
      {modal === 'vehicle' && (
        <CreateVehicleGroupModal onClose={() => setModal(null)} onCreated={handleCreated} />
      )}
      {modal === 'direct' && (
        <NewMessageModal onClose={() => setModal(null)} onOpenGroup={handleCreated} />
      )}
      {accountWindow && (
        <WindowShell
          key={accountWindow}
          title={ACCOUNT_WINDOW_TITLE[accountWindow]}
          size={accountWindow === 'settings' ? 'wide' : 'narrow'}
          onClose={() => setAccountWindow(null)}
        >
          {accountWindow === 'profile' ? (
            <ProfileSidebarPanel
              initialProfile={cachedProfile}
              away={away}
              onSaved={(p) => {
                setCachedProfile(p)
                void refresh()
              }}
              onPreview={() => {
                setAccountWindow(null)
                setProfileTarget({ id: user.id, name: user.displayName })
              }}
            />
          ) : accountWindow === 'company' ? (
            <CompanySidebarPanel onSaved={() => void refresh()} />
          ) : accountWindow === 'members' ? (
            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] border-t border-line px-5 pb-6">
              <div className="flex items-center justify-between gap-3 pt-3.5 pb-1">
                <h2 className="truncate text-xl font-bold tracking-[-0.01em]">{workspace.name}</h2>
                <ScopeTag scope="company" />
              </div>
              <CompanyMembersSettings />
            </div>
          ) : (
            <WorkspaceSettingsPanel />
          )}
        </WindowShell>
      )}
      {profileTarget && (
        <UserProfilePanel
          key={profileTarget.id}
          userId={profileTarget.id}
          name={profileTarget.name}
          currentUserId={user.id}
          currentWorkspaceName={workspace.name}
          onMessage={messageProfileUser}
          onClose={() => setProfileTarget(null)}
        />
      )}
    </div>
  )
}
