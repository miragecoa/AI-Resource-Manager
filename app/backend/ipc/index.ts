import { ipcMain, shell, app, nativeImage } from 'electron'
import {
  getAllResources, getResourceById, updateResource, removeResource,
  getAllTags, createTag, removeTag, addTagToResource, removeTagFromResource,
  searchResources, getSetting, setSetting,
  addIgnoredPath, getAllIgnoredPaths, removeIgnoredPath, removeResourceByPath
} from '../db/queries'
import { scanRecentFolder, scanProcesses } from '../monitor/recent-files'

export function registerIpcHandlers(): void {

  // ── 资源 ──────────────────────────────────────────────
  ipcMain.handle('resources:getAll', (_e, type?: string) => getAllResources(type))
  ipcMain.handle('resources:getById', (_e, id: string) => getResourceById(id))

  ipcMain.handle('resources:update', (_e, id: string, data: object) => {
    updateResource(id, data)
    return getResourceById(id)
  })

  ipcMain.handle('resources:remove', (_e, id: string) => {
    removeResource(id)
    return true
  })

  ipcMain.handle('resources:ignore', (_e, filePath: string) => {
    addIgnoredPath(filePath)
    removeResourceByPath(filePath)   // 同时从资源库中删除，防止重启后重新出现
    return true
  })

  // ── 忽略列表管理 ───────────────────────────────────────
  ipcMain.handle('ignoredPaths:getAll', () => getAllIgnoredPaths())

  ipcMain.handle('ignoredPaths:remove', (_e, filePath: string) => {
    removeIgnoredPath(filePath)
    return true
  })

  // ── 标签 ──────────────────────────────────────────────
  ipcMain.handle('tags:getAll', () => getAllTags())

  ipcMain.handle('tags:create', (_e, name: string) => createTag(name))

  ipcMain.handle('tags:remove', (_e, id: number) => {
    removeTag(id)
    return true
  })

  ipcMain.handle('tags:addToResource', (_e, resourceId: string, tagId: number, source = 'manual') => {
    addTagToResource(resourceId, tagId, source)
    return true
  })

  ipcMain.handle('tags:removeFromResource', (_e, resourceId: string, tagId: number) => {
    removeTagFromResource(resourceId, tagId)
    return true
  })

  // ── 搜索 ──────────────────────────────────────────────
  ipcMain.handle('search:query', (_e, q: string, type?: string) => searchResources(q, type))

  // ── 设置 ──────────────────────────────────────────────
  ipcMain.handle('settings:get', (_e, key: string) => getSetting(key))
  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    setSetting(key, value)
    return true
  })

  // ── 文件操作 ──────────────────────────────────────────
  ipcMain.handle('files:openPath', (_e, filePath: string) => shell.openPath(filePath))
  ipcMain.handle('files:openInExplorer', (_e, filePath: string) => shell.showItemInFolder(filePath))

  // 生成缩略图（用系统缓存，对中文路径完全兼容，返回 PNG data URL）
  ipcMain.handle('files:readImage', async (_e, filePath: string) => {
    try {
      const thumb = await nativeImage.createThumbnailFromPath(filePath, { width: 400, height: 400 })
      return thumb.isEmpty() ? null : thumb.toDataURL()
    } catch (e: any) {
      console.error('[Thumb] failed:', filePath, e?.message)
      return null
    }
  })

  // 获取可执行文件的系统图标（用于 .exe / .lnk 资源卡片预览）
  ipcMain.handle('files:getAppIcon', async (_e, filePath: string) => {
    try {
      // .lnk 快捷方式：先解析出真实目标
      let targetPath = filePath
      if (filePath.toLowerCase().endsWith('.lnk')) {
        try { targetPath = shell.readShortcutLink(filePath).target || filePath } catch { /* 忽略 */ }
      }
      const icon = await app.getFileIcon(targetPath, { size: 'large' })
      return icon.isEmpty() ? null : icon.toDataURL()
    } catch {
      return null
    }
  })

  // ── 开机自启 ──────────────────────────────────────────
  ipcMain.handle('loginItem:get', () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('loginItem:set', (_e, enable: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enable })
    return true
  })

  // ── 监听控制 ──────────────────────────────────────────
  // 立即扫描：Recent/Desktop .lnk + 运行中进程，返回所有新增/更新的资源
  ipcMain.handle('monitor:scanNow', async () => {
    const [lnkResults, processResults] = await Promise.all([scanRecentFolder(), scanProcesses()])
    return [...lnkResults, ...processResults]
  })

  // ── 应用控制 ──────────────────────────────────────────
  ipcMain.handle('app:quit', () => app.quit())
}
