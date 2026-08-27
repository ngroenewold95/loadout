/**
 * One exercise's best set, session by session.
 *
 * The first chart in the app. Everything before this read the five years back
 * as totals and as lists, which answers "what happened" but never "which way is
 * it going" - and that is the question worth asking with a bar in front of you.
 *
 * **One series, so no legend**: the heading names what the line is, and a box
 * repeating it would be a second thing to read. No point carries a number
 * either - the shape is the message, the axis gives the scale, and an exact
 * value is one hover away.
 *
 * **`assistance` is drawn with the axis reversed.** A higher number on an
 * Assisted Chinup is an easier set, so plotted plainly, five years of getting
 * stronger would fall down the screen. Reversing the axis puts progress upward
 * where it is read, and the heading still says the number is assistance so
 * nothing is hidden by the flip.
 */
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatDuration } from '../logic/entry.ts'
import { trendSeries, type SessionCandidate } from '../logic/trend.ts'
import { fromKg, roundForDisplay, type Unit } from '../logic/units.ts'
import type { TrackingType } from '../db/schema.ts'

export function TrendChart({
  sessions,
  trackingType,
  loadMode,
  unit,
}: {
  sessions: readonly SessionCandidate[] | undefined
  trackingType: TrackingType
  loadMode: string
  unit: Unit
}) {
  const series = trendSeries(sessions ?? [], trackingType, loadMode)

  /**
   * Plot in the unit it is READ in, not the unit it is stored in.
   *
   * Measured on device: plotting kilograms and formatting the ticks as pounds
   * gave an axis reading 33 / 66.25 / 99.25 / 132.25 lb, because the nice round
   * numbers the chart picked were round in kg. Converting first lets it pick
   * ticks that are round in the unit on screen.
   */
  const toDisplay = (value: number) =>
    series.measure === 'weight' || series.measure === 'assistance'
      ? roundForDisplay(fromKg(value, unit), unit)
      : series.measure === 'distance'
        ? Math.round(value) / 1000
        : value

  /** Axis ticks carry no unit: the heading says it once. */
  const formatTick = (value: number) =>
    series.measure === 'duration' ? formatDuration(value) : String(value)

  /** The tooltip is read on its own, so it spells the unit out. */
  const formatValue = (value: number) => {
    switch (series.measure) {
      case 'weight':
      case 'assistance':
        return `${value} ${unit}`
      case 'duration':
        return formatDuration(value)
      case 'distance':
        return `${value} km`
      default:
        return `${value} reps`
    }
  }

  if (series.points.length === 0) {
    return null
  }

  /** Named in the heading rather than repeated down the axis. */
  const unitWord =
    series.measure === 'weight' || series.measure === 'assistance'
      ? unit
      : series.measure === 'distance'
        ? 'km'
        : series.measure === 'reps'
          ? 'reps'
          : null

  /**
   * A single point is a dot, not a line, and that is what recharts draws for
   * one datum anyway - but it is worth saying that this is not a failure case
   * to guard against. An exercise performed once has a trend of exactly one
   * session and the screen should show it.
   */
  const data = series.points.map((point) => ({
    date: point.localDate,
    value: toDisplay(point.value),
  }))

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="text-text-dim text-xs tracking-wide uppercase">
          {unitWord ? `${series.label}, ${unitWord}` : series.label}
        </h3>
        {series.lowerIsBetter && (
          // Said outright rather than left to the reversed axis, because the
          // number itself still goes down as the sets get harder.
          <span className="text-text-dim text-xs">less is stronger</span>
        )}
      </div>

      {/* Fixed height, because the card it sits in has no height of its own and
          a percentage would collapse to nothing. */}
      <div className="mt-2 h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--color-track)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="date"
              // Only the ends: 343 sessions of dates would be a black band, and
              // the exact date of a point is what the tooltip is for.
              ticks={[data[0].date, data[data.length - 1].date]}
              tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
              tickFormatter={(date: string) => date.slice(0, 7)}
              tickMargin={6}
              stroke="var(--color-track)"
            />
            <YAxis
              // Wide enough for a bare number and no wider. Measured on device:
              // with the unit on every tick, `66.25 lb` wrapped onto two lines
              // and the bottom label sat on top of the date below it.
              width={44}
              reversed={series.lowerIsBetter}
              domain={['auto', 'auto']}
              tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
              tickFormatter={(value: number) => formatTick(value)}
              tickMargin={4}
              stroke="var(--color-track)"
            />
            <Tooltip
              // The hover layer, which an SVG chart gets by default - see the
              // dataviz rules. Styled off the same tokens as every other
              // surface so it does not arrive as a white browser box.
              contentStyle={{
                background: 'var(--color-surface-3)',
                border: 'none',
                borderRadius: 12,
                color: 'var(--color-text)',
                fontSize: 12,
              }}
              labelStyle={{ color: 'var(--color-text-dim)' }}
              formatter={(value) => [formatValue(Number(value)), series.label]}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={{ r: 2, fill: 'var(--color-primary)', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
