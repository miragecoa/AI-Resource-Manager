<template>
  <div class="library">
    <!-- 顶部工具栏 -->
    <div class="toolbar" @keydown.esc.stop="selectedId = null">
      <button v-if="!showIgnored" class="add-btn" @click="showAddModal = true" title="手动添加资源">
        <span class="btn-icon" v-html="addSvg" />
        添加
      </button>

      <div class="search-wrap" v-if="!showIgnored">
        <span class="search-icon" v-html="searchSvg" />
        <input
          v-model="store.searchQuery"
          class="search"
          placeholder="搜索资源..."
          type="search"
        />
      </div>
      <div class="toolbar-right">
        <div class="zoom-slider-wrap" v-if="!showIgnored" title="调整卡片大小">
          <span class="zoom-icon" v-html="gridSvg" />
          <input
            type="range"
            class="zoom-slider"
            :value="settingsStore.cardZoom"
            min="0.25"
            max="3"
            step="0.05"
            @input="onCardZoomChange"
          />
        </div>

        <button
          class="ignored-toggle"
          :class="{ active: showIgnored }"
          @click="toggleIgnored"
        >
          <span class="btn-icon" v-html="ignoreListSvg" />
          已忽略{{ ignoredFiltered.length ? ` (${ignoredFiltered.length})` : '' }}
        </button>

        <button v-if="!showIgnored" class="scan-btn" :class="{ scanning }" @click="scanNow" :disabled="scanning">
          <span class="scan-icon" v-html="scanning ? spinnerSvg : scanSvg" />
          {{ scanning ? '扫描中…' : '立即扫描' }}
        </button>
      </div>
    </div>

    <AddResourceModal
      v-model="showAddModal"
      :default-type="store.activeType !== 'all' ? store.activeType : undefined"
      @added="onManualAdd"
    />

    <!-- 主内容区域：库视图 + 标签面板 -->
    <div class="content-area">
      <div class="view-area">
        <!-- 已忽略文件视图 -->
        <template v-if="showIgnored">
          <div v-if="ignoredFiltered.length === 0" class="empty-state">
            <span class="empty-icon" v-html="ignoreListSvg" />
            <div class="empty-text">暂无已忽略文件</div>
            <div class="empty-hint">右键资源卡片 → 「忽略此文件」后会在这里出现</div>
          </div>
          <div v-else class="ignored-list">
            <div v-for="p in ignoredFiltered" :key="p" class="ignored-row">
              <span class="ignored-name" :title="p">{{ getBasename(p) }}</span>
              <span class="ignored-path" :title="p">{{ p }}</span>
              <button class="unignore-btn" @click="unignore(p)">取消忽略</button>
              <button class="delete-ignored-btn" @click="deleteIgnored(p)">删除</button>
            </div>
          </div>
        </template>

        <!-- 普通库视图 -->
        <template v-else>
          <div v-if="store.loading" class="empty-state">
            <div class="spinner" />
          </div>

          <div v-else-if="store.filtered.length === 0" class="empty-state">
            <span class="empty-icon" v-html="emptyIcon" />
            <div class="empty-text">暂无资源</div>
            <div class="empty-hint">打开图片、视频或程序后，AI资源管家会自动记录</div>
          </div>

          <div v-else class="grid" :style="{ '--card-min-width': cardMinWidth + 'px' }">
            <ResourceCard
              v-for="item in store.filtered"
              :key="item.id"
              :resource="item"
              @select="onCardSelect"
              @open="openResource"
              @remove="removeResource"
              @ignore="ignoreResource"
            />
          </div>
        </template>
      </div>

      <!-- 右侧标签过滤面板（始终渲染，可折叠） -->
      <div class="tag-panel" :class="{ collapsed: tagPanelCollapsed }">
        <!-- 折叠/展开切换条 -->
        <button
          class="panel-toggle"
          @click="tagPanelCollapsed = !tagPanelCollapsed"
          :title="tagPanelCollapsed ? '展开标签筛选' : '收起标签筛选'"
        >
          <span v-html="tagPanelCollapsed ? chevronLeftSvg : chevronRightSvg" />
        </button>

        <!-- 面板内容 -->
        <div class="tag-panel-inner">
          <div class="tag-panel-header">
            <span class="tag-panel-title">标签筛选</span>
            <button v-if="store.activeTags.length" class="clear-tags-btn" @click="store.activeTags.splice(0)">
              清除
            </button>
          </div>
          <div v-if="availableTags.length" class="tag-list">
            <button
              v-for="tag in availableTags"
              :key="tag.id"
              class="tag-chip"
              :class="{ active: store.activeTags.includes(tag.id) }"
              @click="toggleTag(tag.id)"
            >
              <span class="tag-chip-name">{{ tag.name }}</span>
              <span class="tag-chip-count">{{ tag.count }}</span>
            </button>
          </div>
          <div v-else class="no-tags">暂无标签</div>
        </div>
      </div>
    </div>

    <!-- 详情弹窗（Teleport to body） -->
    <ResourceDetailPanel
      v-if="selectedResource"
      :resource="selectedResource"
      @close="selectedId = null"
    />

    <!-- 忽略撤销 Toast -->
    <Teleport to="body">
      <Transition name="toast-slide">
        <div v-if="toastResource" class="toast-wrap">
          <div class="toast-card">
            <div class="toast-body">
              <span class="toast-label">已忽略</span>
              <span class="toast-filename" :title="toastResource.file_path">{{ getBasename(toastResource.file_path) }}</span>
            </div>
            <button class="toast-undo-btn" @click="undoIgnore">撤销</button>
            <button class="toast-close-btn" @click="dismissToast" v-html="closeSvg" />
            <div class="toast-progress-bar">
              <div :key="toastKey" class="toast-progress-fill" />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useResourceStore } from '../stores/resources'
