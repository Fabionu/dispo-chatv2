import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Group, GroupMember, GroupPendingInvitee } from '../lib/types'
import { groupLabel, tractorPlate, trailerPlate } from '../lib/types'
import {
  getOps,
  labelOf,
  vehicleStatusTone,
  VEHICLE_STATUSES,
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
import GroupAvatar from './GroupAvatar'
import AvatarPhotoEditor from './AvatarPhotoEditor'
import { ICON_ACTION_BASE, ICON_ACTION_IDLE } from './HeaderIconButton'
import AvatarCropModal from './settings/AvatarCropModal'
import { StatusChip } from './vehicle/opsControls'
import VehicleInfoTab from './vehicle/VehicleInfoTab'
import TripTab from './vehicle/TripTab'
import DocumentsTab from './vehicle/DocumentsTab'
import MembersTab from './vehicle/MembersTab'

// The operational tabs in the vehicle-room info panel. Stops are managed inside
// the Trip tab (no separate Stops tab) so there's a single place to manage a
// trip and its stops.
type PanelTab = 'info' | 'trip' | 'docs' | 'members'
const PANEL_TABS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: 'info', label: 'Info' },
  { id: 'trip', label: 'Trip' },
  { id: 'docs', label: 'Docs' },
  { id: 'members', label: 'Members' },
]

