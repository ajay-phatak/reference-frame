import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AnalyzeOptions,
  AnalyzeResult,
  AppConfig,
  CliDetection,
  CoachKeyStatus,
  CoachResult,
  CoachStatus,
  DoctorResult,
  EngineEvent,
  ReferenceFrameApi,
  RunDetail,
  RunRecord,
  SaveFocusesPayload,
  SaveFocusesResult,
  SeedPreviewOptions,
  SeedPreviewResult,
  SetKeyResult,
  SetupResult,
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
  setupModels: (opts: { poseModel: AppConfig['poseModel'] }): Promise<SetupResult> =>
    ipcRenderer.invoke('engine:setup', opts),
  seedPreview: (opts: SeedPreviewOptions): Promise<SeedPreviewResult> =>
    ipcRenderer.invoke('engine:seedPreview', opts),
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
  },
  // Coach (phase 4). API key plaintext crosses only inbound on set; status
  // returns configured + last4 only.
  pickNotesFolder: (): Promise<string | null> => ipcRenderer.invoke('notes:pickFolder'),
  coachStatus: (): Promise<CoachStatus> => ipcRenderer.invoke('coach:status'),
  coachKeyStatus: (): Promise<CoachKeyStatus> => ipcRenderer.invoke('coach:keyStatus'),
  setCoachKey: (key: string): Promise<SetKeyResult> => ipcRenderer.invoke('coach:setKey', key),
  clearCoachKey: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('coach:clearKey'),
  detectClaudeCli: (): Promise<CliDetection> => ipcRenderer.invoke('coach:detectCli'),
  coachReport: (runId: string): Promise<CoachResult> => ipcRenderer.invoke('coach:report', runId),
  coachChat: (text: string): Promise<CoachResult> => ipcRenderer.invoke('coach:chat', text),
  coachReset: (): Promise<boolean> => ipcRenderer.invoke('coach:reset'),
  coachHasConversation: (): Promise<boolean> => ipcRenderer.invoke('coach:hasConversation'),
  saveFocuses: (payload: SaveFocusesPayload): Promise<SaveFocusesResult> =>
    ipcRenderer.invoke('coach:saveFocuses', payload),
  onCoachDelta: (cb: (text: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, text: string): void => cb(text)
    ipcRenderer.on('coach:delta', listener)
    return () => ipcRenderer.removeListener('coach:delta', listener)
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
