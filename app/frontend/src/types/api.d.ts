export {}

declare global {
  interface Window {
    api: {
      resources: {
        getAll: (type?: string) => Promise<import('../stores/resources').Resource[]>
        getById: (id: string) => Promise<import('../stores/resources').Resource | null>
        update: (id: string, data: Partial<import('../stores/resources').Resource>) => Promise<void>
        remove: (id: string) => Promise<void>
        ignore: (filePath: string) => Promise<void>
      }
      tags: {
        getAll: () => Promise<Array<{ id: number; name: string }>>
        create: (name: string) => Promise<{ id: number; name: string }>
        remove: (id: number) => Promise<void>
        addToResource: (resourceId: string, tagId: number, source?: string) => Promise<void>
        removeFromResource: (resourceId: string, tagId: number) => Promise<void>
      }
      search: {
        query: (q: string, type?: string) => Promise<import('../stores/resources').Resource[]>
      }
      settings: {
        get: (key: string) => Promise<string | null>
        set: (key: string, value: string) => Promise<void>
      }
      files: {
        openPath: (filePath: string) => Promise<void>
        openInExplorer: (filePath: string) => Promise<void>
      }
      onNewResource: (callback: (entry: object) => void) => () => void
    }
  }
}