type Props = {
  group: Group
  currentUserId: string
  members: GroupMember[]
  membersLoading: boolean
  // Whether the caller may edit details / invite. The server re-enforces the
  // full rule; this only gates the controls' visibility.
  canManage: boolean
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
  onClose,
  onInvite,
  onMembersChanged,
  onMessageMember,
  onOpenProfile,
  onGroupUpdated,
  onOpenRouteMap,
}: Props) {
  const [error, setError] = useState<string | null>(null)
  // The member whose role is currently being changed (drives the row spinner).
  const [roleBusyId, setRoleBusyId] = useState<string | null>(null)
  // Active operational tab (Info / Trip / Stops / Docs / Members).
  const [tab, setTab] = useState<PanelTab>('info')
  // The picked vehicle image awaiting crop confirmation (no upload until the
  // crop is confirmed). Local version busts the image cache after a change so
  // the hero updates instantly; `onGroupUpdated({ hasAvatar })` flows the new
  // state to the header + sidebar slots.
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [avatarVersion, setAvatarVersion] = useState(0)

  // Confirm from the crop modal: upload the cropped square, then refresh. Must
  // THROW on failure so the crop modal surfaces a retryable error and stays open.
  async function uploadCroppedAvatar(cropped: File) {
    await api.groups.uploadAvatar(group.id, cropped)
    clearAvatarCache('group', group.id)
    setAvatarVersion((v) => v + 1)
    onGroupUpdated({ hasAvatar: true })
    setCropFile(null)
  }

  async function removeGroupAvatar() {
    setError(null)
    try {
      await api.groups.removeAvatar(group.id)
      clearAvatarCache('group', group.id)
      setAvatarVersion((v) => v + 1)
      onGroupUpdated({ hasAvatar: false })
    } catch {
      setError('Could not remove the image.')
    }
  }

  // Operational data, read off the group's meta (server-backed; re-derives each
  // render once a save flows the updated meta back through onGroupUpdated).
  const ops = getOps(group)

  // Group role vs workspace role: managing GROUP roles needs the caller to be a
  // GROUP admin or a WORKSPACE admin (stricter than inviting — dispatchers can
  // invite but not promote). Resolved from the caller's own member row.
  const me = members.find((m) => m.id === currentUserId)
  const canManageRoles = me?.role === 'admin' || me?.userRole === 'admin'
  // How many group admins exist — used to block demoting the last one.
  const adminCount = members.filter((m) => m.role === 'admin').length

  // Live online/offline presence — the SAME global socket source the sidebar DM
  // dots use, so both reflect the same state at the same time. A member's
  // availability colour shows only while they're online; offline members get the
  // dim grey dot. This updates live while the panel is open (no refresh), and
  // re-subscribes cleanly when the panel closes or the group changes (the hook
  // unsubscribes on unmount; GroupInfoPanel mounts per open/per group).
  const { online } = usePresence()

  // Compact vehicle line under the member count: "Tractor … · Trailer …",
  // dropping whichever plate isn't set (empty when neither exists).
  const vehicleMeta = [
    tractorPlate(group) && `Tractor ${tractorPlate(group)}`,
    trailerPlate(group) && `Trailer ${trailerPlate(group)}`,
  ]
    .filter(Boolean)
    .join(' · ')

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
  async function saveOps(next: VehicleOps) {
    const { group: updated } = await api.groups.update(group.id, { ops: next })
    onGroupUpdated({ meta: updated.meta })
  }
  // Focused helpers so each tab patches just its slice. Spreading an `undefined`
  // value drops the key when JSON-serialised, so clearing a field removes it.
  const saveVehicle = (patch: Partial<VehicleInfo>) =>
    saveOps({ ...ops, vehicle: { ...ops.vehicle, ...patch } })
  const saveTrip = (patch: Partial<ActiveTrip>) =>
    saveOps({ ...ops, trip: { ...(ops.trip ?? {}), ...patch } })
  // Start a brand-new, CLEAN trip: a fresh Planned trip with NO carried-over
  // fields and NO stops (stops belong to the trip, so a new trip starts empty).
  const addTrip = () => saveOps({ ...ops, trip: { status: 'planned' }, stops: [] })
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
        className="fixed top-0 right-0 bottom-0 z-40 w-full max-w-[25rem] shadow-[-16px_0_48px_rgba(0,0,0,0.4)] bg-rail flex flex-col
                   xl:static xl:z-auto xl:w-[clamp(22.5rem,26vw,26.25rem)] xl:max-w-none xl:shrink-0 xl:shadow-none
                   xl:rounded-panel xl:overflow-hidden"
      >
        {/* Header — same height as the chat header so the two line up. */}
        <div className="h-[var(--header-height)] flex items-center justify-between px-4 shrink-0">
          <span className="text-[0.8125rem] font-semibold">Group info</span>
          <button
            onClick={onClose}
            aria-label="Close group info"
            className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE} shrink-0`}
          >
            <X size="1.125rem" strokeWidth={1.8} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Identity — the vehicle image is the hero (uploaded photo, or the
              generated multi-user glyph as a fallback), in the same circular slot
              as the header/sidebar. Managers change/remove it via the image
              overlay + the "More" menu (top-right); no form-style buttons. The
              manual vehicle status (when set) shows as a chip below. */}
          <div className="relative flex flex-col items-center text-center pt-1">
            <AvatarPhotoEditor
              size={120}
              hasImage={Boolean(group.hasAvatar)}
              canEdit={canManage}
              noun="vehicle photo"
              viewSrc={group.hasAvatar ? avatarUrl('group', group.id, avatarVersion) : undefined}
              viewTitle={groupLabel(group)}
              onFile={(file) => {
                setError(null)
                setCropFile(file)
              }}
              onRemove={removeGroupAvatar}
              onError={setError}
            >
              <GroupAvatar
                groupId={group.id}
                hasAvatar={Boolean(group.hasAvatar)}
                version={avatarVersion}
                size={120}
              />
            </AvatarPhotoEditor>
            <div className="mt-3 text-[1rem] font-semibold tracking-[-0.2px]">
              {groupLabel(group)}
            </div>
            <div className="mt-0.5 text-[0.75rem] text-muted">
              {members.length} member{members.length === 1 ? '' : 's'}
            </div>
            {vehicleMeta && (
              <div className="mt-1 text-[0.71875rem] text-faint">{vehicleMeta}</div>
            )}
            {ops.vehicle.status && (
              <div className="mt-2">
                <StatusChip
                  tone={vehicleStatusTone(ops.vehicle.status)}
                  label={labelOf(VEHICLE_STATUSES, ops.vehicle.status)}
                />
              </div>
            )}
            {error && <div className="text-[0.71875rem] text-alert mt-2">{error}</div>}
          </div>

          {/* Tab bar — compact segmented control for the operational sections. */}
          <div className="mt-4 flex items-center gap-0.5 rounded-card bg-white/[0.03] p-0.5">
            {PANEL_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'true' : undefined}
                className={`flex-1 h-7 rounded-btn text-[0.71875rem] font-medium transition-colors ${
                  tab === t.id ? 'bg-white/[0.08] text-text' : 'text-muted hover:text-text'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-4">
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
              <TripTab
                trip={ops.trip}
                stops={ops.stops}
                canManage={canManage}
                onSaveTrip={saveTrip}
                onAddTrip={addTrip}
                onClearTrip={clearTrip}
                onSaveStops={saveStops}
                onCalculateRoute={calculateRoute}
                onEditRoute={onOpenRouteMap ? editRoute : undefined}
              />
            )}
            {tab === 'docs' && <DocumentsTab />}
            {tab === 'members' && (
              <MembersTab
                members={members}
                membersLoading={membersLoading}
                currentUserId={currentUserId}
                canManage={canManage}
                canManageRoles={canManageRoles}
                adminCount={adminCount}
                roleBusyId={roleBusyId}
                online={online}
                error={error}
                pending={pending}
                pendingLoading={pendingLoading}
                onInvite={onInvite}
                onSetRole={setMemberRole}
                onRemove={removeMember}
                onMessage={messageMember}
                onOpenProfile={onOpenProfile}
                onCancelInvite={cancelInvite}
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
