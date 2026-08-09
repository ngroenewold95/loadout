import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Live reload is opt-in via env so this file stays machine-agnostic and
 * committable:
 *
 *   adb reverse tcp:5173 tcp:5173     # device localhost -> this machine
 *   npm run dev                        # in one terminal
 *   CAP_LIVE_RELOAD=1 npx cap run android
 *
 * Using `adb reverse` rather than a LAN address means the config never has to
 * carry an IP that changes with the network.
 */
const liveReload = process.env.CAP_LIVE_RELOAD === '1'

const config: CapacitorConfig = {
  appId: 'com.groenewold.loadout',
  appName: 'loadout',
  webDir: 'dist',
  android: {
    // The app is dark-first; this is the colour behind the WebView before
    // first paint, and stops a white flash on cold start.
    backgroundColor: '#0a0a0a',
  },
  ...(liveReload && {
    server: {
      url: 'http://localhost:5173',
      cleartext: true,
    },
  }),
}

export default config
