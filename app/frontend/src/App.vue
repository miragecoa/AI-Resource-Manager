<template>
  <div class="app">
    <Sidebar />
    <main class="main-content">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useResourceStore } from './stores/resources'
import Sidebar from './components/Sidebar.vue'

const store = useResourceStore()

let unsubscribe: (() => void) | null = null

onMounted(() => {
  store.loadAll()
  unsubscribe = window.api.onNewResource((entry) => {
    store.addOrUpdate(entry as any)
  })
})

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
