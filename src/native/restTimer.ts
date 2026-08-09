/**
 * JS face of the native rest timer.
 *
 * The service owns the countdown; this only starts, extends and cancels it.
 * The overlay bubble hides itself while loadout is in front, so the in-app
 * header is free to draw its own countdown from the same `endsAt`.
 */
import { registerPlugin } from '@capacitor/core'

export interface RestTimerPlugin {
  start(opts: { endsAt: number; totalMs: number }): Promise<{ overlay: boolean }>
  extend(opts: { ms: number }): Promise<void>
  cancel(): Promise<void>
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
export async function startRest(seconds: number): Promise<number> {
  const endsAt = Date.now() + seconds * 1000
  await RestTimer.start({ endsAt, totalMs: seconds * 1000 })
  return endsAt
}
