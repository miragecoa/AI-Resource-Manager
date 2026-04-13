/**
 * content-worker.ts — runs as a utilityProcess child
 * Handles: URL fetch, local file read, PDF parse, Readability extraction
 * Communicates with main via process.parentPort (MessageChannelMain)
 *
 * Message IN:  { id, type, resourceId, path }
 *   type: 'url' | 'file'
 *   path: URL string or absolute file path
 *
 * Message OUT: { id, resourceId, status, text?, wordCount?, isTruncated? }
 *   status: 'done' | 'failed' | 'login_required' | 'skipped'
 */

import { readFileSync } from 'fs'
import { extname } from 'path'

const MAX_CHARS = 10_000   // ~20 chunks of 512 chars
const LOGIN_PATTERNS = [/请.*登[录陆]/, /sign[\s-]*in/i, /log[\s-]*in/i, /please.*login/i]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isLoginWall(text: string, statusCode: number): boolean {
  if (statusCode === 401 || statusCode === 403) return true
  if (text.length < 300) return true
  const sample = text.slice(0, 600)
  return LOGIN_PATTERNS.some(p => p.test(sample))
}

function truncate(text: string): { text: string; isTruncated: boolean } {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= MAX_CHARS) return { text: trimmed, isTruncated: false }
  return { text: trimmed.slice(0, MAX_CHARS), isTruncated: true }
}

async function extractFromHtml(html: string, url: string): Promise<string> {
  const { parseHTML } = await import('linkedom')
  const { Readability } = await import('@mozilla/readability')
  const { document } = parseHTML(html)
  const article = new Readability(document as any).parse()
  return article?.textContent ?? ''
}

async function fetchUrl(url: string): Promise<{ text: string; status: 'done' | 'login_required' | 'failed' }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-Cubby/1.0)' },
      signal: AbortSignal.timeout(8000),
    })
    const html = await res.text()
    const text = await extractFromHtml(html, url)
    if (isLoginWall(text, res.status)) return { text: '', status: 'login_required' }
    return { text, status: 'done' }
  } catch {
    return { text: '', status: 'failed' }
  }
}

async function readLocalFile(filePath: string): Promise<{ text: string; status: 'done' | 'skipped' | 'failed' }> {
  const ext = extname(filePath).toLowerCase()

  // Skip binary/media types with no extractable text
  const skipExts = ['.exe', '.dll', '.zip', '.rar', '.7z', '.mp4', '.mp3', '.avi', '.mkv',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.ico', '.bmp', '.svg']
  if (skipExts.includes(ext)) return { text: '', status: 'skipped' }

  try {
    if (ext === '.pdf') {
      const pdfParse = (await import('pdf-parse')).default
      const buf = readFileSync(filePath)
      const data = await pdfParse(buf, { max: 30 }) // max 30 pages
      return { text: data.text, status: 'done' }
    }

    if (['.txt', '.md', '.markdown', '.rst', '.csv', '.json', '.html', '.htm'].includes(ext)) {
      const raw = readFileSync(filePath, 'utf-8')
      const text = ext === '.html' || ext === '.htm'
        ? await extractFromHtml(raw, `file://${filePath}`)
        : raw
      return { text, status: 'done' }
    }

    return { text: '', status: 'skipped' }
  } catch {
    return { text: '', status: 'failed' }
  }
}

// ---------------------------------------------------------------------------
// Main message loop
// ---------------------------------------------------------------------------

if (!process.parentPort) {
  setInterval(() => {}, 60000)
}

process.parentPort?.on('message', async (e: Electron.MessageEvent) => {
  const msg = e.data
  const { id, resourceId, type, path } = msg as {
    id: string
    resourceId: string
    type: 'url' | 'file'
    path: string
  }

  try {
    // Skip localhost — dev servers, not real content
    if (type === 'url' && /^https?:\/\/localhost(:\d+)?/i.test(path)) {
      process.parentPort?.postMessage({ id, resourceId, status: 'skipped' })
      return
    }

    const raw = type === 'url'
      ? await fetchUrl(path)
      : await readLocalFile(path)

    if (raw.status !== 'done' || !raw.text.trim()) {
      process.parentPort?.postMessage({ id, resourceId, status: raw.status })
      return
    }

    const { text, isTruncated } = truncate(raw.text)
    const wordCount = text.split(/\s+/).filter(Boolean).length

    process.parentPort?.postMessage({ id, resourceId, status: 'done', text, wordCount, isTruncated })
  } catch (err) {
    process.parentPort?.postMessage({ id, resourceId, status: 'failed' })
  }
})
