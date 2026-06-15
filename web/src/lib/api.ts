import type {
  CompanyProfile,
  Connection,
  ConnectionsResponse,
  DirectoryUser,
  Group,
  GroupInvite,
  GroupMember,
  GroupPendingInvitee,
  Message,
  Profile,
  WorkspaceMember,
} from './types'
import type { HerePlace, LatLng, RouteWaypoint, TruckProfile, TruckRoute } from './here/types'

// Editable subsets sent to PATCH endpoints (all fields optional).
export type ProfilePatch = Partial<{
  displayName: string
  jobTitle: string | null
  workPhone: string | null
  nativeLanguage: string | null
  otherLanguages: string[]
  availabilityStatus: Profile['availabilityStatus']
}>

export type CompanyProfilePatch = Partial<{
  name: string
  legalName: string | null
  vatId: string | null
  country: string | null
  city: string | null
  operationalAddress: string | null
  dispatchEmail: string | null
  dispatchPhone: string | null
  website: string | null
}>

// Thin typed wrapper over fetch. Every call is same-origin and carries the
// session cookie. Non-2xx responses throw ApiError with the server's machine
// -readable `error` code so callers can branch on it.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`API ${status}: ${code}`)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData manages its own multipart boundary — we must NOT send a manual
  // content-type for those requests or the boundary gets lost.
  const isForm = init?.body instanceof FormData
  const headers: HeadersInit = isForm
    ? { ...init?.headers }
    : { 'content-type': 'application/json', ...init?.headers }
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers,
    ...init,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(res.status, body.error ?? 'unknown')
  }
  // 204 / empty body tolerant
  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as T
}

// ── Groups ───────────────────────────────────────────────────────────────

