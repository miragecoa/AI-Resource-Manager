import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type ResourceType = 'image' | 'game' | 'app' | 'video' | 'comic' | 'music' | 'novel'

export interface Resource {
  id: string
  type: ResourceType
  title: string
  file_path: string
  cover_path?: string
  rating: number
  note?: string
  meta?: string
  added_at: number
  updated_at: number
  open_count: number
  total_run_time: number
  last_run_at: number | null
  pinned?: number
  tags?: Array<{ id: number; name: string; source: string }>
}

export const useResourceStore = defineStore('resources', () => {
  const items = ref<Resource[]>([])
  const activeType = ref<ResourceType | 'all'>('all')
  const searchQuery = ref('')
  const activeTags = ref<number[]>([])
  const loading = ref(false)

  // 运行中状态：resourceId → startTime(ms)
  const runningMap = ref<Map<string, number>>(new Map())
  // 每秒更新一次，用于卡片实时计时
  const clockTick = ref(Date.now())
  let clockTimer: ReturnType<typeof setInterval> | null = null

  function setRunning(resourceId: string, running: boolean, startTime?: number) {
    if (running && startTime) {
      runningMap.value.set(resourceId, startTime)
      if (!clockTimer) {
        clockTimer = setInterval(() => { clockTick.value = Date.now() }, 1000)
      }
    } else {
      runningMap.value.delete(resourceId)
      if (runningMap.value.size === 0 && clockTimer) {
        clearInterval(clockTimer)
        clockTimer = null
      }
    }
  }

  const filtered = computed(() => {
    let list = items.value

    if (activeType.value !== 'all') {
      list = list.filter((r) => r.type === activeType.value)
    }

    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter((r) => r.title.toLowerCase().includes(q))
    }

    if (activeTags.value.length > 0) {
      const hasUnclassified = activeTags.value.includes(0)
      const realTagIds = activeTags.value.filter(id => id !== 0)
      list = list.filter((r) => {
        // id=0 代表"未分类"：资源没有任何标签
        if (hasUnclassified && (!r.tags || r.tags.length === 0)) return true
        if (realTagIds.length > 0) {
          return realTagIds.every((tagId) => r.tags?.some((t) => t.id === tagId))
        }
        return false
      })
    }

    // 置顶(2分) > 运行中(1分) > 其余(0分)
    const hasPinned = list.some(r => r.pinned)
    if (hasPinned || runningMap.value.size > 0) {
      return list.slice().sort((a, b) => {
        const aScore = (a.pinned ? 2 : 0) + (runningMap.value.has(a.id) ? 1 : 0)
        const bScore = (b.pinned ? 2 : 0) + (runningMap.value.has(b.id) ? 1 : 0)
        return bScore - aScore
      })
    }

    return list
  })

  const counts = computed(() => ({
    all: items.value.length,
    game: items.value.filter((r) => r.type === 'game').length,
    app: items.value.filter((r) => r.type === 'app').length,
    image: items.value.filter((r) => r.type === 'image').length,
    video: items.value.filter((r) => r.type === 'video').length,
    comic: items.value.filter((r) => r.type === 'comic').length,
    music: items.value.filter((r) => r.type === 'music').length,
    novel: items.value.filter((r) => r.type === 'novel').length
  }))

  async function loadAll() {
    loading.value = true
    items.value = await window.api.resources.getAll()
    loading.value = false
    // 加载当前运行会话（本次启动后已追踪到的）
    try {
      const sessions = await window.api.monitor.running()
      for (const s of sessions) setRunning(s.resourceId, true, s.startTime)
    } catch { /* 忽略 */ }
  }

  function addOrUpdate(resource: Resource) {
    const idx = items.value.findIndex((r) => r.id === resource.id)
    if (idx >= 0) {
      items.value[idx] = resource
    } else {
      items.value.unshift(resource)
    }
  }

  async function remove(id: string) {
    await window.api.resources.remove(id)
    items.value = items.value.filter((r) => r.id !== id)
    runningMap.value.delete(id)
  }

  async function ignore(filePath: string, id: string) {
    await window.api.resources.ignore(filePath)
    items.value = items.value.filter((r) => r.id !== id)
    runningMap.value.delete(id)
  }

  return {
    items, activeType, searchQuery, activeTags, loading,
    runningMap, clockTick, setRunning,
    filtered, counts,
    loadAll, addOrUpdate, remove, ignore
  }
})
