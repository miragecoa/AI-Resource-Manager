/**
 * ai-manager.ts
 * Orchestrates content fetching (utilityProcess) and embedding (Worker Thread).
 */

import { join } from 'path'
import { mkdirSync, existsSync, readdirSync } from 'fs'
import { Worker } from 'worker_threads'
import { utilityProcess } from 'electron'
import type { Database } from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AiStatus = 'disabled' | 'no_model' | 'downloading' | 'indexing' | 'ready'

export interface AiProgress {
  stage: string
  percent: number
  done?: number
  total?: number
}

export interface SemanticResult {
  resourceId: string
  score: number
  chunkText: string
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let db: Database | null = null
let status: AiStatus = 'disabled'
let modelDir = ''

let contentProc: Electron.UtilityProcess | null = null
const contentPending = new Map<string, (result: any) => void>()
const contentQueue: Array<{ resourceId: string; type: 'url' | 'file'; path: string }> = []
let contentBusy = 0
const CONTENT_CONCURRENCY = 2

let contentIndexTotal = 0
let contentIndexDone = 0
let indexPaused = false

let embedWorker: Worker | null = null
const embedPending = new Map<string, { resolve: (v: number[][]) => void; reject: (e: Error) => void }>()
let embedWorkerReady = false
let statusListeners: ((s: AiStatus) => void)[] = []
let progressListeners: ((p: AiProgress) => void)[] = []

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(...args: any[]) { console.log('[ai-manager]', ...args) }

function setStatus(s: AiStatus) {
  status = s
  statusListeners.forEach(fn => fn(s))
}

function emitProgress(p: AiProgress) {
  progressListeners.forEach(fn => fn(p))
}

function chunkText(text: string, size = 512, overlap = 50): string[] {
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    chunks.push(text.slice(i, i + size))
    i += size - overlap
  }
  return chunks
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2 }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

