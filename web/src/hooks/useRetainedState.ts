import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

// ── State that outlives its component ───────────────────────────────────────
// `useState` whose latest value is also kept in a module-level store, keyed by
// scope + name, and read back as the initial value the next time a component
// with the same key mounts. For the length of the page session only — nothing
// is written to storage, a reload starts clean.
//
// Why: the workspace tools (Route planner, Restriction calculator) are mounted
// one at a time in place of each other. Going from the planner to the
// calculator unmounted the planner, and coming back found it empty (user,
// 2026-09-16: "the user cannot go back to the route he planned, it resets").
// The route a dispatcher spent minutes on is the last thing a tool switch
// should throw away — so the planner's inputs and its computed route live
// here, and a return mounts on top of them.
//
// A store, not lifted state: the planner has ~20 atoms and its parent has no
// business knowing any of them; and not sessionStorage: a route carries its
// polylines (100 KB+), and serialising that on every keystroke to survive a
// reload nobody asked for is the wrong trade.

const stores = new Map<string, Map<string, unknown>>()

function storeFor(scope: string): Map<string, unknown> {
  let store = stores.get(scope)
  if (!store) {
    store = new Map()
    stores.set(scope, store)
  }
  return store
}

/** Whether a value for this key was retained by an earlier mount. Read it at
 *  render time (a `useState` initialiser), before any effect has had the
 *  chance to write this mount's own values in. */
export function hasRetained(scope: string, key: string): boolean {
  return storeFor(scope).has(key)
}

/** Forget everything retained under a scope (a "clear" action, sign-out). */
export function clearRetained(scope: string) {
  stores.delete(scope)
}

export function useRetainedState<T>(
  scope: string,
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const store = storeFor(scope)
  const [value, setValue] = useState<T>(() => {
    if (store.has(key)) return store.get(key) as T
    return typeof initial === 'function' ? (initial as () => T)() : initial
  })
  useEffect(() => {
    store.set(key, value)
  }, [store, key, value])
  return [value, setValue]
}
