/**
 * Read-only analyser for Progression's own app backup.
 *
 * `Examples/progression.*.pgnbkp` is plain JSON despite the extension - the
 * whole app state, not the flat CSV export. It carries four things the CSV
 * throws away: true epoch timestamps, the plan row each set was performed
 * against, a per-set `mark` (FORCED / FAILURE / PARTIAL / NEGATIVE), and the
 * programme definitions themselves.
 *
 * It does NOT carry exercise names. Every set names an `exerciseId`, and only
 * the user's own custom exercises appear in `exercises[]`; the built-in
 * catalogue is absent. So this script recovers the id -> name map by joining
 * each performance to the CSV export on timestamp, weight and reps. That join
 * is the reason both files are arguments.
 *
 * Nothing here writes a database. It prints and exits, like `profile.ts`.
 *
 * Eleven programmes going back years are in there, so only the active one is
 * printed in full unless `--all` is passed.
 *
 *   npm run analyze:backup [backup.pgnbkp] [export.csv] [--all]
 */
import { readFileSync } from 'node:fs'
import { parseCsv, toRecords } from '../src/logic/csv.ts'
import { COLUMNS } from '../src/logic/progression.ts'
import { MUSCLE_BY_EXERCISE } from '../src/logic/exerciseMuscles.ts'

const args = process.argv.slice(2)
const showAll = args.includes('--all')
const positional = args.filter((a) => !a.startsWith('--'))
const backupPath = positional[0] ?? 'Examples/progression.2026-08-13_20-35-55.pgnbkp'
const csvPath = positional[1] ?? 'Examples/2026-08-13_20-35-49.csv'

/**
 * The offsets the join is allowed to try, in order.
 *
 * The CSV writes local wall clock with no zone; the backup writes a true epoch.
 * The difference between them IS the offset that was in force that day, so the
 * set of offsets that produce matches is a measurement rather than a guess.
 * -7 and -8 are Mountain daylight and standard time.
 */
const OFFSETS_H = [-7, -8]

/**
 * Progression's muscle vocabulary against ours.
 *
 * Two known, deliberate divergences, so a disagreement on either is not a
 * finding: it has no `CALVES` (we split them out of legs, because the standing
 * and seated raises are both in the current programme), and it has `FOREARMS`,
 * which we do not model at all.
 */
const MUSCLE_ALIASES: Record<string, string | null> = {
  ABS: 'abs',
  BACK: 'back',
  BICEPS: 'biceps',
  CHEST: 'chest',
  FOREARMS: null,
  LEGS: 'legs',
  SHOULDERS: 'shoulders',
  TRICEPS: 'triceps',
}

interface Performance {
  id: string
  exerciseId: string
  completedAt: number
  weight?: number
  repetitions?: number
  [key: string]: unknown
}
interface Plan {
  rest?: number
  duration?: number
  repetitionRange?: { min: number; max: number }
}
interface Movement {
  exerciseId: string
  note?: string
  plans: Plan[]
}
interface Workout {
  id: string
  name: string
  description?: string
  movements: Movement[]
}
interface Session {
  id: string
  startTime: number
  endTime: number
  workout: Workout
  performances?: Performance[]
}
interface BackupExercise {
  id: string
  name: string
  muscles?: string[]
  equipment?: string
  category?: string
}
interface Backup {
  sessions: Session[]
  exercises: BackupExercise[]
  programs: { id: string; name: string; active?: boolean; weeks: { routines: { workout: Workout }[] }[] }[]
  profile: { preferences: Record<string, unknown> }
  config: { plateAvailability: Record<string, number>; [key: string]: unknown }
}

const backup: Backup = JSON.parse(readFileSync(backupPath, 'utf8'))
const csvRecords = toRecords(parseCsv(readFileSync(csvPath, 'utf8')))

const rule = (label: string) => console.log(`\n${label}\n${'─'.repeat(78)}`)
const pad2 = (n: number) => String(n).padStart(2, '0')

console.log(`backup          ${backupPath}`)
console.log(`export          ${csvPath}`)

// ---------------------------------------------------------------------------
// 1. Structure
// ---------------------------------------------------------------------------
rule('structure')

const allPerformances = backup.sessions.flatMap((s) => s.performances ?? [])
console.log(`sessions        ${backup.sessions.length}`)
console.log(`performances    ${allPerformances.length}`)
console.log(`exercises[]     ${backup.exercises.length}  (custom only - built-ins are not in the file)`)
console.log(`programs        ${backup.programs.length}`)

const perfFields = new Map<string, number>()
for (const p of allPerformances)
  for (const k of Object.keys(p)) perfFields.set(k, (perfFields.get(k) ?? 0) + 1)
