<template>
  <div class="mw-root">
    <!-- 自定义标题栏 -->
    <div class="mw-titlebar">
      <div class="mw-drag">
        <span class="mw-title">瀑布流预览</span>
        <span class="mw-count" v-if="items.length">· {{ items.length }} 张</span>
      </div>
      <div class="mw-controls">
        <span class="mw-zoom-label">{{ colWidth }}px</span>
        <input
          type="range" class="mw-slider"
          min="100" max="600" step="10"
          v-model.number="colWidth"
          title="图片宽度"
        />
        <button class="mw-btn" @click="winMinimize" title="最小化">
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button class="mw-btn mw-close" @click="winClose" title="关闭">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="mw-body">
      <div v-if="loading" class="mw-loading">正在加载图片…</div>
      <div v-else-if="items.length === 0" class="mw-empty">没有图片</div>
      <div v-else class="mw-grid" :style="{ columnWidth: colWidth + 'px' }">
        <div
          v-for="img in items" :key="img.path"
          class="mw-item"
          :ref="el => observeItem(el, img.path)"
          @click="viewFull(img)"
          @contextmenu.prevent="showCtx($event, img)"
        >
          <img
            v-if="srcs[img.path]"
            :src="srcs[img.path]"
            :alt="img.title"
            class="mw-img"
          />
          <div v-else class="mw-placeholder" />
          <div class="mw-overlay">{{ img.title }}</div>
        </div>
      </div>
    </div>

    <!-- 右键菜单 -->
    <div
      v-if="ctx.visible"
      class="mw-ctx-backdrop"
      @mousedown.self="hideCtx"
      @contextmenu.prevent
    >
      <div class="mw-ctx-menu" :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }">
        <button class="mw-ctx-item" @click="ctxOpen">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          打开
        </button>
        <button class="mw-ctx-item" @click="ctxReveal">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          在文件夹中显示
        </button>
        <button class="mw-ctx-item" @click="ctxViewFull">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          大图预览
        </button>
      </div>
    </div>

    <!-- 全屏预览 -->
    <div
      v-if="fullImg"
      class="mw-fullscreen"
      @click="closeFullscreen"
      @wheel.prevent="onWheel"
      @mousedown.prevent="onDragStart"
    >
      <img
        :src="fullImg"
        class="mw-full-img"
        :style="fullImgStyle"
        @click.stop
        draggable="false"
      />
      <!-- 控制栏 -->
      <div class="mw-fs-controls" @click.stop>
        <button class="mw-fs-btn" @click="adjustZoom(-0.25)" title="缩小">
          <svg width="14" height="14" viewBox="0 0 14 14"><line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="1.8"/></svg>
        </button>
        <span class="mw-fs-zoom-label" @click="resetZoom" title="点击重置">{{ Math.round(fullImgZoom * 100) }}%</span>
        <button class="mw-fs-btn" @click="adjustZoom(0.25)" title="放大">
          <svg width="14" height="14" viewBox="0 0 14 14"><line x1="7" y1="2" x2="7" y2="12" stroke="currentColor" stroke-width="1.8"/><line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="1.8"/></svg>
        </button>
        <button class="mw-fs-btn mw-fs-close" @click="closeFullscreen" title="关闭">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.5"/></svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'

interface ImageItem { path: string; title: string }

const items = ref<ImageItem[]>([])
const srcs = reactive<Record<string, string>>({})
const loading = ref(true)
const colWidth = ref(220)
const fullImg = ref<string | null>(null)
const fullImgZoom = ref(1.0)
const fullImgOffset = ref({ x: 0, y: 0 })
let _isDragging = false
let _dragStart = { mx: 0, my: 0, ox: 0, oy: 0 }

const fullImgStyle = computed(() => ({
  transform: `scale(${fullImgZoom.value}) translate(${fullImgOffset.value.x / fullImgZoom.value}px, ${fullImgOffset.value.y / fullImgZoom.value}px)`,
  cursor: fullImgZoom.value > 1 ? (_isDragging ? 'grabbing' : 'grab') : 'default',
}))

