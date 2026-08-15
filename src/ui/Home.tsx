/**
 * Choose a workout.
 *
 * "Next up" is whichever template was performed least recently, because the
 * programme rotates A/B rolling rather than by weekday - miss a week and you
 * resume where you left off instead of skipping a day.
 *
 * **Tapping a template opens it; it does not start it.** Starting writes a
 * session row and snapshots the whole plan into `session_exercises`, and
 * `startSession` refuses to open a second one, so a stray tap here used to be a
 * workout you then had to discard. The preview it pushes carries the
 * `Start workout` button, so the commitment is its own deliberate tap and you
 * can look at what is coming without making it.
 */
import { useNextTemplate, useTemplates } from '../state/queries.ts'
import { useNav } from '../state/nav.ts'

export function Home() {
  const { data: templates } = useTemplates()
  const { data: next } = useNextTemplate()
  const push = useNav((s) => s.push)

  const open = (id: number) => push({ kind: 'template', templateId: id })

  return (
    <div className="flex flex-col gap-4 px-5">
      {next && (
        <button
          className="bg-primary text-on-primary rounded-2xl px-5 py-6 text-left active:opacity-90"
          onClick={() => open(next.id)}
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
              className="bg-surface-1 active:bg-surface-3 rounded-xl px-4 py-4 text-left"
              onClick={() => open(t.id)}
            >
              <span className="block font-medium">{t.name}</span>
              <span className="text-text-dim block text-sm opacity-70">
                {t.exerciseCount} exercises ·{' '}
                {t.lastUsedDate ? `last done ${t.lastUsedDate}` : 'not done yet'}
              </span>
            </button>
          ))}
      </div>
    </div>
  )
}
