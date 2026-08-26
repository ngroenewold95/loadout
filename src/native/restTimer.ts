/**
 * JS face of the native rest timer.
 *
 * The service owns the countdown; this only starts, extends and cancels it.
 * The overlay bubble hides itself while loadout is in front, so the in-app
 * header is free to draw its own countdown from the same `endsAt`.
 */
import { registerPlugin } from '@capacitor/core'

/** The gym settings a rest needs. See `RestTimerService` for why they travel. */
export interface RestOptions {
  /** Show the floating bubble once the app is in the background. */
  overlay?: boolean
  /** The five-second haptic countdown and the buzz at zero. */
  vibrate?: boolean
  /** A tone at zero, on the alarm stream. */
  sound?: boolean
}

export interface RestTimerPlugin {
  start(opts: { endsAt: number; totalMs: number } & RestOptions): Promise<{ overlay: boolean }>
  extend(opts: { ms: number }): Promise<void>
  cancel(): Promise<void>
  /** The service's own view of the countdown. `endsAt` is 0 when idle. */
  state(): Promise<{ running: boolean; endsAt: number; totalMs: number }>
  permissionState(): Promise<{ notifications: boolean; overlay: boolean; sdk: number }>
  requestOverlayPermission(): Promise<{ granted: boolean; opened?: boolean }>
}

export const RestTimer = registerPlugin<RestTimerPlugin>('RestTimer')

/**
 * Start a rest of `seconds`, returning the absolute end instant.
 *
 * Absolute, not a duration: it is what the notification chronometer and the
 * overlay both render from, and it is the only form that survives process
 * death intact.
 */
export async function startRest(seconds: number, options: RestOptions = {}): Promise<number> {
  const endsAt = Date.now() + seconds * 1000
  // The settings are pushed in with the rest rather than read by the service,
  // which cannot reach the database. A toggle therefore applies from the next
  // rest, not the one already running.
  await RestTimer.start({ endsAt, totalMs: seconds * 1000, ...options })
  return endsAt
}

/**
 * Recover a rest already in progress, for a cold start mid-rest.
 *
 * Returns null when nothing is running, and also on the web, where the plugin
 * is not implemented at all and the call rejects. Failing quietly is right here:
 * the worst case is an app bar with no pill, and throwing on mount would take
 * the whole screen down for a timer that is a convenience.
 */
export async function currentRest(): Promise<{ endsAt: number; totalMs: number } | null> {
  try {
    const state = await RestTimer.state()
    return state.running ? { endsAt: state.endsAt, totalMs: state.totalMs } : null
  } catch {
    return null
  }
}
