<template>
  <div class="card" @dblclick="$emit('open', resource)" @contextmenu.prevent="showMenu = true">
    <div class="cover">
      <img
        v-if="resource.cover_path"
        :src="`file://${resource.cover_path}`"
        :alt="resource.title"
        loading="lazy"
      />
      <div v-else class="cover-placeholder">
        <span class="type-icon" v-html="typeIcon" />
      </div>
    </div>

    <div class="info">
      <div class="title" :title="resource.title">{{ resource.title }}</div>
      <div class="tags" v-if="resource.tags?.length">
        <span v-for="tag in resource.tags.slice(0, 3)" :key="tag.id" class="tag">
          {{ tag.name }}
        </span>
      </div>
    </div>

    <!-- 右键菜单 -->
    <div v-if="showMenu" class="context-menu" @mouseleave="showMenu = false">
      <button @click="$emit('open', resource); showMenu = false">
        <span v-html="openIcon" />打开
      </button>
      <button @click="openInExplorer">
        <span v-html="folderIcon" />在文件夹中显示
      </button>
      <hr />
      <button @click="$emit('ignore', resource); showMenu = false" class="danger">
        <span v-html="ignoreIcon" />忽略此文件
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Resource } from '../stores/resources'

const props = defineProps<{ resource: Resource }>()
defineEmits<{
  open: [resource: Resource]
  ignore: [resource: Resource]
}>()

const showMenu = ref(false)

const TYPE_ICONS: Record<string, string> = {
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
  game:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="11.5" r=".6" fill="currentColor"/><circle cx="17.5" cy="13.5" r=".6" fill="currentColor"/><path d="M21 12c0 5-2.5 8-9 8S3 17 3 12 5.5 4 12 4s9 3 9 8z"/></svg>`,
  app:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/><circle cx="7" cy="7" r=".8" fill="currentColor"/><circle cx="10" cy="7" r=".8" fill="currentColor"/></svg>`,
  video: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3V10z"/></svg>`
}

const typeIcon = computed(() => TYPE_ICONS[props.resource.type] ?? TYPE_ICONS.app)

const openIcon   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`
const folderIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
const ignoreIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`

function openInExplorer() {
  window.api.files.openInExplorer(props.resource.file_path)
  showMenu.value = false
}
</script>

<style scoped>
.card {
  position: relative;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: visible;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
}

.card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(99, 102, 241, 0.12);
}

.cover {
  aspect-ratio: 3 / 4;
  background: var(--surface);
  border-radius: 7px 7px 0 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.type-icon {
  width: 40px;
  height: 40px;
  color: var(--text-3);
  display: flex;
}

.type-icon :deep(svg) {
  width: 40px;
  height: 40px;
}

.info {
  padding: 8px 8px 6px;
}

.title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.card:hover .title {
  color: var(--text);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 5px;
}

.tag {
  font-size: 11px;
  background: var(--surface-3);
  color: var(--accent-2);
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 500;
}

.context-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 200;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px;
  min-width: 172px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.context-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  background: none;
  border: none;
  color: var(--text-2);
  text-align: left;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  border-radius: 5px;
  transition: background 0.1s, color 0.1s;
}

.context-menu button span {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  display: flex;
}

.context-menu button span :deep(svg) {
  width: 14px;
  height: 14px;
}

.context-menu button:hover {
  background: var(--surface-3);
  color: var(--text);
}

.context-menu button.danger { color: var(--danger); }
.context-menu button.danger:hover { background: rgba(239, 68, 68, 0.1); }

.context-menu hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 4px 0;
}
</style>
