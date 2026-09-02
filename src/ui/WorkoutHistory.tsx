/**
 * Past workouts, as rows.
 *
 * The database holds 343 sessions and 6,206 sets and, until this screen, no part
 * of the app showed any of them. Home was two template buttons.
 *
 * **Tapping a row opens the existing summary.** `SessionSummary` already takes a
 * `sessionId` rather than a live session and already hides its whole action bar
 * for a finished one, so a past workout needs no screen of its own - and every
 * imported session carries a real `ended_at_utc`, derived from the export's
 * `Time` column, so nothing from 2021 renders a `Finish workout` button.
 */
import { useState } from 'react'
import { useSessionHistory } from '../state/queries.ts'
import { useNav } from '../state/nav.ts'
import { localDateOf, type SessionHistoryRow } from '../db/repo.ts'
import { relativeDay } from '../logic/dates.ts'
import { formatDuration } from '../logic/entry.ts'
import { formatWeight, DEFAULT_UNIT } from '../logic/units.ts'

const UNIT = DEFAULT_UNIT

/** How many Home shows, and how many each `Load more` adds. */
const RECENT = 5
const PAGE = 25

export function WorkoutRow({ session }: { session: SessionHistoryRow }) {
  const push = useNav((s) => s.push)

  const durationS =
    session.endedAtUtc == null
      ? null
      : Math.max(0, Math.round((session.endedAtUtc - session.startedAtUtc) / 1000))

  // Volume is null for a session whose sets were all deleted, and zero for one
  // that was entirely assistance work. Neither is worth a line of its own.
  const parts = [
    `${session.setCount} ${session.setCount === 1 ? 'set' : 'sets'}`,
    session.volumeKg ? `${formatWeight(session.volumeKg, UNIT)} ${UNIT}` : null,
    durationS ? formatDuration(durationS) : null,
  ].filter(Boolean)

  return (
    <button
      className="bg-surface-1 active:bg-surface-3 rounded-xl px-4 py-3 text-left"
      onClick={() => push({ kind: 'summary', sessionId: session.id })}
    >
      <span className="block truncate font-medium">{session.name ?? 'Workout'}</span>
      <span className="text-text-dim block text-sm">
        {session.localDate} · {relativeDay(session.localDate, localDateOf())}
      </span>
      <span className="text-text-dim block text-sm tabular-nums">{parts.join(' · ')}</span>
    </button>
  )
}

/**
 * The last few workouts, for Home.
 *
 * Renders nothing at all when there are none, rather than an empty shell: on a
 * fresh database Home should be the two templates and nothing else.
 */
export function RecentWorkouts() {
  const { data: sessions } = useSessionHistory(RECENT)
  const push = useNav((s) => s.push)

  if (!sessions || sessions.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-text-dim text-xs tracking-wide uppercase">Recent</h2>
        <div className="flex items-baseline">
          <button
            className="text-text-dim active:text-text px-2 py-1 text-sm"
            onClick={() => push({ kind: 'calendar' })}
          >
            Calendar
          </button>
          <button
            className="text-text-dim active:text-text px-2 py-1 text-sm"
            onClick={() => push({ kind: 'history' })}
          >
            All workouts
          </button>
        </div>
      </div>
      {sessions.map((session) => (
        <WorkoutRow key={session.id} session={session} />
      ))}
    </section>
  )
}

/**
 * Every workout, a page at a time.
 *
 * A growing `limit` rather than `useInfiniteQuery`: the database is a local file
 * and re-reading 50 rows costs a millisecond or two, which is the same reasoning
 * the query client's own defaults are written from. A short page means the end,
 * so the button goes away rather than sitting there returning nothing.
 */
export function AllWorkouts() {
  const [limit, setLimit] = useState(PAGE)
  const { data: sessions, isLoading } = useSessionHistory(limit)
  const end = sessions != null && sessions.length < limit

  return (
    <div className="pb-safe-b min-h-0 flex-1 overflow-y-auto px-5 pt-2">
      <div className="flex flex-col gap-2">
        {sessions?.map((session) => (
          <WorkoutRow key={session.id} session={session} />
        ))}
      </div>

      {isLoading && <p className="text-text-dim py-8">Loading…</p>}
      {sessions?.length === 0 && (
        <p className="text-text-dim py-8">No finished workouts yet.</p>
      )}

      {!end && sessions != null && sessions.length > 0 && (
        <button
          className="bg-surface-1 active:bg-surface-3 mt-3 w-full rounded-xl py-3"
          onClick={() => setLimit((n) => n + PAGE)}
        >
          Load more
        </button>
      )}
      <div className="pb-6" />
    </div>
  )
}
