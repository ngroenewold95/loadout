import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Capacitor live reload: `adb reverse tcp:5173 tcp:5173` lets the device
    // reach this over USB without a LAN address.
    host: true,
    port: 5173,
  },
})
