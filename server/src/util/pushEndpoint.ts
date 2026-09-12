// Is this a URL the server may register as a Web Push endpoint?
//
// The endpoint is a URL the SERVER will POST to (web-push, on every message
// in the subscriber's rooms) — so an unchecked one is a request-forgery
// primitive: a user could register `http://10.0.0.5:6379/` or the Redis /
// Postgres host and have the API knock on it from inside the network on their
// schedule. Real push services are public hosts on https:443
// (fcm.googleapis.com, Mozilla's autopush, WNS, Apple's web.push.apple.com),
// so rather than an allowlist of vendors — which would silently lock out any
// browser it doesn't name — the check is structural: https, the default port,
// no credentials, a dotted hostname (not an IP literal), and nothing that
// names the inside of a deployment.
//
// Pure (no env, no db) so it can be unit-tested — see pushEndpoint.test.ts.
const INTERNAL_HOST_SUFFIXES = ['.internal', '.local', '.localhost', '.localdomain']

export function isAcceptablePushEndpoint(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  // `port` is '' when it is the scheme default (443), so this refuses every
  // explicit non-default port — where internal services actually listen.
  if (url.port !== '') return false
  if (url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  if (host === 'localhost') return false
  // IPv6 literals arrive bracketed; IPv4 literals are all digits and dots.
  if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false
  // Single-label names (`redis`, `postgres`, a Docker service) never resolve
  // on the public internet; a push service always has a registrable domain.
  if (!host.includes('.')) return false
  if (INTERNAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false
  return true
}
