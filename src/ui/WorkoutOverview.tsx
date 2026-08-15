/**
 * The workout as a list of exercises, and the root of a live session.
 *
 * The app used to drop straight into exercise 1 of 10, and the only way to
 * reach exercise 7 was seven swipes or an accurate tap on a strip of 20 px
 * circles. The strip had two faults on device - a jump of more than one page
 * snapped back, and the ring around the selected circle was clipped by the
 * strip's own scroll container - and both were symptoms of asking a small
 * moving target to be a navigation control. So the list becomes a screen: swipe
 * between neighbours inside an exercise, back out to here to go anywhere else.
 *
 * **This is also where the session's plan is edited.** The actions belong to the
 * card for the exercise they act on, which is what the reference app does and
 * where they are furthest from a thumb aiming at LOG SET. They open in an
 * `ActionSheet` rather than expanding the card: an inline menu pushed every
 * card below it down as it opened, and on the last card it opened below the
 * fold, so `Remove` had to be scrolled to.
 *
 * `Move up` / `Move down` live there too. They had been cut on the grounds that
 * a list you can jump around makes reordering pointless, which was wrong -
 * jumping changes where you are, reordering changes what the workout IS, and
 * only the second survives to the summary.
 *
 * The same card list renders a template that has not been started, so what you
 * see before `Start workout` is what you get after it.
 */
import { useCallback, useState } from 'react'
import {
  useEditSessionPlan,
  useSessionExercises,
  useSessionSets,
  useStartSession,
  useTemplateExercises,
  useTemplates,
} from '../state/queries.ts'
import type { SessionRow, TemplateExerciseRow } from '../db/repo.ts'
import { formatDuration, formatTarget } from '../logic/entry.ts'
import { useNav } from '../state/nav.ts'
import { useWorkout } from '../state/workout.ts'
import { GroupRail, GroupWord } from './GroupTag.tsx'
import { ActionItem, ActionSheet } from './ActionSheet.tsx'

/** A live workout: tappable cards, plan edits, and the way out. */
export function WorkoutOverview({ session }: { session: SessionRow }) {
  const { data: planned } = useSessionExercises(session.id)
  const { data: sets } = useSessionSets(session.id)
  const push = useNav((s) => s.push)
  const plan = useEditSessionPlan(session.id)

  const busy = plan.remove.isPending || plan.replace.isPending || plan.reorder.isPending

  /**
   * Removing an exercise can leave the pager index past the end of the list.
   * The index is only read when an exercise screen opens, so clamping here is
   * enough and there is no screen to keep in step meanwhile.
   */
  const handleRemove = async (exerciseId: number) => {
    await plan.remove.mutateAsync({ exerciseId })
    const state = useWorkout.getState()
    if (state.sessionId === session.id && planned) {
      state.setIndex(session.id, Math.min(state.index, planned.length - 2))
    }
  }

  /**
   * Move an exercise one place.
   *
   * The whole order is rewritten rather than two rows swapped - see
   * `reorderSessionExercises`. A pairwise swap has to read the neighbour first,
   * and two racing would leave two rows sharing an `order_index`.
   */
  const handleMove = async (exerciseId: number, by: -1 | 1) => {
    if (!planned) return
    const ids = planned.map((p) => p.exerciseId)
    const from = ids.indexOf(exerciseId)
    const to = from + by
    if (from < 0 || to < 0 || to >= ids.length) return

    ids.splice(to, 0, ...ids.splice(from, 1))
    await plan.reorder.mutateAsync({ exerciseIds: ids })
  }

  return (
    <Layout
      rows={planned}
      countFor={(row) => (sets ?? []).filter((s) => s.exerciseId === row.exerciseId).length}
      onOpen={(index) => push({ kind: 'exercise', sessionId: session.id, index })}
      onReplace={(exerciseId) =>
        push({ kind: 'picker', sessionId: session.id, replacing: exerciseId })
      }
      onRemove={handleRemove}
      onMove={handleMove}
      busy={busy}
      actions={
        <>
          <button
            className="bg-surface-1 active:bg-surface-3 flex-1 rounded-2xl py-4 font-medium"
            onClick={() => push({ kind: 'picker', sessionId: session.id })}
          >
            Add exercise
          </button>
          {/* Opens the summary rather than ending the session. Nothing is saved
              by finishing - every set was written when it was logged - so
              nothing is decided by this tap either. */}
          <button
            className="bg-primary text-on-primary flex-1 rounded-2xl py-4 font-semibold"
            onClick={() => push({ kind: 'summary', sessionId: session.id })}
          >
            Finish
          </button>
        </>
      }
    />
  )
}

/**
 * A template, before any session exists.
 *
 * Read-only on purpose. `session_exercises` is a snapshot `startSession` takes,
 * so an edit made here would have nothing to write to; the alternative would be
 * editing the programme, which is exactly the fault the snapshot exists to
 * prevent. Editing this list is the template editor's job.
 */
export function TemplatePreview({ templateId }: { templateId: number }) {
  const { data: planned } = useTemplateExercises(templateId)
  const { data: templates } = useTemplates()
  const startSession = useStartSession()
  const reset = useNav((s) => s.reset)

  // `sessions.name` is a copy taken at start, not a foreign key, so a template
  // renamed later leaves old workouts reading as they were performed.
  const name = templates?.find((t) => t.id === templateId)?.name ?? null

  const start = async () => {
    await startSession.mutateAsync({ templateId, name })
    // All the way out, not one screen back: the live workout's overview is the
    // ROOT once a session exists, and this preview is what it replaces.
    reset()
  }

  return (
    <Layout
      rows={planned}
      heading={name}
      busy={startSession.isPending}
      error={startSession.error as Error | null}
      actions={
        <button
          className="bg-primary text-on-primary flex-1 rounded-2xl py-4 text-lg font-semibold disabled:opacity-40"
          disabled={startSession.isPending}
          onClick={start}
        >
          Start workout
        </button>
      }
    />
  )
}

