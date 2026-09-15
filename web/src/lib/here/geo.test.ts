import test from 'node:test'
import assert from 'node:assert/strict'

import { looksLikeCoordPair, parseLatLng } from './geo'

// Brno-ish, the pair the user typed (2026-09-15): 49.278854N, 16.209515E.
const LAT = 49.278854
const LNG = 16.209515

function near(actual: { lat: number; lng: number } | null, lat: number, lng: number, eps = 1e-5) {
  assert.ok(actual, 'expected a coordinate, got null')
  assert.ok(Math.abs(actual.lat - lat) < eps, `lat ${actual.lat} ≠ ${lat}`)
  assert.ok(Math.abs(actual.lng - lng) < eps, `lng ${actual.lng} ≠ ${lng}`)
}

test('decimal degrees, the app’s own form', () => {
  near(parseLatLng('49.278854, 16.209515'), LAT, LNG)
  near(parseLatLng('49.278854 16.209515'), LAT, LNG)
  near(parseLatLng('  49.278854 ,16.209515  '), LAT, LNG)
  near(parseLatLng('-33.8688, 151.2093'), -33.8688, 151.2093)
  near(parseLatLng('+49.278854, -16.209515'), LAT, -LNG)
})

test('hemisphere letters after the values', () => {
  near(parseLatLng('49.278854N, 16.209515E'), LAT, LNG)
  near(parseLatLng('49.278854 N 16.209515 E'), LAT, LNG)
  near(parseLatLng('49.278854n, 16.209515e'), LAT, LNG)
  near(parseLatLng('33.8688S, 151.2093E'), -33.8688, 151.2093)
  near(parseLatLng('40.7128N 74.0060W'), 40.7128, -74.006)
  near(parseLatLng('49.278854N16.209515E'), LAT, LNG)
})

test('hemisphere letters before the values', () => {
  near(parseLatLng('N 49.278854, E 16.209515'), LAT, LNG)
  near(parseLatLng('N49.278854 E16.209515'), LAT, LNG)
  near(parseLatLng('S 33.8688 E 151.2093'), -33.8688, 151.2093)
})

test('letters fix the axes: longitude first is read correctly, not swapped blindly', () => {
  near(parseLatLng('16.209515E, 49.278854N'), LAT, LNG)
  near(parseLatLng('E 16.209515 N 49.278854'), LAT, LNG)
  // Without letters the UI is lat-first: a latitude of 151 is simply invalid.
  assert.equal(parseLatLng('151.2093, -33.8688'), null)
})

test('degrees, minutes, seconds', () => {
  near(parseLatLng('49°16\'43.9"N 16°12\'34.3"E'), LAT, LNG, 1e-4)
  near(parseLatLng('49°16′43.9″N, 16°12′34.3″E'), LAT, LNG, 1e-4)
  near(parseLatLng('49° 16\' 43.9" N, 16° 12\' 34.3" E'), LAT, LNG, 1e-4)
  near(parseLatLng('49 16 43.9 N, 16 12 34.3 E'), LAT, LNG, 1e-4)
  near(parseLatLng('49 16 43.9 N 16 12 34.3 E'), LAT, LNG, 1e-4)
  near(parseLatLng('33°52\'7.7"S 151°12\'33.5"E'), -33.8688, 151.2093, 1e-4)
})

test('degrees and decimal minutes', () => {
  near(parseLatLng('49 16.7312, 16 12.5709'), LAT, LNG, 1e-4)
  near(parseLatLng('49 16.7312 16 12.5709'), LAT, LNG, 1e-4)
  near(parseLatLng('49°16.7312\'N 16°12.5709\'E'), LAT, LNG, 1e-4)
})

test('minutes and seconds only follow INTEGER degrees, so plain decimals stay plain', () => {
  // Read as two decimal degrees, never as 49.27° 16.20′.
  near(parseLatLng('49.27 16.20'), 49.27, 16.2)
  assert.equal(parseLatLng('49 61.0, 16 5'), null) // 61 minutes
  assert.equal(parseLatLng('49 16 60 N, 16 12 34 E'), null) // 60 seconds
})

test('contradictions and ranges are refused', () => {
  assert.equal(parseLatLng('-49.278854N, 16.209515E'), null) // sign AND letter
  assert.equal(parseLatLng('49.278854N, 16.209515N'), null) // two latitudes
  assert.equal(parseLatLng('49.278854E, 16.209515W'), null) // two longitudes
  assert.equal(parseLatLng('N49.278854N, 16.209515E'), null) // letter twice
  assert.equal(parseLatLng('91, 16'), null)
  assert.equal(parseLatLng('49, 181'), null)
  assert.equal(parseLatLng('49, 16, 12'), null)
  assert.equal(parseLatLng('49'), null)
  assert.equal(parseLatLng(''), null)
})

test('looksLikeCoordPair: coordinate shapes, and not addresses', () => {
  assert.equal(looksLikeCoordPair('49.278854N, 16.209515E'), true)
  assert.equal(looksLikeCoordPair('49.278854, 16'), true) // still being typed
  assert.equal(looksLikeCoordPair('49°16\'43.9"N 16°12\'34.3"E'), true)
  assert.equal(looksLikeCoordPair('N 49 E 16'), true)
  assert.equal(looksLikeCoordPair('49'), false) // one number
  assert.equal(looksLikeCoordPair('Metz'), false)
  assert.equal(looksLikeCoordPair('Essen 4, 5'), false) // a word spelt from N/S/E/W
  assert.equal(looksLikeCoordPair('Sens 12 3'), false)
  assert.equal(looksLikeCoordPair('Bulevardul Republicii 12'), false)
})