function adjustZoom(delta: number) {
  fullImgZoom.value = Math.max(0.1, Math.min(10, fullImgZoom.value + delta))
}
function resetZoom() {
  fullImgZoom.value = 1
  fullImgOffset.value = { x: 0, y: 0 }
}
function closeFullscreen() {
  fullImg.value = null
  fullImgPath.value = null
  resetZoom()
}
function onWheel(e: WheelEvent) {
  adjustZoom(e.deltaY < 0 ? 0.15 : -0.15)
}
function onDragStart(e: MouseEvent) {
  if (e.button !== 0) return
  _isDragging = true
  _dragStart = { mx: e.clientX, my: e.clientY, ox: fullImgOffset.value.x, oy: fullImgOffset.value.y }
  const onMove = (ev: MouseEvent) => {
    if (!_isDragging) return
    fullImgOffset.value = { x: _dragStart.ox + (ev.clientX - _dragStart.mx), y: _dragStart.oy + (ev.clientY - _dragStart.my) }
  }
  const onUp = () => {
    _isDragging = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// 当前全屏对应的原始路径（用于加载全分辨率）
const fullImgPath = ref<string | null>(null)

async function viewFull(img: ImageItem) {
  if (!srcs[img.path]) return
  // 先用缩略图显示，同时异步加载原图
  fullImg.value = srcs[img.path]
  fullImgPath.value = img.path
  resetZoom()
  const full = await window.api.files.readFullImage(img.path)
  // 确保用户还在看同一张图
  if (fullImgPath.value === img.path && full) fullImg.value = full
}

// 右键菜单
const ctx = reactive({ visible: false, x: 0, y: 0, img: null as ImageItem | null })

function showCtx(e: MouseEvent, img: ImageItem) {
  // 计算菜单位置，防止超出边界
  const menuW = 170, menuH = 110
  const x = Math.min(e.clientX, window.innerWidth - menuW - 8)
  const y = Math.min(e.clientY, window.innerHeight - menuH - 8)
  ctx.visible = true
  ctx.x = x
  ctx.y = y
  ctx.img = img
}
function hideCtx() { ctx.visible = false; ctx.img = null }

function ctxOpen() {
  if (ctx.img) window.api.files.openPath(ctx.img.path)
  hideCtx()
}
function ctxReveal() {
  if (ctx.img) window.api.files.openInExplorer(ctx.img.path)
  hideCtx()
}
function ctxViewFull() {
  if (ctx.img) viewFull(ctx.img)
  hideCtx()
}

// 懒加载：只有进入视口才触发 IPC
let _io: IntersectionObserver | null = null

function observeItem(el: Element | null, path: string) {
  if (!el || srcs[path]) return
  el.setAttribute('data-lazy', path)
  _io?.observe(el)
}

function initIO() {
  _io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const path = (entry.target as HTMLElement).dataset.lazy
      if (path && !srcs[path]) {
        window.api.files.readImage(path).then(src => { if (src) srcs[path] = src })
      }
      _io?.unobserve(entry.target)
    }
  }, { rootMargin: '400px' })
}

const winMinimize = () => window.api.masonry.minimize()
const winClose = () => window.api.masonry.close()

// 持久化滑条设置
let _saveTimer: ReturnType<typeof setTimeout>
watch(colWidth, (val) => {
  clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => window.api.settings.set('masonryColWidth', String(val)), 500)
})

let unsubUpdate: (() => void) | null = null

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') { hideCtx(); closeFullscreen() }
}

