import { ref, onMounted } from 'vue'

export interface TipSummary {
  slug: string
  title_zh: string
  title_en: string
  summary_zh: string
  summary_en: string
}

const CACHE_KEY = 'tips_cache'
const CACHE_TS_KEY = 'tips_cache_ts'
const MAX_AGE = 6 * 60 * 60 * 1000 // 6 hours
const ENDPOINT = 'https://aicubby.app/api/tips'

export function useTips() {
  const tips = ref<TipSummary[]>([])

  function loadFromCache(): TipSummary[] {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (!raw) return []
      return JSON.parse(raw)
    } catch { return [] }
  }

  function saveToCache(data: TipSummary[]) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data))
      localStorage.setItem(CACHE_TS_KEY, String(Date.now()))
    } catch { /* silent */ }
  }

  function isCacheFresh(): boolean {
    try {
      const ts = Number(localStorage.getItem(CACHE_TS_KEY) || 0)
      return Date.now() - ts < MAX_AGE
    } catch { return false }
  }

  async function fetchTips() {
    try {
      const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return
      const json = await res.json()
      if (json.ok && Array.isArray(json.data)) {
        tips.value = json.data
        saveToCache(json.data)
      }
    } catch { /* silent — offline, timeout, etc. */ }
  }

  onMounted(() => {
    const cached = loadFromCache()
    if (cached.length > 0) tips.value = cached
    // 每次启动都拉最新，缓存仅用于离线/请求失败时的兜底
    fetchTips()
  })

  return { tips }
}
