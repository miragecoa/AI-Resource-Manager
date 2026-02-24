import { app, shell } from 'electron'
import { watch, readdirSync, FSWatcher } from 'fs'
import { extname, basename, join } from 'path'
import { spawn, execFile, ChildProcess } from 'child_process'
import { promisify } from 'util'
import { createInterface } from 'readline'
import { upsertResource, isIgnored } from '../db/queries'
import type { Resource } from '../db/queries'

const execFileAsync = promisify(execFile)

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
  // 漫画（CBZ/CBR 是明确的漫画格式，不会误判为其他类型）
  '.cbz': 'comic', '.cbr': 'comic', '.cbt': 'comic',
  // 音乐
  '.mp3': 'music', '.flac': 'music', '.wav': 'music',
  '.aac': 'music', '.ogg': 'music', '.m4a': 'music',
  '.ape': 'music', '.wma': 'music',
  // 小说/电子书（txt/pdf 不加：太泛，误判率高）
  '.epub': 'novel', '.mobi': 'novel', '.azw3': 'novel', '.azw': 'novel',
  // 可执行（游戏/应用，后续异步区分）
  '.exe': 'app'
}

// .lnk 路径黑名单（用于 processLnk，大小写敏感，shell 返回路径一般大小写一致）
const BLOCKED_PATHS = [
  'C:\\Windows\\',
  'C:\\Program Files\\WindowsApps\\',
  'C:\\ProgramData\\Microsoft\\'
]

// 进程路径黑名单（小写比较，避免 WMI 返回路径大小写不一致）
const BLOCKED_PROCESS_PATHS = [
  'c:\\windows\\',
  'c:\\program files\\windowsapps\\',
  'c:\\programdata\\microsoft\\'
]

// 进程路径中包含这些片段的视为辅助/后台进程，跳过
// 注意：不能用 \\bin\\ —— 很多合法程序（OBS、FFmpeg等）安装在 bin 子目录里
// Steam / Chrome 的帮助进程已经被 \\cef\\ \\helper\\ \\crashpad\\ 覆盖到了
const BLOCKED_PATH_SEGMENTS = [
  '\\cef\\', '\\lib\\', '\\libs\\',
  '\\helper\\', '\\helpers\\', '\\crashpad\\'
]

// 已知系统/后台进程名（不含 .exe，小写）
const BLOCKED_EXE_NAMES = new Set([
  'conhost', 'svchost', 'dllhost', 'rundll32', 'taskhost', 'taskhostw',
  'werfault', 'werfaultsecure', 'wermgr', 'sihost', 'fontdrvhost',
  'searchprotocolhost', 'searchfilterhost', 'searchindexer',
  'steamwebhelper', 'crashpad_handler', 'chrome_crashpad_handler',
  'git', 'updater'
])

// 系统文件扩展名黑名单
const BLOCKED_EXTS = new Set(['.dll', '.sys', '.tmp', '.lnk', '.ini', '.dat', '.log', '.xml'])

// exe路径(小写) → 快捷方式显示名称 / 快捷方式路径
// 仅记录「用户自定义命名」的快捷方式（lnk 名称 ≠ exe 名称），Windows 自动生成的 Recent lnk 不记
const exeToLnkName = new Map<string, string>()
const exeToLnkPath = new Map<string, string>()

/** 判断一个进程路径是否应跳过（专用于进程扫描，比 .lnk 过滤更严格） */
function isBlockedProcess(exePath: string): boolean {
  const lower = exePath.toLowerCase()
  if (BLOCKED_PROCESS_PATHS.some(p => lower.startsWith(p))) return true
  if (BLOCKED_PATH_SEGMENTS.some(s => lower.includes(s))) return true
  const exeName = basename(lower, '.exe')
  if (BLOCKED_EXE_NAMES.has(exeName)) return true
  if (isIgnored(exePath)) return true
  return false
}

let recentWatcher: FSWatcher | null = null
let desktopWatcher: FSWatcher | null = null
let processWatcherProc: ChildProcess | null = null

