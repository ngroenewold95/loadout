import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useActiveSession } from './state/queries.ts'
import { useCurrentScreen, useNav, useSystemBack, type Screen } from './state/nav.ts'
import { ActiveSession } from './ui/ActiveSession'
import { AppHeader } from './ui/AppHeader'
import { Home } from './ui/Home'
import { SessionSummary } from './ui/SessionSummary'
import { SessionExercisePicker } from './ui/ExercisePicker'
import { RestPill } from './ui/RestPill'
import { DbSmoke } from './ui/DbSmoke'
import { TimerSpike } from './ui/TimerSpike'

/**
 * The database is local, so a refetch costs a millisecond. Retries and stale
 * timers exist for flaky networks and there is no network here.
 */
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 0 } },
})

/**
 * Titles for pushed screens, as a total record rather than a switch with a
 * default: adding a `Screen` member without a title is a type error here.
 */
const SCREEN_TITLES: Record<Screen['kind'], string> = {
  spikes: 'Debug',
  summary: 'Summary',
  picker: 'Choose exercise',
}

function Shell() {
  const { data: session, isLoading } = useActiveSession()
  const screen = useCurrentScreen()
  const push = useNav((s) => s.push)

  useSystemBack()

  return (
    // `h-full`, not `min-h-full`: the shell is exactly the viewport so that a
    // screen can dock a bar to the bottom and scroll only its middle. With
    // min-height the shell grows instead and the whole page scrolls, which is
    // what used to move LOG SET around under the thumb.
    <div className="pt-safe-t flex h-full flex-col">
      <AppHeader
        title={screen ? SCREEN_TITLES[screen.kind] : undefined}
        right={
          // The rest pill outranks everything else in this slot: it belongs to
          // the workout, not to the screen, and it has to stay visible when a
          // pushed screen is covering the logging loop.
          session ? (
            <RestPill />
          ) : screen ? undefined : (
            <button className="text-muted text-xs" onClick={() => push({ kind: 'spikes' })}>
              debug
            </button>
          )
        }
      />

      {/* `min-h-0` so a flex child is allowed to be shorter than its content
          and scroll, rather than pushing the shell taller. */}
      <main className="flex min-h-0 flex-1 flex-col">
        {/* A pushed screen REPLACES the one below it, which unmounts. That is
            right for the spikes and costs nothing today. The first push from
            inside a live workout (the exercise detail, stage 11) is where it
            has to be reconsidered, because unmounting ActiveSession throws away
            a half-typed entry draft. Decide it there, against a real case. */}
        {screen?.kind === 'spikes' ? (
          <div className="pb-safe-b flex flex-col gap-4 overflow-y-auto px-5 pt-4">
            <DbSmoke />
            <TimerSpike />
            <div className="pb-6" />
          </div>
        ) : screen?.kind === 'summary' ? (
          <SessionSummary sessionId={screen.sessionId} />
        ) : screen?.kind === 'picker' ? (
          <SessionExercisePicker
            sessionId={screen.sessionId}
            replacing={screen.replacing}
          />
        ) : isLoading ? (
          <p className="text-text-dim px-5 py-8 opacity-70">Opening database…</p>
        ) : session ? (
          <ActiveSession session={session} />
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
