<template>
  <div class="library">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="search-wrap">
        <span class="search-icon" v-html="searchSvg" />
        <input
          v-model="store.searchQuery"
          class="search"
          placeholder="搜索资源..."
          type="search"
        />
      </div>
      <span class="result-count">{{ store.filtered.length }} 个资源</span>
    </div>

    <!-- 加载中 -->
    <div v-if="store.loading" class="empty-state">
      <div class="spinner" />
    </div>

    <!-- 空状态 -->
    <div v-else-if="store.filtered.length === 0" class="empty-state">
      <span class="empty-icon" v-html="emptyIcon" />
      <div class="empty-text">暂无资源</div>
      <div class="empty-hint">打开图片、视频或程序后，AI资源管家会自动记录</div>
    </div>

    <!-- 资源网格 -->
    <div v-else class="grid">
      <ResourceCard
        v-for="item in store.filtered"
        :key="item.id"
        :resource="item"
        @open="openResource"
        @ignore="ignoreResource"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useResourceStore } from '../stores/resources'
import type { Resource } from '../stores/resources'
import ResourceCard from '../components/ResourceCard.vue'

const store = useResourceStore()

const searchSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`
const emptyIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`

function openResource(resource: Resource) {
  window.api.files.openPath(resource.file_path)
}

function ignoreResource(resource: Resource) {
  store.ignore(resource.file_path, resource.id)
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

.search-icon :deep(svg) {
  width: 14px;
  height: 14px;
}

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
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.empty-icon {
  width: 48px;
  height: 48px;
  display: flex;
  color: var(--text-3);
  opacity: 0.4;
}

.empty-icon :deep(svg) {
  width: 48px;
  height: 48px;
}

.empty-text {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-2);
}

.empty-hint {
  font-size: 13px;
  color: var(--text-3);
  max-width: 280px;
  text-align: center;
  line-height: 1.5;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
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
</style>
