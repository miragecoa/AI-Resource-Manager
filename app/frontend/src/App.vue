<template>
  <!-- 首次启动授权弹窗 -->
  <ConsentDialog v-if="showConsent" @consent="onConsent" />

  <div class="app" v-else>
    <Sidebar />
    <main class="main-content">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useResourceStore } from './stores/resources'
import { useSettingsStore } from './stores/settings'
import Sidebar from './components/Sidebar.vue'
import ConsentDialog from './components/ConsentDialog.vue'

const store = useResourceStore()
const settingsStore = useSettingsStore()
const showConsent = ref(false)

let unsubscribe: (() => void) | null = null

function startApp() {
  store.loadAll()
  unsubscribe = window.api.onNewResource((entry) => {
    store.addOrUpdate(entry as any)
  })
}

onMounted(async () => {
  // 最先加载设置（含缩放），确保 UI 出现前就已应用
  await settingsStore.load()

  const consent = await window.api.settings.get('consent_given')
  if (consent === '1') {
    startApp()
  } else {
    showConsent.value = true
  }
})

function onConsent() {
  showConsent.value = false
  startApp()
}

onUnmounted(() => {
  unsubscribe?.()
})
</script>

<style>
:root {
  --bg:         #0C0C18;
  --surface:    #111122;
  --surface-2:  #191930;
  --surface-3:  #20203A;
  --border:     #28284A;
  --text:       #E2E2F2;
  --text-2:     #9090B8;
  --text-3:     #525278;
  --accent:     #6366F1;
  --accent-2:   #818CF8;
  --danger:     #EF4444;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-size: 14px;
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-3); }

.app {
  display: flex;
  height: 100vh;
  width: 100vw;
}

.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
