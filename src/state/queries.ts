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
import { getDb } from '../db/open.ts'
import {
  activeSession,
  addSessionExercise,
  deleteSet,
  removeSessionExercise,
  reorderSessionExercises,
  replaceSessionExercise,
  discardSession,
  endSession,
  recentPerformance,
  listSessionExercises,
  listSessionSets,
  listTemplateExercises,
  listTemplates,
  logSet,
  nextTemplate,
  searchExercises,
  sessionById,
  setPlannedSets,
  startSession,
  updateSet,
  type LogSetInput,
  type UpdateSetInput,
} from '../db/repo.ts'

export const keys = {
  templates: ['templates'] as const,
  templateExercises: (id: number) => ['templates', id, 'exercises'] as const,
  activeSession: ['session', 'active'] as const,
  session: (id: number) => ['session', id] as const,
  sessionSets: (id: number) => ['session', id, 'sets'] as const,
  sessionExercises: (id: number) => ['session', id, 'exercises'] as const,
  recentPerformance: (ids: number[], exclude?: number) =>
    ['recentPerformance', [...ids].sort((a, b) => a - b), exclude ?? null] as const,
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
export function useExerciseSearch(term: string) {
  return useQuery({
    queryKey: ['exercises', 'search', term] as const,
    queryFn: async () => searchExercises(await getDb(), term),
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

/** Everything a logged set can change. */
const invalidateAfterSet = (client: QueryClient, sessionId: number) => {
  void client.invalidateQueries({ queryKey: keys.sessionSets(sessionId) })
  void client.invalidateQueries({ queryKey: ['recentPerformance'] })
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

  return { add, remove, replace, reorder }
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
    },
  })
}
