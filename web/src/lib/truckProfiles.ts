// Saved truck-restriction presets ("profiles"), persisted in localStorage so a
// dispatcher can predefine a few vehicle configurations (e.g. "40t semi",
// "7.5t box") and apply one in a click instead of re-typing dimensions.

export type TruckProfileValues = {
  height: string
  width: string
  length: string
  grossWeight: string
  axleWeight: string
  hazardous: boolean
}

export type TruckProfile = {
  id: string
  name: string
  values: TruckProfileValues
}

const STORAGE_KEY = 'dispo:truck-profiles'

export function getTruckProfiles(): TruckProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as TruckProfile[]) : []
  } catch {
    return []
  }
}

function persist(list: TruckProfile[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* ignore quota/availability — the in-memory list still drives the UI */
  }
}

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `tp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }
}

// Save (or overwrite by name) a profile and return the updated list. Overwriting
// keeps names unique so re-saving "40t semi" updates it instead of duplicating.
export function saveTruckProfile(name: string, values: TruckProfileValues): TruckProfile[] {
  const list = getTruckProfiles()
  const existing = list.find((p) => p.name.toLowerCase() === name.toLowerCase())
  const next = existing
    ? list.map((p) => (p.id === existing.id ? { ...p, values } : p))
    : [...list, { id: newId(), name, values }]
  persist(next)
  return next
}

export function deleteTruckProfile(id: string): TruckProfile[] {
  const next = getTruckProfiles().filter((p) => p.id !== id)
  persist(next)
  return next
}
