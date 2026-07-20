// Tiny in-process TTL + LRU cache. Entries expire ttlMs after being SET (a get
// never extends the lifetime — important for values that go stale on their own,
// like signed URLs), and the least-recently-USED entry is evicted once the cache
// is full. Per-instance and in-memory by design: both users (signed preview
// URLs, HERE geocode results) are pure derived data that every instance can
// cheaply re-derive, so cross-instance coherence isn't worth a Redis round-trip.
export class TtlCache<V> {
  private map = new Map<string, { value: V; expiresAt: number }>()

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): V | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (Date.now() >= entry.expiresAt) {
      this.map.delete(key)
      return undefined
    }
    // Re-insert to mark as most-recently-used (Map preserves insertion order,
    // so the first key is always the LRU candidate).
    this.map.delete(key)
    this.map.set(key, entry)
    return entry.value
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key)
    } else if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  delete(key: string): void {
    this.map.delete(key)
  }
}

// Memoize one async lookup through a TtlCache of PROMISES. Caching the promise
// (not the resolved value) means concurrent identical calls share a single
// in-flight request instead of stampeding the upstream. A rejected promise is
// evicted immediately so a transient upstream failure is retried on the next
// call rather than being cached for the full TTL — only successful results
// (including a legitimate "not found" null) stick.
export async function cachedAsync<V>(
  cache: TtlCache<Promise<V>>,
  key: string,
  fn: () => Promise<V>,
): Promise<V> {
  const hit = cache.get(key)
  if (hit) return hit
  const promise = fn()
  cache.set(key, promise)
  try {
    return await promise
  } catch (err) {
    cache.delete(key)
    throw err
  }
}
