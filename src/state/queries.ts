/**
 * TanStack Query over the repo.
 *
 * Historical reads are cached and invalidated; the ACTIVE session is not a
 * cached remote resource and is driven directly by the components that mutate
 * it. The split is deliberate - see the Decisions table in PROJECT.md.
 *
 * Every mutation invalidates by key rather than patching the cache: the whole
 * database is on-device and a refetch costs a millisecond or two, so hand-rolled
 * optimistic surgery would be all risk and no reward.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { currentDatabaseUrl, getDb } from '../db/open.ts'
import { exportNow } from '../native/backup.ts'
import { RestTimer } from '../native/restTimer.ts'
import { useWorkout } from './workout.ts'
import {
  activeSession,
  addSessionExercise,
  deleteSet,
  removeSessionExercise,
  reorderSessionExercises,
  replaceSessionExercise,
  discardSession,
  getSettings,
  setSettings,
  type AppSettings,
  listPlateInventory,
  addTemplateExercise,
  removeTemplateExercise,
  replaceTemplateExercise,
  reorderTemplateExercises,
  setExercisePlan,
  sessionPlan,
  templatePlan,
  exerciseDetail,
  exerciseHistory,
  exerciseStats,
  endSession,
  historyStats,
  localDateOf,
  recentPerformance,
  listSessionExercises,
  listSessionHistory,
  listSessionSets,
  listTemplateExercises,
  listTemplates,
  logSet,
  nextTemplate,
  searchExercises,
  sessionById,
  setPlannedSets,
  setsByMuscle,
  startSession,
  updateSet,
  type ExercisePlanPatch,
  type LogSetInput,
  type UpdateSetInput,
} from '../db/repo.ts'
import { daysAgo, startOfWeek } from '../logic/dates.ts'
import { earnedIncreases } from '../logic/plan.ts'

export const keys = {
  templates: ['templates'] as const,
  templateExercises: (id: number) => ['templates', id, 'exercises'] as const,
  activeSession: ['session', 'active'] as const,
  session: (id: number) => ['session', id] as const,
  sessionSets: (id: number) => ['session', id, 'sets'] as const,
  sessionExercises: (id: number) => ['session', id, 'exercises'] as const,
  recentPerformance: (ids: number[], exclude?: number) =>
    ['recentPerformance', [...ids].sort((a, b) => a - b), exclude ?? null] as const,
  /** Everything Home says about the past. One key so one invalidation covers
   *  the list, the totals and the muscle split together. */
  history: ['history'] as const,
  /** The library, the picker search and every exercise detail screen. */
  exercises: ['exercises'] as const,
  exercise: (id: number) => ['exercises', id] as const,
  /** The settings row, and the plates. Both read by the logging screen. */
  settings: ['settings'] as const,
  plates: ['plates'] as const,
}

export function useTemplates() {
  return useQuery({
    queryKey: keys.templates,
    queryFn: async () => listTemplates(await getDb()),
  })
}

export function useNextTemplate() {
  return useQuery({
    queryKey: [...keys.templates, 'next'],
    queryFn: async () => nextTemplate(await getDb()),
  })
}

export function useTemplateExercises(templateId: number | null | undefined) {
  return useQuery({
    queryKey: keys.templateExercises(templateId ?? -1),
    enabled: templateId != null,
    queryFn: async () => listTemplateExercises(await getDb(), templateId!),
  })
}

export function useActiveSession() {
  return useQuery({
    queryKey: keys.activeSession,
    queryFn: async () => activeSession(await getDb()),
  })
}

/**
 * The exercise picker's list, ordered by most recently performed.
 *
 * `keepPreviousData` is what stops the list blanking between keystrokes: the
 * query is a couple of milliseconds against a local file, so the flash of an
 * empty list would be the only thing anyone noticed.
 */
export function useExerciseSearch(term: string, limit?: number) {
  return useQuery({
    queryKey: [...keys.exercises, 'search', term, limit ?? null] as const,
    queryFn: async () => searchExercises(await getDb(), term, limit),
    placeholderData: (previous) => previous,
  })
}

/**
 * The settings row.
 *
 * Null until `seedDefaults` has run, and every caller falls back to the
 * constant it used before this existed rather than rendering nothing.
 */
export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: async () => getSettings(await getDb()),
  })
}

/**
 * Change a setting.
 *
 * Written straight through to SQLite rather than held in React state: a gym
 * setting that did not survive a force-stop would be worse than none, and the
 * backup story is `VACUUM INTO`, which only covers the database.
 */
export function useSetSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<AppSettings>) => setSettings(await getDb(), patch),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.settings })
    },
  })
}

