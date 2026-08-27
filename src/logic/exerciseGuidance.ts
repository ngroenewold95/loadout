/**
 * Authored coaching cues, keyed by exact `exercises.name`.
 *
 * **This is authored content, not a measurement.** Nothing here was derived
 * from the export or from the reference app; it is written from general
 * training knowledge and reviewed by hand. `PROJECT.md` states facts that were
 * measured, so this file says outright that these are not.
 *
 * The value is one string of newline separated lines, one cue per line, which
 * the detail screen renders as bullets. One column, no parser, no schema for
 * structure. An exercise with nothing written for it is simply absent from the
 * table and renders "no guidance yet".
 *
 * The 21 programme exercises in `plan.ts` are authored first, because those are
 * the ones read under a bar. Keys are exact names, and `seedExerciseGuidance`
 * reports any live exercise the table cannot find, so a rename surfaces as a
 * failing test rather than a silently empty screen.
 */
/**
 * The stored string, as lines to render.
 *
 * One parse, used by both surfaces that show cues: the exercise detail screen
 * and the info sheet on the logging screen. Blank lines are dropped rather than
 * rendered as empty bullets, because the column is hand-authored and a trailing
 * newline is not a cue.
 */
export function guidanceCues(guidance: string | null | undefined): string[] {
  return (guidance ?? '').split('\n').filter((line) => line.trim().length > 0)
}