onMounted(async () => {
  initIO()
  window.addEventListener('keydown', onKeyDown)

  // 恢复上次列宽
  const saved = await window.api.settings.get('masonryColWidth')
  if (saved) colWidth.value = Math.max(100, Math.min(600, parseInt(saved, 10)))

  const data = await window.api.masonry.getPaths()
  items.value = data
  loading.value = false
  // 不主动加载——IntersectionObserver 会在元素进入视口时触发

  unsubUpdate = window.api.masonry.onUpdate((newItems) => {
    items.value = newItems
    // 新增项的 ref 回调会自动注册到 IO
  })
})

onUnmounted(() => {
  _io?.disconnect()
  _io = null
  unsubUpdate?.()
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<style scoped>
.mw-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: 'Inter', system-ui, sans-serif;
  overflow: hidden;
}

/* 标题栏 */
.mw-titlebar {
  display: flex;
  align-items: center;
  height: 36px;
  flex-shrink: 0;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  padding: 0 4px 0 12px;
  gap: 8px;
}
.mw-drag {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  -webkit-app-region: drag;
  overflow: hidden;
}
.mw-title { font-size: 13px; font-weight: 500; color: var(--text); }
.mw-count { font-size: 12px; color: var(--text-2); }
.mw-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  -webkit-app-region: no-drag;
}
.mw-zoom-label {
  font-size: 11px;
  color: var(--text-2);
  min-width: 36px;
  text-align: right;
}
.mw-slider {
  width: 100px;
  accent-color: var(--accent);
  cursor: pointer;
}
.mw-btn {
  width: 40px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition: background .12s, color .12s;
}
.mw-btn:hover { background: var(--surface-2); color: var(--text); }
.mw-close:hover { background: #e81123; color: #fff; }

/* 内容 */
.mw-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.mw-loading, .mw-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  font-size: 14px;
  color: var(--text-2);
}

/* 瀑布流 */
.mw-grid {
  column-gap: 6px;
  padding: 10px;
}
.mw-item {
  break-inside: avoid;
  margin-bottom: 6px;
  position: relative;
  cursor: pointer;
  border-radius: 6px;
  overflow: hidden;
  background: var(--surface);
}
.mw-img {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 6px;
}
.mw-placeholder {
  width: 100%;
  aspect-ratio: 4/3;
  background: var(--surface-2);
  border-radius: 6px;
}
.mw-overlay {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  padding: 18px 8px 6px;
  background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%);
  border-radius: 0 0 6px 6px;
  font-size: 11px;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  transition: opacity .15s;
}
.mw-item:hover .mw-overlay { opacity: 1; }

/* 全屏预览 */
.mw-fullscreen {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  cursor: zoom-out;
}
.mw-full-img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 4px;
  user-select: none;
  will-change: transform;
}
.mw-fs-controls {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(0,0,0,0.65);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  padding: 4px 6px;
}
.mw-fs-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: rgba(255,255,255,0.75);
  cursor: pointer;
  border-radius: 4px;
  transition: background .12s, color .12s;
}
.mw-fs-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
.mw-fs-close:hover { background: #e81123; color: #fff; }
.mw-fs-zoom-label {
  font-size: 11px;
  color: rgba(255,255,255,0.75);
  min-width: 36px;
  text-align: center;
  cursor: pointer;
  padding: 0 4px;
  border-radius: 3px;
  transition: color .1s;
}
.mw-fs-zoom-label:hover { color: #fff; }

/* 右键菜单 */
.mw-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
}
.mw-ctx-menu {
  position: fixed;
  background: var(--surface-2, #191930);
  border: 1px solid var(--border, rgba(255,255,255,0.08));
  border-radius: 8px;
  padding: 4px;
  min-width: 160px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.mw-ctx-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 12px;
  border: none;
  background: transparent;
  color: var(--text, #e5e5f0);
  font-size: 13px;
  cursor: pointer;
  border-radius: 5px;
  text-align: left;
  transition: background .1s;
}
.mw-ctx-item:hover { background: var(--accent, #6366F1); color: #fff; }
.mw-ctx-item svg { flex-shrink: 0; opacity: .7; }
.mw-ctx-item:hover svg { opacity: 1; }
</style>