import type { Resource, ResourceType } from '../stores/resources'
import { useSettingsStore } from '../stores/settings'
import ResourceCard from '../components/ResourceCard.vue'
import AddResourceModal from '../components/AddResourceModal.vue'
import ResourceDetailPanel from '../components/ResourceDetailPanel.vue'

const store = useResourceStore()
const settingsStore = useSettingsStore()
const scanning = ref(false)
const showAddModal = ref(false)

// Toast (ignore undo)
const toastResource = ref<Resource | null>(null)
const toastKey = ref(0)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let toastTimer: any = null

// Detail panel state
const selectedId = ref<string | null>(null)
const selectedResource = computed(() =>
  selectedId.value ? (store.items.find(r => r.id === selectedId.value) ?? null) : null
)

function onCardSelect(resource: Resource) {
  selectedId.value = selectedId.value === resource.id ? null : resource.id
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') selectedId.value = null
}

// 标签筛选面板
const tagPanelCollapsed = ref(localStorage.getItem('tagPanelCollapsed') === '1')
const dbTags = ref<Array<{ id: number; name: string; count: number }>>([])

watch(tagPanelCollapsed, (val) => {
  localStorage.setItem('tagPanelCollapsed', val ? '1' : '0')
})

async function loadTags() {
  const type = store.activeType === 'all' ? undefined : store.activeType
  dbTags.value = await window.api.tags.getForType(type)
}

watch(() => store.activeType, loadTags)

// 实时计算当前分类下无标签的资源数，插入虚拟"未分类"条目（id=0）
const untaggedCount = computed(() => {
  const type = store.activeType === 'all' ? undefined : store.activeType
  return store.items
    .filter(r => !type || r.type === type)
    .filter(r => !r.tags?.length)
    .length
})

const availableTags = computed(() => {
  if (untaggedCount.value > 0) {
    return [{ id: 0, name: '未分类', count: untaggedCount.value }, ...dbTags.value]
  }
  return dbTags.value
})

function toggleTag(id: number) {
  const idx = store.activeTags.indexOf(id)
  if (idx >= 0) {
    store.activeTags.splice(idx, 1)
  } else {
    store.activeTags.push(id)
  }
}

onMounted(async () => {
  settingsStore.load()
  document.addEventListener('keydown', onKeyDown)
  loadTags()
  ignoredPaths.value = await window.api.ignoredPaths.getAll()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
})

const cardMinWidth = computed(() => Math.round(150 * settingsStore.cardZoom))

function onCardZoomChange(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  settingsStore.setCardZoom(val)
}

const showIgnored = ref(false)
const ignoredPaths = ref<string[]>([])

const TYPE_BY_EXT: Record<string, ResourceType> = {
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image',
  '.gif': 'image', '.webp': 'image', '.bmp': 'image',
  '.tiff': 'image', '.avif': 'image',
  '.mp4': 'video', '.mkv': 'video', '.avi': 'video',
  '.mov': 'video', '.wmv': 'video', '.flv': 'video',
  '.webm': 'video', '.m4v': 'video',
  '.exe': 'app'
}

function inferType(filePath: string): ResourceType {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return TYPE_BY_EXT[ext] ?? 'app'
}

function getBasename(filePath: string): string {
  return filePath.replace(/^.*[\\/]/, '')
}

const ignoredFiltered = computed(() => {
  if (store.activeType === 'all') return ignoredPaths.value
  return ignoredPaths.value.filter(p => inferType(p) === store.activeType)
})

