/**
 * The settings that matter in a gym, and nothing else.
 *
 * Every one of these columns has existed since migration 0003 with no reader
 * at all. This is the reader, and the writer.
 *
 * **In SQLite, not in React state or `localStorage`.** A toggle that did not
 * survive a force-stop would be worse than no toggle, and the backup story is
 * `VACUUM INTO`, which only covers the database.
 *
 * There is deliberately **no unit setting**: 100% of five years of history is
 * lb, one distinct value in the whole export, and `app_settings` has no column
 * for it. Adding one would cost a migration for a choice nobody is making.
 */
import { useEffect, useState } from 'react'
import { useSettings, useSetSettings } from '../state/queries.ts'
import { currentDatabaseUrl, getDb } from '../db/open.ts'
import { exportFolder, exportNow, pickExportFolder, type ExportFolder } from '../native/backup.ts'
import { DEFAULT_UNIT, fromKg, roundForDisplay, toKg } from '../logic/units.ts'
import { WEIGHT_STEPS } from '../logic/entry.ts'

/** The steps worth having under a thumb, in the display unit. */
const INCREMENTS_LB = [1, 2.5, 5, 10]

export function Settings() {
  const { data: settings } = useSettings()
  const save = useSetSettings()
  const unit = DEFAULT_UNIT
  const backup = useExportFolder()

  if (!settings) {
    // Null until `seedDefaults` has run, which is one launch on a database
    // pushed from an older lineage.
    return <p className="text-text-dim px-5 py-8 text-sm">No settings row yet.</p>
  }

  const increment = settings.weightIncrementKg
    ? roundForDisplay(fromKg(settings.weightIncrementKg, unit), unit)
    : WEIGHT_STEPS[unit][0]

  return (
    <div className="pb-safe-b min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-6">
      <section>
        <h3 className="text-text-dim text-xs tracking-wide uppercase">Entry</h3>
        <div className="bg-surface-1 mt-2 rounded-xl px-4 py-3">
          <p className="font-medium">Increment (Weight)</p>
          <p className="text-text-dim text-sm">
            One tap on the weight handle. An exercise can override it.
          </p>
          <div className="mt-3 flex gap-2">
            {INCREMENTS_LB.map((step) => (
              <button
                key={step}
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate({ weightIncrementKg: toKg(step, unit) })}
                className={`min-w-14 rounded-xl px-3 py-2 text-sm font-semibold tabular-nums ${
                  step === increment
                    ? 'bg-primary text-on-primary'
                    : 'bg-muted active:bg-surface-3'
                }`}
              >
                {step}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h3 className="text-text-dim text-xs tracking-wide uppercase">While training</h3>
        <div className="mt-2 flex flex-col gap-2">
          <Toggle
            label="Keep screen on"
            detail="Only while a workout is live."
            on={settings.keepScreenOn}
            busy={save.isPending}
            onChange={(on) => save.mutate({ keepScreenOn: on })}
          />
        </div>
      </section>

      <section className="mt-6">
        <h3 className="text-text-dim text-xs tracking-wide uppercase">Rest timer</h3>
        <div className="mt-2 flex flex-col gap-2">
          <Toggle
            label="Floating bubble"
            detail="Shown once you leave the app. The notification counts either way."
            on={settings.overlayInBackground}
            busy={save.isPending}
            onChange={(on) => save.mutate({ overlayInBackground: on })}
          />
          <Toggle
            label="Vibrate"
            detail="Five pulses into the last five seconds, then a long buzz."
            on={settings.restVibrate}
            busy={save.isPending}
            onChange={(on) => save.mutate({ restVibrate: on })}
          />
          <Toggle
            label="Sound"
            detail="A tone at zero, on the alarm stream."
            on={settings.restSound}
            busy={save.isPending}
            onChange={(on) => save.mutate({ restSound: on })}
          />
        </div>
        {/* Said outright rather than discovered: the service cannot read the
            database, so the settings ride in with each rest. */}
        <p className="text-text-dim mt-2 text-xs">
          A change here applies from the next rest, not one already running.
        </p>
      </section>

      <section className="mt-6">
        <h3 className="text-text-dim text-xs tracking-wide uppercase">Backup</h3>
        <div className="bg-surface-1 mt-2 rounded-xl px-4 py-3">
          <p className="font-medium">Copy to a folder</p>
          {/* The threat is uninstall, not a bad migration: the pre-migration
              copies live in app-private storage and go with the app. */}
          <p className="text-text-dim text-sm">
            {backup.folder?.uri
              ? `Exports go to ${backup.folder.label ?? 'the chosen folder'}.`
              : 'Not set. App storage does not survive uninstall.'}
          </p>
          {backup.folder?.lastExportDay && (
            <p className="text-text-dim mt-1 text-xs">
              Last copy {backup.folder.lastExportDay}.
            </p>
          )}
          {backup.message && <p className="mt-1 text-xs">{backup.message}</p>}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="bg-muted active:bg-surface-3 rounded-xl px-3 py-2 text-sm font-semibold"
              onClick={backup.choose}
            >
              {backup.folder?.uri ? 'Change folder' : 'Choose folder'}
            </button>
            <button
              type="button"
              disabled={!backup.folder?.uri || backup.busy}
              className="bg-primary text-on-primary rounded-xl px-3 py-2 text-sm font-semibold disabled:opacity-40"
              onClick={backup.run}
            >
              Export a copy now
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

/**
 * The export destination, and the two things that can be done to it.
 *
 * Kept in this file because nothing else needs it: the automatic exports run
 * from `open.ts` and from `useEndSession` without any UI at all, and this is
 * the one screen where a person is asking a question about them.
 */
function useExportFolder() {
  const [folder, setFolder] = useState<ExportFolder | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void exportFolder().then(setFolder)
  }, [])

  const choose = async () => {
    setMessage(null)
    try {
      await pickExportFolder()
    } catch (e) {
      setMessage(`Could not set the folder: ${(e as Error).message}`)
    }
    setFolder(await exportFolder())
  }

  const run = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const done = await exportNow(await getDb(), currentDatabaseUrl())
      setMessage(done ? `Copied ${done.name}.` : 'Nothing to copy on this platform.')
    } catch (e) {
      // Surfaced rather than thrown: an export that failed is exactly the thing
      // worth knowing about, and a blank screen would not say it.
      setMessage(`Export failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
      setFolder(await exportFolder())
    }
  }

  return { folder, message, busy, choose, run }
}

/**
 * A labelled row with an on/off control.
 *
 * A button pair rather than a switch component: there is no toggle primitive in
 * this codebase and one built for five rows on one screen would be the same
 * mistake `PROJECT.md` twice records turning down.
 */
function Toggle({
  label,
  detail,
  on,
  busy,
  onChange,
}: {
  label: string
  detail: string
  on: boolean
  busy: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <div className="bg-surface-1 flex items-center gap-3 rounded-xl px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{label}</p>
        <p className="text-text-dim text-sm">{detail}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={busy}
        onClick={() => onChange(!on)}
        className={`size-tap shrink-0 rounded-xl px-3 text-sm font-semibold ${
          on ? 'bg-primary text-on-primary' : 'bg-muted text-text-dim active:bg-surface-3'
        }`}
      >
        {on ? 'On' : 'Off'}
      </button>
    </div>
  )
}
