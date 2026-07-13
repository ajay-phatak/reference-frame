import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AnalyzeOptions,
  AnalyzeResult,
  AppConfig,
  DoctorResult,
  EngineEvent,
  ReferenceFrameApi,
  RunDetail,
  RunRecord,
  UpdateCheck
} from './index.d'

const api: ReferenceFrameApi = {
  checkUpdate: (): Promise<UpdateCheck> => ipcRenderer.invoke('update:check'),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  setConfig: (patch: Partial<AppConfig>): Promise<AppConfig> =>
    ipcRenderer.invoke('config:set', patch),
  pickVideoFile: (): Promise<string | null> => ipcRenderer.invoke('video:pickFile'),
  analyze: (opts: AnalyzeOptions): Promise<AnalyzeResult> =>
    ipcRenderer.invoke('engine:analyze', opts),
  cancelAnalyze: (): Promise<boolean> => ipcRenderer.invoke('engine:cancel'),
  doctor: (): Promise<DoctorResult> => ipcRenderer.invoke('engine:doctor'),
  libraryList: (): Promise<RunRecord[]> => ipcRenderer.invoke('library:list'),
  libraryGet: (runId: string): Promise<RunDetail | null> =>
    ipcRenderer.invoke('library:get', runId),
  libraryDelete: (runId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('library:delete', runId),
  libraryOpenFolder: (runId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('library:openFolder', runId),
  onEngineEvent: (cb: (e: EngineEvent) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: EngineEvent): void => cb(payload)
    ipcRenderer.on('engine:event', listener)
    return () => ipcRenderer.removeListener('engine:event', listener)
  }
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