export const api = {
  groups: {
    list: () => request<{ groups: Group[] }>('/groups'),

    createVehicle: (input: {
      name: string
      description?: string
      tractorPlate?: string
      trailerPlate?: string
      memberIds?: string[]
    }) =>
      request<{ group: { id: string; type: 'vehicle' } }>('/groups', {
        method: 'POST',
        body: JSON.stringify({ type: 'vehicle', ...input }),
      }),

    createDirect: (otherUserId: string) =>
      request<{ group: { id: string; type: 'direct'; existed?: boolean } }>('/groups', {
        method: 'POST',
        body: JSON.stringify({ type: 'direct', otherUserId }),
      }),

    messages: (groupId: string, before?: string) =>
      request<{ messages: Message[]; nextCursor: string | null }>(
        `/groups/${groupId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`,
      ),

    postMessage: (
      groupId: string,
      body: string,
      file?: File | null,
      replyToMessageId?: string | null,
      mentionUserIds?: string[],
    ) => {
      const mentions = mentionUserIds ?? []
      // Multipart only when there's actually a file; JSON otherwise to keep
      // the wire format and server parsing path as simple as possible.
      if (file) {
        const form = new FormData()
        form.append('body', body)
        if (replyToMessageId) form.append('replyToMessageId', replyToMessageId)
        // Form fields are strings — send the ids as a JSON string the server
        // coerces back into an array.
        if (mentions.length) form.append('mentionUserIds', JSON.stringify(mentions))
        form.append('file', file, file.name)
        return request<{ message: Message & { groupId: string } }>(
          `/groups/${groupId}/messages`,
          { method: 'POST', body: form },
        )
      }
      return request<{ message: Message & { groupId: string } }>(
        `/groups/${groupId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            body,
            ...(replyToMessageId ? { replyToMessageId } : {}),
            ...(mentions.length ? { mentionUserIds: mentions } : {}),
          }),
        },
      )
    },

    // Members of one conversation — the source for the @-mention picker and the
    // group-info members list.
    members: (groupId: string) =>
      request<{ members: GroupMember[] }>(`/groups/${groupId}/members`),

    // Change a member's GROUP role (admin | member). Server enforces the
    // manager permission and the last-admin guard. Returns the refreshed list.
    setMemberRole: (groupId: string, userId: string, role: 'admin' | 'member') =>
      request<{ members: GroupMember[] }>(`/groups/${groupId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),

    // Remove a member from a vehicle group. Server enforces the manager
    // permission and refuses to remove the last remaining admin. Returns the
    // refreshed member list so the panel can update immediately.
    removeMember: (groupId: string, userId: string) =>
      request<{ members: GroupMember[] }>(`/groups/${groupId}/members/${userId}`, {
        method: 'DELETE',
      }),

    // Pending invitees for a vehicle group (drives the invite picker's state).
    pendingInvites: (groupId: string) =>
      request<{ invites: GroupPendingInvitee[] }>(`/groups/${groupId}/invites`),

    // Invite one or more workspace users into a vehicle group. Returns the ids
    // actually invited plus per-user skip reasons (already member / invited).
    invite: (groupId: string, userIds: string[]) =>
      request<{ invited: string[]; skipped: Array<{ userId: string; reason: string }> }>(
        `/groups/${groupId}/invites`,
        { method: 'POST', body: JSON.stringify({ userIds }) },
      ),

    // Edit a vehicle group's operational details. Server enforces the manage
    // permission (group admin / workspace admin|dispatcher).
    update: (
      groupId: string,
      patch: Partial<{
        name: string
        description: string | null
        tractorPlate: string | null
        trailerPlate: string | null
      }>,
    ) =>
      request<{
        group: {
          id: string
          name: string | null
          description: string | null
          meta: Group['meta']
          hasAvatar: boolean
        }
      }>(`/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

    uploadAvatar: (groupId: string, file: File) => {
      const form = new FormData()
      form.append('file', file, file.name)
      return request<{ ok: true; hasAvatar: true }>(`/groups/${groupId}/avatar`, {
        method: 'POST',
        body: form,
      })
    },

    removeAvatar: (groupId: string) =>
      request<{ ok: true; hasAvatar: false }>(`/groups/${groupId}/avatar`, { method: 'DELETE' }),

    editMessage: (groupId: string, messageId: string, body: string) =>
      request<{ message: { id: string; groupId: string; body: string; editedAt: string } }>(
        `/groups/${groupId}/messages/${messageId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ body }),
        },
      ),

    deleteForEveryone: (groupId: string, messageId: string) =>
      request<{
        ok: true
        message: { id: string; groupId: string; deletedAt: string; deletedBy: string }
      }>(`/groups/${groupId}/messages/${messageId}/delete-for-everyone`, {
        method: 'POST',
      }),

    deleteForMe: (groupId: string, messageId: string) =>
      request<{ ok: true }>(`/groups/${groupId}/messages/${messageId}/delete-for-me`, {
        method: 'POST',
      }),

    // Pinned messages are group-wide; any member can pin/unpin.
    pins: (groupId: string) =>
      request<{ messages: Message[] }>(`/groups/${groupId}/pins`),

    pin: (groupId: string, messageId: string) =>
      request<{ message: Message & { groupId: string } }>(
        `/groups/${groupId}/messages/${messageId}/pin`,
        { method: 'POST' },
      ),

    unpin: (groupId: string, messageId: string) =>
      request<{ ok: true; id: string }>(
        `/groups/${groupId}/messages/${messageId}/unpin`,
        { method: 'POST' },
      ),

    forwardMessage: (fromGroupId: string, messageId: string, toGroupId: string) =>
      request<{ message: Message & { groupId: string } }>(
        `/groups/${fromGroupId}/messages/${messageId}/forward`,
        { method: 'POST', body: JSON.stringify({ toGroupId }) },
      ),

    markRead: (groupId: string, upTo?: string) =>
      request<{ ok: true; lastReadAt: string }>(`/groups/${groupId}/read`, {
        method: 'POST',
        body: JSON.stringify(upTo ? { upTo } : {}),
      }),
  },

  workspace: {
    members: () => request<{ members: WorkspaceMember[] }>('/workspace/members'),
  },

  profile: {
    get: () => request<{ profile: Profile }>('/profile'),
    update: (patch: ProfilePatch) =>
      request<{ profile: Profile }>('/profile', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    uploadAvatar: (file: File) => {
      const form = new FormData()
      form.append('file', file, file.name)
      return request<{ profile: Profile }>('/profile/avatar', { method: 'POST', body: form })
    },
    removeAvatar: () => request<{ profile: Profile }>('/profile/avatar', { method: 'DELETE' }),
  },

  company: {
    get: () => request<{ company: CompanyProfile }>('/company-profile'),
    update: (patch: CompanyProfilePatch) =>
      request<{ company: CompanyProfile }>('/company-profile', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    uploadLogo: (file: File) => {
      const form = new FormData()
      form.append('file', file, file.name)
      return request<{ company: CompanyProfile }>('/company-profile/logo', {
        method: 'POST',
        body: form,
      })
    },
    removeLogo: () => request<{ company: CompanyProfile }>('/company-profile/logo', { method: 'DELETE' }),
  },

  directory: {
    searchUsers: (q: string) =>
      request<{ users: DirectoryUser[] }>(`/directory/users?q=${encodeURIComponent(q)}`),
  },

  connections: {
    list: () => request<ConnectionsResponse>('/connections'),

    request: (toUserId: string, message?: string) =>
      request<{ connection: Connection }>('/connections/request', {
        method: 'POST',
        body: JSON.stringify({ toUserId, message }),
      }),

    accept: (id: string) =>
      request<{ ok: true }>(`/connections/${id}/accept`, { method: 'POST' }),

    decline: (id: string) =>
      request<{ ok: true }>(`/connections/${id}/decline`, { method: 'POST' }),
  },

  // Vehicle-group invitations (intra-workspace). Separate from connections.
  groupInvites: {
    list: () => request<{ invites: GroupInvite[] }>('/group-invites'),

    accept: (id: string) =>
      request<{ ok: true; groupId: string }>(`/group-invites/${id}/accept`, { method: 'POST' }),

    decline: (id: string) =>
      request<{ ok: true }>(`/group-invites/${id}/decline`, { method: 'POST' }),

    cancel: (id: string) =>
      request<{ ok: true }>(`/group-invites/${id}/cancel`, { method: 'POST' }),
  },

  // HERE maps/routing — all proxied through our server so the HERE key stays
  // server-side. The map-render key is fetched from `config` (auth-gated).
  here: {
    // The HERE Maps JS API key, for the browser-rendered map. Auth-gated;
    // throws ApiError('here_not_configured') when HERE_API_KEY is unset.
    config: () => request<{ apiKey: string }>('/here/config'),

    // Address/location autocomplete (HERE Discover). Returns [] for queries
    // shorter than 3 chars (the server short-circuits those).
    search: (q: string) =>
      request<{ items: HerePlace[] }>(`/here/search?q=${encodeURIComponent(q)}`),

    // Reverse geocode a clicked/dragged coordinate to a label + road-snapped
    // position (HERE Reverse Geocode). `place` is null when HERE has no result.
    // `zoom` (current map zoom) biases the snap toward major roads when zoomed
    // out; `major` flags that the chosen road looks like a highway/trunk road.
    revgeocode: (lat: number, lng: number, zoom?: number) =>
      request<{ place: { label: string; position: LatLng; major?: boolean } | null }>(
        `/here/revgeocode?at=${lat},${lng}${zoom !== undefined ? `&zoom=${zoom}` : ''}`,
      ),

    // Truck route (HERE Routing v8, transportMode=truck). `via` is the ordered
    // list of intermediate stops between origin and destination; each waypoint
    // may carry a `course` (desired travel heading) so HERE snaps to the correct
    // carriageway/direction. `truck` refines it with the entered profile (omit a
    // field to skip it).
    truckRoute: (input: {
      origin: RouteWaypoint
      destination: RouteWaypoint
      via?: RouteWaypoint[]
      truck?: TruckProfile
    }) =>
      request<{ route: TruckRoute }>('/here/routes/truck', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },
}
