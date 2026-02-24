import { app, shell } from 'electron'
import { watch, FSWatcher } from 'fs'
import { extname, basename } from 'path'
import { upsertResource, isIgnored } from '../db/queries'
import type { Resource } from '../db/queries'

// 按扩展名判断资源类型
const EXT_MAP: Record<string, Resource['type']> = {
  // 图片
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image',
  '.gif': 'image', '.webp': 'image', '.bmp': 'image',
  '.tiff': 'image', '.avif': 'image',
  // 视频
  '.mp4': 'video', '.mkv': 'video', '.avi': 'video',
  '.mov': 'video', '.wmv': 'video', '.flv': 'video',
  '.webm': 'video', '.m4v': 'video',
  // 可执行（游戏/应用，后续异步区分）
  '.exe': 'app'
}

// 系统路径黑名单
const BLOCKED_PATHS = [
  'C:\\Windows\\',
  'C:\\Program Files\\WindowsApps\\',
  'C:\\ProgramData\\Microsoft\\'
]

// 系统文件扩展名黑名单
const BLOCKED_EXTS = new Set(['.dll', '.sys', '.tmp', '.lnk', '.ini', '.dat', '.log', '.xml'])

let watcher: FSWatcher | null = null

export function startMonitor(onNewEntry: (entry: Resource) => void): void {
  const recentPath = app.getPath('recent')

  watcher = watch(recentPath, { persistent: false }, (_event, filename) => {
    if (!filename?.endsWith('.lnk')) return
    handleLnkFile(`${recentPath}\\${filename}`, onNewEntry)
  })

  console.log('Monitor started:', recentPath)
}

export function stopMonitor(): void {
  watcher?.close()
  watcher = null
}

function handleLnkFile(lnkPath: string, onNewEntry: (entry: Resource) => void): void {
  try {
    const shortcut = shell.readShortcutLink(lnkPath)
    const target = shortcut.target
    if (!target) return

    // 路径过滤
    if (BLOCKED_PATHS.some((p) => target.startsWith(p))) return
    const ext = extname(target).toLowerCase()
    if (BLOCKED_EXTS.has(ext)) return

    const type = EXT_MAP[ext]
    if (!type) return

    // 忽略列表
    if (isIgnored(target)) return

    const title = basename(target, ext)

    const resource = upsertResource({
      type,
      title,
      file_path: target,
      rating: 0
    })

    if (resource) {
      onNewEntry(resource)
    }
  } catch {
    // lnk 解析失败或文件已删除，忽略
  }
}