/** The plates owned, in the shape `platesFor` takes. */
export function usePlateInventory() {
  return useQuery({
    queryKey: keys.plates,
    queryFn: async () => listPlateInventory(await getDb()),
  })
}

/** One exercise's metadata and its authored guidance. */
export function useExerciseDetail(exerciseId: number | null | undefined) {
  return useQuery({
    queryKey: keys.exercise(exerciseId ?? -1),
    enabled: exerciseId != null,
    queryFn: async () => exerciseDetail(await getDb(), exerciseId!),
  })
}

/** What five years of one exercise came to. */
export function useExerciseStats(exerciseId: number | null | undefined) {
  return useQuery({
    queryKey: [...keys.exercise(exerciseId ?? -1), 'stats'] as const,
    enabled: exerciseId != null,
    queryFn: async () => exerciseStats(await getDb(), exerciseId!),
  })
}

/**
 * One exercise's sessions, newest first.
 *
 * `sessions` grows the way `WorkoutHistory` grows its limit rather than
 * chasing a cursor, and the repo pages by rank so the extra pages can only
 * ever be whole sessions.
 */
export function useExerciseHistory(exerciseId: number | null | undefined, sessions: number) {
  return useQuery({
    queryKey: [...keys.exercise(exerciseId ?? -1), 'history', sessions] as const,
    enabled: exerciseId != null,
    queryFn: async () => exerciseHistory(await getDb(), exerciseId!, { sessions }),
    placeholderData: (previous) => previous,
  })
}

/** Any session by id - the summary reads this, not the active-session query. */
export function useSession(sessionId: number | null | undefined) {
  return useQuery({
    queryKey: keys.session(sessionId ?? -1),
    enabled: sessionId != null,
    queryFn: async () => sessionById(await getDb(), sessionId!),
  })
}

/**
 * What this workout is doing - the session's own copy, not the template.
 *
 * The template hook still exists for Home and for the template editor; a live
 * workout must never read it, or editing the workout would edit the programme.
 */
export function useSessionExercises(sessionId: number | null | undefined) {
  return useQuery({
    queryKey: keys.sessionExercises(sessionId ?? -1),
    enabled: sessionId != null,
    queryFn: async () => listSessionExercises(await getDb(), sessionId!),
  })
}

export function useSessionSets(sessionId: number | null | undefined) {
  return useQuery({
    queryKey: keys.sessionSets(sessionId ?? -1),
    enabled: sessionId != null,
    queryFn: async () => listSessionSets(await getDb(), sessionId!),
  })
}

/** Recent sessions for a whole template - one query, not one per exercise. */
export function useRecentPerformance(
  exerciseIds: number[],
  excludeSessionId?: number,
) {
  return useQuery({
    queryKey: keys.recentPerformance(exerciseIds, excludeSessionId),
    enabled: exerciseIds.length > 0,
    queryFn: async () =>
      recentPerformance(await getDb(), exerciseIds, { excludeSessionId }),
  })
}

/**
 * Past workouts, newest first.
 *
 * `limit` is part of the key, so `Load more` growing it is a fresh query rather
 * than a mutation of a cached page. Re-reading 50 rows out of a local file is
 * cheaper than the cursor bookkeeping `useInfiniteQuery` would need.
 */
export function useSessionHistory(limit: number, offset = 0) {
  return useQuery({
    queryKey: [...keys.history, 'list', limit, offset] as const,
    queryFn: async () => listSessionHistory(await getDb(), { limit, offset }),
    placeholderData: (previous) => previous,
  })
}

/**
 * Lifetime totals and training cadence.
 *
 * Today's date is in the key so the "this week" boundary cannot go stale in a
 * session left open across midnight - the numbers would otherwise be answering
 * yesterday's question.
 */
export function useHistoryStats() {
  const today = localDateOf()
  return useQuery({
    queryKey: [...keys.history, 'stats', today] as const,
    queryFn: async () =>
      historyStats(await getDb(), {
        weekStart: startOfWeek(today),
        fourWeeksAgo: daysAgo(today, 27),
      }),
  })
}

/** How the last four weeks of work was distributed across muscle groups. */
export function useSetsByMuscle(days = 28) {
  const since = daysAgo(localDateOf(), days - 1)
  return useQuery({
    queryKey: [...keys.history, 'muscles', since] as const,
    queryFn: async () => setsByMuscle(await getDb(), since),
  })
}

