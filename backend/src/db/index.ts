import { initDatabase, getDatabase, closeDatabase, query as sqliteQuery, execute as sqliteExecute, withTransaction as sqliteTransaction } from './sqlite.js'

// Export initialization and database access
export { initDatabase, closeDatabase, getDatabase }

// Compatibility layer to match PostgreSQL API
export async function query(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
  try {
    // Convert PostgreSQL-style $1, $2, $3 to SQLite-style ?
    const sqliteSql = sql.replace(/\$(\d+)/g, '?')
    const rows = sqliteQuery(sqliteSql, params)
    return { rows }
  } catch (error: any) {
    console.error('Database query error:', error.message)
    throw error
  }
}

export async function execute(sql: string, params: any[] = []): Promise<{ rows: any[], rowCount: number }> {
  try {
    // Convert PostgreSQL-style $1, $2, $3 to SQLite-style ?
    const sqliteSql = sql.replace(/\$(\d+)/g, '?')
    const result = sqliteExecute(sqliteSql, params)

    // For INSERT statements, get the inserted row
    if (sqliteSql.trim().toUpperCase().startsWith('INSERT') && sqliteSql.includes('RETURNING')) {
      // SQLite doesn't support RETURNING, so we need to get the last inserted row
      const db = getDatabase()
      const lastId = result.lastInsertRowid

      // Extract table name from INSERT statement
      const tableMatch = sqliteSql.match(/INSERT\s+INTO\s+(\w+)/i)
      if (tableMatch && lastId) {
        const tableName = tableMatch[1]
        const rows = sqliteQuery(`SELECT * FROM ${tableName} WHERE rowid = ?`, [lastId])
        return { rows, rowCount: result.changes }
      }
    }

    return { rows: [], rowCount: result.changes }
  } catch (error: any) {
    console.error('Database execute error:', error.message)
    throw error
  }
}

/**
 * Run a synchronous callback inside a SQLite transaction.
 * Note: better-sqlite3 transactions are synchronous. For async operations,
 * manually call BEGIN/COMMIT/ROLLBACK via execute().
 */
export function withTransaction<T>(callback: () => T): T {
  return sqliteTransaction(callback)
}