/**
 * The card list itself, with a docked action bar.
 *
 * Docked for the reason region 3 of the exercise screen is: the list scrolls
 * and the buttons do not, so `Start workout` and `Finish` are in the same place
 * whatever the template's length.
 */
function Layout({
  rows,
  heading,
  countFor,
  onOpen,
  onReplace,
  onRemove,
  onMove,
  busy = false,
  error,
  actions,
}: {
  rows: TemplateExerciseRow[] | undefined
  /** The template's name, shown only where the app bar does not already say it. */
  heading?: string | null
  /** Sets performed so far. Absent for a template, which has no sets. */
  countFor?: (row: TemplateExerciseRow) => number
  onOpen?: (index: number) => void
  onReplace?: (exerciseId: number) => void
  onRemove?: (exerciseId: number) => void
  onMove?: (exerciseId: number, by: -1 | 1) => void
  busy?: boolean
  error?: Error | null
  actions: React.ReactNode
}) {
  /**
   * Which exercise's menu is open, by id rather than index.
   *
   * By id because the menu's own actions reorder and remove rows: an index
   * would point at a different exercise the instant one of them lands, and the
   * sheet would silently retarget under the thumb.
   */
  const [menuFor, setMenuFor] = useState<number | null>(null)
  /** Remove confirms with a second tap on the same row - see `ActionSheet`. */
  const [confirmRemove, setConfirmRemove] = useState(false)

  const closeMenu = useCallback(() => {
    setMenuFor(null)
    setConfirmRemove(false)
  }, [])

  if (!rows) return <p className="text-text-dim px-5 py-8">Loading…</p>

  const open = rows.find((r) => r.exerciseId === menuFor) ?? null
  const openIndex = open ? rows.indexOf(open) : -1
  const editable = Boolean(onReplace || onRemove || onMove)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-4">
        {heading && <h2 className="mb-3 text-xl font-semibold">{heading}</h2>}

        <div className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <ExerciseCard
              key={row.exerciseId}
              row={row}
              done={countFor?.(row) ?? null}
              onOpen={onOpen && (() => onOpen(index))}
              onMenu={editable ? () => setMenuFor(row.exerciseId) : undefined}
              busy={busy}
            />
          ))}
        </div>

        {error && (
          <p className="bg-surface-1 text-danger mt-3 rounded-xl px-3 py-2 text-sm">
            {error.message}
          </p>
        )}
      </div>

      <div className="bg-surface-1 pb-safe-b shrink-0">
        <div className="flex gap-3 px-4 py-3">{actions}</div>
      </div>

      {open && (
        <ActionSheet title={open.name} onClose={closeMenu}>
          {onMove && (
            <>
              <ActionItem
                label="Move up"
                disabled={busy || openIndex <= 0}
                onClick={() => {
                  void onMove(open.exerciseId, -1)
                  closeMenu()
                }}
              />
              <ActionItem
                label="Move down"
                disabled={busy || openIndex >= rows.length - 1}
                onClick={() => {
                  void onMove(open.exerciseId, 1)
                  closeMenu()
                }}
              />
            </>
          )}
          {onReplace && (
            <ActionItem
              label="Replace"
              disabled={busy}
              onClick={() => {
                onReplace(open.exerciseId)
                closeMenu()
              }}
            />
          )}
          {onRemove && (
            <ActionItem
              label={confirmRemove ? 'Tap again to remove' : 'Remove'}
              danger
              disabled={busy}
              onClick={() => {
                if (!confirmRemove) {
                  setConfirmRemove(true)
                  return
                }
                void onRemove(open.exerciseId)
                closeMenu()
              }}
            />
          )}
        </ActionSheet>
      )}
    </div>
  )
}

function ExerciseCard({
  row,
  done,
  onOpen,
  onMenu,
  busy,
}: {
  row: TemplateExerciseRow
  /** Sets performed, or null when this is a template and none exist yet. */
  done: number | null
  onOpen?: () => void
  /** Absent on a read-only list, which is what hides the menu button entirely. */
  onMenu?: () => void
  busy: boolean
}) {
  const complete = done != null && row.targetSets != null && done >= row.targetSets
  const detail = [
    formatTarget(row.targetSets, row.targetRepMin, row.targetRepMax),
    done == null ? null : row.targetSets == null ? `${done} sets` : `${done}/${row.targetSets} sets`,
    row.restS ? `rest ${formatDuration(row.restS)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={`bg-surface-1 flex items-center rounded-xl ${complete ? 'opacity-50' : ''}`}>
      <button
        type="button"
        disabled={!onOpen || busy}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-stretch gap-3 px-3 py-3 text-left disabled:opacity-100"
      >
        <GroupRail primaryMuscle={row.primaryMuscle} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{row.name}</span>
          <span className="flex items-baseline gap-2">
            <GroupWord primaryMuscle={row.primaryMuscle} />
            <span className="text-text-dim text-xs">{detail}</span>
          </span>
        </span>
      </button>

      {onMenu && (
        <button
          type="button"
          aria-label={`Edit ${row.name}`}
          aria-haspopup="dialog"
          onClick={onMenu}
          className="text-text-dim active:text-text size-tap shrink-0 text-lg"
        >
          ⋯
        </button>
      )}
    </div>
  )
}
