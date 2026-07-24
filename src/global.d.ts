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
    }
  }

  type UpdateStatus = {
    state: 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error' | 'dev'
    version?: string
    percent?: number
    message?: string
  }
}
