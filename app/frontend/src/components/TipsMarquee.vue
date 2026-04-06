<template>
  <div v-if="tips.length > 0" class="tips-wrap">
    <button class="tips-toggle" @click="toggle">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline v-if="expanded" points="15 18 9 12 15 6" />
        <polyline v-else points="9 18 15 12 9 6" />
      </svg>
    </button>
    <div v-if="expanded" class="tips-text-wrap" @click="openCurrentTip">
      <span class="tips-text" :key="currentIndex">{{ currentText }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TipSummary } from '../composables/useTips'

const props = defineProps<{ tips: TipSummary[] }>()
const { locale } = useI18n()
const isZh = computed(() => locale.value === 'zh')

const expanded = ref(true)
const currentIndex = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

const currentText = computed(() => {
  if (!props.tips.length) return ''
  const tip = props.tips[currentIndex.value % props.tips.length]
  return isZh.value ? tip.title_zh : (tip.title_en || tip.title_zh)
})

function openCurrentTip() {
  if (!props.tips.length) return
  const tip = props.tips[currentIndex.value % props.tips.length]
  const lang = isZh.value ? 'zh' : 'en'
  window.api.app.openUrl(`https://aicubby.app/${lang}/tips/${tip.slug}`)
}

function toggle() {
  expanded.value = !expanded.value
  try { localStorage.setItem('tips_expanded', expanded.value ? '1' : '0') } catch {}
}

onMounted(() => {
  try { const v = localStorage.getItem('tips_expanded'); if (v === '0') expanded.value = false } catch {}
  // 5 秒轮播
  timer = setInterval(() => {
    if (props.tips.length > 1) currentIndex.value = (currentIndex.value + 1) % props.tips.length
  }, 20000)
})

onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<style scoped>
.tips-wrap {
  display: flex;
  align-items: center;
  flex-shrink: 1;
  min-width: 0;
  -webkit-app-region: no-drag;
}
.tips-toggle {
  flex-shrink: 0;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.25);
  cursor: pointer;
  padding: 2px 4px;
  line-height: 0;
  display: flex;
  align-items: center;
}
.tips-toggle:hover { color: rgba(255, 255, 255, 0.5); }
.tips-text-wrap {
  overflow: hidden;
  min-width: 0;
  cursor: pointer;
}
.tips-text {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  animation: tips-fade 20s infinite;
}
@keyframes tips-fade {
  0%, 8% { opacity: 0; }
  15%, 85% { opacity: 1; }
  92%, 100% { opacity: 0; }
}
.tips-text-wrap:hover .tips-text {
  color: var(--accent, #6366f1);
  animation: none;
  opacity: 1;
}
</style>