/**
 * How stale a session may be and still say anything about today.
 *
 * Four weeks. The programme runs about twice a week, so a movement untouched for
 * a month has been skipped for several rotations - and whatever it managed then
 * is no longer a claim about what it can manage now. The same window the muscle
 * balance uses, for the same reason: this is about recent training, not a record.
 */
const READY_MAX_AGE_DAYS = 28

/**
 * Which exercises of the next workout earned more load last time.
 *
 * Three queries, none of them in a loop: the next template, its exercises, and
 * one `recentPerformance` covering the whole list - the statement measured at
 * 14.7 ms for 8 exercises over the real database. Only the most recent session
 * of each is needed, so it asks for one rather than the logging screen's three.
 *
 * **Scoped twice over**: to the next workout's exercises, and to sessions inside
 * the recency window. The first is what stops it reading out all 87 exercises;
 * the second is what stops a movement dropped from the programme months ago
 * still announcing that it earned more load.
 *
 * Keyed under `history` so logging a set re-computes it; the exercise names come
 * back with it because the point is to say which, not how many.
 */
export function useReadyToAddLoad() {
  const { data: next } = useNextTemplate()
  const { data: planned } = useTemplateExercises(next?.id)
  const ids = (planned ?? []).map((p) => p.exerciseId)
  const since = daysAgo(localDateOf(), READY_MAX_AGE_DAYS - 1)

  const query = useQuery({
    queryKey: [...keys.history, 'ready', next?.id ?? null, ids] as const,
    enabled: ids.length > 0,
    queryFn: async () => recentPerformance(await getDb(), ids, { sessions: 1 }),
  })

  const earned = query.data ? earnedIncreases(planned ?? [], query.data, { since }) : []
  return {
    template: next ?? null,
    exercises: (planned ?? []).filter((p) => earned.includes(p.exerciseId)),
  }
}

/** Everything a logged set can change. */
const invalidateAfterSet = (client: QueryClient, sessionId: number) => {
  void client.invalidateQueries({ queryKey: keys.sessionSets(sessionId) })
  void client.invalidateQueries({ queryKey: ['recentPerformance'] })
  // Home's totals and its readiness list both count sets.
  void client.invalidateQueries({ queryKey: keys.history })
  // So do the library's per-exercise counts and the detail screen's history.
  void client.invalidateQueries({ queryKey: keys.exercises })
}

export function useStartSession() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: Parameters<typeof startSession>[1]) =>
      startSession(await getDb(), input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.activeSession })
      void client.invalidateQueries({ queryKey: keys.templates })
    },
  })
}

export function useLogSet() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: LogSetInput) => logSet(await getDb(), input),
    onSuccess: (_id, input) => invalidateAfterSet(client, input.sessionId),
  })
}

/**
 * Correct any set, not just the last one.
 *
 * `sessionId` is carried in the variables only so the invalidation can name its
 * key - the repo call does not need it. Same shape as the `undoLastSet` hook
 * this replaces.
 */
export function useUpdateSet() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (v: { setId: number; sessionId: number; patch: UpdateSetInput }) =>
      updateSet(await getDb(), v.setId, v.patch),
    onSuccess: (_r, v) => invalidateAfterSet(client, v.sessionId),
  })
}

export function useDeleteSet() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (v: { setId: number; sessionId: number }) =>
      deleteSet(await getDb(), v.setId),
    onSuccess: (_r, v) => invalidateAfterSet(client, v.sessionId),
  })
}

/** `Add set`, and un-planning one. Writes to the session, not the template. */
export function useSetPlannedSets() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (v: { sessionId: number; exerciseId: number; targetSets: number }) =>
      setPlannedSets(await getDb(), v.sessionId, v.exerciseId, v.targetSets),
    onSuccess: (_r, v) => {
      void client.invalidateQueries({ queryKey: keys.sessionExercises(v.sessionId) })
    },
  })
}

/**
 * Editing the workout in progress: add, remove, replace, reorder.
 *
 * One hook rather than four, because all four invalidate exactly the same key
 * and differ only in which repo call they make. `recentPerformance` is
 * invalidated too: it is keyed by the exercise ids on screen, and adding or
 * replacing changes that set.
 */
