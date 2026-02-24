import { app, BrowserWindow, shell, Menu, Tray, nativeImage, protocol, net } from 'electron'
import { join } from 'path'
import { deflateSync } from 'zlib'
import { existsSync } from 'fs'
import { execFile } from 'child_process'

// Windows 终端默认使用 GBK 编码，切换到 UTF-8 (65001) 让中文日志正常显示
if (process.platform === 'win32') {
  execFile('cmd.exe', ['/c', 'chcp', '65001'], { windowsHide: true }, () => {})
}

// 必须在 app ready 之前声明自定义 scheme（用于本地文件预览）
protocol.registerSchemesAsPrivileged([
  { scheme: 'local', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }
])
import { initDatabase } from './db/index'
import { registerIpcHandlers } from './ipc/index'
import { startMonitor } from './monitor/recent-files'
import type { RunningEvent } from './monitor/recent-files'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let willQuit = false

// 点击 X 时隐藏到托盘，而非退出
app.on('before-quit', () => { willQuit = true })

/** 用 Node 内置 zlib 生成合法 PNG buffer（无外部依赖） */
function makeSolidPng(r: number, g: number, b: number, size = 16): Buffer {
  // 每行：1 字节 filter(=0) + size×3 字节 RGB
  const raw = Buffer.alloc(size * (1 + size * 3), 0)
  for (let y = 0; y < size; y++) {
    const off = y * (1 + size * 3)
    for (let x = 0; x < size; x++) {
      raw[off + 1 + x * 3 + 0] = r
      raw[off + 1 + x * 3 + 1] = g
      raw[off + 1 + x * 3 + 2] = b
    }
  }
  const compressed = deflateSync(raw)

  // CRC32 table-driven
  const crc32 = (data: Buffer): number => {
    let crc = 0xFFFFFFFF
    for (const byte of data) {
      crc ^= byte
      for (let k = 0; k < 8; k++) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0
  }

  const makeChunk = (type: string, data: Buffer): Buffer => {
    const lenBuf = Buffer.alloc(4)
    lenBuf.writeUInt32BE(data.length)
    const typeBuf = Buffer.from(type)
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 2  // color type: RGB

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ])
}

let fileIcon: nativeImage | null | undefined = undefined  // undefined = not yet checked

/** 只加载用户放在 resources/ 里的真实图标，找不到返回 null */
function loadFileIcon(): nativeImage | null {
  if (fileIcon !== undefined) return fileIcon

  const resourcesDir = join(app.getAppPath(), 'resources')
  for (const name of ['icon.ico', 'icon.png']) {
    const p = join(resourcesDir, name)
    if (existsSync(p)) {
      try {
        const img = nativeImage.createFromPath(p)
        if (!img.isEmpty()) {
          console.log('[Icon] Loaded from', p)
          fileIcon = img
          return fileIcon
        }
      } catch { /* continue */ }
    }
  }

  fileIcon = null
  return null
}

/** 托盘图标：有真实文件用真实的，否则用程序内生成的纯色 PNG 兜底 */
function createTrayIcon(): nativeImage {
  return loadFileIcon() ?? nativeImage.createFromBuffer(makeSolidPng(0x63, 0x66, 0xF1))
}

function createTray(): void {
  tray = new Tray(createTrayIcon())
  tray.setToolTip('AI资源管家')

  const menu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => mainWindow?.show())
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'AI资源管家',
    backgroundColor: '#0C0C18',
    ...(loadFileIcon() ? { icon: loadFileIcon()! } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 关闭按钮 → 隐藏到托盘，而非退出
  mainWindow.on('close', (event) => {
    if (!willQuit) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  // local://local-file/D:/path/to/file → 转发给 file:// 协议
  // 注意：Chromium 对 standard scheme 解析 local:///C:/path 时会把 C: 当成 hostname，
  // 导致 request.url 变成 local://c/path（丢失盘符）。
  // 解决方法：前端统一用 local://local-file/C:/path 格式，这里从 pathname 提取路径。
  protocol.handle('local', (request) => {
    const url = new URL(request.url)
    // pathname 形如 /C%3A%2FUsers%2F... (encodeURIComponent 编码)，去掉开头的 / 并解码
    const filePath = decodeURIComponent(url.pathname.slice(1))
    const target = 'file:///' + filePath.replace(/\\/g, '/')
    // 转发 Range 等请求头，支持视频 seek
    return net.fetch(target, { headers: Object.fromEntries(request.headers) }).catch((e: Error) => {
      console.error('[Protocol] failed:', filePath, e?.message)
      return new Response('Not found', { status: 404 })
    })
  })

  initDatabase()
  registerIpcHandlers()

  createTray()
  createWindow()

  // 启动 Recent Files 监听
  startMonitor(
    (entry) => {
      mainWindow?.webContents.send('resource:new', entry)
    },
    (event: RunningEvent) => {
      mainWindow?.webContents.send('resource:running', event)
      // 同时推送更新后的资源数据（含最新统计字段）
      if (event.resource) {
        mainWindow?.webContents.send('resource:new', event.resource)
      }
    }
  )

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