async function toggleIgnored() {
  showIgnored.value = !showIgnored.value
  if (showIgnored.value) {
    ignoredPaths.value = await window.api.ignoredPaths.getAll()
  }
}

async function unignore(filePath: string) {
  await window.api.ignoredPaths.remove(filePath)
  ignoredPaths.value = ignoredPaths.value.filter(p => p !== filePath)
}

function onManualAdd(resource: object) {
  store.addOrUpdate(resource as Resource)
}

const searchSvg      = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`
const addSvg         = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`
const gridSvg        = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`
const emptyIcon      = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
const scanSvg        = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`
const spinnerSvg     = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>`
const ignoreListSvg  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`
const chevronRightSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="9 18 15 12 9 6"/></svg>`
const chevronLeftSvg  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="15 18 9 12 15 6"/></svg>`
const closeSvg        = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`

async function scanNow() {
  scanning.value = true
  try {
    const found = await window.api.monitor.scanNow()
    for (const r of found) store.addOrUpdate(r)
  } finally {
    scanning.value = false
  }
}

async function openResource(resource: Resource) {
  const updated = await window.api.files.openPath(resource.file_path)
  if (updated) store.addOrUpdate(updated)
}

function removeResource(resource: Resource) {
  store.remove(resource.id)
}

function ignoreResource(resource: Resource) {
  const snapshot: Resource = JSON.parse(JSON.stringify(resource))
  store.ignore(resource.file_path, resource.id)
  ignoredPaths.value = [...ignoredPaths.value, resource.file_path]
  // Show undo toast
  if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null }
  toastKey.value++
  toastResource.value = snapshot
  toastTimer = setTimeout(() => {
    toastResource.value = null
    toastTimer = null
  }, 5000)
}

function dismissToast() {
  if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null }
  toastResource.value = null
}

async function undoIgnore() {
  if (!toastResource.value) return
  const res = toastResource.value
  if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null }
  toastResource.value = null
  await window.api.ignoredPaths.remove(res.file_path)
  const restored = await window.api.resources.restore(res)
  if (restored) store.addOrUpdate(restored)
  ignoredPaths.value = ignoredPaths.value.filter(p => p !== res.file_path)
}

async function deleteIgnored(filePath: string) {
  await window.api.ignoredPaths.remove(filePath)
  ignoredPaths.value = ignoredPaths.value.filter(p => p !== filePath)
}
</script>

<style scoped>
.library {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  flex-shrink: 0;
}

.search-wrap {
  position: relative;
  flex: 1;
  max-width: 340px;
}

.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  color: var(--text-3);
  display: flex;
  pointer-events: none;
}

.search-icon :deep(svg) { width: 14px; height: 14px; }

.search {
  width: 100%;
  padding: 6px 12px 6px 32px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}

.search::placeholder { color: var(--text-3); }
.search:focus { border-color: var(--accent); }
.search::-webkit-search-cancel-button { display: none; }

.result-count {
  font-size: 13px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.toolbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-icon { width: 13px; height: 13px; display: flex; flex-shrink: 0; }
.btn-icon :deep(svg) { width: 13px; height: 13px; }

.add-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid var(--accent);
  border-radius: 6px;
  color: var(--accent-2);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}

.add-btn:hover { background: rgba(99, 102, 241, 0.2); }

.ignored-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-3);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
  white-space: nowrap;
}

.ignored-toggle:hover { border-color: var(--text-3); color: var(--text-2); }
.ignored-toggle.active { border-color: var(--danger); color: var(--danger); background: rgba(239, 68, 68, 0.08); }

.scan-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-2);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  white-space: nowrap;
}

.scan-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-2); }
.scan-btn:disabled { opacity: 0.6; cursor: default; }
.scan-btn.scanning { color: var(--accent-2); border-color: var(--accent); }

.scan-icon { width: 13px; height: 13px; display: flex; }
.scan-icon :deep(svg) { width: 13px; height: 13px; }
.scan-icon :deep(.spin) { animation: spin 0.8s linear infinite; }

@keyframes spin { to { transform: rotate(360deg); } }

/* ── 内容区域 ── */
.content-area {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.view-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.empty-icon { width: 48px; height: 48px; display: flex; color: var(--text-3); opacity: 0.4; }
.empty-icon :deep(svg) { width: 48px; height: 48px; }
.empty-text { font-size: 15px; font-weight: 500; color: var(--text-2); }
.empty-hint { font-size: 13px; color: var(--text-3); max-width: 280px; text-align: center; line-height: 1.5; }

.spinner {
  width: 28px; height: 28px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.grid {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--card-min-width, 225px), 1fr));
  gap: 12px;
  align-content: start;
}

.zoom-slider-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
}

.zoom-icon { width: 14px; height: 14px; color: var(--text-3); display: flex; flex-shrink: 0; }
.zoom-icon :deep(svg) { width: 14px; height: 14px; }

.zoom-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 88px;
  height: 3px;
  background: var(--border);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.zoom-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 13px; height: 13px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;
}

.zoom-slider::-webkit-slider-thumb:hover {
  background: var(--accent-2);
  transform: scale(1.2);
}

/* ── 已忽略文件列表 ── */
.ignored-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ignored-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  transition: border-color 0.1s;
}

.ignored-row:hover { border-color: var(--text-3); }

.ignored-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ignored-path {
  flex: 1;
  font-size: 11px;
  font-family: 'Consolas', 'Courier New', monospace;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.unignore-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  background: none;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--accent-2);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
}

.unignore-btn:hover { background: rgba(99, 102, 241, 0.1); border-color: var(--accent); }

.delete-ignored-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  background: none;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--danger);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
}

.delete-ignored-btn:hover { background: rgba(239, 68, 68, 0.08); border-color: var(--danger); }

/* ── 标签过滤面板 ── */
.tag-panel {
  display: flex;
  flex-direction: row;
  flex-shrink: 0;
  width: 212px;      /* 22px toggle + 190px content */
  border-left: 1px solid var(--border);
  background: var(--surface);
  transition: width 0.22s ease;
  overflow: hidden;
}

.tag-panel.collapsed {
  width: 22px;
}

/* 折叠切换条 */
.panel-toggle {
  width: 22px;
  flex-shrink: 0;
  background: none;
  border: none;
  border-right: 1px solid var(--border);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  padding: 0;
  transition: background 0.12s, color 0.12s;
}

.panel-toggle:hover {
  background: var(--surface-2);
  color: var(--text);
}

.panel-toggle :deep(svg) {
  width: 13px;
  height: 13px;
}

/* 面板内容区 */
.tag-panel-inner {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tag-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 12px 9px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.tag-panel-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.clear-tags-btn {
  font-size: 11px;
  color: var(--accent-2);
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  padding: 2px 5px;
  border-radius: 3px;
  white-space: nowrap;
  transition: background 0.1s;
}

.clear-tags-btn:hover { background: rgba(99, 102, 241, 0.12); }

.tag-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tag-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 8px;
  background: none;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  width: 100%;
  text-align: left;
  transition: background 0.1s, border-color 0.1s;
}

.tag-chip:hover { background: var(--surface-2); }

.tag-chip.active {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.35);
}

.tag-chip-name {
  font-size: 13px;
  color: var(--text-2);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-chip.active .tag-chip-name { color: var(--accent-2); }

.tag-chip-count {
  font-size: 11px;
  color: var(--text-3);
  background: var(--surface-3);
  padding: 1px 5px;
  border-radius: 10px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.tag-chip.active .tag-chip-count {
  background: rgba(99, 102, 241, 0.18);
  color: var(--accent-2);
}

.no-tags {
  padding: 24px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--text-3);
}

/* ── 撤销 Toast ── */
.toast-wrap {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9999;
  pointer-events: none;
}

.toast-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 12px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  pointer-events: all;
  min-width: 280px;
  max-width: 380px;
  overflow: hidden;
}

.toast-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toast-label {
  font-size: 11px;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.toast-filename {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toast-undo-btn {
  flex-shrink: 0;
  padding: 5px 11px;
  background: rgba(99, 102, 241, 0.12);
  border: 1px solid var(--accent);
  border-radius: 6px;
  color: var(--accent-2);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.12s;
}

.toast-undo-btn:hover { background: rgba(99, 102, 241, 0.22); }

.toast-close-btn {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-3);
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
  transition: color 0.1s, background 0.1s;
}

.toast-close-btn:hover { color: var(--text); background: var(--surface); }
.toast-close-btn :deep(svg) { width: 13px; height: 13px; }

.toast-progress-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--border);
  border-radius: 0 0 10px 10px;
  overflow: hidden;
}

.toast-progress-fill {
  height: 100%;
  width: 100%;
  background: var(--accent);
  transform-origin: left;
  animation: toast-shrink 5s linear forwards;
}

@keyframes toast-shrink {
  from { width: 100%; }
  to   { width: 0%; }
}

/* toast 出入动画 */
.toast-slide-enter-active { animation: toast-in 0.22s ease; }
.toast-slide-leave-active { animation: toast-in 0.18s ease reverse; }

@keyframes toast-in {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
