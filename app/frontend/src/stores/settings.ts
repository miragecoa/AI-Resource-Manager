import { defineStore } from 'pinia'
import { ref } from 'vue'
import { NAV_ITEM_DEFS } from '../config/navItems'

export interface SidebarNavConfig {
  type: string
  visible: boolean
}

const DEFAULT_SIDEBAR_NAV: SidebarNavConfig[] = NAV_ITEM_DEFS.map(d => ({ type: d.type, visible: true }))

export const useSettingsStore = defineStore('settings', () => {
  const monitorEnabled = ref(true)
  const autostartEnabled = ref(false)
  const zoom = ref(1.5)
  const sidebarNav = ref<SidebarNavConfig[]>(DEFAULT_SIDEBAR_NAV.map(x => ({ ...x })))
  const loaded = ref(false)

  async function load() {
    if (loaded.value) return
    const [monitorVal, autostartVal, zoomVal, navVal] = await Promise.all([
      window.api.settings.get('monitorEnabled'),
      window.api.loginItem.get(),
      window.api.settings.get('zoom'),
      window.api.settings.get('sidebarNav'),
    ])
    monitorEnabled.value = monitorVal !== 'false'
    autostartEnabled.value = autostartVal
    zoom.value = zoomVal ? parseFloat(zoomVal) : 1.5
    window.api.app.setZoom(zoom.value)

    if (navVal) {
      try {
        const parsed = JSON.parse(navVal) as SidebarNavConfig[]
        // Keep user's order/visibility; append any new types not yet saved
        const knownTypes = new Set(parsed.map(x => x.type))
        const merged = [...parsed]
        for (const def of DEFAULT_SIDEBAR_NAV) {
          if (!knownTypes.has(def.type)) merged.push({ ...def })
        }
        sidebarNav.value = merged
      } catch { /* keep default */ }
    }

    loaded.value = true
  }

  async function setMonitor(enabled: boolean) {
    monitorEnabled.value = enabled
    await window.api.settings.set('monitorEnabled', String(enabled))
  }

  async function setAutostart(enabled: boolean) {
    autostartEnabled.value = enabled
    await window.api.loginItem.set(enabled)
  }

  async function setZoom(factor: number) {
    zoom.value = factor
    window.api.app.setZoom(factor)
    await window.api.settings.set('zoom', String(factor))
  }

  async function setSidebarNav(nav: SidebarNavConfig[]) {
    sidebarNav.value = [...nav]
    await window.api.settings.set('sidebarNav', JSON.stringify(nav))
  }

  return { monitorEnabled, autostartEnabled, zoom, sidebarNav, load, setMonitor, setAutostart, setZoom, setSidebarNav }
})
