<template>
  <div class="library">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="search-wrap" v-if="!showIgnored">
        <span class="search-icon" v-html="searchSvg" />
        <input
          v-model="store.searchQuery"
          class="search"
          placeholder="搜索资源..."
          type="search"
        />
      </div>
      <span class="result-count" v-if="!showIgnored">{{ store.filtered.length }} 个资源</span>

      <div class="toolbar-right">
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

      <div v-else class="grid">
        <ResourceCard
          v-for="item in store.filtered"
          :key="item.id"
          :resource="item"
          @open="openResource"
          @remove="removeResource"
          @ignore="ignoreResource"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useResourceStore } from '../stores/resources'
import type { Resource, ResourceType } from '../stores/resources'
import ResourceCard from '../components/ResourceCard.vue'

const store = useResourceStore()
const scanning = ref(false)
const showIgnored = ref(false)
const ignoredPaths = ref<string[]>([])

// 与后端 EXT_MAP 同步的类型推断
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

// 按当前分区过滤已忽略路径
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

const searchSvg     = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`
const emptyIcon     = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
const scanSvg       = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`
const spinnerSvg    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>`
const ignoreListSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`

async function scanNow() {
  scanning.value = true
  try {
    const found = await window.api.monitor.scanNow()
    for (const r of found) store.addOrUpdate(r)
  } finally {
    scanning.value = false
  }
}

function openResource(resource: Resource) {
  window.api.files.openPath(resource.file_path)
}

function removeResource(resource: Resource) {
  store.remove(resource.id)
}

function ignoreResource(resource: Resource) {
  store.ignore(resource.file_path, resource.id)
  if (showIgnored.value) {
    ignoredPaths.value = [...ignoredPaths.value, resource.file_path]
  }
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

.ignored-toggle:hover {
  border-color: var(--text-3);
  color: var(--text-2);
}

.ignored-toggle.active {
  border-color: var(--danger);
  color: var(--danger);
  background: rgba(239, 68, 68, 0.08);
}

.btn-icon {
  width: 13px;
  height: 13px;
  display: flex;
  flex-shrink: 0;
}

.btn-icon :deep(svg) { width: 13px; height: 13px; }

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

.scan-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-2);
}

.scan-btn:disabled { opacity: 0.6; cursor: default; }
.scan-btn.scanning { color: var(--accent-2); border-color: var(--accent); }

.scan-icon { width: 13px; height: 13px; display: flex; }
.scan-icon :deep(svg) { width: 13px; height: 13px; }
.scan-icon :deep(.spin) { animation: spin 0.8s linear infinite; }

@keyframes spin { to { transform: rotate(360deg); } }

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
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  align-content: start;
}

/* 已忽略文件列表 */
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

.unignore-btn:hover {
  background: rgba(99, 102, 241, 0.1);
  border-color: var(--accent);
}
</style>
