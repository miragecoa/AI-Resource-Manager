/**
 * ai-manager.ts
 * Orchestrates content fetching (utilityProcess) and embedding (llama.cpp server).
 * llama-server runs as an independent child process, communicates via HTTP.
 */

import { join } from 'path'
import { mkdirSync, existsSync, readdirSync, createWriteStream } from 'fs'
import { ChildProcess, spawn } from 'child_process'
import { net, utilityProcess } from 'electron'
import type { Database } from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CDN = 'https://download.aicubby.app'
const LLAMA_SERVER_PORT = 18293 // random high port
const LLAMA_ZIP = 'llama-ai-module-win-x64.zip'

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

let llamaProc: ChildProcess | null = null
let llamaReady = false
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
// Download helper
// ---------------------------------------------------------------------------

async function downloadFile(url: string, dest: string, progressStage?: string): Promise<void> {
  const resp = await net.fetch(url)
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`)
  const reader = resp.body?.getReader()
  if (!reader) throw new Error('No response body')
  const totalSize = Number(resp.headers.get('content-length')) || 0
  const ws = createWriteStream(dest)
  let received = 0
  let lastProgressTime = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      ws.write(Buffer.from(value))
      received += value.byteLength
      if (progressStage && totalSize > 0) {
        const now = Date.now()
        if (now - lastProgressTime > 300) {
          lastProgressTime = now
          emitProgress({ stage: progressStage, percent: Math.round((received / totalSize) * 100) })
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
  await new Promise<void>((resolve, reject) => {
    ws.on('error', reject)
    ws.on('close', resolve)
    ws.end()
  })
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

  const parts: string[] = []
  if (r.title) parts.push(r.title)
  if (r.type) parts.push(r.type)
  if (tags.length) parts.push(tags.map(t => t.name).join(', '))
  if (r.note) parts.push(r.note)

  return parts.join('. ')
}

// ---------------------------------------------------------------------------
// Content Worker (utilityProcess) — unchanged
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
      if (result.status === 'done' && result.text && llamaReady) {
        indexResourceEmbeddings(task.resourceId, result.text).catch(() => {})
      }
    })
    contentProc?.postMessage({ id, resourceId: task.resourceId, type: task.type, path: task.path })
  }
}

// ---------------------------------------------------------------------------
// llama.cpp Embedding Server
// ---------------------------------------------------------------------------

/** Ensure llama-server + model are downloaded and extracted.
 *  Uses %LOCALAPPDATA%\ai-cubby-llama\ to avoid Unicode path issues on Windows.
 *  llama.cpp cannot load models from paths containing non-ASCII characters. */
async function ensureLlamaFiles(): Promise<{ serverPath: string; modelPath: string }> {
  const dir = join(process.env.LOCALAPPDATA || modelDir, 'ai-cubby-llama')
  mkdirSync(dir, { recursive: true })

  const serverPath = join(dir, 'llama-server.exe')
  const modelPath = join(dir, 'e5-small-v2-q8_0.gguf')

  if (!existsSync(serverPath) || !existsSync(modelPath)) {
    const zipPath = join(modelDir, LLAMA_ZIP)
    log('downloading AI module zip...')
    await downloadFile(`${CDN}/${LLAMA_ZIP}`, zipPath, '下载 AI 模块')
    log('extracting...')
    emitProgress({ stage: '解压 AI 模块', percent: 80 })
    // Extract using PowerShell (available on all Windows)
    const { execSync } = require('child_process')
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${dir}' -Force"`, { timeout: 60000 })
    // Clean up zip
    try { require('fs').unlinkSync(zipPath) } catch {}
    log('extraction complete')
  }

  emitProgress({ stage: 'done', percent: 100 })
  return { serverPath, modelPath }
}

