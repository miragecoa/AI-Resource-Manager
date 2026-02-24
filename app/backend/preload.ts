import { contextBridge, ipcRenderer } from 'electron'

// 暴露给渲染进程的 API（类型安全）
contextBridge.exposeInMainWorld('api', {
  // 资源 CRUD
  resources: {
    getAll: (type?: string) => ipcRenderer.invoke('resources:getAll', type),
    getById: (id: string) => ipcRenderer.invoke('resources:getById', id),
    update: (id: string, data: object) => ipcRenderer.invoke('resources:update', id, data),
    remove: (id: string) => ipcRenderer.invoke('resources:remove', id),
    ignore: (filePath: string) => ipcRenderer.invoke('resources:ignore', filePath)
  },

  // 标签
  tags: {
    getAll: () => ipcRenderer.invoke('tags:getAll'),
    create: (name: string) => ipcRenderer.invoke('tags:create', name),
    remove: (id: number) => ipcRenderer.invoke('tags:remove', id),
    addToResource: (resourceId: string, tagId: number, source?: string) =>
      ipcRenderer.invoke('tags:addToResource', resourceId, tagId, source),
    removeFromResource: (resourceId: string, tagId: number) =>
      ipcRenderer.invoke('tags:removeFromResource', resourceId, tagId)
  },

  // 搜索
  search: {
    query: (q: string, type?: string) => ipcRenderer.invoke('search:query', q, type)
  },

  // 设置
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value)
  },

  // 文件操作
  files: {
    openPath: (filePath: string) => ipcRenderer.invoke('files:openPath', filePath),
    openInExplorer: (filePath: string) => ipcRenderer.invoke('files:openInExplorer', filePath)
  },

  // 监听主进程推送的新资源
  onNewResource: (callback: (entry: object) => void) => {
    ipcRenderer.on('resource:new', (_event, entry) => callback(entry))
    return () => ipcRenderer.removeAllListeners('resource:new')
  }
})
