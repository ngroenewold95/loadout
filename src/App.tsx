import { useEffect, useRef } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useActiveSession, useSettings } from './state/queries.ts'
import { useCurrentScreen, useNav, useSystemBack, type Screen } from './state/nav.ts'
import { ExerciseView } from './ui/ExerciseView'
import { TemplateEditor, TemplatePreview, WorkoutOverview } from './ui/WorkoutOverview'
import { AppHeader } from './ui/AppHeader'
import { Home } from './ui/Home'
import { SessionSummary } from './ui/SessionSummary'
import { SessionExercisePicker, TemplateExercisePicker } from './ui/ExercisePicker'
import { AllWorkouts } from './ui/WorkoutHistory'
import { ExerciseLibrary } from './ui/ExerciseLibrary'
import { Settings } from './ui/Settings'
import { ExerciseDetail } from './ui/ExerciseDetail'
import { RestPill } from './ui/RestPill'
import { setKeepAwake } from './native/screen.ts'
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
  // Both of these screens name themselves in their own content - the template's
  // day name, the exercise's name - so the bar says what kind of thing it is.
  template: 'Workout',
  exercise: 'Exercise',
  history: 'Workouts',
  library: 'Exercises',
  templateEdit: 'Edit workout',
  settings: 'Settings',
  exerciseInfo: 'Exercise',
  home: 'Home',
}

function Shell() {
  const { data: session, isLoading } = useActiveSession()
  const { data: settings } = useSettings()
  const screen = useCurrentScreen()
  const push = useNav((s) => s.push)

  useSystemBack()

  /**
   * Keep the screen on while a workout is live, if that is asked for.
   *
   * Scoped to the session rather than to the app: a phone that never sleeps
   * while Home is open is a flat battery, and the reason to want this at all is
   * that the next set is two minutes away and the phone is on the bench.
   */
  const keepAwake = Boolean(session) && (settings?.keepScreenOn ?? false)
  useEffect(() => {
    void setKeepAwake(keepAwake)
    return () => {
      void setKeepAwake(false)
    }
  }, [keepAwake])

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
            /**
             * The way into the spikes, and deliberately not a labelled button.
             *
             * `DbSmoke` is still the only on-device proof that the device's
             * SQLite has the `DENSE_RANK` window function `recentPerformance`
             * depends on, so the spikes earn their place until that is retired.
             * But a visible `debug` link in the app bar is the first thing
             * anyone shown the app reads, so it is now the wordmark's own
             * corner: five taps on the invisible target opens it.
             */
            <DebugTap onOpen={() => push({ kind: 'spikes' })} />
          )
        }
      />

      {/* `min-h-0` so a flex child is allowed to be shorter than its content
          and scroll, rather than pushing the shell taller. */}
      <main className="flex min-h-0 flex-1 flex-col">
        {/* A pushed screen REPLACES the one below it, which unmounts.

            `nav.ts` flagged the first push from inside a live workout as where
            that had to be reconsidered, because unmounting the logging screen
            throws away a half-typed entry draft. It is no longer a first: the
            exercise screen is itself pushed, so every summary and picker takes
            it down. The draft therefore lives in `state/workout.ts` now, beside
            the pager index and the rest, and unmounting costs nothing. */}
        {screen?.kind === 'spikes' ? (
          <div className="pb-safe-b flex flex-col gap-4 overflow-y-auto px-5 pt-4">
            <DbSmoke />
            <TimerSpike />
            <div className="pb-6" />
          </div>
        ) : screen?.kind === 'summary' ? (
          <SessionSummary sessionId={screen.sessionId} />
        ) : screen?.kind === 'picker' ? (
          'session' in screen.target ? (
            <SessionExercisePicker
              sessionId={screen.target.session}
              replacing={screen.replacing}
            />
          ) : (
            <TemplateExercisePicker
              templateId={screen.target.template}
              replacing={screen.replacing}
            />
          )
        ) : screen?.kind === 'template' ? (
          <TemplatePreview templateId={screen.templateId} />
        ) : screen?.kind === 'templateEdit' ? (
          <TemplateEditor templateId={screen.templateId} />
        ) : screen?.kind === 'history' ? (
          <AllWorkouts />
        ) : screen?.kind === 'settings' ? (
          <Settings />
        ) : screen?.kind === 'library' ? (
          <ExerciseLibrary />
        ) : screen?.kind === 'exerciseInfo' ? (
          <ExerciseDetail exerciseId={screen.exerciseId} />
        ) : screen?.kind === 'home' ? (
          // The same Home as the root, pushed over a live workout so that
          // `Exercises` and `Settings` are reachable without finishing first.
          // `Home` itself is what refuses to start a second session.
          <div className="pb-safe-b min-h-0 flex-1 overflow-y-auto pt-4">
            <Home />
            <div className="pb-6" />
          </div>
        ) : isLoading ? (
          <p className="text-text-dim px-5 py-8 opacity-70">Opening database…</p>
        ) : screen?.kind === 'exercise' && session ? (
          <ExerciseView session={session} openAt={screen.index} />
        ) : session ? (
          // The root while a workout is live. Cold start resumes to here, which
          // is the list, not whichever exercise was open - the workout is the
          // thing being resumed.
          <WorkoutOverview session={session} />
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

/**
 * Five taps in the corner of the app bar opens the spikes.
 *
 * The count resets on unmount, and there is no feedback until it fires: this is
 * a way back in for whoever is building the thing, not a feature. Android's own
 * build-number tap is the same shape, so it is at least a familiar secret.
 */
function DebugTap({ onOpen }: { onOpen: () => void }) {
  const taps = useRef(0)
  return (
    <button
      aria-hidden="true"
      tabIndex={-1}
      className="size-tap"
      onClick={() => {
        taps.current += 1
        if (taps.current < 5) return
        taps.current = 0
        onOpen()
      }}
    />
  )
}

export default function App() {
  return (
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>
  )
}
