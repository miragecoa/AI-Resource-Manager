import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  const monitorEnabled = ref(true)
  const loaded = ref(false)

  async function load() {
    if (loaded.value) return
    const val = await window.api.settings.get('monitorEnabled')
    monitorEnabled.value = val !== 'false'
    loaded.value = true
  }

  async function setMonitor(enabled: boolean) {
    monitorEnabled.value = enabled
    await window.api.settings.set('monitorEnabled', String(enabled))
  }

  return { monitorEnabled, load, setMonitor }
})
