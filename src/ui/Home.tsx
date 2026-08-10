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
          className="bg-primary text-on-primary rounded-2xl px-5 py-6 text-left active:opacity-90 disabled:opacity-40"
          disabled={startSession.isPending}
          onClick={() => start(next.id, next.name)}
        >
          <span className="block text-xs tracking-wide uppercase opacity-70">Next up</span>
          <span className="block text-xl font-semibold">{next.name}</span>
          <span className="block text-sm opacity-70">
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
              className="bg-surface-1 active:bg-surface-3 rounded-xl px-4 py-4 text-left disabled:opacity-40"
              disabled={startSession.isPending}
              onClick={() => start(t.id, t.name)}
            >
              <span className="block font-medium">{t.name}</span>
              <span className="text-text-dim block text-sm opacity-70">
                {t.exerciseCount} exercises ·{' '}
                {t.lastUsedDate ? `last done ${t.lastUsedDate}` : 'not done yet'}
              </span>
            </button>
          ))}
      </div>

      {startSession.isError && (
        <p className="bg-surface-1 text-danger rounded-xl px-3 py-2 text-sm">
          {(startSession.error as Error).message}
        </p>
      )}
    </div>
  )
}
