import { TimerSpike } from './ui/TimerSpike'

export default function App() {
  return (
    <div className="flex min-h-full flex-col pt-safe-t pb-safe-b">
      <header className="px-5 pt-4 pb-3">
        <h1 className="text-2xl font-semibold tracking-tight">loadout</h1>
        <p className="text-sm text-neutral-500">rest timer spike</p>
      </header>
      <main className="flex-1 px-5">
        <TimerSpike />
      </main>
    </div>
  )
}