export function useEditSessionPlan(sessionId: number) {
  const client = useQueryClient()
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: keys.sessionExercises(sessionId) })
    void client.invalidateQueries({ queryKey: ['recentPerformance'] })
  }

  const add = useMutation({
    mutationFn: async (v: { exerciseId: number; targetSets?: number | null }) =>
      addSessionExercise(await getDb(), sessionId, v.exerciseId, v.targetSets ?? null),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (v: { exerciseId: number }) =>
      removeSessionExercise(await getDb(), sessionId, v.exerciseId),
    onSuccess: invalidate,
  })
  const replace = useMutation({
    mutationFn: async (v: { exerciseId: number; withExerciseId: number }) =>
      replaceSessionExercise(await getDb(), sessionId, v.exerciseId, v.withExerciseId),
    onSuccess: invalidate,
  })
  const reorder = useMutation({
    mutationFn: async (v: { exerciseIds: number[] }) =>
      reorderSessionExercises(await getDb(), sessionId, v.exerciseIds),
    onSuccess: invalidate,
  })
  const setPlan = useMutation({
    mutationFn: async (v: { exerciseId: number; patch: ExercisePlanPatch }) =>
      setExercisePlan(await getDb(), sessionPlan(sessionId), v.exerciseId, v.patch),
    onSuccess: invalidate,
  })

  return { add, remove, replace, reorder, setPlan }
}

/**
 * The same five edits, against the programme instead of one performance of it.
 *
 * **Deliberately does not invalidate `sessionExercises`.** A live session holds
 * its own snapshot of the plan, so a template edit must leave the workout on
 * screen exactly where it was; invalidating would refetch rows that did not
 * change and imply they might have.
 */
export function useEditTemplatePlan(templateId: number) {
  const client = useQueryClient()
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: keys.templateExercises(templateId) })
    // Home lists each template with its exercise count.
    void client.invalidateQueries({ queryKey: keys.templates })
  }

  const add = useMutation({
    mutationFn: async (v: { exerciseId: number; targetSets?: number | null }) =>
      addTemplateExercise(await getDb(), templateId, v.exerciseId, v.targetSets ?? null),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (v: { exerciseId: number }) =>
      removeTemplateExercise(await getDb(), templateId, v.exerciseId),
    onSuccess: invalidate,
  })
  const replace = useMutation({
    mutationFn: async (v: { exerciseId: number; withExerciseId: number }) =>
      replaceTemplateExercise(await getDb(), templateId, v.exerciseId, v.withExerciseId),
    onSuccess: invalidate,
  })
  const reorder = useMutation({
    mutationFn: async (v: { exerciseIds: number[] }) =>
      reorderTemplateExercises(await getDb(), templateId, v.exerciseIds),
    onSuccess: invalidate,
  })
  const setPlan = useMutation({
    mutationFn: async (v: { exerciseId: number; patch: ExercisePlanPatch }) =>
      setExercisePlan(await getDb(), templatePlan(templateId), v.exerciseId, v.patch),
    onSuccess: invalidate,
  })

  return { add, remove, replace, reorder, setPlan }
}

/**
 * Stop a rest that belongs to a workout that no longer exists.
 *
 * Measured on device: discarding a workout left the pill counting and the
 * foreground service alive, because the rest is owned by the service and
 * nothing told it the session had gone. Both the native timer and the store
 * have to be cleared - the service keeps counting without the first, and the
 * app bar keeps drawing without the second.
 */
const stopRest = () => {
  void RestTimer.cancel().catch(() => {
    // Web has no plugin, and a rest that was already over is not an error.
  })
  useWorkout.getState().clearRest()
}

export function useEndSession() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (sessionId: number) => endSession(await getDb(), sessionId),
    onSuccess: (_r, sessionId) => {
      void client.invalidateQueries({ queryKey: keys.activeSession })
      void client.invalidateQueries({ queryKey: keys.templates })
      // The summary is still on screen when this runs, reading the session it
      // just ended. Without this it would keep rendering a running duration.
      void client.invalidateQueries({ queryKey: keys.session(sessionId) })
      // Finishing is what moves a session INTO the history: every read there
      // filters on `ended_at_utc IS NOT NULL`.
      void client.invalidateQueries({ queryKey: keys.history })
      stopRest()
      // And a copy leaves the device. Fire and forget, and deliberately not
      // awaited: the summary is on screen and nothing about it depends on this.
      void (async () => {
        await exportNow(await getDb(), currentDatabaseUrl())
      })().catch((e: unknown) => console.warn('[export] after session', e))
    },
  })
}

export function useDiscardSession() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (sessionId: number) => discardSession(await getDb(), sessionId),
    onSuccess: (_r, sessionId) => {
      void client.invalidateQueries({ queryKey: keys.activeSession })
      void client.invalidateQueries({ queryKey: keys.templates })
      void client.invalidateQueries({ queryKey: ['recentPerformance'] })
      void client.invalidateQueries({ queryKey: keys.session(sessionId) })
      void client.invalidateQueries({ queryKey: keys.history })
      stopRest()
    },
  })
}
