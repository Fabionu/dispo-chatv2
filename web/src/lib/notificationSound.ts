import { useEffect, useState } from 'react'

export type NotificationSound =
  | 'none'
  | 'soft-pop'
  | 'glass-ping'
  | 'warm-pulse'
  | 'digital-drop'
  | 'velvet-tap'
  | 'crystal-duo'
  | 'orbit'
  | 'mono-click'

export const NOTIFICATION_SOUNDS: ReadonlyArray<{
  value: NotificationSound
  label: string
  description: string
}> = [
  { value: 'none', label: 'None', description: 'Keep incoming messages silent.' },
  { value: 'soft-pop', label: 'Soft Pop', description: 'A clean, friendly two-note lift.' },
  { value: 'glass-ping', label: 'Glass Ping', description: 'A crisp single chime with a light harmonic.' },
  { value: 'warm-pulse', label: 'Warm Pulse', description: 'Two softer notes for busy conversations.' },
  { value: 'digital-drop', label: 'Digital Drop', description: 'A short descending, modern signal.' },
  { value: 'velvet-tap', label: 'Velvet Tap', description: 'A subdued, rounded tap with a soft lift.' },
  { value: 'crystal-duo', label: 'Crystal Duo', description: 'Two bright notes with a polished finish.' },
  { value: 'orbit', label: 'Orbit', description: 'A fluid rising signal with a playful turn.' },
  { value: 'mono-click', label: 'Mono Click', description: 'An ultra-short, focused digital tick.' },
]

const STORAGE_KEY = 'dispo:notification-sound'
const CHANGE_EVENT = 'dispo:notification-sound-change'
const DEFAULT_SOUND: NotificationSound = 'soft-pop'

let audioContext: AudioContext | null = null

function isNotificationSound(value: unknown): value is NotificationSound {
  return NOTIFICATION_SOUNDS.some((sound) => sound.value === value)
}

export function getNotificationSound(): NotificationSound {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isNotificationSound(stored) ? stored : DEFAULT_SOUND
  } catch {
    return DEFAULT_SOUND
  }
}

export function setNotificationSound(sound: NotificationSound) {
  try {
    localStorage.setItem(STORAGE_KEY, sound)
  } catch {
    // The in-memory event still updates the current UI when storage is blocked.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: sound }))
}

export function useNotificationSound(): NotificationSound {
  const [sound, setSound] = useState<NotificationSound>(getNotificationSound)

  useEffect(() => {
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<NotificationSound>).detail
      setSound(isNotificationSound(next) ? next : getNotificationSound())
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setSound(getNotificationSound())
    }
    window.addEventListener(CHANGE_EVENT, onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return sound
}

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioContextCtor = window.AudioContext
  if (!AudioContextCtor) return null
  audioContext ??= new AudioContextCtor()
  return audioContext
}

type Tone = {
  at: number
  frequency: number
  endFrequency?: number
  duration: number
  volume: number
  type?: OscillatorType
}

function tone(ctx: AudioContext, base: number, spec: Tone) {
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  const start = base + spec.at
  const end = start + spec.duration

  oscillator.type = spec.type ?? 'sine'
  oscillator.frequency.setValueAtTime(spec.frequency, start)
  if (spec.endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(spec.endFrequency, end)
  }

  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(spec.volume, start + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, end)
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(start)
  oscillator.stop(end + 0.01)
}

function schedule(ctx: AudioContext, sound: Exclude<NotificationSound, 'none'>) {
  const now = ctx.currentTime + 0.012
  const tones: Record<typeof sound, Tone[]> = {
    'soft-pop': [
      { at: 0, frequency: 740, endFrequency: 820, duration: 0.12, volume: 0.045 },
      { at: 0.062, frequency: 1108.73, duration: 0.16, volume: 0.038 },
    ],
    'glass-ping': [
      { at: 0, frequency: 1318.51, duration: 0.22, volume: 0.038 },
      { at: 0, frequency: 2637.02, duration: 0.14, volume: 0.011 },
    ],
    'warm-pulse': [
      { at: 0, frequency: 523.25, duration: 0.14, volume: 0.042, type: 'triangle' },
      { at: 0.075, frequency: 659.25, duration: 0.18, volume: 0.034, type: 'triangle' },
    ],
    'digital-drop': [
      { at: 0, frequency: 1174.66, endFrequency: 987.77, duration: 0.11, volume: 0.038, type: 'triangle' },
      { at: 0.075, frequency: 783.99, endFrequency: 698.46, duration: 0.15, volume: 0.032 },
    ],
    'velvet-tap': [
      { at: 0, frequency: 392, endFrequency: 440, duration: 0.1, volume: 0.033, type: 'triangle' },
      { at: 0.052, frequency: 587.33, duration: 0.14, volume: 0.026 },
    ],
    'crystal-duo': [
      { at: 0, frequency: 1046.5, duration: 0.12, volume: 0.032 },
      { at: 0.058, frequency: 1567.98, duration: 0.2, volume: 0.028 },
      { at: 0.058, frequency: 3135.96, duration: 0.11, volume: 0.007 },
    ],
    orbit: [
      { at: 0, frequency: 659.25, endFrequency: 783.99, duration: 0.14, volume: 0.036 },
      { at: 0.082, frequency: 987.77, endFrequency: 880, duration: 0.17, volume: 0.029, type: 'triangle' },
    ],
    'mono-click': [
      { at: 0, frequency: 880, endFrequency: 760, duration: 0.075, volume: 0.03, type: 'triangle' },
      { at: 0.006, frequency: 440, duration: 0.09, volume: 0.016 },
    ],
  }
  for (const spec of tones[sound]) tone(ctx, now, spec)
}

export async function playNotificationSound(sound: NotificationSound = getNotificationSound()) {
  if (sound === 'none') return
  const ctx = context()
  if (!ctx) return
  try {
    if (ctx.state === 'suspended') await ctx.resume()
    schedule(ctx, sound)
  } catch {
    // Browsers may block audio until the first user gesture. The unlock handler
    // below makes later notifications available without surfacing an app error.
  }
}

// Browsers require one user gesture before notification audio may start. Arm a
// silent unlock at startup; preview buttons also resume the context themselves.
export function initNotificationSound() {
  if (typeof document === 'undefined') return
  const unlock = () => {
    const ctx = context()
    if (ctx?.state === 'suspended') void ctx.resume()
    document.removeEventListener('pointerdown', unlock, true)
    document.removeEventListener('keydown', unlock, true)
  }
  document.addEventListener('pointerdown', unlock, true)
  document.addEventListener('keydown', unlock, true)
}