/** Start llama-server as child process and wait for it to be ready */
function startLlamaServer(serverPath: string, modelPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    log('starting llama-server on port', LLAMA_SERVER_PORT)
    llamaProc = spawn(serverPath, [
      '--embedding',
      '-m', modelPath,
      '-c', '512',
      '--port', String(LLAMA_SERVER_PORT),
      '--host', '127.0.0.1',
      '-fit', 'off',
    ], { stdio: ['ignore', 'pipe', 'pipe'], cwd: require('path').dirname(serverPath) })

    // Capture stderr for debugging
    let stderrBuf = ''
    llamaProc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString()
      // Log last line for real-time debug
      const lines = stderrBuf.split('\n').filter(l => l.trim())
      if (lines.length > 0) log('llama-server:', lines[lines.length - 1].substring(0, 200))
    })

    let resolved = false
    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; reject(new Error('llama-server startup timeout')) }
    }, 30000)

    // Poll for readiness
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${LLAMA_SERVER_PORT}/health`)
        if (res.ok) {
          clearInterval(poll)
          clearTimeout(timeout)
          if (!resolved) { resolved = true; llamaReady = true; resolve() }
        }
      } catch { /* not ready yet */ }
    }, 500)

    llamaProc.on('error', (err) => {
      clearInterval(poll)
      clearTimeout(timeout)
      if (!resolved) { resolved = true; reject(err) }
    })

    llamaProc.on('exit', (code) => {
      log('llama-server exited, code:', code, stderrBuf ? 'stderr: ' + stderrBuf.substring(0, 500) : '')
      llamaProc = null
      llamaReady = false
      clearInterval(poll)
      clearTimeout(timeout)
      if (!resolved) { resolved = true; reject(new Error(`llama-server exited: ${code}`)) }
    })
  })
}

function stopLlamaServer() {
  if (llamaProc) {
    llamaProc.kill()
    llamaProc = null
    llamaReady = false
  }
}

/** Call llama-server /v1/embeddings endpoint */
async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!llamaReady) throw new Error('llama-server not ready')

  const body = JSON.stringify({ input: texts })
  const res = await fetch(`http://127.0.0.1:${LLAMA_SERVER_PORT}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  if (!res.ok) throw new Error(`Embedding request failed: ${res.status}`)
  const data = await res.json() as { data: Array<{ embedding: number[] }> }
  return data.data.map(d => d.embedding)
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

async function runFullIndex() {
  log('runFullIndex called, db:', !!db, 'llamaReady:', llamaReady)
  if (!db || !llamaReady) { log('runFullIndex aborted'); return }

  setStatus('indexing')

  // Check if embeddings need rebuild (model switch)
  const MODEL_KEY = 'e5-small-v2-llama'
  const lastModel = db.prepare(`SELECT value FROM settings WHERE key = 'aiEmbedModel'`).get() as any
  if (lastModel?.value !== MODEL_KEY) {
    log('model changed from', lastModel?.value, '→', MODEL_KEY, '— clearing all embeddings')
    db.prepare('DELETE FROM resource_embeddings').run()
    db.prepare('DELETE FROM resource_content').run()
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('aiEmbedModel', ?)`).run(MODEL_KEY)
  }

  // Metadata embedding — only resources missing metadata vector
  const needsEmbed = db.prepare(`
    SELECT r.id FROM resources r
    LEFT JOIN resource_embeddings re ON re.resource_id = r.id AND re.chunk_index = -1
    WHERE re.resource_id IS NULL
  `).all() as Array<{ id: string }>
  const total = needsEmbed.length

  log('metadata indexing:', total, 'resources need embedding')
  for (let i = 0; i < needsEmbed.length; i++) {
    if (!llamaReady) break
    try { await indexMetadataEmbedding(needsEmbed[i].id) } catch (e: any) { log('embed error:', e?.message) }
    if (total > 0) emitProgress({ stage: '索引资源', percent: Math.round(((i + 1) / total) * 100), done: i + 1, total })
  }

  // Content that was fetched but not yet embedded
  const needsContentEmbed = db.prepare(`
    SELECT rc.resource_id, rc.text FROM resource_content rc
    LEFT JOIN resource_embeddings re ON re.resource_id = rc.resource_id AND re.chunk_index >= 0
    WHERE rc.fetch_status = 'done' AND rc.text IS NOT NULL AND re.resource_id IS NULL
  `).all() as Array<{ resource_id: string; text: string }>

  if (needsContentEmbed.length > 0) {
    for (let i = 0; i < needsContentEmbed.length; i++) {
      if (!llamaReady) break
      try { await indexResourceEmbeddings(needsContentEmbed[i].resource_id, needsContentEmbed[i].text) } catch {}
      emitProgress({ stage: '索引内容', percent: Math.round(((i + 1) / needsContentEmbed.length) * 100), done: i + 1, total: needsContentEmbed.length })
    }
  }

  // Queue content extraction for resources never attempted
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
  } else if (needsContentEmbed.length === 0 && needsEmbed.length === 0) {
    emitProgress({ stage: 'done', percent: 100 })
  }
}

async function indexMetadataEmbedding(resourceId: string) {
  if (!db || !llamaReady) return
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
  if (!db || !llamaReady) return
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

async function startAi(workerDir: string) {
  setStatus('downloading')
  startContentWorker(join(workerDir, 'content-worker.js'))

  try {
    const { serverPath, modelPath } = await ensureLlamaFiles()
    await startLlamaServer(serverPath, modelPath)
    log('llama-server ready, llamaReady:', llamaReady, 'db:', !!db)
    setStatus('ready')
    runFullIndex()
  } catch (err) {
    log('failed to start llama-server:', err)
    setStatus('disabled')
  }
}

export async function enableAi(workerDir: string) {
  if (!db) return
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('aiEnabled', '1')`).run()
  if (status === 'disabled') await startAi(workerDir)
}

