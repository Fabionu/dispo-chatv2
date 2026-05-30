// Minimal structured logger: one JSON object per line, easy to ship to any log
// aggregator (Railway, Logtail, Datadog, …) without a heavyweight dependency.
//
// SAFETY: callers must pass only non-sensitive fields. Never hand this message
// bodies, cookies, JWTs, passwords, or raw file contents — by design it just
// serializes whatever it's given. The hot-path call sites pass ids + timings.

type Fields = Record<string, unknown>
type Level = 'info' | 'warn' | 'error'

function emit(level: Level, event: string, fields: Fields = {}): void {
  const record: Fields = { ts: new Date().toISOString(), level, event }
  // Drop null/undefined so optional fields (userId, groupId) stay absent
  // rather than logging noise.
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) record[k] = v
  }
  const line = JSON.stringify(record)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = {
  info: (event: string, fields?: Fields) => emit('info', event, fields),
  warn: (event: string, fields?: Fields) => emit('warn', event, fields),
  error: (event: string, fields?: Fields) => emit('error', event, fields),
}

// Elapsed milliseconds since a process.hrtime.bigint() start mark.
export function elapsedMs(startNs: bigint): number {
  return Math.round(Number(process.hrtime.bigint() - startNs) / 1e6)
}