// WMI 进程创建事件监听脚本（Base64-UTF16LE 编码，通过 -EncodedCommand 传入，避免引号转义问题）
// 只捕获由用户 Shell（Explorer/终端）直接启动的进程，过滤掉程序自己衍生的子进程
function buildWmiWatcherScript(): string {
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$ErrorActionPreference = "SilentlyContinue"',
    // 系统级进程：由这些进程启动的子进程属于后台服务，跳过
    // 用户层进程（explorer、tray app、终端等）启动的则允许
    '$sysSpawners = @("svchost","services","lsass","wininit","winlogon","smss","csrss","system","registry","taskeng","taskschd")',
    '$w = New-Object System.Management.ManagementEventWatcher(',
    '  "SELECT * FROM __InstanceCreationEvent WITHIN 2 WHERE TargetInstance ISA \'Win32_Process\'"',
    ')',
    'while ($true) {',
    '  try {',
    '    $e = $w.WaitForNextEvent()',
    '    $p = $e.TargetInstance.ExecutablePath',
    '    if ($p) {',
    '      $ppid = $e.TargetInstance.ParentProcessId',
    '      $parent = Get-Process -Id $ppid -ErrorAction SilentlyContinue',
    '      if (-not $parent -or $sysSpawners -notcontains $parent.ProcessName.ToLower()) {',
    '        Write-Output $p',
    '      }',
    '    }',
    '  } catch { }',
    '}'
  ].join('\n')
  return Buffer.from(script, 'utf16le').toString('base64')
}

function startProcessWatcher(onNewEntry: (entry: Resource) => void): void {
  if (processWatcherProc) return
  console.log('[Monitor] Starting WMI process watcher...')
  const ownExe = process.execPath.toLowerCase()

  try {
    processWatcherProc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', buildWmiWatcherScript()
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

    createInterface({ input: processWatcherProc.stdout! }).on('line', (line) => {
      const exePath = line.trim()
      const lower = exePath.toLowerCase()
      if (!exePath || lower === ownExe || !lower.endsWith('.exe')) return
      if (isBlockedProcess(exePath)) {
        console.log('[Monitor] Process skipped (blocked):', exePath)
        return
      }
      const lnkTitle = exeToLnkName.get(lower)
      // file_path 始终用 exe 路径，与 .lnk 通道天然去重
      // 有快捷方式名称时 updateTitle=true（如已存在的 "chrome" → "Google Chrome"）
      const title = lnkTitle ?? basename(exePath, extname(exePath))
      try {
        const resource = upsertResource({ type: 'app', title, file_path: exePath, rating: 0 }, !!lnkTitle)
        if (resource) {
          console.log('[Monitor] Process started, auto-added:', title, lnkTitle ? '(from shortcut)' : '(exe name)')
          onNewEntry(resource)
        }
      } catch (e) {
        console.error('[Monitor] upsertResource failed for process:', exePath, e)
      }
    })

    processWatcherProc.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim()
      // PowerShell 非交互模式下 stderr 可能输出 CLIXML 格式噪音，忽略
      if (msg && !msg.startsWith('#< CLIXML')) console.warn('[Monitor] WMI watcher:', msg)
    })

    processWatcherProc.on('exit', (code) => {
      console.warn('[Monitor] WMI process watcher exited, code:', code)
      processWatcherProc = null
    })

    console.log('[Monitor] WMI process watcher started')
  } catch (e) {
    console.error('[Monitor] Failed to start WMI process watcher:', e)
    processWatcherProc = null
  }
}

/** 递归收集一个目录下所有 .lnk 文件的完整路径 */
function collectLnkFiles(dir: string, result: string[] = []): string[] {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        collectLnkFiles(fullPath, result)
      } else if (entry.name.endsWith('.lnk')) {
        result.push(fullPath)
      }
    }
  } catch { /* 无权访问，跳过 */ }
  return result
}

/** 启动时预扫描 .lnk，把「exe路径→快捷方式名称」写入 exeToLnkName，
 *  这样 WMI 检测到进程时就能用人类可读的名称，而不是裸的 exe 文件名。
 *  只建立映射，不写数据库。*/
function preloadLnkNames(folders: string[]): void {
  for (const folder of folders) {
    for (const lnkPath of collectLnkFiles(folder)) {
      try {
        const shortcut = shell.readShortcutLink(lnkPath)
        if (!shortcut.target) continue
        const lnkName = basename(lnkPath, '.lnk')
        const exeName = basename(shortcut.target, extname(shortcut.target))
        // 只收录用户自定义命名的快捷方式（名称与 exe 不同，说明是有意义的别名）
        if (lnkName.toLowerCase() !== exeName.toLowerCase()) {
          exeToLnkName.set(shortcut.target.toLowerCase(), lnkName)
          exeToLnkPath.set(shortcut.target.toLowerCase(), lnkPath)
        }
      } catch { /* 单个 .lnk 读取失败，跳过 */ }
    }
  }
  console.log(`[Monitor] Pre-indexed ${exeToLnkName.size} named shortcuts`)
}

