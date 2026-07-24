import { contextBridge, ipcRenderer } from 'electron'

export type ChatPayload = {
  messages: { role: 'user' | 'assistant'; content: string }[]
  project: unknown
}

contextBridge.exposeInMainWorld('daw', {
  getKeyStatus: (): Promise<{ hasKey: boolean }> =>
    ipcRenderer.invoke('settings:getKeyStatus'),
  setKey: (key: string): Promise<{ hasKey: boolean }> =>
    ipcRenderer.invoke('settings:setKey', key),
  chat: (payload: ChatPayload): Promise<{
    text: string
    commands: any[]
    error?: string
    message?: string
  }> => ipcRenderer.invoke('claude:chat', payload),

  // auto-update
  checkForUpdates: (): Promise<any> => ipcRenderer.invoke('update:check'),
  restartToUpdate: (): Promise<void> => ipcRenderer.invoke('update:restart'),
  onUpdateStatus: (cb: (status: any) => void) => {
    const listener = (_e: unknown, status: any) => cb(status)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },

  // Free Jam recording
  jam: {
    start: (sampleRate: number): Promise<{ id: string; filePath: string }> =>
      ipcRenderer.invoke('jam:start', sampleRate),
    chunk: (id: string, bytes: Uint8Array): void => ipcRenderer.send('jam:chunk', id, bytes),
    flag: (id: string, ms: number): Promise<void> => ipcRenderer.invoke('jam:flag', id, ms),
    stop: (id: string): Promise<any> => ipcRenderer.invoke('jam:stop', id),
    list: (): Promise<any[]> => ipcRenderer.invoke('jam:list'),
    openFolder: (): Promise<void> => ipcRenderer.invoke('jam:openFolder'),
  },
})
