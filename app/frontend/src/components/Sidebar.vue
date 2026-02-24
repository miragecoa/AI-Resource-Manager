<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <svg class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
      <span class="logo-text">AI资源管家</span>
    </div>

    <nav class="nav-section">
      <button
        v-for="item in visibleNavItems"
        :key="item.type"
        class="nav-item"
        :class="{ active: store.activeType === item.type }"
        @click="select(item.type)"
      >
        <span class="nav-icon" v-html="item.svg" />
        <span class="nav-label">{{ item.label }}</span>
        <span v-if="store.counts[item.type]" class="nav-count">
          {{ store.counts[item.type] }}
        </span>
      </button>
    </nav>

    <div class="sidebar-footer">
      <RouterLink to="/settings" class="nav-item">
        <span class="nav-icon" v-html="settingsIcon" />
        <span class="nav-label">设置</span>
      </RouterLink>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useResourceStore } from '../stores/resources'
import { useSettingsStore } from '../stores/settings'
import { NAV_ITEM_DEFS } from '../config/navItems'
import type { ResourceType } from '../stores/resources'

const store = useResourceStore()
const settingsStore = useSettingsStore()
const router = useRouter()

onMounted(() => settingsStore.load())

const visibleNavItems = computed(() =>
  settingsStore.sidebarNav
    .filter(cfg => cfg.visible)
    .map(cfg => NAV_ITEM_DEFS.find(d => d.type === cfg.type))
    .filter((d): d is typeof NAV_ITEM_DEFS[0] => d !== undefined)
)

const settingsIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`

function select(type: string) {
  store.activeType = type as ResourceType | 'all'
  router.push('/library')
}
</script>

<style scoped>
.sidebar {
  width: 210px;
  min-width: 210px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 14px 14px;
  border-bottom: 1px solid var(--border);
}

.logo-icon {
  width: 18px;
  height: 18px;
  color: var(--accent);
  flex-shrink: 0;
}

.logo-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.01em;
}

.nav-section {
  flex: 1;
  padding: 8px 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 14px;
  background: none;
  border: none;
  color: var(--text-2);
  cursor: pointer;
  font-size: 14px;
  font-family: inherit;
  text-decoration: none;
  transition: background 0.1s, color 0.1s;
  position: relative;
}

.nav-item:hover {
  background: var(--surface-2);
  color: var(--text);
}

.nav-item.active {
  background: var(--surface-2);
  color: var(--text);
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: var(--accent);
  border-radius: 0 2px 2px 0;
}

.nav-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-icon :deep(svg) {
  width: 16px;
  height: 16px;
}

.nav-label {
  flex: 1;
  text-align: left;
}

.nav-item.active .nav-label {
  font-weight: 500;
}

.nav-count {
  font-size: 12px;
  color: var(--text-3);
  background: var(--surface-3);
  padding: 1px 6px;
  border-radius: 8px;
  min-width: 20px;
  text-align: center;
}

.nav-item.active .nav-count {
  color: var(--accent-2);
}

.sidebar-footer {
  border-top: 1px solid var(--border);
  padding: 6px 0;
}
</style>