export function startMonitor(onNewEntry: (entry: Resource) => void): void {
  const recentPath = app.getPath('recent')
  const desktopPath = app.getPath('desktop')
  console.log('[Monitor] Watching Recent:', recentPath)
  console.log('[Monitor] Watching Desktop:', desktopPath)

  // 预热快捷方式名称映射（WMI 通道用来把 exe 路径翻译成显示名称）
  // 扫描 Desktop + Recent + 开始菜单（用户 + 全局），递归处理子文件夹
  const appData    = process.env.APPDATA    ?? ''
  const programData = process.env.PROGRAMDATA ?? 'C:\\ProgramData'
  const startMenuUser   = join(appData,     'Microsoft', 'Windows', 'Start Menu', 'Programs')
  const startMenuGlobal = join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  preloadLnkNames([desktopPath, recentPath, startMenuUser, startMenuGlobal])

  recentWatcher = watch(recentPath, { persistent: false }, (_event, filename) => {
    if (!filename?.endsWith('.lnk')) return
    handleLnkFile(join(recentPath, filename), onNewEntry)
  })

  desktopWatcher = watch(desktopPath, { persistent: false }, (_event, filename) => {
    if (!filename?.endsWith('.lnk')) return
    console.log('[Monitor] Desktop .lnk change:', filename)
    handleLnkFile(join(desktopPath, filename), onNewEntry)
  })

  startProcessWatcher(onNewEntry)
  console.log('[Monitor] Watchers started (Recent + Desktop + WMI)')
}

export function stopMonitor(): void {
  recentWatcher?.close(); recentWatcher = null
  desktopWatcher?.close(); desktopWatcher = null
  if (processWatcherProc) { processWatcherProc.kill(); processWatcherProc = null }
}

/**
 * 扫描注册表启动项（HKCU + HKLM Run Key），返回 exe 路径列表。
 * 这些是用户主动配置了「开机启动」的程序，是高质量的入库候选。
 */
async function scanStartupRegistry(): Promise<string[]> {
  const keys = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
  ]
  const exePaths: string[] = []

  for (const key of keys) {
    try {
      const { stdout } = await execFileAsync('reg.exe', ['query', key, '/t', 'REG_SZ'], {
        encoding: 'utf8', timeout: 3000, windowsHide: true
      })
      for (const line of stdout.split(/\r?\n/)) {
        const match = line.match(/REG_SZ\s+(.+)$/)
        if (!match) continue
        const value = match[1].trim()
        // 提取 exe 路径（可能带引号，可能带参数）
        let exePath = ''
        if (value.startsWith('"')) {
          const end = value.indexOf('"', 1)
          exePath = end > 1 ? value.slice(1, end) : ''
        } else {
          exePath = value.split(/\s+/)[0]
        }
        if (exePath.toLowerCase().endsWith('.exe')) exePaths.push(exePath)
      }
    } catch { /* 键不存在或无权限，跳过 */ }
  }

  console.log(`[Monitor] Registry startup items: ${exePaths.length} exe paths found`)
  return exePaths
}

/**
 * 立即扫描所有 .lnk 来源 + 注册表启动项，返回成功入库的资源列表。
 * .lnk 来源：Recent Files、Desktop、用户开机启动文件夹、系统开机启动文件夹
 */
export async function scanRecentFolder(): Promise<Resource[]> {
  // Startup 文件夹：用户级 + 系统级
  const appData = process.env.APPDATA || ''
  const programData = process.env.PROGRAMDATA || 'C:\\ProgramData'
  const startupUser = join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
  const startupAll  = join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')

  const folders = [app.getPath('recent'), app.getPath('desktop'), startupUser, startupAll]
  const results: Resource[] = []

  for (const folder of folders) {
    console.log('[Monitor] Scanning:', folder)
    let files: string[]
    try {
      files = readdirSync(folder).filter(f => f.endsWith('.lnk'))
    } catch (e) {
      console.error('[Monitor] Cannot read folder:', folder, e)
      continue
    }
    console.log(`[Monitor] Found ${files.length} .lnk in ${folder}`)
    for (const file of files) {
      const resource = processLnk(join(folder, file))
      if (resource) results.push(resource)
    }
  }

  // 注册表启动项
  const regPaths = await scanStartupRegistry()
  const ownExe = process.execPath.toLowerCase()
  for (const exePath of regPaths) {
    const lower = exePath.toLowerCase()
    if (lower === ownExe) continue
    // 注册表启动项只过滤系统目录，不过滤路径段（\cef\ 等对启动项无意义）
    if (BLOCKED_PROCESS_PATHS.some(p => lower.startsWith(p))) continue
    if (isIgnored(exePath)) continue
    const ext = extname(lower)
    const type = EXT_MAP[ext]
    if (!type) continue
    const title = basename(exePath, ext)
    try {
      const resource = upsertResource({ type, title, file_path: exePath, rating: 0 })
      if (resource) results.push(resource)
    } catch (e) {
      console.error('[Monitor] upsertResource failed for startup registry:', exePath, e)
    }
  }

  console.log(`[Monitor] Scan done, added/updated ${results.length} resources`)
  return results
}

