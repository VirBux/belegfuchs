import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type {
  ExportPayload,
  ExtractRequest,
  ExtractResponse,
  LlmModelInfo,
  LlmStatus,
  OcrRequest,
  OcrResult,
  PickedFile,
  ProjectFilePayload,
  Settings
} from '../shared/types';

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api = {
  pickPdfs: (): Promise<PickedFile[]> => ipcRenderer.invoke('dialog:openPdfs'),
  readFiles: (paths: string[]): Promise<PickedFile[]> => ipcRenderer.invoke('files:read', paths),
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  ocr: (req: OcrRequest): Promise<OcrResult> => ipcRenderer.invoke('ocr:recognize', req),
  llm: {
    status: (): Promise<LlmStatus> => ipcRenderer.invoke('llm:status'),
    models: (): Promise<LlmModelInfo[]> => ipcRenderer.invoke('llm:models'),
    download: (id: string): Promise<boolean> => ipcRenderer.invoke('llm:download', id),
    cancelDownload: (): Promise<void> => ipcRenderer.invoke('llm:cancelDownload'),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('llm:delete', id),
    load: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('llm:load'),
    extract: (req: ExtractRequest): Promise<ExtractResponse> => ipcRenderer.invoke('llm:extract', req),
    cancel: (): Promise<void> => ipcRenderer.invoke('llm:cancel'),
    onStatus: (cb: (s: LlmStatus) => void) => subscribe('llm:status', cb),
    onProgress: (cb: (p: { requestId: string; chars: number }) => void) => subscribe('llm:progress', cb)
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (partial: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', partial)
  },
  project: {
    save: (args: {
      payload: ProjectFilePayload;
      filePath?: string;
      saveAs?: boolean;
      suggestedName: string;
    }): Promise<{ filePath: string } | null> => ipcRenderer.invoke('project:save', args),
    open: (filePath?: string): Promise<{ filePath: string; payload: ProjectFilePayload } | null> =>
      ipcRenderer.invoke('project:open', filePath)
  },
  exportData: (payload: ExportPayload): Promise<{ filePath: string } | null> => ipcRenderer.invoke('export:run', payload),
  shell: {
    showItem: (p: string): Promise<void> => ipcRenderer.invoke('shell:showItem', p),
    openPath: (p: string): Promise<string> => ipcRenderer.invoke('shell:openPath', p)
  },
  app: {
    info: (): Promise<{ version: string; userData: string; modelsDir: string; packaged: boolean }> =>
      ipcRenderer.invoke('app:info'),
    ready: (): Promise<string[]> => ipcRenderer.invoke('app:ready'),
    setDirty: (dirty: boolean) => ipcRenderer.send('app:setDirty', dirty),
    setTitle: (title: string) => ipcRenderer.send('app:setTitle', title),
    closeNow: () => ipcRenderer.send('app:closeNow'),
    onOpenFiles: (cb: (paths: string[]) => void) => subscribe('app:openFiles', cb),
    onSaveAndClose: (cb: () => void) => subscribe('app:saveAndClose', cb)
  }
};

export type BelegfuchsApi = typeof api;

contextBridge.exposeInMainWorld('belegfuchs', api);
