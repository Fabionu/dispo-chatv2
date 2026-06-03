type AvatarKind = 'user' | 'group'

const loaded = new Set<string>()
const failed = new Set<string>()
const inflight = new Map<string, Promise<boolean>>()

function key(kind: AvatarKind, id: string, version?: number | string): string {
  return `${kind}:${id}:${version ?? ''}`
}

export function avatarUrl(kind: AvatarKind, id: string, version?: number | string): string {
  const base = kind === 'user' ? `/api/users/${id}/avatar` : `/api/groups/${id}/avatar`
  return `${base}${version != null ? `?v=${version}` : ''}`
}

export function isAvatarLoaded(kind: AvatarKind, id: string, version?: number | string): boolean {
  return loaded.has(key(kind, id, version))
}

export function isAvatarFailed(kind: AvatarKind, id: string, version?: number | string): boolean {
  return failed.has(key(kind, id, version))
}

export function markAvatarLoaded(kind: AvatarKind, id: string, version?: number | string): void {
  const k = key(kind, id, version)
  failed.delete(k)
  loaded.add(k)
}

export function markAvatarFailed(kind: AvatarKind, id: string, version?: number | string): void {
  const k = key(kind, id, version)
  loaded.delete(k)
  failed.add(k)
}

export function clearAvatarCache(kind: AvatarKind, id: string): void {
  const prefix = `${kind}:${id}:`
  for (const k of loaded) {
    if (k.startsWith(prefix)) loaded.delete(k)
  }
  for (const k of failed) {
    if (k.startsWith(prefix)) failed.delete(k)
  }
  for (const k of inflight.keys()) {
    if (k.startsWith(prefix)) inflight.delete(k)
  }
}

export function preloadAvatar(
  kind: AvatarKind,
  id: string | null | undefined,
  version?: number | string,
): Promise<boolean> | null {
  if (!id) return null
  const k = key(kind, id, version)
  if (loaded.has(k)) return Promise.resolve(true)
  if (failed.has(k)) return Promise.resolve(false)
  const existing = inflight.get(k)
  if (existing) return existing

  const promise = new Promise<boolean>((resolve) => {
    const img = new Image()
    img.onload = () => {
      inflight.delete(k)
      markAvatarLoaded(kind, id, version)
      resolve(true)
    }
    img.onerror = () => {
      inflight.delete(k)
      markAvatarFailed(kind, id, version)
      resolve(false)
    }
    img.src = avatarUrl(kind, id, version)
  })
  inflight.set(k, promise)
  return promise
}