function buildMetadataText(resourceId: string): string {
  if (!db) return ''
  const r = db.prepare(`SELECT title, type, file_path, note FROM resources WHERE id = ?`).get(resourceId) as any
  if (!r) return ''

  const tags = db.prepare(`
    SELECT t.name FROM tags t
    JOIN resource_tags rt ON rt.tag_id = t.id
    WHERE rt.resource_id = ?
  `).all(resourceId) as Array<{ name: string }>

  // Pure semantic signal only — no paths, no key prefixes, no noise
  const parts: string[] = []
  if (r.title) parts.push(r.title)
  if (r.type) parts.push(r.type)
  if (tags.length) parts.push(tags.map(t => t.name).join(', '))
  if (r.note) parts.push(r.note)

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Content Worker (utilityProcess)
// ---------------------------------------------------------------------------

function startContentWorker(workerPath: string) {
  contentProc = utilityProcess.fork(workerPath, [], { serviceName: 'ai-content-worker' })

  contentProc.on('message', (msg: any) => {
    const cb = contentPending.get(msg.id)
    if (cb) { contentPending.delete(msg.id); cb(msg) }
    contentBusy = Math.max(0, contentBusy - 1)
    drainContentQueue()
  })

  contentProc.on('exit', () => {
    contentProc = null
    setTimeout(() => {
      if (status !== 'disabled') startContentWorker(workerPath)
    }, 3000)
  })
}

function drainContentQueue() {
  if (indexPaused) return
  while (contentBusy < CONTENT_CONCURRENCY && contentQueue.length > 0) {
    const task = contentQueue.shift()!
    const id = `${task.resourceId}-${Date.now()}`
    contentBusy++
    log('fetching:', task.type, task.path.substring(0, 80), `[${contentIndexDone + contentBusy}/${contentIndexTotal}]`)
    contentPending.set(id, (result: any) => {
      if (!db) return
      db.prepare(`
        INSERT OR REPLACE INTO resource_content
          (resource_id, text, fetch_status, is_truncated, word_count, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        task.resourceId,
        result.text ?? null,
        result.status,
        result.isTruncated ? 1 : 0,
        result.wordCount ?? 0,
        Date.now()
      )
      // Update progress immediately
      contentIndexDone++
      if (contentIndexTotal > 0) {
        emitProgress({
          stage: '索引内容',
          percent: Math.round((contentIndexDone / contentIndexTotal) * 100),
          done: contentIndexDone,
          total: contentIndexTotal,
        })
      }
      if (contentIndexDone >= contentIndexTotal && contentIndexTotal > 0) {
        contentIndexTotal = 0
        contentIndexDone = 0
        emitProgress({ stage: 'done', percent: 100 })
      }
      // Embed content in background
      if (result.status === 'done' && result.text && embedWorkerReady) {
        indexResourceEmbeddings(task.resourceId, result.text).catch(() => {})
      }
    })
    contentProc?.postMessage({ id, resourceId: task.resourceId, type: task.type, path: task.path })
  }
}

// ---------------------------------------------------------------------------
// Embed Worker (Worker Thread)
// ---------------------------------------------------------------------------

function startEmbedWorker(workerPath: string) {
  embedWorker = new Worker(workerPath, { workerData: { cacheDir: modelDir } })

  embedWorker.on('message', (msg: any) => {
    if (msg.type === 'log') {
      log('[embed-worker]', msg.text)
      // Forward to all renderers for DevTools visibility
      try {
        const { webContents } = require('electron')
        for (const wc of webContents.getAllWebContents()) wc.send('ai:log', msg.text)
      } catch {}
      return
    }
    if (msg.type === 'ready') {
      embedWorkerReady = true
      runFullIndex()
    } else if (msg.type === 'progress') {
      emitProgress({ stage: msg.stage, percent: msg.percent })
    } else if (msg.type === 'embed') {
      const entry = embedPending.get(msg.id)
      if (entry) { embedPending.delete(msg.id); entry.resolve(msg.embeddings) }
    } else if (msg.type === 'error') {
      log('embed-worker error:', msg.message)
      const entry = msg.id ? embedPending.get(msg.id) : null
      if (entry) { embedPending.delete(msg.id!); entry.reject(new Error(msg.message)) }
    }
  })

  embedWorker.on('error', (err) => log('embed-worker error:', err))
  embedWorker.on('exit', () => { embedWorker = null; embedWorkerReady = false })
}

function embedTexts(texts: string[]): Promise<number[][]> {
  return new Promise((resolve, reject) => {
    if (!embedWorker || !embedWorkerReady) return reject(new Error('Embed worker not ready'))
    const id = Math.random().toString(36).slice(2)
    embedPending.set(id, { resolve, reject })
    embedWorker.postMessage({ type: 'embed', id, texts })
  })
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

async function runFullIndex() {
  if (!db || !embedWorkerReady) return

  setStatus('indexing')

  // Metadata embedding — only resources missing metadata vector
  const needsEmbed = db.prepare(`
    SELECT r.id FROM resources r
    LEFT JOIN resource_embeddings re ON re.resource_id = r.id AND re.chunk_index = -1
    WHERE re.resource_id IS NULL
  `).all() as Array<{ id: string }>
  const total = needsEmbed.length

  for (let i = 0; i < needsEmbed.length; i++) {
    if (!embedWorkerReady) break
    try { await indexMetadataEmbedding(needsEmbed[i].id) } catch {}
    if (total > 0) emitProgress({ stage: '索引资源', percent: Math.round(((i + 1) / total) * 100), done: i + 1, total })
  }

  // Phase 2: embed content that was fetched but not yet embedded (interrupted last time)
  const needsContentEmbed = db.prepare(`
    SELECT rc.resource_id, rc.text FROM resource_content rc
    LEFT JOIN resource_embeddings re ON re.resource_id = rc.resource_id AND re.chunk_index >= 0
    WHERE rc.fetch_status = 'done' AND rc.text IS NOT NULL AND re.resource_id IS NULL
  `).all() as Array<{ resource_id: string; text: string }>

  if (needsContentEmbed.length > 0) {
    log('embedding content for', needsContentEmbed.length, 'resources (interrupted)')
    for (let i = 0; i < needsContentEmbed.length; i++) {
      if (!embedWorkerReady) break
      try { await indexResourceEmbeddings(needsContentEmbed[i].resource_id, needsContentEmbed[i].text) } catch {}
      emitProgress({ stage: '索引内容', percent: Math.round(((i + 1) / needsContentEmbed.length) * 100), done: i + 1, total: needsContentEmbed.length })
    }
  }

  // Phase 3: fetch content for resources never attempted
  const needsContent = db.prepare(`
    SELECT r.id, r.file_path FROM resources r
    LEFT JOIN resource_content rc ON rc.resource_id = r.id
    WHERE rc.resource_id IS NULL AND r.file_path IS NOT NULL
  `).all() as Array<{ id: string; file_path: string }>

  contentQueue.length = 0
  contentBusy = 0
  contentIndexTotal = needsContent.length
  contentIndexDone = 0

  setStatus('ready')

  if (needsContent.length > 0) {
    for (const row of needsContent) {
      const type = /^https?:\/\//i.test(row.file_path) ? 'url' : 'file' as const
      contentQueue.push({ resourceId: row.id, type, path: row.file_path })
    }
    emitProgress({ stage: '抓取内容', percent: 0, done: 0, total: needsContent.length })
    drainContentQueue()
  } else if (needsContentEmbed.length === 0) {
    emitProgress({ stage: 'done', percent: 100 })
  }
}

async function indexMetadataEmbedding(resourceId: string) {
  if (!db || !embedWorkerReady) return
  const metaText = buildMetadataText(resourceId)
  if (!metaText.trim()) return

  const embeddings = await embedTexts([`passage: ${metaText}`])
  const buf = Buffer.from(new Float32Array(embeddings[0]).buffer)
  db.prepare(`
    INSERT OR REPLACE INTO resource_embeddings (resource_id, chunk_index, embedding, chunk_text)
    VALUES (?, -1, ?, ?)
  `).run(resourceId, buf, metaText)
}

async function indexResourceEmbeddings(resourceId: string, text: string) {
  if (!db || !embedWorkerReady) return
  db.prepare('DELETE FROM resource_embeddings WHERE resource_id = ? AND chunk_index >= 0').run(resourceId)
  const chunks = chunkText(text)
  if (chunks.length === 0) return

  const prefixed = chunks.map(c => `passage: ${c}`)
  const embeddings = await embedTexts(prefixed)

  const insert = db.prepare('INSERT INTO resource_embeddings (resource_id, chunk_index, embedding, chunk_text) VALUES (?, ?, ?, ?)')
  const insertMany = db.transaction((rows: Array<{ chunk: string; emb: number[]; i: number }>) => {
    for (const r of rows) {
      const buf = Buffer.from(new Float32Array(r.emb).buffer)
      insert.run(resourceId, r.i, buf, r.chunk)
    }
  })
  insertMany(chunks.map((chunk, i) => ({ chunk, emb: embeddings[i], i })))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initAiManager(database: Database, workerDir: string, dataDirectory: string) {
  db = database
  modelDir = join(dataDirectory, 'models')
  mkdirSync(modelDir, { recursive: true })

  const enabled = db.prepare(`SELECT value FROM settings WHERE key = 'aiEnabled'`).get() as any
  if (enabled?.value !== '1') return

  startAi(workerDir)
}

function startAi(workerDir: string) {
  setStatus('no_model')
  startContentWorker(join(workerDir, 'content-worker.js'))
  setStatus('downloading')
  startEmbedWorker(join(workerDir, 'embed-worker.js'))
}

export function enableAi(workerDir: string) {
  if (!db) return
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('aiEnabled', '1')`).run()
  if (status === 'disabled') startAi(workerDir)
}

export function disableAi() {
  if (!db) return
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('aiEnabled', '0')`).run()
  contentProc?.kill()
  embedWorker?.terminate()
  contentProc = null; embedWorker = null; embedWorkerReady = false
  contentIndexTotal = 0; contentIndexDone = 0
  setStatus('disabled')
}

export function getAiStatus(): AiStatus { return status }

export function isModelInstalled(): boolean {
  if (!modelDir) return false
  try {
    const files = readdirSync(modelDir, { recursive: true }) as string[]
    return files.some(f => f.endsWith('.onnx'))
  } catch { return false }
}

export function isIndexPaused(): boolean { return indexPaused }

export function pauseIndex() {
  indexPaused = true
  log('index paused, queue:', contentQueue.length, 'remaining')
}

export function resumeIndex() {
  indexPaused = false
  log('index resumed, draining queue')
  drainContentQueue()
}

export function onStatusChange(fn: (s: AiStatus) => void) {
  statusListeners.push(fn)
  return () => { statusListeners = statusListeners.filter(f => f !== fn) }
}

export function onProgress(fn: (p: AiProgress) => void) {
  progressListeners.push(fn)
  return () => { progressListeners = progressListeners.filter(f => f !== fn) }
}

export async function queueResourceContent(resourceId: string, filePath: string) {
  if (embedWorkerReady) {
    try { await indexMetadataEmbedding(resourceId) } catch {}
  }
  if (status === 'disabled' || !contentProc) return
  const type = /^https?:\/\//i.test(filePath) ? 'url' : 'file'
  contentQueue.push({ resourceId, type, path: filePath })
  drainContentQueue()
}

export async function semanticSearch(query: string, topK = 10): Promise<SemanticResult[]> {
  if (!db || !embedWorkerReady) return []

  const queryEmb = (await embedTexts([`query: ${query}`]))[0]

  const rows = db.prepare(`
    SELECT resource_id, chunk_index, embedding, chunk_text
    FROM resource_embeddings
  `).all() as Array<{ resource_id: string; chunk_index: number; embedding: Buffer; chunk_text: string }>

  // Field-level weighting: metadata is gold, content chunks are dirt
  const WEIGHT_META = 1.0    // chunk_index == -1 (title, tags, path)
  const WEIGHT_CONTENT = 0.3 // chunk_index >= 0  (page body text)

  const scored = rows.map(row => {
    const emb = Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4))
    const rawScore = cosineSim(queryEmb, emb)
    let weight: number
    if (row.chunk_index === -1) {
      weight = WEIGHT_META // metadata: full weight
    } else if (rawScore > 0.85) {
      weight = 0.9 // content but extremely precise match: pardon
    } else {
      weight = WEIGHT_CONTENT // content noise: suppressed
    }
    return {
      resourceId: row.resource_id,
      score: rawScore * weight,
      chunkText: row.chunk_text,
    }
  })

  // Deduplicate: keep best weighted chunk per resource
  const best = new Map<string, SemanticResult>()
  for (const r of scored) {
    const prev = best.get(r.resourceId)
    if (!prev || r.score > prev.score) best.set(r.resourceId, r)
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(r => r.score > 0.5) // 0.7 * 1.0 = title needs raw 0.7; 0.5 / 0.3 = content needs raw 0.83+
}
