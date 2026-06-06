import {
  LocationClient,
  GetDevicePositionCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-location'
import { env } from './env.js'

// ── Amazon Location Service: tracker reads (server-only) ─────────────────────
//
// All tracker operations live here, on the server, so the browser never holds
// AWS credentials or talks to the tracker directly. The frontend only renders
// the map (with a scoped Maps API key) and calls our own API for positions.
//
// Configuration is OPTIONAL: the feature turns on only when AWS_REGION and
// AWS_LOCATION_TRACKER_NAME are both set (see env.ts). Credentials are resolved
// by the AWS SDK's default provider chain (env vars / IAM role) — never
// hardcoded. When unconfigured, isLocationConfigured() is false and the route
// short-circuits with a clear code, so existing deployments are unaffected.

let client: LocationClient | null = null

export function isLocationConfigured(): boolean {
  return Boolean(env.AWS_REGION && env.AWS_LOCATION_TRACKER_NAME)
}

// Lazily build the client so importing this module is free when the feature is
// off. region is the only explicit option; credentials come from the SDK chain.
function getClient(): LocationClient | null {
  if (!isLocationConfigured()) return null
  if (!client) client = new LocationClient({ region: env.AWS_REGION })
  return client
}

// Map a vehicle group to its tracker DEVICE id. Default: the group id, which is
// stable and unique. Centralized here so the mapping is a one-line change if your
// devices report a different id (e.g. the tractor plate) — callers never assume.
export function deviceIdForGroup(groupId: string): string {
  return groupId
}

export type VehiclePosition = {
  latitude: number
  longitude: number
  // ISO timestamp of when the position was sampled (falls back to received time).
  timestamp: string | null
  // Horizontal accuracy in metres, when the device reports it.
  accuracy: number | null
  deviceId: string
}

// Latest known position for a device. Returns null when the feature is off OR the
// device simply has no position yet (AWS throws ResourceNotFoundException then) —
// the route turns that into a clean "no location yet" for the UI. Real faults
// (network/permissions) propagate to the central error handler.
export async function getLatestPosition(deviceId: string): Promise<VehiclePosition | null> {
  const c = getClient()
  if (!c) return null
  try {
    const res = await c.send(
      new GetDevicePositionCommand({
        TrackerName: env.AWS_LOCATION_TRACKER_NAME,
        DeviceId: deviceId,
      }),
    )
    // Amazon Location returns Position as [longitude, latitude].
    const pos = res.Position
    if (!pos || pos.length < 2) return null
    const when = res.SampleTime ?? res.ReceivedTime
    return {
      longitude: pos[0],
      latitude: pos[1],
      timestamp: when ? when.toISOString() : null,
      accuracy: res.Accuracy?.Horizontal ?? null,
      deviceId,
    }
  } catch (err) {
    // No position recorded for this device yet → treat as "no location".
    if (err instanceof ResourceNotFoundException) return null
    throw err
  }
}
