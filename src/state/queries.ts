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
  discardSession,
  endSession,
  lastPerformance,
  listSessionSets,
  listTemplateExercises,
  listTemplates,
  logSet,
  nextTemplate,
  startSession,
  undoLastSet,
  type LogSetInput,
} from '../db/repo.ts'

export const keys = {
  templates: ['templates'] as const,
  templateExercises: (id: number) => ['templates', id, 'exercises'] as const,
  activeSession: ['session', 'active'] as const,
  sessionSets: (id: number) => ['session', id, 'sets'] as const,
  lastPerformance: (ids: number[], exclude?: number) =>
    ['lastPerformance', [...ids].sort((a, b) => a - b), exclude ?? null] as const,
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

export function useSessionSets(sessionId: number | null | undefined) {
  return useQuery({
    queryKey: keys.sessionSets(sessionId ?? -1),
    enabled: sessionId != null,
    queryFn: async () => listSessionSets(await getDb(), sessionId!),
  })
}

/** Last session's sets for a whole template - one query, not one per exercise. */
export function useLastPerformance(
  exerciseIds: number[],
  excludeSessionId?: number,
) {
  return useQuery({
    queryKey: keys.lastPerformance(exerciseIds, excludeSessionId),
    enabled: exerciseIds.length > 0,
    queryFn: async () =>
      lastPerformance(await getDb(), exerciseIds, { excludeSessionId }),
  })
}

/** Everything a logged set can change. */
const invalidateAfterSet = (client: QueryClient, sessionId: number) => {
  void client.invalidateQueries({ queryKey: keys.sessionSets(sessionId) })
  void client.invalidateQueries({ queryKey: ['lastPerformance'] })
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

export function useUndoLastSet() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (sessionId: number) => undoLastSet(await getDb(), sessionId),
    onSuccess: (_removed, sessionId) => invalidateAfterSet(client, sessionId),
  })
}

export function useEndSession() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (sessionId: number) => endSession(await getDb(), sessionId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.activeSession })
      void client.invalidateQueries({ queryKey: keys.templates })
    },
  })
}

export function useDiscardSession() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (sessionId: number) => discardSession(await getDb(), sessionId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.activeSession })
      void client.invalidateQueries({ queryKey: keys.templates })
      void client.invalidateQueries({ queryKey: ['lastPerformance'] })
    },
  })
}
