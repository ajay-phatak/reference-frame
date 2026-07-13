import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Minimal surface for the scaffold. Real engine/library/coach channels land
// with their phases; keep every addition typed in index.d.ts.
const api = {
  checkUpdate: (): Promise<unknown> => ipcRenderer.invoke('update:check'),
  getConfig: (): Promise<unknown> => ipcRenderer.invoke('config:get')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
