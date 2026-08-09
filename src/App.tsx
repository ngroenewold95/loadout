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
    <div className="flex min-h-full flex-col pt-safe-t pb-safe-b">
      <header className="flex items-baseline justify-between px-5 pt-4 pb-2">
        <h1 className="text-2xl font-semibold tracking-tight">loadout</h1>
        <button
          className="text-xs text-neutral-600"
          onClick={() => setShowSpikes((s) => !s)}
        >
          {showSpikes ? 'hide' : 'debug'}
        </button>
      </header>

      <main className="flex flex-1 flex-col gap-6 pb-6">
        {isLoading ? (
          <p className="px-5 py-8 text-neutral-500">Opening database…</p>
        ) : session ? (
          <ActiveSession
            session={session}
            onFinish={() => endSession.mutate(session.id)}
          />
        ) : (
          <Home />
        )}

        {showSpikes && (
          <div className="flex flex-col gap-4 px-5">
            <DbSmoke />
            <TimerSpike />
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
