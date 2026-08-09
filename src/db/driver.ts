/**
 * The database surface the rest of the app talks to.
 *
 * Three backends implement `DbCore` - better-sqlite3 (Node: import, scripts,
 * tests), and `@capacitor-community/sqlite` in both its device and its
 * jeep-sqlite browser form. Everything above this file is backend-agnostic and
 * therefore testable in Node, which is the entire point: the logging loop must
 * be provable on the laptop, not only on the phone.
 *
 * Two rules this layer exists to enforce:
 *
 * 1. **No query inside a loop.** Every call is free in Node and a JS->native
 *    bridge crossing on device. `batch()` sends N statements in one crossing;
 *    repo functions that touch many rows must use it or express the work as a
 *    single statement.
 * 2. **Transactions are scoped to a handle, not to the connection.** There is
 *    one connection, and on device it is driven by an async bridge, so two
 *    overlapping callers would otherwise interleave and one would commit the
 *    other's half-written work. `transaction()` takes the connection for its
 *    whole duration and hands the caller a `tx` handle; everything else queues.
 */

/** What SQLite can actually store. `undefined` is deliberately excluded - it
 *  arrives as NULL through better-sqlite3 but throws over the bridge. */
export type SqlValue = string | number | null

export interface Statement {
  sql: string
  params?: SqlValue[]
}

export interface WriteResult {
  changes: number
  /** rowid of the last INSERT on this connection. 0 when nothing was inserted. */
  lastInsertId: number
}

/**
 * The per-backend part. Small on purpose - locking, savepoints and the
 * convenience wrappers are shared above so all three backends behave alike.
 */
export interface DbCore {
  query<T>(sql: string, params: SqlValue[]): Promise<T[]>
  exec(sql: string, params: SqlValue[]): Promise<WriteResult>
  batch(statements: Statement[]): Promise<void>
  close(): Promise<void>
  /** Native transaction control, when the backend tracks its own state and
   *  would be confused by a raw `BEGIN` (the Capacitor plugin does). Backends
   *  that omit these get plain SQL instead. */
  begin?(): Promise<void>
  commit?(): Promise<void>
  rollback?(): Promise<void>
}

export interface Db {
  query<T>(sql: string, params?: SqlValue[]): Promise<T[]>
  /** First row, or null. Does not error on an empty result. */
  queryOne<T>(sql: string, params?: SqlValue[]): Promise<T | null>
  exec(sql: string, params?: SqlValue[]): Promise<WriteResult>
  /** All statements, one round trip, inside a transaction. */
  batch(statements: Statement[]): Promise<void>
  /**
   * Run `fn` with exclusive use of the connection.
   *
   * Use the `tx` handle passed in, **not** the outer `Db`: calls on the outer
   * handle queue until this transaction commits, so awaiting one from inside
   * would wait forever. Repo functions all take a `Db`, so passing `tx` down is
   * the natural thing anyway. Nesting is allowed and uses savepoints.
   */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>
  close(): Promise<void>
}

const noop = () => {}

export function createDb(core: DbCore): Db {
  /** 0 outside a transaction; N inside N nested ones. Drives savepoint naming. */
  let depth = 0
  /** Tail of the serialisation queue. Always resolved, never rejected. */
  let tail: Promise<unknown> = Promise.resolve()

  /** Queue an operation behind whatever currently holds the connection. */
  const lock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn)
    tail = run.then(noop, noop)
    return run
  }

  const begin = async (): Promise<void> => {
    if (depth === 0) {
      if (core.begin) await core.begin()
      else await core.exec('BEGIN', [])
    } else {
      await core.exec(`SAVEPOINT sp${depth}`, [])
    }
    depth++
  }

  const commit = async (): Promise<void> => {
    depth--
    if (depth === 0) {
      if (core.commit) await core.commit()
      else await core.exec('COMMIT', [])
    } else {
      await core.exec(`RELEASE sp${depth}`, [])
    }
  }

  const rollback = async (): Promise<void> => {
    depth--
    if (depth === 0) {
      if (core.rollback) await core.rollback()
      else await core.exec('ROLLBACK', [])
    } else {
      // ROLLBACK TO leaves the savepoint on the stack; RELEASE pops it.
      await core.exec(`ROLLBACK TO sp${depth}`, [])
      await core.exec(`RELEASE sp${depth}`, [])
    }
  }

  /**
   * A handle that talks to the connection directly.
   *
   * Handed to `transaction` callbacks, which already hold the lock - going
   * through the queue again would deadlock against themselves.
   */
  const unlocked: Db = {
    query: (sql, params = []) => core.query(sql, params),
    queryOne: async <T>(sql: string, params: SqlValue[] = []) =>
      (await core.query<T>(sql, params))[0] ?? null,
    exec: (sql, params = []) => core.exec(sql, params),
    batch: (statements) => core.batch(statements),
    transaction: async (fn) => {
      await begin()
      try {
        const result = await fn(unlocked)
        await commit()
        return result
      } catch (err) {
        await rollback()
        throw err
      }
    },
    close: () => core.close(),
  }

  return {
    query: (sql, params = []) => lock(() => core.query(sql, params)),
    queryOne: <T>(sql: string, params: SqlValue[] = []) =>
      lock(async () => (await core.query<T>(sql, params))[0] ?? null),
    exec: (sql, params = []) => lock(() => core.exec(sql, params)),
    batch: (statements) => lock(() => core.batch(statements)),
    transaction: (fn) => lock(() => unlocked.transaction(fn)),
    close: () => lock(() => core.close()),
  }
}
