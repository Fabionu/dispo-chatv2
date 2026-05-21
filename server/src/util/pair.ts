// Canonical ordering helpers for any "unordered pair of UUIDs" — connections
// between two users, the direct_pair_key on groups, etc. Always returning the
// smaller UUID first lets us:
//   - enforce uniqueness in Postgres via a single unique index
//   - look up "is there anything between A and B?" without a UNION query

export function sortPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

export function directPairKey(a: string, b: string): string {
  const [first, second] = sortPair(a, b)
  return `${first}:${second}`
}
