// Identity-field locking.
//
// For identity consistency + spam/bot abuse prevention, the details captured at
// signup are frozen afterwards. This is enforced SERVER-SIDE (the settings UI
// also hides the editors, but that alone is bypassable via direct API calls).
//
// Two flavours of lock:
//   • FULLY LOCKED — captured at account/company creation, never changeable by
//     anyone (there is no verified admin rename/correction flow in this product,
//     so per the product rule we default to locked for everyone, admins too):
//       user.display_name, user.email, workspace.name
//   • LOCK-ONCE-SET — official company identity fields that are NOT captured at
//     signup (they start empty and are filled in later): settable while empty,
//     immutable once a non-empty value exists.
//       workspace.legal_name, workspace.dispatch_email
//
// Anything not listed here stays editable (avatar, status, phone, title,
// languages, VAT, address, website, dispatch phone, logo, …).

// Client (camelCase) keys that map to immutable user identity columns. We list a
// few aliases too so a crafted body can't sneak a rename through an unexpected key.
export const LOCKED_PROFILE_FIELDS = ['displayName', 'fullName', 'name', 'email'] as const

// Client key that maps to the immutable company identity column (workspace.name).
export const LOCKED_COMPANY_FIELDS = ['name'] as const

// Company identity fields that lock once they hold a value.
export const LOCK_ONCE_SET_COMPANY_FIELDS = ['legalName', 'dispatchEmail'] as const

// Which locked keys a request body is actually trying to set. Used to reject the
// request with a clear error instead of silently dropping the field.
export function lockedFieldsInBody(body: unknown, locked: readonly string[]): string[] {
  if (!body || typeof body !== 'object') return []
  const obj = body as Record<string, unknown>
  return locked.filter((k) => k in obj)
}

// For lock-once-set fields: given the CURRENT stored values (camelCase keys) and
// the requested patch, return the fields the caller is illegally trying to change
// — i.e. ones that already hold a non-empty value and are being set to something
// different (changing OR clearing both count as a change). Fields that are still
// empty are allowed through (initial set).
export function lockOnceSetViolations(
  fields: readonly string[],
  current: Record<string, string | null | undefined>,
  patch: Record<string, unknown>,
): string[] {
  const out: string[] = []
  for (const k of fields) {
    if (!(k in patch)) continue
    const existing = (current[k] ?? '').toString().trim()
    if (!existing) continue // not set yet → caller may set it
    const next = typeof patch[k] === 'string' ? patch[k].trim() : ''
    if (existing !== next) out.push(k)
  }
  return out
}