export const GUIDANCE_BY_EXERCISE: Record<string, string> = {
  // Day A - Trap Bar
  'Trap Bar Deadlift': [
    'Set the hips lower than a conventional pull, chest up, arms straight.',
    'Push the floor away rather than pulling with the back.',
    'Lock out by squeezing the glutes, not by leaning back.',
    'Reset the brace on the floor between reps rather than bouncing.',
  ].join('\n'),
  'Smith Machine Bulgarian Split Squat': [
    'Rear foot on the bench, front foot far enough forward that the knee stays over the midfoot.',
    'Drop straight down, torso slightly forward, weight through the front heel.',
    'Stop when the rear knee is just off the floor.',
    'Finish every rep on one leg before switching.',
  ].join('\n'),
  'Smith Machine Incline Bench Press': [
    'Bench at about 30 degrees, eyes under the bar.',
    'Shoulder blades pinned back and down for the whole set.',
    'Touch the upper chest, elbows about 45 degrees from the body.',
    'Press without letting the shoulders roll forward at lockout.',
  ].join('\n'),
  'Bent-Over Barbell Row': [
    'Hinge to roughly 45 degrees and hold that angle for every rep.',
    'Pull to the lower ribs, elbows past the torso.',
    'Lead with the elbows, not the hands.',
    'Lower under control; the torso rising is the set ending.',
  ].join('\n'),
  'Machine Shoulder Press': [
    'Set the seat so the handles start at shoulder height, not above.',
    'Ribs down, no arching away from the pad.',
    'Press until the elbows are almost straight, then stop.',
    'Lower to the start rather than letting the stack touch down.',
  ].join('\n'),
  'Assisted Pullup': [
    'The number is assistance: less weight is a harder set.',
    'Start from a full hang, shoulders pulled down before the arms bend.',
    'Chin over the bar without craning the neck.',
    'Lower all the way; the bottom half is the part that builds it.',
  ].join('\n'),
  'Machine Calf Raise': [
    'Balls of the feet on the platform, heels free to drop.',
    'Full stretch at the bottom, and pause a beat there.',
    'Drive to the top and hold for a count.',
    'Knees stay straight; bending them turns it into a different lift.',
  ].join('\n'),
  'Pallof Press': [
    'Stand side on to the cable, feet about shoulder width.',
    'Press straight out from the sternum and resist the twist.',
    'Ribs down and glutes tight; nothing should rotate.',
    'Ten each side, and the side facing the machine works hardest.',
  ].join('\n'),
  'Incline Dumbbell Hammer Curl': [
    'Bench at about 45 degrees, arms hanging straight down behind the body.',
    'Neutral grip throughout, thumbs up.',
    'Curl without letting the elbows drift forward.',
    'Lower slowly to a full stretch; the incline is the point.',
  ].join('\n'),
  'Chest Dip': [
    'Lean the torso forward to bias the chest rather than the triceps.',
    'Elbows flare slightly out, not pinned to the ribs.',
    'Descend until the shoulders are just below the elbows, no deeper.',
    'This is the unassisted one; the machine version is its own exercise.',
  ].join('\n'),
  'Assisted Chest Dip': [
    'Same movement, with the machine carrying part of you.',
    'Lean the torso forward to bias the chest rather than the triceps.',
    'Descend until the shoulders are just below the elbows, no deeper.',
    'The number is assistance: less of it is the harder set, and the progress.',
  ].join('\n'),

  // Day B - RDL
  'Romanian Deadlift': [
    'Start standing, unlock the knees and leave them there.',
    'Push the hips back and let the bar drag down the thighs.',
    'Stop where the hamstrings stop, usually mid shin, not the floor.',
    'Stand up by driving the hips forward, back flat throughout.',
  ].join('\n'),
  'Machine Leg Curl': [
    'Line the knees up with the machine pivot before starting.',
    'Hips stay down on the pad the whole set.',
    'Curl fully, hold a beat, then lower under control.',
    'Toes pulled toward the shins keeps the load on the hamstrings.',
  ].join('\n'),
  'Machine Single-Leg Extension': [
    'One leg at a time, so the strong side cannot cover for the weak one.',
    'Knee lined up with the pivot, back against the pad.',
    'Extend to straight, pause, then lower slowly.',
    'Match the reps on the second leg to the first, not to what it could do.',
  ].join('\n'),
  'Machine Calf Raise (Seated)': [
    'Seated bends the knee, which shifts the work to the soleus.',
    'Pad low on the thighs, not on the knees.',
    'Full drop at the bottom, full squeeze at the top.',
    'Slower than feels necessary; short bouncy reps do nothing here.',
  ].join('\n'),
  'Machine Chest Press': [
    'Seat height so the handles sit at mid chest.',
    'Shoulder blades back against the pad before the first rep.',
    'Press to almost straight, without shrugging.',
    'Control the return until the chest is stretched, then go again.',
  ].join('\n'),
  'Machine Row': [
    'Chest against the pad, no rocking to start the rep.',
    'Pull the elbows back past the ribs.',
    'Squeeze the shoulder blades together at the end of the pull.',
    'Let the arms straighten fully between reps.',
  ].join('\n'),
  'Machine Lateral Raise': [
    'Pads on the upper arms, not the forearms.',
    'Raise to shoulder height and no higher.',
    'Lead with the elbows and keep the traps out of it.',
    'Lower slowly rather than dropping back to the stack.',
  ].join('\n'),
  'Cable Face Pull': [
    'Cable set at about head height, rope in a neutral grip.',
    'Pull toward the face and split the rope apart.',
    'Finish with the hands beside the ears and the elbows high.',
    'Lighter than instinct suggests; this one is for the rear delts.',
  ].join('\n'),
  'Machine Preacher Curl': [
    'Armpits over the top of the pad, upper arms flat on it.',
    'Curl without the elbows lifting off.',
    'Full stretch at the bottom, and it will feel exposed there.',
    'Slow on the way down; that is where the pad earns its place.',
  ].join('\n'),
  'Cable Pushdown (with Bar Handle)': [
    'Elbows pinned to the ribs before the first rep.',
    'Push down to straight arms, then hold a beat.',
    'Only the forearms move; the torso stays still.',
    'Leaning over the bar is the set ending, not extra reps.',
  ].join('\n'),
  'Cable Crunch': [
    'Kneel far enough from the stack that the cable pulls the torso up.',
    'Hands beside the head, hips fixed in place.',
    'Curl the ribs toward the hips rather than folding at the hips.',
    'Unroll slowly and stop before the lower back arches.',
  ].join('\n'),
}
