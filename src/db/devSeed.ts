/**
 * Fabricated history, for the browser only.
 *
 * `npm run dev` runs against a jeep-sqlite database in IndexedDB that starts
 * empty, so every screen that reads the past - the last-session panel, the
 * history cards, the prefill chain, Home - rendered its empty state and nothing
 * else. That made UI work impossible without a phone attached.
 *
 * **The data here is invented.** It is not derived from `Examples/`, and it must
 * never be: that directory holds the only copy of the real export, including
 * medical notes in `Set Comment`, and nothing from it may be committed or
 * bundled. The exercise names come from `logic/plan.ts`, which is committed and
 * is the legitimate source for them.
 *
 * Three guards keep it off the phone and out of real data. Two of them - web
 * only, and dev only - live in `open.ts`, deliberately: importing anything from
 * this module statically would defeat the dynamic import that keeps all of this
 * out of the device bundle. The third, "only into an empty database", is here in
 * `seedDevData`, which is what makes it safe to call on every launch.
 */
import type { Db } from './driver.ts'
import { PLAN, type PlannedDay } from '../logic/plan.ts'
import { toKg } from '../logic/units.ts'
import { localDateOf } from './repo.ts'
import { seedExerciseMuscles } from './seedMuscles.ts'
import { seedPlanTemplates } from './seedPlan.ts'

/**
 * Plausible working weights in lb, one per exercise in the plan.
 *
 * Hand-written rather than generated, because the point of the seed is a screen
 * that looks like a real training log: a Trap Bar Deadlift at 355 and a Cable
 * Face Pull at 50 read as a person's numbers, and a hash of the name does not.
 * They are still invented, and nothing should be concluded from them.
 */
const START_LB: Record<string, number> = {
  'Trap Bar Deadlift': 315,
  'Smith Machine Bulgarian Split Squat': 95,
  'Smith Machine Incline Bench Press': 155,
  'Bent-Over Barbell Row': 155,
  'Machine Shoulder Press': 120,
  'Assisted Pullup': 40,
  'Machine Calf Raise': 180,
  'Pallof Press': 40,
  'Incline Dumbbell Hammer Curl': 50,
  'Chest Dip': 25,
  'Romanian Deadlift': 225,
  'Machine Leg Curl': 110,
  'Machine Single-Leg Extension': 85,
  'Machine Calf Raise (Seated)': 90,
  'Machine Chest Press': 160,
  'Machine Row': 150,
  'Machine Lateral Raise': 60,
  'Cable Face Pull': 50,
  'Machine Preacher Curl': 70,
  'Cable Pushdown (with Bar Handle)': 80,
  'Cable Crunch': 100,
}

/** Fallback for an exercise the table above has no entry for. */
const DEFAULT_START_LB = 100

/** How many past sessions to write, alternating templates. */
const SESSIONS = 8
/** Days between them. Two sessions a week, which is what A/B rolling looks like. */
const DAYS_APART = 3.5
/** Load added each time an exercise comes round. */
const PROGRESSION_LB = 5

export interface DevSeedResult {
  sessions: number
  sets: number
}

/**
 * Deterministic pseudo-randomness.
 *
 * Reps have to vary or every history card reads identically and the highlighted
 * row proves nothing, but `Math.random` would make the seed a different database
 * on every reload and any UI oddity impossible to reproduce.
 */
function wobble(seed: number): number {
  const x = Math.sin(seed) * 10_000
  return x - Math.floor(x)
}

/**
 * Write templates, muscle groups and fabricated history into an empty database.
 *
 * Returns null when the database already holds a session, which is what makes
 * this safe to call on every launch.
 */
export async function seedDevData(db: Db): Promise<DevSeedResult | null> {
  const existing = await db.queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM sessions WHERE deleted_at IS NULL',
  )
  if ((existing?.n ?? 0) > 0) return null

  // Templates first: the web database has no exercises either, and
  // `seedPlanTemplates` creates the ones the plan introduces.
  await seedPlanTemplates(db)
  await seedExerciseMuscles(db)

  const names = [...new Set(PLAN.flatMap((d) => d.exercises.map((e) => e.exercise)))]
  const idByName = new Map(
    (
      await db.query<{ id: number; name: string }>(
        `SELECT id, name FROM exercises
          WHERE deleted_at IS NULL AND name IN (${names.map(() => '?').join(', ')})`,
        names,
      )
    ).map((r) => [r.name, r.id]),
  )

  const templateIdByName = new Map(
    (
      await db.query<{ id: number; name: string }>(
        'SELECT id, name FROM templates WHERE deleted_at IS NULL',
      )
    ).map((r) => [r.name, r.id]),
  )

  const day = new Date()
  let sets = 0

  // Oldest first, so each exercise's weight climbs toward the present and the
  // most recent session - the one that prefills - is the heaviest.
  for (let i = SESSIONS; i >= 1; i--) {
    const plan: PlannedDay = PLAN[(SESSIONS - i) % PLAN.length]
    const templateId = templateIdByName.get(plan.name) ?? null

    const startedAt = new Date(day.getTime() - i * DAYS_APART * 86_400_000)
    // A plausible hour, and a session about an hour long.
    startedAt.setHours(17, 30, 0, 0)
    const startedAtUtc = startedAt.getTime()
    const endedAtUtc = startedAtUtc + 55 * 60_000

    const { lastInsertId: sessionId } = await db.exec(
      `INSERT INTO sessions
         (name, started_at_utc, ended_at_utc, local_date, template_id, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'native', ?, ?)`,
      [
        plan.name,
        startedAtUtc,
        endedAtUtc,
        localDateOf(startedAt),
        templateId,
        endedAtUtc,
        endedAtUtc,
      ],
    )

    // How many times this exercise has come round already, which is what the
    // load climbs with. Integer division because the plan alternates days.
    const round = Math.floor((SESSIONS - i) / PLAN.length)

    // One batch per session, not one statement per set: the rule in driver.ts
    // is that a loop of queries is a loop of bridge crossings.
    const statements: { sql: string; params: (string | number | null)[] }[] = []
    let orderIndex = 0

    for (const [exIndex, planned] of plan.exercises.entries()) {
      const exerciseId = idByName.get(planned.exercise)
      if (exerciseId == null) continue

      const lb = (START_LB[planned.exercise] ?? DEFAULT_START_LB) + round * PROGRESSION_LB

      for (let setIndex = 0; setIndex < planned.sets; setIndex++) {
        const spread = planned.repMax - planned.repMin
        const reps =
          planned.repMin + Math.round(wobble(i * 31 + exIndex * 7 + setIndex) * spread)

        statements.push({
          sql: `INSERT INTO sets
                  (session_id, exercise_id, order_index, set_index, performed_at_utc,
                   weight_kg, entered_value, entered_unit, reps, set_type, source,
                   created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'lb', ?, 'working', 'native', ?, ?)`,
          params: [
            sessionId,
            exerciseId,
            orderIndex,
            setIndex,
            // Spread through the session so `order_index` and the timestamps
            // agree, which is what the history cards sort on.
            startedAtUtc + orderIndex * 3 * 60_000,
            toKg(lb, 'lb'),
            lb,
            reps,
            endedAtUtc,
            endedAtUtc,
          ],
        })
        orderIndex++
        sets++
      }
    }

    await db.batch(statements)
  }

  return { sessions: SESSIONS, sets }
}
