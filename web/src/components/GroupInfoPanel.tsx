import { useCallback, useEffect, useState } from 'react'
import type { Group, GroupMember, GroupPendingInvitee } from '../lib/types'
import { useTravellingMarker } from './useTravellingMarker'
import { groupLabel, tractorPlate, trailerPlate } from '../lib/types'
import {
  getOps,
  vehicleDriverIds,
  type ActiveTrip,
  type VehicleInfo,
  type VehicleOps,
  type VehicleStop,
} from '../lib/vehicleOps'
import { api, ApiError } from '../lib/api'
import { persistOpsWithRoute, persistTripRoute } from '../lib/tripRoute'
import { getSocket } from '../lib/socket'
import { avatarUrl, clearAvatarCache } from '../lib/avatarCache'
import { usePresence } from '../hooks/usePresence'
import { Camera, Truck } from 'lucide-react'
import { usePhotoEditor, type PhotoEditor } from './AvatarPhotoEditor'
import { PanelCloseHeader } from './settings/panelChrome'
import { PANEL_SURFACE, ProfileHero } from './settings/profileChrome'
import { RowMeta } from '../pages/sidebarBits'
import AvatarCropModal from './settings/AvatarCropModal'
import VehicleStatusSelect from './vehicle/VehicleStatusSelect'
import VehicleInfoTab from './vehicle/VehicleInfoTab'
import TripTab from './vehicle/TripTab'
import MembersTab from './vehicle/MembersTab'

// The operational tabs in the vehicle-room info panel. Stops are managed inside
// the Trip tab (no separate Stops tab) so there's a single place to manage a
// trip and its stops. The ids are the ones ChatView deep-links with; the labels
// were renamed in the 2026-10-12 rework (Info → Vehicle, Members → Crew) and
// the Docs tab, a disabled placeholder, was dropped — transport documents
// belong to a trip, so they will land with the Trip panel when they exist.
export type PanelTab = 'info' | 'trip' | 'members'
const PANEL_TABS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: 'info', label: 'Vehicle' },
  { id: 'trip', label: 'Trip' },
  { id: 'members', label: 'Crew' },
]

type Props = {
  group: Group
  currentUserId: string
  members: GroupMember[]
  membersLoading: boolean
  // Whether the caller may edit details / invite, and (stricter) change member
  // roles / remove members. Computed by ChatView from lib/roomPermissions; the
  // server re-enforces the full rule, these only gate the controls' visibility.
  canManage: boolean
  canManageRoles: boolean
  onClose: () => void
  // Open the shared invite picker (owned by ChatView so it can sit above chat).
  onInvite: () => void
  // Refetch the members list after a role change so badges/menus update live.
  onMembersChanged: () => void
  // Open (or reuse) a 1:1 DM with a member — used by the "Send private message"
  // member action. Reuses the parent's existing direct-message creation flow;
  // throws an ApiError (e.g. `connection_required`) the panel surfaces inline.
  onMessageMember: (member: GroupMember) => Promise<void>
  // Open the read-only user-details panel for a member (avatar click in the
  // Members tab). Owned by ChatView so it overlays this panel.
  onOpenProfile: (member: GroupMember) => void
  // Patch the parent group after a details edit so the header reflects it live.
  onGroupUpdated: (partial: Partial<Group>) => void
  // Open the read-only trip route map tool (owned by ChatView, shown in the chat
  // body). Undefined when the active trip isn't routable (no/too-few coordinates)
  // — the Trip tab's "Edit route" control is hidden in that case.
  onOpenRouteMap?: () => void
  // Open the shared full Add trip editor owned by ChatView.
  onAddTrip: () => void
  // Which tab to open on mount (e.g. the header trip bar opens straight to 'trip').
  // Defaults to 'info'.
  initialTab?: PanelTab
  // The viewer's company — a crew member from another one is named in the row.
  viewerWorkspace?: string | null
}

