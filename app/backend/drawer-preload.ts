import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('drawerApi', {
  notifyDrop: (paths: string[]) => ipcRenderer.invoke('drawer:filesDropped', paths),
  openMain:   () => ipcRenderer.invoke('drawer:openMain'),
  showContextMenu: () => ipcRenderer.invoke('drawer:showContextMenu'),
})
