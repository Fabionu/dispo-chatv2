import type { TruckProfileForm } from './types'

// Truck-profile presets. Personal/local for now (localStorage) — NOT persisted
// to the server. Built-in presets are always offered and are never written to
// storage, so seeding them can never overwrite a user's saved presets. Kept
// small and provider-agnostic so a route + its profile can later be attached to
// a vehicle room.

export type TruckPreset = {
  id: string
  name: string
  builtIn?: boolean
  values: TruckProfileForm
}

const KEY = 'dispo.here.truckPresets'

const BUILT_INS: TruckPreset[] = [
  {
    id: 'builtin:artic40',
    name: 'Artic 40t (EU)',
    builtIn: true,
    values: { heightCm: '400', widthCm: '255', lengthCm: '1650', grossWeightKg: '40000', axleCount: '5', trailerCount: '1' },
  },
  {
    id: 'builtin:rigid18',
    name: 'Rigid 18t',
    builtIn: true,
    values: { heightCm: '380', widthCm: '255', lengthCm: '900', grossWeightKg: '18000', axleCount: '2', trailerCount: '0' },
  },
  {
    id: 'builtin:van35',
    name: 'Van 3.5t',
    builtIn: true,
    values: { heightCm: '260', widthCm: '200', lengthCm: '600', grossWeightKg: '3500', axleCount: '2', trailerCount: '0' },
  },
]

export function builtInPresets(): TruckPreset[] {
  return BUILT_INS
}

export function loadUserPresets(): TruckPreset[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (p): p is TruckPreset =>
        p && typeof p.id === 'string' && typeof p.name === 'string' && p.values && typeof p.values === 'object',
    )
  } catch {
    return []
  }
}

// Save (or replace by name) a user preset. Returns the updated user-preset list.
export function saveUserPreset(name: string, values: TruckProfileForm): TruckPreset[] {
  const trimmed = name.trim()
  if (!trimmed) return loadUserPresets()
  const preset: TruckPreset = {
    id: `user:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: trimmed,
    values,
  }
  const next = [...loadUserPresets().filter((p) => p.name !== trimmed), preset]
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage full / unavailable — keep in-memory only this session */
  }
  return next
}

export function deleteUserPreset(id: string): TruckPreset[] {
  const next = loadUserPresets().filter((p) => p.id !== id)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return next
}
