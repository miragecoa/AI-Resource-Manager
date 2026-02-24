import { ipcMain, shell } from 'electron'
import {
  getAllResources, getResourceById, updateResource, removeResource,
  getAllTags, createTag, removeTag, addTagToResource, removeTagFromResource,
  searchResources, getSetting, setSetting, addIgnoredPath
} from '../db/queries'

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
}
