<template>
  <div class="drop-window">
    <div class="titlebar">
      <span class="titlebar-title">{{ t('dropImport.title') }}</span>
      <div class="titlebar-drag" />
      <button class="close-btn" @click="cancel" v-html="closeIcon" />
    </div>

    <div class="item-list">
      <div v-for="(item, idx) in items" :key="idx" class="item-row">
        <span class="item-icon">
          <img v-if="iconMap[idx]" :src="iconMap[idx]" class="item-icon-img" />
          <span v-else v-html="TYPE_ICONS[item.type] || TYPE_ICONS.app" />
        </span>
        <div class="item-info">
          <div class="item-title" :title="item.title">{{ item.title }}</div>
          <div class="item-path" :title="item.file_path">{{ item.file_path }}</div>
        </div>
        <select class="item-type" :value="item.type" @change="onTypeChange(idx, $event)">
          <option v-for="ty in TYPES" :key="ty.value" :value="ty.value">{{ ty.label }}</option>
        </select>
        <button class="item-remove" @click="removeItem(idx)" :title="t('common.delete')" v-html="removeSvg" />
      </div>
    </div>

    <div v-if="items.length === 0" class="empty-hint">{{ t('dropImport.title') }}</div>

    <div class="footer">
      <button class="btn-cancel" @click="cancel">{{ t('dropImport.cancel') }}</button>
      <button class="btn-confirm" :disabled="items.length === 0 || importing" @click="confirm">
        {{ importing ? t('dropImport.importing') : `${t('dropImport.confirm')}${items.length > 0 ? ` (${items.length})` : ''}` }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

interface DropItem {
  type: string
  title: string
  file_path: string
  meta?: string
}

const items = ref<DropItem[]>([])
const iconMap = ref<Record<number, string>>({})
const importing = ref(false)

async function loadIcons(newItems: DropItem[]) {
  iconMap.value = {}
  newItems.forEach(async (item, idx) => {
    let icon: string | null = null
    if (item.type === 'image') {
      icon = await window.api.files.readImage(item.file_path)
    } else if (['app', 'game'].includes(item.type)) {
      icon = await window.api.files.getAppIcon(item.file_path)
    }
    if (icon) iconMap.value = { ...iconMap.value, [idx]: icon }
  })
}

let unsubItems: (() => void) | null = null

onMounted(async () => {
  // Fetch items already queued (handles race with ready-to-show)
  const initial = await window.api.dropImport.getItems()
  if (initial.length) {
    items.value = initial.map(v => ({ ...v }))
    loadIcons(items.value)
  }
  // Also listen for live updates (another drop while window is open)
  unsubItems = window.api.onDropWindowItems((newItems) => {
    items.value = newItems.map(v => ({ ...v }))
    loadIcons(items.value)
  })
})

onUnmounted(() => {
  unsubItems?.()
})

function removeItem(idx: number) {
  items.value.splice(idx, 1)
}

function onTypeChange(idx: number, e: Event) {
  items.value[idx].type = (e.target as HTMLSelectElement).value
}

async function confirm() {
  if (!items.value.length || importing.value) return
  importing.value = true
  try {
    const plain = items.value.map(({ type, title, file_path, meta }) => ({ type, title, file_path, meta }))
    await window.api.dropImport.confirm(plain)
    // main closes the window after confirm
  } catch {
    importing.value = false
  }
}

function cancel() {
  window.api.dropImport.close()
}

const TYPES = computed(() => [
  { value: 'game',     label: t('resource.types.game') },
  { value: 'app',      label: t('resource.types.app') },
  { value: 'image',    label: t('resource.types.image') },
  { value: 'video',    label: t('resource.types.video') },
  { value: 'music',    label: t('resource.types.music') },
  { value: 'comic',    label: t('resource.types.comic') },
  { value: 'novel',    label: t('resource.types.novel') },
  { value: 'document', label: t('resource.types.document') },
  { value: 'folder',   label: t('resource.types.folder') },
  { value: 'other',    label: t('resource.types.other') },
])

const TYPE_ICONS: Record<string, string> = {
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
  game:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="11.5" r=".6" fill="currentColor"/><circle cx="17.5" cy="13.5" r=".6" fill="currentColor"/><path d="M21 12c0 5-2.5 8-9 8S3 17 3 12 5.5 4 12 4s9 3 9 8z"/></svg>`,
  app:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/><circle cx="7" cy="7" r=".8" fill="currentColor"/><circle cx="10" cy="7" r=".8" fill="currentColor"/></svg>`,
  video: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3V10z"/></svg>`,
  comic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="8" height="11" rx="1"/><rect x="13" y="3" width="8" height="11" rx="1"/><rect x="3" y="16" width="8" height="5" rx="1"/><rect x="13" y="16" width="8" height="5" rx="1"/></svg>`,
  music: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  novel: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  document: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  other:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
}

const closeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
const removeSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
</script>

<style scoped>
.drop-window {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, -apple-system, 'Microsoft YaHei', sans-serif;
  overflow: hidden;
}

.titlebar {
  display: flex;
  align-items: center;
  padding: 0 12px;
  height: 36px;
  flex-shrink: 0;
  -webkit-app-region: drag;
  border-bottom: 1px solid var(--border);
  gap: 8px;
}

.titlebar-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.titlebar-drag { flex: 1; }

.close-btn {
  -webkit-app-region: no-drag;
  background: transparent;
  border: none;
  color: var(--text-2);
  cursor: pointer;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  padding: 0;
  flex-shrink: 0;
}
.close-btn:hover { background: rgba(239,68,68,0.15); color: #ef4444; }
.close-btn :deep(svg) { width: 14px; height: 14px; }

.item-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.item-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
}
.item-row:last-child { border-bottom: none; }

.item-icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-2);
}
.item-icon :deep(svg) { width: 22px; height: 22px; }
.item-icon-img { width: 100%; height: 100%; object-fit: contain; border-radius: 4px; }

.item-info {
  flex: 1;
  min-width: 0;
}
.item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item-path {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.item-type {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text);
  font-size: 12px;
  padding: 3px 6px;
  cursor: pointer;
  flex-shrink: 0;
}
.item-type:focus { outline: 1px solid var(--accent); }

.item-remove {
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  padding: 0;
  flex-shrink: 0;
}
.item-remove:hover { background: rgba(239,68,68,0.1); color: #ef4444; }
.item-remove :deep(svg) { width: 14px; height: 14px; }

.empty-hint {
  text-align: center;
  color: var(--text-3);
  font-size: 13px;
  padding: 32px 0;
}


.footer {
  display: flex;
  gap: 8px;
  padding: 10px 16px 12px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.btn-cancel {
  flex: 1;
  padding: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
}
.btn-cancel:hover { border-color: var(--accent); color: var(--text); }

.btn-confirm {
  flex: 2;
  padding: 8px;
  background: var(--accent);
  border: none;
  border-radius: 7px;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.btn-confirm:hover:not(:disabled) { opacity: 0.88; }
.btn-confirm:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
