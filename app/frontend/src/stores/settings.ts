import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  const monitorEnabled = ref(true)
  const autostartEnabled = ref(false)
  const zoom = ref(1.0)
  const loaded = ref(false)

  async function load() {
    if (loaded.value) return
    const [monitorVal, autostartVal, zoomVal] = await Promise.all([
      window.api.settings.get('monitorEnabled'),
      window.api.loginItem.get(),
      window.api.settings.get('zoom')
    ])
    monitorEnabled.value = monitorVal !== 'false'
    autostartEnabled.value = autostartVal
    zoom.value = zoomVal ? parseFloat(zoomVal) : 1.0
    window.api.app.setZoom(zoom.value)
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

  return { monitorEnabled, autostartEnabled, zoom, load, setMonitor, setAutostart, setZoom }
})
