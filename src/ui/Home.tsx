/**
 * Start or resume a workout.
 *
 * "Next up" is whichever template was performed least recently, because the
 * programme rotates A/B rolling rather than by weekday - miss a week and you
 * resume where you left off instead of skipping a day.
 */
import { useNextTemplate, useStartSession, useTemplates } from '../state/queries.ts'

export function Home() {
  const { data: templates } = useTemplates()
  const { data: next } = useNextTemplate()
  const startSession = useStartSession()

  const start = (id: number, name: string) =>
    startSession.mutate({ templateId: id, name })

  return (
    <div className="flex flex-col gap-4 px-5">
      {next && (
        <button
          className="rounded-2xl bg-emerald-700 px-5 py-6 text-left active:bg-emerald-600 disabled:opacity-40"
          disabled={startSession.isPending}
          onClick={() => start(next.id, next.name)}
        >
          <span className="block text-xs tracking-wide text-emerald-200 uppercase">
            Next up
          </span>
          <span className="block text-xl font-semibold">{next.name}</span>
          <span className="block text-sm text-emerald-200">
            {next.exerciseCount} exercises ·{' '}
            {next.lastUsedDate ? `last done ${next.lastUsedDate}` : 'not done yet'}
          </span>
        </button>
      )}

      <div className="flex flex-col gap-2">
        {(templates ?? [])
          .filter((t) => t.id !== next?.id)
          .map((t) => (
            <button
              key={t.id}
              className="rounded-xl bg-neutral-900 px-4 py-4 text-left active:bg-neutral-800 disabled:opacity-40"
              disabled={startSession.isPending}
              onClick={() => start(t.id, t.name)}
            >
              <span className="block font-medium">{t.name}</span>
              <span className="block text-sm text-neutral-500">
                {t.exerciseCount} exercises ·{' '}
                {t.lastUsedDate ? `last done ${t.lastUsedDate}` : 'not done yet'}
              </span>
            </button>
          ))}
      </div>

      {startSession.isError && (
        <p className="rounded-xl bg-red-950 px-3 py-2 text-sm text-red-300">
          {(startSession.error as Error).message}
        </p>
      )}
    </div>
  )
}
