import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('iconPickerApi', {
  getCurrentIcon:    (): Promise<string | null> => ipcRenderer.invoke('iconPicker:getCurrentIcon'),
  browse:            (): Promise<void>          => ipcRenderer.invoke('iconPicker:browse'),
  saveFromDataUrl:   (dataUrl: string): Promise<void> => ipcRenderer.invoke('iconPicker:saveFromDataUrl', dataUrl),
  clearIcon:         (): Promise<void>          => ipcRenderer.invoke('iconPicker:clearIcon'),
  close:             (): Promise<void>          => ipcRenderer.invoke('iconPicker:close'),
  onIconSaved: (cb: (dataUrl: string | null) => void) => {
    ipcRenderer.on('iconPicker:saved', (_e, dataUrl) => cb(dataUrl))
  },
  onLanguageChange: (cb: (lang: string) => void) => {
    ipcRenderer.on('language:change', (_e, lang) => cb(lang))
  },
})
