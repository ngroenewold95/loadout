/**
 * Spike harness for the rest timer.
 *
 * Drives the overlay bubble, the +30s/Skip path and the vibration waveform.
 * Delete once the real logging loop owns the timer.
 */
import { useState } from 'react'
import { registerPlugin } from '@capacitor/core'

interface RestTimerPlugin {
  start(opts: { endsAt: number; totalMs: number }): Promise<{ overlay: boolean }>
  extend(opts: { ms: number }): Promise<void>
  cancel(): Promise<void>
  permissionState(): Promise<{
    notifications: boolean
    overlay: boolean
    sdk: number
  }>
  requestOverlayPermission(): Promise<{ granted: boolean; opened?: boolean }>
}

const RestTimer = registerPlugin<RestTimerPlugin>('RestTimer')

export function TimerSpike() {
  const [log, setLog] = useState<string[]>([])
  const say = (m: string) =>
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 10))

  const run = (label: string, fn: () => Promise<unknown>) => async () => {
    try {
      const r = await fn()
      say(`${label} ${r && Object.keys(r).length ? JSON.stringify(r) : 'ok'}`)
    } catch (e) {
      say(`${label} ERROR ${(e as Error).message}`)
    }
  }

  const startTimer = (seconds: number) =>
    run(`start ${seconds}s`, () =>
      RestTimer.start({
        endsAt: Date.now() + seconds * 1000,
        totalMs: seconds * 1000,
      }),
    )

  const btn =
    'rounded-xl bg-neutral-800 px-4 py-4 text-base font-medium active:bg-neutral-700'

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <button className={btn} onClick={run('perms', () => RestTimer.permissionState())}>
          Check perms
        </button>
        <button
          className={btn}
          onClick={run('grant overlay', () => RestTimer.requestOverlayPermission())}
        >
          Grant overlay
        </button>
        <button className={btn} onClick={startTimer(15)}>
          Start 0:15
        </button>
        <button className={btn} onClick={startTimer(180)}>
          Start 3:00
        </button>
        <button className={btn} onClick={run('+30s', () => RestTimer.extend({ ms: 30000 }))}>
          +30s
        </button>
        <button className={btn} onClick={run('cancel', () => RestTimer.cancel())}>
          Skip
        </button>
      </div>
      <pre className="tabular mt-2 rounded-xl bg-neutral-900 p-3 text-xs leading-5 wrap-break-word whitespace-pre-wrap text-neutral-400">
        {log.length === 0 ? 'no events yet' : log.join('\n')}
      </pre>
    </div>
  )
}
