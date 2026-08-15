/**
 * Which muscle group each exercise belongs to.
 *
 * `exercises.primary_muscle` is nullable free text and arrived from the export
 * empty for all 86 rows, so something has to fill it. This is that something:
 * a flat name -> group table rather than a name-matching heuristic, because the
 * heuristics all fail on the cases that matter here. `Machine Fly` is chest and
 * `Machine Rear Delt Fly` is shoulders; `Machine Leg Curl` is legs and
 * `Nordic Curl` is legs while every other `Curl` is biceps.
 *
 * Keys are exact `exercises.name` values, verified against the database rather
 * than typed from memory. `seedExerciseMuscles` reports any name it cannot
 * find, so a rename shows up as a failing test instead of a silent `?` badge.
 *
 * **`null` means deliberately unclassified**, not "not done yet". Cardio and
 * general mobility have no single primary group, and `muscleMark` renders them
 * as the neutral `?` circle. Guessing would be worse than admitting it: the
 * whole point of the colour is that it is reliable at a glance.
 */
import type { Muscle } from './muscles.ts'

export const MUSCLE_BY_EXERCISE: Record<string, Muscle | null> = {
  // Chest
  'Barbell Bench Press': 'chest',
  'Chest Dip': 'chest',
  'Dumbbell Fly': 'chest',
  'Incline Barbell Bench Press': 'chest',
  'Incline Dumbbell Bench Press': 'chest',
  'Machine Chest Press': 'chest',
  'Machine Fly': 'chest',
  'Smith Machine Incline Bench Press': 'chest',

  // Back
  'Assisted Chinup': 'back',
  'Assisted Pullup': 'back',
  'Back Strengthening': 'back',
  'Bent-Over Barbell Row': 'back',
  'Cable Row': 'back',
  Chinup: 'back',
  'Dumbbell Shrug': 'back',
  'Machine Hyperextension': 'back',
  'Machine Lat Pulldown': 'back',
  'Machine Row': 'back',
  'Single-Arm Dumbbell Row on Bench': 'back',
  'Upper Back Machine Row': 'back',

  // Shoulders
  'Barbell Push Press': 'shoulders',
  'Barbell Shoulder Press': 'shoulders',
  'Cable Face Pull': 'shoulders',
  'Dumbbell Shoulder Press': 'shoulders',
  'Dumbbell Shoulder Press (Seated)': 'shoulders',
  'Dumbbell Side Raise': 'shoulders',
  'Machine Lateral Raise': 'shoulders',
  'Machine Rear Delt Fly': 'shoulders',
  'Machine Shoulder Press': 'shoulders',
  'Shoulder Mobility': 'shoulders',
  'Shoulder Rotation (Rotator Cuff)': 'shoulders',
  'Strict Barbell Press': 'shoulders',

  // Biceps
  'Barbell Curl': 'biceps',
  'Bicep Physio Curl': 'biceps',
  'Dumbbell Curl': 'biceps',
  'Dumbbell Hammer Curl': 'biceps',
  'Incline Dumbbell Curl': 'biceps',
  'Incline Dumbbell Hammer Curl': 'biceps',
  'Machine Biceps Curl': 'biceps',
  'Machine Preacher Curl': 'biceps',

  // Triceps
  'Cable Pushdown (with Bar Handle)': 'triceps',
  'Cable Pushdown (with Rope Handle)': 'triceps',
  'Dumbbell Triceps Extension': 'triceps',
  'Lying Barbell Skull Crusher': 'triceps',
  'Machine Triceps Extension': 'triceps',

  // Legs. Deadlift variants sit here rather than under back: the programme
  // treats them as the hinge that opens a leg day.
  'Barbell Deadlift': 'legs',
  'Barbell Front Squat': 'legs',
  'Barbell Lunge': 'legs',
  'Barbell Power Clean': 'legs',
  'Barbell Reverse Lunge': 'legs',
  'Barbell Squat': 'legs',
  'Box Jump': 'legs',
  'Bulgarian Split Squat': 'legs',
  'Hang Clean': 'legs',
  'Hip Thrust': 'legs',
  'Jump Squat': 'legs',
  'Leg Extensions (Knee Rehab)': 'legs',
  'Machine Hack Squat': 'legs',
  'Machine Leg Curl': 'legs',
  'Machine Leg Extension': 'legs',
  'Machine Leg Press': 'legs',
  'Machine Single-Leg Extension': 'legs',
  'Machine Thigh Abduction (Out)': 'legs',
  'Machine Thigh Adduction (In)': 'legs',
  'Machine V-Squat': 'legs',
  'Nordic Curl': 'legs',
  'Romanian Deadlift': 'legs',
  'Smith Machine Bulgarian Split Squat': 'legs',
  'Trap Bar Deadlift': 'legs',

  // Calves. Standing and seated are separate exercises, deliberately.
  'Machine Calf Raise': 'calves',
  'Machine Calf Raise (Seated)': 'calves',

  // Abs and core. Loaded carries live here: they are trained as anti-rotation
  // and anti-lateral-flexion work, which is also why Pallof Press joins them.
  'Ab Machine': 'abs',
  Birddogs: 'abs',
  'Cable Crunch': 'abs',
  Deadbug: 'abs',
  "Farmer's Walk (with Dumbbells)": 'abs',
  'Kettlebell Around the World': 'abs',
  'Kettlebell March': 'abs',
  'McGill Big 3': 'abs',
  'Machine Ab Crunch': 'abs',
  'Pallof Press': 'abs',
  Plank: 'abs',
  'Suitcase Carry': 'abs',

  // Deliberately unclassified - no single primary group.
  'Biking Indoors': null,
  Mobility: null,
  'Running on Treadmill': null,
  'Walking on Treadmill': null,
}
