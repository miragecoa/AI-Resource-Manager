import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('drawerApi', {
  notifyDrop:   (paths: string[]) => ipcRenderer.invoke('drawer:filesDropped', paths),
  openMain:     () => ipcRenderer.invoke('drawer:openMain'),
  toggleMain:   () => ipcRenderer.invoke('drawer:toggleMain'),
  showContextMenu: () => ipcRenderer.invoke('drawer:showContextMenu'),
  move:           (x: number, y: number) => ipcRenderer.invoke('drawer:move', x, y),
  savePosition:   (x: number, y: number) => ipcRenderer.invoke('drawer:savePosition', x, y),
  getCustomIcon:  () => ipcRenderer.invoke('drawer:getCustomIcon'),
  getAccent:      () => ipcRenderer.invoke('drawer:getAccent'),
  onSetCustomIcon:(cb: (path: string | null) => void) => {
    ipcRenderer.on('drawer:setCustomIcon', (_e, p) => cb(p))
  },
  onThemeChange:  (cb: (vars: { accent: string; accent2: string }) => void) => {
    ipcRenderer.on('theme:change', (_e, json) => {
      try { const t = JSON.parse(json); cb({ accent: t['accent'] ?? '#6366F1', accent2: t['accent-2'] ?? '#818CF8' }) } catch {}
    })
  },
})