function handleLnkFile(lnkPath: string, onNewEntry: (entry: Resource) => void): void {
  const resource = processLnk(lnkPath)
  if (resource) {
    console.log('[Monitor] New resource:', resource.type, resource.title)
    onNewEntry(resource)
  }
}

/**
 * 扫描当前所有运行中的进程，获取 .exe 路径并入库。
 * 等同于任务管理器里看到的进程列表。
 * 仅按需调用（用户手动触发），不做轮询，避免杀毒误报。
 */
export async function scanProcesses(): Promise<Resource[]> {
  console.log('[Monitor] Scanning running processes...')
  const ownExe = process.execPath.toLowerCase()
  let exePaths: string[] = []

  // 优先用 PowerShell（Win10+ 均可用，支持 Unicode 路径）
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      // 强制 UTF-8 输出，避免中文路径乱码
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' +
      'Get-Process | Where-Object { $_.Path } | Select-Object -ExpandProperty Path'
    ], { timeout: 8000, windowsHide: true, encoding: 'utf8' })

    exePaths = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    console.log(`[Monitor] PowerShell returned ${exePaths.length} process paths`)
  } catch (psErr) {
    console.warn('[Monitor] PowerShell scan failed, falling back to wmic:', (psErr as Error).message)

    // Fallback：wmic（Windows 10 仍可用，Win11 某些版本已移除）
    try {
      const { stdout } = await execFileAsync('wmic.exe',
        ['process', 'get', 'ExecutablePath', '/FORMAT:CSV'],
        { timeout: 8000, windowsHide: true, encoding: 'utf8' }
      )
      // CSV 格式：第一行空行，第二行是 header "Node,ExecutablePath"，之后是数据
      exePaths = stdout.split(/\r?\n/)
        .slice(2)
        .map(line => {
          const commaIdx = line.indexOf(',')
          return commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : ''
        })
        .filter(Boolean)
      console.log(`[Monitor] wmic returned ${exePaths.length} process paths`)
    } catch (wmicErr) {
      console.error('[Monitor] Both process scan methods failed:', (wmicErr as Error).message)
      return []
    }
  }

  const results: Resource[] = []
  for (const exePath of exePaths) {
    const lower = exePath.toLowerCase()
    if (lower === ownExe) continue
    if (!lower.endsWith('.exe')) continue
    if (isBlockedProcess(exePath)) continue

    const title = basename(exePath, extname(exePath))
    try {
      const resource = upsertResource({ type: 'app', title, file_path: exePath, rating: 0 })
      if (resource) results.push(resource)
    } catch (e) {
      console.error('[Monitor] upsertResource failed for process path:', exePath, e)
    }
  }

  console.log(`[Monitor] Process scan done, added/updated ${results.length} resources`)
  return results
}

function processLnk(lnkPath: string): Resource | null {
  let target: string
  try {
    const shortcut = shell.readShortcutLink(lnkPath)
    target = shortcut.target
    if (!target) {
      console.log('[Monitor] No target in .lnk:', lnkPath)
      return null
    }
  } catch (e) {
    console.warn('[Monitor] readShortcutLink failed for', lnkPath, ':', e)
    return null
  }

  // 路径过滤
  if (BLOCKED_PATHS.some((p) => target.startsWith(p))) {
    console.log('[Monitor] Blocked path:', target)
    return null
  }

  const ext = extname(target).toLowerCase()

  if (BLOCKED_EXTS.has(ext)) {
    console.log('[Monitor] Blocked ext:', ext, target)
    return null
  }

  const type = EXT_MAP[ext]
  if (!type) {
    console.log('[Monitor] Unknown ext, skipping:', ext, target)
    return null
  }

  if (isIgnored(target)) {
    console.log('[Monitor] Ignored path:', target)
    return null
  }

  const lnkName = basename(lnkPath, '.lnk')
  const exeName = basename(target, ext)
  // 快捷方式名称与 exe 名不同 → 用户自定义命名（如「VK加速器全球版」「Google Chrome」）
  const isUserNamed = lnkName.toLowerCase() !== exeName.toLowerCase()
  const title = isUserNamed ? lnkName : exeName
  if (isUserNamed) {
    // 建立 exe→lnk 映射，供 WMI 通道使用
    exeToLnkName.set(target.toLowerCase(), title)
    exeToLnkPath.set(target.toLowerCase(), lnkPath)
  }

  // file_path 始终存 exe 路径（保证「打开文件所在位置」指向 exe 目录，且与 WMI 通道天然去重）
  try {
    // isUserNamed 时 updateTitle=true：将已有的 exe 名称升级为快捷方式名称
    const resource = upsertResource({ type, title, file_path: target, rating: 0 }, isUserNamed)
    return resource ?? null
  } catch (e) {
    console.error('[Monitor] upsertResource failed:', e)
    return null
  }
}
