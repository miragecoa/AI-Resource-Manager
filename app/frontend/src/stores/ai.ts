import { ref } from 'vue'
import { defineStore } from 'pinia'

export type AiStatus = 'disabled' | 'no_model' | 'downloading' | 'indexing' | 'ready'

export interface AiProgress {
  stage: string
  percent: number
  done?: number
  total?: number
}

export interface SemanticResult {
  resourceId: string
  score: number
  chunkText: string
}

export const useAiStore = defineStore('ai', () => {
  const status = ref<AiStatus>('disabled')
  const progress = ref<AiProgress | null>(null)

  const semanticResults = ref<SemanticResult[]>([])
  const semanticQuery = ref('')
  const semanticLoading = ref(false)

  async function init() {
    status.value = (await window.api.ai.getStatus()) as AiStatus

    window.api.ai.onStatusChange((s: string) => {
      status.value = s as AiStatus
    })

    window.api.ai.onProgress((p: AiProgress) => {
      if (p.stage === 'done') {
        progress.value = null
      } else {
        progress.value = p
      }
    })
  }

  async function enable() {
    await window.api.ai.enable()
  }

  async function disable() {
    await window.api.ai.disable()
    semanticResults.value = []
    progress.value = null
  }

  let searchTimer: ReturnType<typeof setTimeout> | null = null

  /** Short query gate: English < 3 chars, Chinese < 2 chars → skip semantic */
  function isTooShort(q: string): boolean {
    const trimmed = q.trim()
    const hasChinese = /[\u4e00-\u9fff]/.test(trimmed)
    if (hasChinese) return trimmed.replace(/[^\u4e00-\u9fff]/g, '').length < 2
    return trimmed.length < 3
  }

  function scheduleSearch(query: string) {
    if (searchTimer) clearTimeout(searchTimer)
    if (!query.trim() || status.value !== 'ready' || isTooShort(query)) {
      semanticResults.value = []
      semanticQuery.value = ''
      return
    }
    searchTimer = setTimeout(() => runSearch(query), 400)
  }

  function searchNow(query: string) {
    if (searchTimer) clearTimeout(searchTimer)
    if (!query.trim() || status.value !== 'ready' || isTooShort(query)) return
    runSearch(query)
  }

  async function runSearch(query: string) {
    if (status.value !== 'ready') return
    semanticQuery.value = query
    semanticLoading.value = true
    try {
      const results = await window.api.ai.search(query)
      if (semanticQuery.value === query) {
        semanticResults.value = results
      }
    } catch {
      semanticResults.value = []
    } finally {
      semanticLoading.value = false
    }
  }

  return {
    status, progress,
    semanticResults, semanticLoading,
    init, enable, disable, scheduleSearch, searchNow,
  }
})
