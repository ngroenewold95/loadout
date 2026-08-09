/**
 * `@capacitor-community/sqlite` backend - device, and the jeep-sqlite browser
 * build used by `npm run dev`.
 *
 * Rows come back keyed by column NAME. That is the whole reason drizzle's
 * `sqlite-proxy` was ruled out (it reads positionally and would silently
 * misalign every column after a duplicated key in a join), and it is also why
 * repo queries alias their columns: `SELECT weight_kg AS "weightKg"` hands the
 * UI camelCase without a mapping layer.
 *
 * Every call here crosses the JS->native bridge. One statement is one crossing.
 */
import { Capacitor } from '@capacitor/core'
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import { createDb, type Db, type DbCore, type SqlValue, type Statement } from './driver.ts'

export const DB_NAME = 'loadout'

/**
 * Plugin schema version, deliberately pinned at 1 and never bumped.
 *
 * Upgrades are ours: `__migrations` + the numbered drizzle SQL. Letting the
 * plugin's `addUpgradeStatement` also believe it owns the schema is the quiet
 * failure mode the migration runner's header warns about.
 */
const PLUGIN_VERSION = 1

/**
 * Statements the plugin's `run()` is not for.
 *
 * `run()` is the parameterised DML path and reports `lastId`; DDL, pragmas and
 * transaction control go through `execute()`. Routing by leading keyword keeps
 * the migration SQL and the savepoint plumbing on the correct call.
 */
const NON_DML =
  /^\s*(CREATE|DROP|ALTER|PRAGMA|VACUUM|ANALYZE|REINDEX|BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i

/** jeep-sqlite persists to IndexedDB only when asked. Device is automatic. */
const isWeb = () => Capacitor.getPlatform() === 'web'

async function initWebStore(sqlite: SQLiteConnection): Promise<void> {
  const { defineCustomElements } = await import('jeep-sqlite/loader')
  defineCustomElements(window)
  if (!document.querySelector('jeep-sqlite')) {
    document.body.appendChild(document.createElement('jeep-sqlite'))
  }
  await customElements.whenDefined('jeep-sqlite')
  await sqlite.initWebStore()
}

function core(conn: SQLiteDBConnection, sqlite: SQLiteConnection): DbCore {
  /** Depth of *our* transaction, so the web store is saved once at commit
   *  rather than after every statement inside it. */
  let open = 0
  const persist = async () => {
    if (open === 0 && isWeb()) await sqlite.saveToStore(DB_NAME)
  }

  const exec = async (sql: string, params: SqlValue[]) => {
    if (NON_DML.test(sql)) {
      const res = await conn.execute(sql, false)
      return { changes: res.changes?.changes ?? 0, lastInsertId: 0 }
    }
    // `transaction: false` throughout - driver.ts owns transaction boundaries,
    // and letting the plugin wrap each statement as well would commit work that
    // an enclosing transaction is still entitled to roll back.
    const res = await conn.run(sql, params, false)
    return {
      changes: res.changes?.changes ?? 0,
      lastInsertId: res.changes?.lastId ?? 0,
    }
  }

  return {
    query: async <T>(sql: string, params: SqlValue[]) => {
      const res = await conn.query(sql, params)
      return (res.values ?? []) as T[]
    },

    exec: async (sql, params) => {
      const result = await exec(sql, params)
      await persist()
      return result
    },

    /** One bridge crossing for N statements - see the rule in driver.ts. */
    batch: async (statements: Statement[]) => {
      await conn.executeSet(
        statements.map((s) => ({ statement: s.sql, values: s.params ?? [] })),
        true,
      )
      await persist()
    },

    begin: async () => {
      await conn.beginTransaction()
      open++
    },
    commit: async () => {
      await conn.commitTransaction()
      open--
      await persist()
    },
    rollback: async () => {
      await conn.rollbackTransaction()
      open--
    },

    close: async () => {
      await conn.close()
      await sqlite.closeConnection(DB_NAME, false)
    },
  }
}

export async function openCapacitorDb(name = DB_NAME): Promise<Db> {
  const sqlite = new SQLiteConnection(CapacitorSQLite)
  if (isWeb()) await initWebStore(sqlite)

  // A dev-server hot reload leaves the previous connection registered; reusing
  // it is correct, and createConnection would throw.
  const existing = (await sqlite.isConnection(name, false)).result
  const conn = existing
    ? await sqlite.retrieveConnection(name, false)
    : await sqlite.createConnection(name, false, 'no-encryption', PLUGIN_VERSION, false)

  if (!(await conn.isDBOpen()).result) await conn.open()
  await conn.execute('PRAGMA foreign_keys = ON', false)

  return createDb(core(conn, sqlite))
}
