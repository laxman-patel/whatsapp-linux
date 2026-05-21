import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'
import { MIGRATIONS, SCHEMA_VERSION } from './schema'

let db: Database.Database | null = null

export function getDbPath(): string {
  return path.join(app.getPath('userData'), 'whatsapp.db')
}

export function initDatabase(): Database.Database {
  if (db) return db

  db = new Database(getDbPath())
  // Performance pragmas for bulk WhatsApp history imports.
  // WAL keeps reads (sidebar) responsive while the writer is flushing.
  // synchronous=NORMAL is safe with WAL and ~10x faster than FULL.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('temp_store = MEMORY')
  db.pragma('cache_size = -65536') // 64 MiB page cache
  db.pragma('mmap_size = 268435456') // 256 MiB memory map
  db.pragma('foreign_keys = ON')

  for (const sql of MIGRATIONS) {
    db.exec(sql)
  }

  // Idempotent schema upgrades for already-existing databases.
  applyIncrementalMigrations(db)

  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(SCHEMA_VERSION))

  return db
}

export function getDb(): Database.Database {
  if (!db) return initDatabase()
  return db
}

export function clearDatabase(): void {
  const database = getDb()
  database.exec('DELETE FROM messages')
  database.exec('DELETE FROM chats')
  database.exec('DELETE FROM contacts')
}

function applyIncrementalMigrations(db: Database.Database): void {
  // v1 -> v2: avatar_path column on chats.
  try {
    db.exec('ALTER TABLE chats ADD COLUMN avatar_path TEXT')
  } catch (err) {
    // Column already exists; safe to ignore.
    if (
      err instanceof Error &&
      !/duplicate column name/i.test(err.message)
    ) {
      throw err
    }
  }
}
