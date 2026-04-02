/**
 * Heartbeat — anonymous daily-active-user tracking.
 *
 * What is sent:  { id: <random UUID stored locally>, v: <app version> }
 * What is NOT sent: file paths, filenames, usernames, hardware info, any PII.
 * The server captures the IP from request headers server-side.
 *
 * Behavior:
 *  - Fires once on app launch, then every 60 minutes while the app is open.
 *  - All errors are silently swallowed — never affects the user experience.
 *  - If the endpoint is unreachable (offline, etc.), nothing happens.
 */

import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'

const ENDPOINT = 'https://aicubby.app/api/heartbeat'
const INTERVAL_MS = 60 * 60 * 1000  // 1 hour

let _timer: ReturnType<typeof setInterval> | null = null

/** Returns the persisted install_id, creating one on first run. */
function getInstallId(): string {
  const file = join(app.getPath('userData'), 'install.json')
  try {
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'))
      if (typeof data?.id === 'string' && data.id.length === 36) return data.id
    }
  } catch { /* corrupt file — regenerate */ }

  const id = randomUUID()
  try { writeFileSync(file, JSON.stringify({ id }), 'utf8') } catch { /* non-critical */ }
  return id
}

/** Fires one heartbeat. Never throws. */
async function sendHeartbeat(installId: string, version: string): Promise<void> {
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: installId, v: version }),
      signal: AbortSignal.timeout(8000),  // 8s timeout, don't hang
    })
  } catch { /* offline, timeout, or any error — silently ignored */ }
}

/** Call once after app.whenReady(). Starts heartbeat loop. */
export function initHeartbeat(): void {
  try {
    const installId = getInstallId()
    const version = app.getVersion()

    // Fire immediately on launch
    sendHeartbeat(installId, version)

    // Then every hour
    _timer = setInterval(() => {
      sendHeartbeat(installId, version)
    }, INTERVAL_MS)

    // Don't keep Node alive just for the heartbeat timer
    _timer.unref()
  } catch { /* if anything goes wrong, heartbeat simply doesn't start */ }
}

/** Call on app quit to clean up the interval (optional, unref handles it). */
export function stopHeartbeat(): void {
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
}
