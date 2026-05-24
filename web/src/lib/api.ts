import type {
  Connection,
  ConnectionsResponse,
  DirectoryUser,
  Group,
  Message,
  WorkspaceMember,
} from './types'

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
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
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
      plate?: string
      trip?: string
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

    postMessage: (groupId: string, body: string) =>
      request<{ message: Message & { groupId: string } }>(`/groups/${groupId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),

    markRead: (groupId: string, upTo?: string) =>
      request<{ ok: true; lastReadAt: string }>(`/groups/${groupId}/read`, {
        method: 'POST',
        body: JSON.stringify(upTo ? { upTo } : {}),
      }),
  },

  workspace: {
    members: () => request<{ members: WorkspaceMember[] }>('/workspace/members'),
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
}
