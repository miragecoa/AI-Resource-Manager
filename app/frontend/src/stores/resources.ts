import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type ResourceType = 'image' | 'game' | 'app' | 'video'

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
  tags?: Array<{ id: number; name: string; source: string }>
}

export const useResourceStore = defineStore('resources', () => {
  const items = ref<Resource[]>([])
  const activeType = ref<ResourceType | 'all'>('all')
  const searchQuery = ref('')
  const activeTags = ref<number[]>([])
  const loading = ref(false)

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
      list = list.filter((r) =>
        activeTags.value.every((tagId) => r.tags?.some((t) => t.id === tagId))
      )
    }

    return list
  })

  const counts = computed(() => ({
    all: items.value.length,
    image: items.value.filter((r) => r.type === 'image').length,
    game: items.value.filter((r) => r.type === 'game').length,
    app: items.value.filter((r) => r.type === 'app').length,
    video: items.value.filter((r) => r.type === 'video').length
  }))

  async function loadAll() {
    loading.value = true
    items.value = await window.api.resources.getAll()
    loading.value = false
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
  }

  async function ignore(filePath: string, id: string) {
    await window.api.resources.ignore(filePath)
    items.value = items.value.filter((r) => r.id !== id)
  }

  return {
    items, activeType, searchQuery, activeTags, loading,
    filtered, counts,
    loadAll, addOrUpdate, remove, ignore
  }
})