console.log('\nperformance fields, and how many rows carry each:')
for (const [field, n] of [...perfFields].sort((a, b) => b[1] - a[1]))
  console.log(`  ${field.padEnd(14)} ${String(n).padStart(5)}`)

// `mark` is the one with no CSV counterpart at all, so spell out its values.
const marks = new Map<string, number>()
for (const p of allPerformances) if (typeof p.mark === 'string') marks.set(p.mark, (marks.get(p.mark) ?? 0) + 1)
if (marks.size > 0) {
  console.log('\nmark values (no column exists for these in the CSV export):')
  for (const [m, n] of [...marks].sort((a, b) => b[1] - a[1])) console.log(`  ${m.padEnd(14)} ${n}`)
}

// ---------------------------------------------------------------------------
// 2. The id -> name join
// ---------------------------------------------------------------------------
rule('exercise id -> name, recovered by joining to the CSV')

// Key on clock-time + weight + reps, then confirm the date, so a row is only
// claimed when all four agree.
const csvByKey = new Map<string, { date: string; name: string; sessionDate: string }[]>()
for (const { record } of csvRecords) {
  const clock = record[COLUMNS.setTimestamp].slice(0, 8)
  const weight = Number.parseFloat(record[COLUMNS.weight]) || ''
  const reps = Number.parseFloat(record[COLUMNS.reps]) || ''
  const key = `${clock}|${weight}|${reps}`
  const entry = {
    date: record[COLUMNS.date],
    name: record[COLUMNS.exercise],
    sessionDate: `${record[COLUMNS.date]} ${record[COLUMNS.time]}`,
  }
  const bucket = csvByKey.get(key)
  if (bucket) bucket.push(entry)
  else csvByKey.set(key, [entry])
}

const namesById = new Map<string, Set<string>>()
const offsetHits = new Map<number, number>()
const unmatched: Performance[] = []

for (const p of allPerformances) {
  let matched: string | null = null
  for (const offset of OFFSETS_H) {
    const d = new Date(p.completedAt + offset * 3_600_000)
    const clock = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
    const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
    const key = `${clock}|${p.weight ?? ''}|${p.repetitions ?? ''}`
    const hit = (csvByKey.get(key) ?? []).find((c) => c.date === date)
    if (hit) {
      matched = hit.name
      offsetHits.set(offset, (offsetHits.get(offset) ?? 0) + 1)
      break
    }
  }
  if (matched === null) {
    unmatched.push(p)
    continue
  }
  const set = namesById.get(p.exerciseId)
  if (set) set.add(matched)
  else namesById.set(p.exerciseId, new Set([matched]))
}

const matchedCount = allPerformances.length - unmatched.length
console.log(`matched         ${matchedCount}/${allPerformances.length}`)
console.log(`distinct ids    ${namesById.size}`)
console.log(
  `offsets used    ${[...offsetHits]
    .sort((a, b) => b[1] - a[1])
    .map(([o, n]) => `${o >= 0 ? '+' : ''}${o}h: ${n}`)
    .join(', ')}  <- both present, i.e. daylight saving`,
)

const ambiguous = [...namesById].filter(([, names]) => names.size > 1)
console.log(`ambiguous ids   ${ambiguous.length}`)
for (const [id, names] of ambiguous) console.log(`  ${id} -> ${[...names].join(' | ')}`)

// Listed, never swallowed. A row that fails the date check but matches on clock
// and load is in the CSV under a different date - which is exactly what a
// session spanning midnight looks like, since `Date` is the session's END date.
if (unmatched.length > 0) {
  console.log(`\nunmatched performances (${unmatched.length}):`)
  for (const p of unmatched) {
    let note = 'no CSV row with this clock, weight and reps at all'
    for (const offset of OFFSETS_H) {
      const d = new Date(p.completedAt + offset * 3_600_000)
      const clock = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
      const loose = csvByKey.get(`${clock}|${p.weight ?? ''}|${p.repetitions ?? ''}`)
      if (loose && loose.length > 0) {
        note = `CSV files it under session ${loose[0].sessionDate} as ${loose[0].name}`
        break
      }
    }
    const d = new Date(p.completedAt + OFFSETS_H[0] * 3_600_000)
    console.log(
      `  performed ${d.toISOString().slice(0, 19).replace('T', ' ')}  ` +
        `weight ${p.weight ?? '-'}  reps ${p.repetitions ?? '-'}`,
    )
    console.log(`      ${note}`)
  }
}

// ---------------------------------------------------------------------------
// 3. Coverage: what the backup can and cannot say about an exercise
// ---------------------------------------------------------------------------
rule('metadata coverage - the ceiling on any exercises.loading backfill')

