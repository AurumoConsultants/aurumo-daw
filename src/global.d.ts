export {}

declare global {
  interface Window {
    daw: {
      getKeyStatus: () => Promise<{ hasKey: boolean }>
      setKey: (key: string) => Promise<{ hasKey: boolean }>
      chat: (payload: {
        messages: { role: 'user' | 'assistant'; content: string }[]
        project: unknown
      }) => Promise<{ text: string; commands: any[]; error?: string; message?: string }>
      checkForUpdates: () => Promise<any>
      restartToUpdate: () => Promise<void>
      onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void
      jam: {
        start: (sampleRate: number) => Promise<{ id: string; filePath: string }>
        chunk: (id: string, bytes: Uint8Array) => void
        flag: (id: string, ms: number) => Promise<void>
        stop: (id: string) => Promise<JamMeta | null>
        list: () => Promise<JamMeta[]>
        openFolder: () => Promise<void>
      }
    }
  }

  type UpdateStatus = {
    state: 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error' | 'dev'
    version?: string
    percent?: number
    message?: string
  }

  type JamMeta = {
    id: string
    filePath: string
    durationSec: number
    sampleRate: number
    flags: number[]
    createdAt: number
  }
}
