import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { useActiveSession, useEndSession } from './state/queries.ts'
import { ActiveSession } from './ui/ActiveSession'
import { Home } from './ui/Home'
import { DbSmoke } from './ui/DbSmoke'
import { TimerSpike } from './ui/TimerSpike'

/**
 * The database is local, so a refetch costs a millisecond. Retries and stale
 * timers exist for flaky networks and there is no network here.
 */
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 0 } },
})

function Shell() {
  const { data: session, isLoading } = useActiveSession()
  const endSession = useEndSession()
  const [showSpikes, setShowSpikes] = useState(false)

  return (
    // `h-full`, not `min-h-full`: the shell is exactly the viewport so that a
    // screen can dock a bar to the bottom and scroll only its middle. With
    // min-height the shell grows instead and the whole page scrolls, which is
    // what used to move LOG SET around under the thumb.
    <div className="pt-safe-t flex h-full flex-col">
      <header className="flex shrink-0 items-baseline justify-between px-5 pt-4 pb-2">
        <h1 className="text-2xl font-semibold tracking-tight">loadout</h1>
        <button
          className="text-muted text-xs"
          onClick={() => setShowSpikes((s) => !s)}
        >
          {showSpikes ? 'hide' : 'debug'}
        </button>
      </header>

      {/* `min-h-0` so a flex child is allowed to be shorter than its content
          and scroll, rather than pushing the shell taller. */}
      <main className="flex min-h-0 flex-1 flex-col">
        {showSpikes ? (
          // The spikes replace the screen rather than trailing it: they are
          // throwaway harnesses (stage 12 deletes them) and stacking them under
          // a docked entry bar has nowhere to go.
          <div className="pb-safe-b flex flex-col gap-4 overflow-y-auto px-5 pt-4">
            <DbSmoke />
            <TimerSpike />
            <div className="pb-6" />
          </div>
        ) : isLoading ? (
          <p className="text-text-dim px-5 py-8 opacity-70">Opening database…</p>
        ) : session ? (
          <ActiveSession
            session={session}
            onFinish={() => endSession.mutate(session.id)}
          />
        ) : (
          <div className="pb-safe-b min-h-0 flex-1 overflow-y-auto pt-4">
            <Home />
            <div className="pb-6" />
          </div>
        )}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>
  )
}
