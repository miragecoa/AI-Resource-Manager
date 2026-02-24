import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { SCHEMA_SQL } from './schema'

let db: Database.Database

export function initDatabase(): Database.Database {
  const dbPath = join(app.getPath('userData'), 'resources.db')
  db = new Database(dbPath)

  // 开启 WAL 模式（写性能更好）
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // 建表
  db.exec(SCHEMA_SQL)

  console.log('Database initialized at:', dbPath)
  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}