const customById = new Map(backup.exercises.map((e) => [e.id, e]))
const withMeta: BackupExercise[] = []
const withoutMeta: string[] = []
for (const [id, names] of namesById) {
  const custom = customById.get(id)
  if (custom) withMeta.push(custom)
  else withoutMeta.push([...names][0])
}

console.log(`custom, with equipment + muscles   ${withMeta.length}`)
console.log(`built-in, no metadata in the file  ${withoutMeta.length}`)

const byEquipment = new Map<string, string[]>()
for (const e of withMeta) {
  const key = e.equipment ?? '(none)'
  const bucket = byEquipment.get(key)
  if (bucket) bucket.push(e.name)
  else byEquipment.set(key, [e.name])
}
console.log('\ncustom exercises by equipment:')
for (const [equipment, names] of [...byEquipment].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${equipment.padEnd(15)} ${names.length}`)
  for (const n of names.sort()) console.log(`      ${n}`)
}

console.log('\nbuilt-in exercises, name known only from the CSV:')
for (const n of withoutMeta.sort()) console.log(`  ${n}`)

// ---------------------------------------------------------------------------
// 4. Muscle cross-check. Reports, never throws.
// ---------------------------------------------------------------------------
rule('muscle cross-check against src/logic/exerciseMuscles.ts')

let agreed = 0
const disagreements: string[] = []
const unmapped: string[] = []
for (const e of withMeta) {
  const theirs = (e.muscles ?? [])[0]
  if (theirs === undefined) continue
  if (!(theirs in MUSCLE_ALIASES)) {
    unmapped.push(`${e.name}: unknown Progression group "${theirs}"`)
    continue
  }
  const mapped = MUSCLE_ALIASES[theirs]
  if (mapped === null) {
    unmapped.push(`${e.name}: "${theirs}" has no counterpart in our eight groups`)
    continue
  }
  const ours = MUSCLE_BY_EXERCISE[e.name]
  if (ours === undefined) unmapped.push(`${e.name}: not in MUSCLE_BY_EXERCISE`)
  else if (ours === mapped) agreed++
  else disagreements.push(`${e.name}: ours "${ours ?? 'null'}" vs theirs "${theirs}"`)
}
console.log(`agreed          ${agreed}`)
console.log(`disagreed       ${disagreements.length}`)
for (const d of disagreements) console.log(`  ${d}`)
if (unmapped.length > 0) {
  console.log(`not comparable  ${unmapped.length}`)
  for (const u of unmapped) console.log(`  ${u}`)
}

// ---------------------------------------------------------------------------
// 5. Settings
// ---------------------------------------------------------------------------
rule('settings')

console.log('profile.preferences:')
for (const [k, v] of Object.entries(backup.profile.preferences))
  console.log(`  ${k.padEnd(24)} ${JSON.stringify(v)}`)

const plates = Object.entries(backup.config.plateAvailability ?? {})
console.log(`\nconfig.plateAvailability: ${plates.length} entr${plates.length === 1 ? 'y' : 'ies'}`)
for (const [id, count] of plates) console.log(`  ${id}  count ${count}`)
console.log(
  '  The ids are opaque and no plate table ships in the backup, so this does\n' +
    '  NOT enumerate the inventory. It only says which plates were overridden.',
)

// ---------------------------------------------------------------------------
// 6. Programmes, resolved to names
// ---------------------------------------------------------------------------
rule(
  'programmes, with exercise ids resolved' +
    (showAll ? '' : '  (active only - pass --all for the archived ones)'),
)

const nameOf = (id: string) =>
  [...(namesById.get(id) ?? [])][0] ?? customById.get(id)?.name ?? `(unknown ${id})`

for (const program of backup.programs) {
  const workouts = program.weeks.flatMap((w) => w.routines).map((r) => r.workout)
  if (!showAll && program.active !== true) {
    console.log(`\n${program.name}  - ${workouts.length} workout(s), not active, skipped`)
    continue
  }
  console.log(`\n${program.name}${program.active ? '  [active]' : ''}  - ${workouts.length} workout(s)`)
  for (const workout of workouts) {
    console.log(`  ## ${workout.name}${workout.description ? `  ${JSON.stringify(workout.description)}` : ''}`)
    for (const m of workout.movements) {
      const first = m.plans[0] ?? {}
      // A range can be half-open: `Box Jump` carries a max with no min.
      const range = first.repetitionRange
      const reps = range
        ? `${range.min ?? '?'}-${range.max ?? '?'}`
        : first.duration
          ? `${first.duration / 1000}s`
          : '-'
      const rest = first.rest === undefined ? 'unset' : `${first.rest / 1000}s`
      console.log(
        `     ${nameOf(m.exerciseId).padEnd(38)} ${String(m.plans.length)} x ${reps.padEnd(7)} rest ${rest}`,
      )
    }
  }
}
