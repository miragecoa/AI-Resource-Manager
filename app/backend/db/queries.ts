import { randomUUID } from 'crypto'
import { getDb } from './index'

export interface Resource {
  id: string
  type: 'image' | 'game' | 'app' | 'video'
  title: string
  file_path: string
  cover_path?: string
  rating: number
  note?: string
  meta?: string
  added_at: number
  updated_at: number
  tags?: Tag[]
}

export interface Tag {
  id: number
  name: string
  source?: string
}

// ── 资源查询 ────────────────────────────────────────────

export function getAllResources(type?: string): Resource[] {
  const db = getDb()
  const rows = type
    ? db.prepare('SELECT * FROM resources WHERE type = ? ORDER BY added_at DESC').all(type)
    : db.prepare('SELECT * FROM resources ORDER BY added_at DESC').all()

  return (rows as Resource[]).map(attachTags)
}

export function getResourceById(id: string): Resource | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(id) as Resource | undefined
  return row ? attachTags(row) : null
}

export function upsertResource(
  data: Omit<Resource, 'id' | 'added_at' | 'updated_at' | 'tags'> & { id?: string },
  updateTitle = false
): Resource | null {
  const db = getDb()
  const now = Date.now()
  const id = data.id ?? randomUUID()

  // updateTitle=true：发现快捷方式名称时，更新已有条目的标题（如 "chrome" → "Google Chrome"）
  // updateTitle=false（默认）：已存在则跳过，避免覆盖用户手动改过的名称
  const onConflict = updateTitle
    ? 'DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at'
    : 'DO NOTHING'

  const info = db.prepare(`
    INSERT INTO resources (id, type, title, file_path, cover_path, rating, note, meta, added_at, updated_at)
    VALUES (@id, @type, @title, @file_path, @cover_path, @rating, @note, @meta, @added_at, @updated_at)
    ON CONFLICT(file_path) ${onConflict}
  `).run({ cover_path: null, note: null, meta: null, ...data, id, added_at: now, updated_at: now })

  // changes=0 且 DO NOTHING：说明已存在且未变更，返回 null 让调用方跳过 onNewEntry
  if (info.changes === 0) return null

  // 新插入 or 标题被更新：通过 file_path 查出真实记录（冲突时原 id 未写入）
  const existing = db.prepare('SELECT * FROM resources WHERE file_path = ?').get(data.file_path) as Resource | undefined
  return existing ?? getResourceById(id) ?? null
}

export function updateResource(id: string, data: Partial<Resource>): void {
  const db = getDb()
  const now = Date.now()
  const fields = Object.keys(data)
    .filter((k) => k !== 'id' && k !== 'added_at')
    .map((k) => `${k} = @${k}`)
    .join(', ')

  db.prepare(`UPDATE resources SET ${fields}, updated_at = ${now} WHERE id = @id`)
    .run({ ...data, id })
}

export function removeResource(id: string): void {
  getDb().prepare('DELETE FROM resources WHERE id = ?').run(id)
}

export function isIgnored(filePath: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM ignored_paths WHERE path = ?').get(filePath)
}

export function addIgnoredPath(filePath: string): void {
  getDb().prepare('INSERT OR IGNORE INTO ignored_paths (path) VALUES (?)').run(filePath)
}

export function getAllIgnoredPaths(): string[] {
  return (getDb().prepare('SELECT path FROM ignored_paths ORDER BY path').all() as { path: string }[])
    .map(r => r.path)
}

export function removeIgnoredPath(filePath: string): void {
  getDb().prepare('DELETE FROM ignored_paths WHERE path = ?').run(filePath)
}

export function removeResourceByPath(filePath: string): void {
  getDb().prepare('DELETE FROM resources WHERE file_path = ?').run(filePath)
}

// ── 标签查询 ────────────────────────────────────────────

export function getAllTags(): Tag[] {
  return getDb().prepare('SELECT * FROM tags ORDER BY name').all() as Tag[]
}

export function createTag(name: string): Tag {
  const db = getDb()
  db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name)
  return db.prepare('SELECT * FROM tags WHERE name = ?').get(name) as Tag
}

export function removeTag(id: number): void {
  getDb().prepare('DELETE FROM tags WHERE id = ?').run(id)
}

export function addTagToResource(resourceId: string, tagId: number, source = 'manual'): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO resource_tags (resource_id, tag_id, source) VALUES (?, ?, ?)')
    .run(resourceId, tagId, source)
}

export function removeTagFromResource(resourceId: string, tagId: number): void {
  getDb()
    .prepare('DELETE FROM resource_tags WHERE resource_id = ? AND tag_id = ?')
    .run(resourceId, tagId)
}

// ── 搜索 ────────────────────────────────────────────────

export function searchResources(query: string, type?: string): Resource[] {
  const db = getDb()
  const typeFilter = type ? `AND r.type = '${type}'` : ''
  const rows = db.prepare(`
    SELECT r.* FROM resources r
    JOIN resources_fts fts ON r.rowid = fts.rowid
    WHERE resources_fts MATCH ?
    ${typeFilter}
    ORDER BY rank
    LIMIT 100
  `).all(query + '*') as Resource[]

  return rows.map(attachTags)
}

// ── 设置 ────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(key, value)
}

// ── 辅助 ────────────────────────────────────────────────

function attachTags(resource: Resource): Resource {
  const db = getDb()
  const tags = db.prepare(`
    SELECT t.id, t.name, rt.source
    FROM tags t JOIN resource_tags rt ON t.id = rt.tag_id
    WHERE rt.resource_id = ?
  `).all(resource.id) as Tag[]

  return { ...resource, tags }
}
