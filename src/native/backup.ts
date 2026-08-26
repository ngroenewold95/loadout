/**
 * JS face of the synced-folder export.
 *
 * `src/db/backup.ts` takes the copy; this hands it to the native side, which is
 * the only half able to write into a folder that survives uninstall. Every call
 * here fails soft: an export that cannot happen must never take down a screen,
 * least of all the summary at the end of a workout.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { databaseDirectory, exportSnapshot, exportsToPrune } from '../db/backup.ts'
import { localDateOf } from '../db/repo.ts'
import type { Db } from '../db/driver.ts'

export interface ExportFolder {
  uri: string | null
  label: string | null
  /** `YYYY-MM-DD` of the last successful export, for the daily throttle. */
  lastExportDay: string | null
}

interface BackupPlugin {
  folder(): Promise<ExportFolder>
  pickFolder(): Promise<{ uri: string | null; label?: string | null }>
  copyOut(opts: { path: string; name: string; day: string }): Promise<{
    name: string
    bytes: number
  }>
  list(): Promise<{ names: string[] }>
  deleteFiles(opts: { names: string[] }): Promise<{ deleted: number }>
}

export const Backup = registerPlugin<BackupPlugin>('Backup')

/** How many exports the folder keeps. Older ones are pruned after a new one. */
const KEEP = 10

const onAndroid = () => Capacitor.getPlatform() === 'android'

/** Where exports go, or nulls on the web and before a folder has been picked. */
export async function exportFolder(): Promise<ExportFolder> {
  if (!onAndroid()) return { uri: null, label: null, lastExportDay: null }
  try {
    return await Backup.folder()
  } catch {
    return { uri: null, label: null, lastExportDay: null }
  }
}

/** Ask for a folder. Returns null if the picker was dismissed. */
export async function pickExportFolder(): Promise<string | null> {
  if (!onAndroid()) return null
  const picked = await Backup.pickFolder()
  return picked.uri ?? null
}

/**
 * Copy the database into the chosen folder.
 *
 * Returns null when there is nothing to do - the web build, or no folder picked
 * yet - and throws only when an export was genuinely attempted and failed, so a
 * manual `Export a copy now` can say so while the automatic triggers ignore it.
 */
export async function exportNow(
  db: Db,
  databaseUrl: string | null,
  now: Date = new Date(),
): Promise<{ name: string; bytes: number } | null> {
  if (!onAndroid() || !databaseUrl) return null
  const folder = await exportFolder()
  if (!folder.uri) return null

  const staged = await exportSnapshot(db, databaseDirectory(databaseUrl), now)
  // `day` is what the native side stores as the throttle marker, and it is the
  // local date rather than a UTC one: "already exported today" is a question
  // about the day the person is having.
  const result = await Backup.copyOut({
    path: staged.path,
    name: staged.name,
    day: localDateOf(now),
  })

  // Pruning decides in TypeScript and deletes natively, so the policy is
  // testable without a device and the plugin never decides anything.
  try {
    const { names } = await Backup.list()
    const surplus = exportsToPrune(names, KEEP)
    if (surplus.length > 0) await Backup.deleteFiles({ names: surplus })
  } catch {
    // A folder that cannot be listed still received the export, which is the
    // part that matters.
  }

  return result
}

/**
 * Export at most once a calendar day, on launch.
 *
 * The marker is native `SharedPreferences` rather than a row in the database.
 * "When did we last copy out" is a fact about this installation, and a value
 * restored from an exported copy would claim an export that this device never
 * made.
 */
export async function exportOncePerDay(
  db: Db,
  databaseUrl: string | null,
  now: Date = new Date(),
): Promise<{ name: string; bytes: number } | null> {
  if (!onAndroid() || !databaseUrl) return null
  const folder = await exportFolder()
  if (!folder.uri || folder.lastExportDay === localDateOf(now)) return null
  return exportNow(db, databaseUrl, now)
}
