/**
 * How each exercise is loaded, keyed by exact `exercises.name`.
 *
 * Two axes, filled by one seeder because the base-weight chain needs both:
 *
 * - `modality` is what the movement is performed with. The last link of the
 *   bar-weight chain only fires for `barbell`, which is why it matters here.
 * - `loading` is how weight is added: plates per side, plates in total, a pin
 *   stack, or a fixed implement. Only the two plate values make chips appear.
 *
 * **Absent means unknown, and unknown renders nothing.** A flat table like
 * `exerciseMuscles.ts` rather than a heuristic, and deliberately incomplete:
 * a `Machine*` row appears here only where a logged set proves how it loads.
 * Whether a given machine is plate-loaded per side or a selectorised stack is a
 * fact about one specific gym, not something inferable from a name, and a wrong
 * guess would put a plate breakdown under a pin stack. The rest get filled in
 * as they are confirmed, one at a time.
 *
 * `Machine ...` and `Smith Machine ...` are different pieces of equipment and
 * nothing here treats one as the other.
 *
 * `baseLb` is the bar or carriage before any plates, in pounds because that is
 * how a gym labels it and how the plate maths is done.
 *
 * **Six machines and the trap bar are stated because five years of logging says
 * so, and each one reconciles.** The bases and the per-side reading were both
 * read back out of the logged sets: `Trap bar 55lb` against a logged 235 lb is
 * 55 + 2 x 45, and `Machine weight 100 / 7x45 per side` against 730 lb is
 * 100 + 14 x 45. Per side rather than total is not inferable from the wording,
 * so it was checked arithmetically in every case rather than read off the note.
 */
import type { Loading, Modality } from '../db/schema.ts'

export interface Equipment {
  modality: Modality | null
  loading: Loading | null
  /** Bar, carriage or machine base in POUNDS. Absent means there is none. */
  baseLb?: number
}

/** An Olympic barbell, everywhere one is used. */
const BARBELL: Equipment = { modality: 'barbell', loading: 'plates_per_side', baseLb: 45 }
const DUMBBELL: Equipment = { modality: 'dumbbell', loading: 'fixed' }
const CABLE: Equipment = { modality: 'cable', loading: 'stack' }
const BODYWEIGHT: Equipment = { modality: 'bodyweight', loading: 'fixed' }
const OTHER: Equipment = { modality: 'other', loading: 'fixed' }

export const EQUIPMENT_BY_EXERCISE: Record<string, Equipment> = {
  // Barbell. The bar is named in every one of these, which is what makes them
  // safe to state.
  'Barbell Bench Press': BARBELL,
  'Barbell Curl': BARBELL,
  'Barbell Deadlift': BARBELL,
  'Barbell Front Squat': BARBELL,
  'Barbell Lunge': BARBELL,
  'Barbell Power Clean': BARBELL,
  'Barbell Push Press': BARBELL,
  'Barbell Reverse Lunge': BARBELL,
  'Barbell Shoulder Press': BARBELL,
  'Barbell Squat': BARBELL,
  'Bent-Over Barbell Row': BARBELL,
  'Hang Clean': BARBELL,
  'Incline Barbell Bench Press': BARBELL,
  'Lying Barbell Skull Crusher': BARBELL,
  'Romanian Deadlift': BARBELL,
  'Strict Barbell Press': BARBELL,

  // The trap bar is its own bar and its own weight, which is why `PROJECT.md`
  // calls the global 45 lb default a trap for exactly this lift. **55 lb, and
  // that is measured, not assumed**: one set carries the note `Trap bar 55lb`
  // and was logged at 235 lb, which is 55 + 2 x 45 exactly.
  'Trap Bar Deadlift': { modality: 'barbell', loading: 'plates_per_side', baseLb: 55 },

  // Smith machine: plates per side like a barbell, but the carriage is
  // counterbalanced, so the base is nothing like 45 lb.
  'Smith Machine Bulgarian Split Squat': {
    modality: 'machine',
    loading: 'plates_per_side',
    baseLb: 20,
  },
  'Smith Machine Incline Bench Press': {
    modality: 'machine',
    loading: 'plates_per_side',
    baseLb: 20,
  },

  // Plate-loaded machines, every one confirmed against a logged set rather
  // than guessed from its name. The rest of the `Machine*` rows are absent on
  // purpose: whether a machine is plate-loaded or a pin stack is a fact about
  // one gym, and a wrong guess would put a plate breakdown under a stack.
  'Hip Thrust': { modality: 'machine', loading: 'plates_per_side', baseLb: 15 },
  'Machine Calf Raise (Seated)': {
    modality: 'machine',
    loading: 'plates_per_side',
    baseLb: 60,
  },
  'Machine Hack Squat': { modality: 'machine', loading: 'plates_per_side', baseLb: 55 },
  'Machine Leg Press': { modality: 'machine', loading: 'plates_per_side', baseLb: 100 },
  'Machine V-Squat': { modality: 'machine', loading: 'plates_per_side', baseLb: 55 },

  // Dumbbells: fixed implements, so no chips and no base. Two-handed lifts log
  // the PAIR total, which `implement_count` already carries.
  'Dumbbell Curl': DUMBBELL,
  'Dumbbell Fly': DUMBBELL,
  'Dumbbell Hammer Curl': DUMBBELL,
  'Dumbbell Shoulder Press': DUMBBELL,
  'Dumbbell Shoulder Press (Seated)': DUMBBELL,
  'Dumbbell Shrug': DUMBBELL,
  'Dumbbell Side Raise': DUMBBELL,
  'Dumbbell Triceps Extension': DUMBBELL,
  "Farmer's Walk (with Dumbbells)": DUMBBELL,
  'Incline Dumbbell Bench Press': DUMBBELL,
  'Incline Dumbbell Curl': DUMBBELL,
  'Incline Dumbbell Hammer Curl': DUMBBELL,
  'Single-Arm Dumbbell Row on Bench': DUMBBELL,

  // Cables: a pin stack, so the number typed is the number on the pin.
  'Cable Crunch': CABLE,
  'Cable Face Pull': CABLE,
  'Cable Pushdown (with Bar Handle)': CABLE,
  'Cable Pushdown (with Rope Handle)': CABLE,
  'Cable Row': CABLE,
  'Pallof Press': CABLE,

  // Bodyweight, weighted or not. `Chinup` and `Chest Dip` appear in the history
  // both ways, which is why the tracking type stays what it is and only the
  // loading is stated here.
  Birddogs: BODYWEIGHT,
  'Box Jump': BODYWEIGHT,
  'Chest Dip': BODYWEIGHT,
  Chinup: BODYWEIGHT,
  Deadbug: BODYWEIGHT,
  'Jump Squat': BODYWEIGHT,
  'McGill Big 3': BODYWEIGHT,
  'Nordic Curl': BODYWEIGHT,
  Plank: BODYWEIGHT,

  // Kettlebells and cardio: no plates to solve either way.
  'Biking Indoors': OTHER,
  'Kettlebell Around the World': OTHER,
  'Kettlebell March': OTHER,
  'Running on Treadmill': OTHER,
  'Walking on Treadmill': OTHER,
}
