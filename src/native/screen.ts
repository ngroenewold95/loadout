/**
 * Keep the screen on while training.
 *
 * A window flag on the activity, not a wake lock: it is scoped to the app being
 * visible, which is exactly the scope wanted. Failures are swallowed because
 * the web build has no such plugin and a screen that dims is not a reason to
 * take a workout down.
 */
import { registerPlugin } from '@capacitor/core'

interface AppScreenPlugin {
  setKeepAwake(opts: { on: boolean }): Promise<void>
}

const AppScreen = registerPlugin<AppScreenPlugin>('AppScreen')

export async function setKeepAwake(on: boolean): Promise<void> {
  try {
    await AppScreen.setKeepAwake({ on })
  } catch {
    // Web, or an activity that has gone away. Nothing to do either way.
  }
}