export function disableAi() {
  if (!db) return
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('aiEnabled', '0')`).run()
  contentProc?.kill()
  stopLlamaServer()
  contentProc = null
  contentIndexTotal = 0; contentIndexDone = 0
  setStatus('disabled')
}

export function getAiStatus(): AiStatus { return status }

export function isModelInstalled(): boolean {
  try {
    const dir = join(process.env.LOCALAPPDATA || modelDir, 'ai-cubby-llama')
    return existsSync(join(dir, 'llama-server.exe')) && existsSync(join(dir, 'e5-small-v2-q8_0.gguf'))
  } catch { return false }
}

export function pauseIndex() { indexPaused = true }
export function resumeIndex() { indexPaused = false; drainContentQueue() }
export function isIndexPaused(): boolean { return indexPaused }

export function onStatusChange(fn: (s: AiStatus) => void) {
  statusListeners.push(fn)
  return () => { statusListeners = statusListeners.filter(f => f !== fn) }
}

export function onProgress(fn: (p: AiProgress) => void) {
  progressListeners.push(fn)
  return () => { progressListeners = progressListeners.filter(f => f !== fn) }
}

export async function queueResourceContent(resourceId: string, filePath: string) {
  if (llamaReady) {
    try { await indexMetadataEmbedding(resourceId) } catch {}
  }
  if (status === 'disabled' || !contentProc) return
  const type = /^https?:\/\//i.test(filePath) ? 'url' : 'file'
  contentQueue.push({ resourceId, type, path: filePath })
  drainContentQueue()
}

export async function semanticSearch(query: string, topK = 10): Promise<SemanticResult[]> {
  if (!db || !llamaReady) return []

  const queryEmb = (await embedTexts([`query: ${query}`]))[0]

  const WEIGHT_META = 1.0
  const WEIGHT_CONTENT = 0.3

  const rows = db.prepare(`
    SELECT resource_id, chunk_index, embedding, chunk_text
    FROM resource_embeddings
  `).all() as Array<{ resource_id: string; chunk_index: number; embedding: Buffer; chunk_text: string }>

  const scored = rows.map(row => {
    const emb = Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4))
    const rawScore = cosineSim(queryEmb, emb)
    let weight: number
    if (row.chunk_index === -1) {
      weight = WEIGHT_META
    } else if (rawScore > 0.75) {
      weight = 0.3 + (rawScore - 0.75) * 2.8
    } else {
      weight = WEIGHT_CONTENT
    }
    return {
      resourceId: row.resource_id,
      score: rawScore * weight,
      chunkText: row.chunk_text,
    }
  })

  const best = new Map<string, SemanticResult>()
  for (const r of scored) {
    const prev = best.get(r.resourceId)
    if (!prev || r.score > prev.score) best.set(r.resourceId, r)
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(r => r.score > 0.5)
}