// Right-side panel with a vehicle group's operational details and membership.
// Native to the chat UI (same rail background/border/spacing as the workspace
// sidebar), not a browser modal. On desktop (xl+) it's a real in-flow column
// beside the chat, so the conversation reflows narrower and stays fully usable;
// below xl it falls back to an overlay drawer with a transparent click-away.
//
// Reads as clean information by default — each detail is a label/value row, not
// a form box. Managers (admins / dispatchers) edit fields INDIVIDUALLY: each row
// has its own pencil → inline input → Save/Cancel, so changes are made one field
// at a time. The identity hero is a GENERATED vehicle icon (the same slot as the
// header/sidebar) — vehicle rooms have no uploaded/custom image, so there is no
// image upload/crop/remove UI here.
export default function GroupInfoPanel({
  group,
  currentUserId,
  members,
  membersLoading,
  canManage,
  canManageRoles,
  onClose,
  onInvite,
  onMembersChanged,
  onMessageMember,
  onOpenProfile,
  onGroupUpdated,
  onOpenRouteMap,
  onAddTrip,
  initialTab = 'info',
  viewerWorkspace,
}: Props) {
  const [error, setError] = useState<string | null>(null)
  // The member whose role is currently being changed (drives the row spinner).
  const [roleBusyId, setRoleBusyId] = useState<string | null>(null)
  // Active operational tab (Info / Trip / Stops / Docs / Members). Seeded from
  // initialTab so the header trip bar can deep-link straight to the Trip tab.
  const [tab, setTab] = useState<PanelTab>(initialTab)
  // The picked vehicle image awaiting crop confirmation (no upload until the
  // crop is confirmed). `onGroupUpdated({ hasAvatar, avatarVersion })` flows
  // the new image to this hero, the header and the sidebar slots at once — a
  // new version is a new URL, so nothing shows the old picture.
  const [cropFile, setCropFile] = useState<File | null>(null)

  // Confirm from the crop modal: upload the cropped square, then refresh. Must
  // THROW on failure so the crop modal surfaces a retryable error and stays open.
  async function uploadCroppedAvatar(cropped: File) {
    const { avatarVersion } = await api.groups.uploadAvatar(group.id, cropped)
    clearAvatarCache('group', group.id)
    onGroupUpdated({ hasAvatar: true, avatarVersion })
    setCropFile(null)
  }

  async function removeGroupAvatar() {
    setError(null)
    try {
      await api.groups.removeAvatar(group.id)
      clearAvatarCache('group', group.id)
      onGroupUpdated({ hasAvatar: false, avatarVersion: null })
    } catch {
      setError('Could not remove the image.')
    }
  }

  // Operational data, read off the group's meta (server-backed; re-derives each
  // render once a save flows the updated meta back through onGroupUpdated).
  const ops = getOps(group)

  // How many group admins exist — used to block demoting the last one.
  const adminCount = members.filter((m) => m.role === 'admin').length

  // Live online/offline presence — the SAME global socket source the sidebar DM
  // dots use, so both reflect the same state at the same time. A member's
  // availability colour shows only while they're online; offline members get the
  // dim grey dot. This updates live while the panel is open (no refresh), and
  // re-subscribes cleanly when the panel closes or the group changes (the hook
  // unsubscribes on unmount; GroupInfoPanel mounts per open/per group).
  const { online } = usePresence()

  // The identity's two quiet lines: the plates, then what the truck is and how
  // many people are in the room. RowMeta drops whichever segment is empty.
  const plates = [tractorPlate(group), trailerPlate(group)]
  const kind = [
    ops.vehicle.vehicleType,
    ops.vehicle.trailerType,
    `${members.length} member${members.length === 1 ? '' : 's'}`,
  ]

  async function setMemberRole(targetId: string, role: 'admin' | 'member') {
    setRoleBusyId(targetId)
    setError(null)
    try {
      await api.groups.setMemberRole(group.id, targetId, role)
      // Refetch in the parent → updated members flow back down as props. The
      // server also broadcasts group:members_changed for other open clients.
      onMembersChanged()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'last_admin') {
        setError('A group must keep at least one admin.')
      } else {
        setError(role === 'admin' ? 'Could not make admin.' : 'Could not remove admin.')
      }
    } finally {
      setRoleBusyId(null)
    }
  }

  async function removeMember(targetId: string) {
    setRoleBusyId(targetId)
    setError(null)
    try {
      await api.groups.removeMember(group.id, targetId)
      // Same flow as a role change — refetch in the parent so the updated
      // roster flows back down; the server also broadcasts members_changed.
      onMembersChanged()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'last_admin') {
        setError('A group must keep at least one admin.')
      } else {
        setError('Could not remove this member.')
      }
    } finally {
      setRoleBusyId(null)
    }
  }

  // "Send private message" — reuse the parent's DM creation/navigation flow.
  // A missing cross-workspace connection surfaces as a themed inline error.
  async function messageMember(target: GroupMember) {
    setError(null)
    try {
      await onMessageMember(target)
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'connection_required'
          ? 'Connect with this person before messaging.'
          : 'Could not open a private conversation.',
      )
    }
  }

  // Pending invites — only loadable by manage-capable callers (the endpoint
  // 403s otherwise), so we fetch only when canManage.
  const [pending, setPending] = useState<GroupPendingInvitee[]>([])
  const [pendingLoading, setPendingLoading] = useState(canManage)

  // Esc closes the drawer (matches the rest of the app's overlays).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Load pending invites (manage-capable only).
  useEffect(() => {
    if (!canManage) return
    let cancelled = false
    setPendingLoading(true)
    api.groups
      .pendingInvites(group.id)
      .then((r) => {
        if (!cancelled) setPending(r.invites)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPendingLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [group.id, canManage])

  // Silent refetch (no spinner flash) for the live socket refresh below.
  const refetchPending = useCallback(() => {
    if (!canManage) return
    api.groups
      .pendingInvites(group.id)
      .then((r) => setPending(r.invites))
      .catch(() => {})
  }, [group.id, canManage])

  // Live: the group's invite set changed (a new invite was sent, or one was
  // accepted / declined / cancelled — here or on another client). The server
  // emits `group:invites_changed` to the group room, so refresh the pending
  // list and it never goes stale while the panel is open. Scoped to THIS group;
  // the listener is removed on unmount / group change (no leak). New MEMBERS flow
  // in separately via the parent's `group:members_changed` refetch (props).
  useEffect(() => {
    if (!canManage) return
    const socket = getSocket()
    function onInvitesChanged(p: { groupId: string }) {
      if (p.groupId === group.id) refetchPending()
    }
    socket.on('group:invites_changed', onInvitesChanged)
    return () => {
      socket.off('group:invites_changed', onInvitesChanged)
    }
  }, [group.id, canManage, refetchPending])

  // Persist one detail field. Throws on failure so the row keeps its editor
  // open and shows a retryable error.
  async function saveField(
    patch: Partial<{ name: string; description: string | null; tractorPlate: string | null; trailerPlate: string | null }>,
  ) {
    const { group: updated } = await api.groups.update(group.id, patch)
    onGroupUpdated({ name: updated.name, description: updated.description, meta: updated.meta })
  }

  // Persist the whole operational blob, then flow the updated meta back up so
  // `ops` re-derives on the next render (single source of truth = the group's
  // server-backed meta; no separate local copy that could drift). Throws on
  // failure so the calling control surfaces a retryable error.
  async function saveOps(next: VehicleOps, options?: { driverAssignmentEdited?: boolean }) {
    const { group: updated } = await api.groups.update(group.id, {
      ops: next,
      ...(options?.driverAssignmentEdited ? { driverAssignmentEdited: true } : {}),
    })
    onGroupUpdated({ meta: updated.meta })
  }
  // Focused helpers so each tab patches just its slice. Spreading an `undefined`
  // value drops the key when JSON-serialised, so clearing a field removes it.
  const saveVehicle = (patch: Partial<VehicleInfo>) =>
    saveOps({ ...ops, vehicle: { ...ops.vehicle, ...patch } })
  const saveTrip = (patch: Partial<ActiveTrip>) =>
    saveOps({ ...ops, trip: { ...(ops.trip ?? {}), ...patch } })
  // Driver assignment belongs to the vehicle room, not to one trip, so it
  // survives trip replacement/clearing until a manager changes it manually.
  const saveDrivers = (ids: string[]) =>
    saveOps(
      {
        ...ops,
        vehicle: { ...ops.vehicle, assignedDriverIds: ids },
        trip: ops.trip ? { ...ops.trip, assignedDriverIds: undefined } : null,
      },
      { driverAssignmentEdited: true },
    )
  // Clearing a trip also drops its stops — they belong to the trip, so leaving
  // them behind would resurface on the next trip as stale data.
  const clearTrip = () => saveOps({ ...ops, trip: null, stops: [] })
  // Stops carry the coordinates the route is built from, so persist + recompute
  // the route (in the background) whenever they change.
  const saveStops = (stops: VehicleStop[]) =>
    persistOpsWithRoute(group.id, { ...ops, stops }, (meta) => onGroupUpdated({ meta }))
  // Explicit "Calculate route" — a foreground recompute from the current stops,
  // saved without the edit flag (a first calculation is quiet, no activity row).
  const calculateRoute = async () => {
    await persistTripRoute(group.id, ops, (meta) => onGroupUpdated({ meta }))
  }
  // Explicit "Edit route" — open the map tool, then recompute + save flagged as a
  // deliberate edit so the server logs "Route was edited" when the route changed.
  const editRoute = async () => {
    onOpenRouteMap?.()
    await persistTripRoute(group.id, ops, (meta) => onGroupUpdated({ meta }), { flagAsEdit: true })
  }

  async function cancelInvite(inviteId: string) {
    const prev = pending
    setPending((p) => p.filter((i) => i.id !== inviteId))
    try {
      await api.groupInvites.cancel(inviteId)
    } catch {
      setPending(prev)
      setError('Could not cancel the invite.')
    }
  }

  // The vehicle photo's viewing + management, for the hero's two slots.
  const editor = usePhotoEditor({
    hasImage: Boolean(group.hasAvatar),
    canEdit: canManage,
    noun: 'vehicle photo',
    viewSrc: group.hasAvatar ? avatarUrl('group', group.id, group.avatarVersion) : undefined,
    viewTitle: groupLabel(group),
    onFile: (file) => {
      setError(null)
      setCropFile(file)
    },
    onRemove: removeGroupAvatar,
    onError: setError,
  })

  return (
    <>
      {/* Click-away — only as an overlay drawer on narrow screens (< xl). On
          desktop the panel is a real in-flow column, so there's no backdrop and
          the chat behind it stays fully clickable. */}
      <div className="fixed inset-0 z-40 xl:hidden" onClick={onClose} aria-hidden />

      <aside
        role="dialog"
        aria-label="Group info"
        // Narrow screens: a fixed right-edge drawer (overlay) up to full width.
        // xl+ : a static, in-flow right column that sits beside the chat as its
        // own borderless surface — same rail bg + radius as the sidebar/chat
        // cards, with a gap from the chat (the row's xl:gap-3) — so the chat
        // reflows narrower and the panel matches the app's flat card shell.
        className={`panel-fade-in fixed top-0 right-0 bottom-0 z-40 w-full max-w-[25rem] shadow-drawer ${PANEL_SURFACE} flex flex-col
                   xl:static xl:z-auto xl:w-[clamp(22.5rem,26vw,26.25rem)] xl:max-w-none xl:shrink-0 xl:shadow-none
                   xl:rounded-panel xl:overflow-hidden`}
      >
        <PanelCloseHeader title="Group info" onClose={onClose} closeLabel="Close group info" />

        <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable] px-4 pt-4 pb-8">
          {/* Identity. With a vehicle photo it is the banner every profile
              surface uses (managers change/remove it via the pinned pencil; the
              banner opens the photo). Without one — most trucks — the banner
              was 400px of empty gradient, so it is a compact tile + name, and
              the tile is where a manager adds the first photo. */}
          {group.hasAvatar ? (
            <ProfileHero
              photo={{
                src: avatarUrl('group', group.id, group.avatarVersion),
                alt: `${groupLabel(group)} vehicle photo`,
              }}
              fallback={<Truck size="4.5rem" strokeWidth={1.4} />}
              onPhotoClick={editor.openPreview}
              overlay={editor.optionsButton}
              title={groupLabel(group)}
              subtitle={<RowMeta segments={plates} whole />}
              meta={<RowMeta segments={kind} whole />}
              error={error}
            />
          ) : (
            <VehicleIdentity
              name={groupLabel(group)}
              plates={plates}
              kind={kind}
              editor={editor}
              error={error}
            />
          )}

          {editor.chrome}

          <div className="px-1">
            {/* The manual vehicle status — always visible, above the tabs,
                because it is the field a dispatcher changes most. */}
            <div className="border-t border-line pt-4 pb-5">
              <VehicleStatusSelect
                value={ops.vehicle.status}
                editable={canManage}
                onSave={(status) => saveVehicle({ status })}
              />
            </div>

            {/* Tab bar — compact segmented control for the operational sections. */}
            <PanelTabs value={tab} onChange={setTab} crewCount={members.length} />

            {tab === 'info' && (
              <VehicleInfoTab
                group={group}
                canManage={canManage}
                vehicle={ops.vehicle}
                onSaveField={saveField}
                onSaveVehicle={saveVehicle}
              />
            )}
            {tab === 'trip' && (
              <div className="pt-4">
              <TripTab
                trip={ops.trip}
                stops={ops.stops}
                canManage={canManage}
                onSaveTrip={saveTrip}
                onAddTrip={onAddTrip}
                onClearTrip={clearTrip}
                onSaveStops={saveStops}
                onCalculateRoute={calculateRoute}
                onEditRoute={onOpenRouteMap ? editRoute : undefined}
              />
              </div>
            )}
            {tab === 'members' && (
              <MembersTab
                members={members}
                membersLoading={membersLoading}
                currentUserId={currentUserId}
                viewerWorkspace={viewerWorkspace}
                canManage={canManage}
                canManageRoles={canManageRoles}
                adminCount={adminCount}
                roleBusyId={roleBusyId}
                online={online}
                error={error}
                assignedDriverIds={vehicleDriverIds(ops)}
                pending={pending}
                pendingLoading={pendingLoading}
                onInvite={onInvite}
                onSetRole={setMemberRole}
                onRemove={removeMember}
                onMessage={messageMember}
                onOpenProfile={onOpenProfile}
                onCancelInvite={cancelInvite}
                onSaveDrivers={saveDrivers}
              />
            )}
          </div>
        </div>
      </aside>

      {/* Crop step — reuses the same WhatsApp-style cropper as profile photos.
          It uploads on confirm and rejects on failure so the modal can retry. */}
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


// The panel's section switcher (Info / Trip / Docs / Members).
//
// ONE PILL THAT TRAVELS, not a background that blinks on and off per button.
// The selection used to be a `bg-white/8` wash applied to whichever button was
// active, so switching tabs meant a shape vanishing in one place and appearing
// in another — two events for what is one selection moving. Here the pill is a
// single element measured onto the active button and moved with a transform, so
// the eye follows it across instead of re-finding it.
//
// The fill is `bg-text` over `text-bg`: near-white with black labels on the dark
// theme, and the exact inverse on the light one. That is the app's existing
// filled-control idiom — the composer's send button and the rail's unread badge
// are the same pair — and it is deliberately the loudest thing in the panel,
// because it answers the only question this bar exists to answer.
//
// The position is read off `aria-current`, which the buttons already publish, so
// the pill and the accessibility tree can never disagree about which tab is on.
function PanelTabs({
  value,
  onChange,
  crewCount,
}: {
  value: PanelTab
  onChange: (tab: PanelTab) => void
  /** Drawn after the Crew label, quieter than it. */
  crewCount: number
}) {
  // Shared with the rail's filter bar, the Settings segmented control and the
  // conversation bar — see components/useTravellingMarker.
  const { trackRef, rect } = useTravellingMarker(value)

  return (
    <div
      ref={trackRef}
      className="relative flex items-center gap-0.5 rounded-card bg-white/4 p-0.5"
    >
      {rect && (
        <span
          aria-hidden
          // Mounted only once a position is known, which is what keeps the first
          // paint still: a transition has no previous value to run from on the
          // frame an element is inserted, so the pill appears under the live tab
          // and only travels on later changes.
          className="travelling-marker pointer-events-none absolute left-0 top-0 rounded-btn bg-text motion-reduce:transition-none"
          style={{
            width: rect.w,
            height: rect.h,
            transform: `translate(${rect.x}px, ${rect.y}px)`,
          }}
        />
      )}
      {PANEL_TABS.map((t) => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-current={active ? 'true' : undefined}
            // `relative` so the label sits ON the pill rather than under it.
            className={`relative z-10 flex flex-1 h-8 items-center justify-center gap-1.5 rounded-btn text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
              active ? 'text-bg' : 'text-muted hover:text-text'
            }`}
          >
            {t.label}
            {t.id === 'members' && <span className="font-medium opacity-60 tabular-nums">{crewCount}</span>}
          </button>
        )
      })}
    </div>
  )
}

// The compact identity for a vehicle room with no photo: the truck tile (a
// manager's way to add the first photo, marked by a camera badge), the room
// name, the plates, then what the truck is and how many people are in the room.
function VehicleIdentity({
  name,
  plates,
  kind,
  editor,
  error,
}: {
  name: string
  plates: (string | undefined)[]
  kind: (string | undefined)[]
  editor: PhotoEditor
  error: string | null
}) {
  const glyph = <Truck size="1.625rem" strokeWidth={1.6} />
  return (
    <div className="px-1 pt-1 pb-5">
      <div className="flex items-center gap-4">
        {editor.pickFile ? (
          <button
            type="button"
            onClick={editor.pickFile}
            aria-label="Add a vehicle photo"
            title="Add a vehicle photo"
            className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-tile border border-line bg-white/4 text-muted transition-colors hover:border-line-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            {glyph}
            <span className="absolute -bottom-[0.4375rem] -right-[0.4375rem] flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-btn border-2 border-panel bg-line text-text">
              <Camera size="0.6875rem" strokeWidth={2.2} />
            </span>
          </button>
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-tile border border-line bg-white/4 text-muted">
            {glyph}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-bold tracking-[-0.02em]">{name}</h2>
          <div className="mt-1 text-base text-text/80">
            <RowMeta segments={plates} whole />
          </div>
          <div className="mt-0.5 text-base text-muted">
            <RowMeta segments={kind} whole />
          </div>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-alert leading-[1.4]">{error}</p>}
    </div>
  )
}
