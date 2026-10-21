import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { ExportPayload, ExtractRequest, OcrRequest, PickedFile, ProjectFilePayload, Settings } from '../shared/types';
import { writeCsv, writeXlsx } from './exporter';
import * as llm from './llm';
import { recognize, shutdownOcr } from './ocr';
import { PROJECT_EXT, readProject, writeProject } from './project';
import { getSettings, updateSettings } from './settings';

// Fester Datenordner (auch im Entwicklungsmodus): Einstellungen, Modelle, Cache.
app.setPath('userData', path.join(app.getPath('appData'), 'Belegfuchs'));

/** Für automatisierte Tests: Dialoge überspringen und in diesen Ordner schreiben. */
const E2E_OUT = process.env.BELEGFUCHS_E2E_OUT;

let mainWindow: BrowserWindow | null = null;
let dirty = false;
let forceClose = false;
const pendingOpen: string[] = [];

function filesFromArgv(argv: string[]): string[] {
  return argv
    .slice(1)
    .filter((a) => !a.startsWith('-') && /\.(fuchs|pdf)$/i.test(a))
    .map((a) => path.resolve(a))
    .filter((a) => fs.existsSync(a));
}

function safeName(name: string): string {
  return (name || 'Belegfuchs').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim() || 'Belegfuchs';
}

async function readPdfFiles(paths: string[]): Promise<PickedFile[]> {
  const pdfs = paths.filter((p) => /\.pdf$/i.test(p));
  return Promise.all(
    pdfs.map(async (p) => {
      const bytes = await fs.promises.readFile(p);
      return { name: path.basename(p), path: p, size: bytes.length, bytes: new Uint8Array(bytes) };
    })
  );
}

function openFilesInRenderer(files: string[]): void {
  if (!files.length) return;
  if (mainWindow && !mainWindow.webContents.isLoading()) mainWindow.webContents.send('app:openFiles', files);
  else pendingOpen.push(...files);
}

async function askSaveBeforeClose(): Promise<void> {
  if (!mainWindow) return;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Speichern', 'Nicht speichern', 'Abbrechen'],
    defaultId: 0,
    cancelId: 2,
    title: 'Belegfuchs',
    message: 'Das Projekt hat ungespeicherte Änderungen.',
    detail: 'Möchtest du es vor dem Schliessen speichern?'
  });
  if (response === 0) mainWindow.webContents.send('app:saveAndClose');
  else if (response === 1) {
    forceClose = true;
    mainWindow.close();
  }
}

function createWindow(): void {
  const devIcon = path.join(app.getAppPath(), 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    title: 'Belegfuchs',
    backgroundColor: '#F5F3EF',
    icon: !app.isPackaged && fs.existsSync(devIcon) ? devIcon : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Auf das Fenster gezogene Dateien dürfen die App nie verlassen
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') mainWindow?.webContents.toggleDevTools();
  });
  mainWindow.on('close', (event) => {
    if (dirty && !forceClose) {
      event.preventDefault();
      void askSaveBeforeClose();
    }
  });
  mainWindow.on('closed', () => (mainWindow = null));

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function registerIpc(): void {
  ipcMain.handle('dialog:openPdfs', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'PDF-Rechnungen auswählen',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF-Dokumente', extensions: ['pdf'] }]
    });
    return result.canceled ? [] : readPdfFiles(result.filePaths);
  });
  ipcMain.handle('files:read', (_e, paths: string[]) => readPdfFiles(paths));

  ipcMain.handle('ocr:recognize', (_e, req: OcrRequest) => recognize(req));

  ipcMain.handle('llm:status', () => llm.refreshStatus());
  ipcMain.handle('llm:models', () => llm.listModels());
  ipcMain.handle('llm:download', (_e, id: string) => llm.downloadModel(id));
  ipcMain.handle('llm:cancelDownload', () => llm.cancelDownload());
  ipcMain.handle('llm:delete', (_e, id: string) => llm.deleteModel(id));
  ipcMain.handle('llm:load', async () => {
    try {
      await llm.ensureLoaded();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('llm:extract', (_e, req: ExtractRequest) => llm.extract(req));
  ipcMain.handle('llm:cancel', () => llm.cancelExtraction());

  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:set', async (_e, partial: Partial<Settings>) => {
    const before = getSettings();
    const next = updateSettings(partial);
    if (next.modelId !== before.modelId || next.gpu !== before.gpu) await llm.unloadModel();
    llm.refreshStatus();
    return next;
  });

  ipcMain.handle(
    'project:save',
    async (_e, args: { payload: ProjectFilePayload; filePath?: string; saveAs?: boolean; suggestedName: string }) => {
      let target = args.saveAs ? undefined : args.filePath;
      if (!target && E2E_OUT) target = path.join(E2E_OUT, `${safeName(args.suggestedName)}.${PROJECT_EXT}`);
      if (!target) {
        const result = await dialog.showSaveDialog(mainWindow!, {
          title: 'Projekt speichern',
          defaultPath: path.join(app.getPath('desktop'), `${safeName(args.suggestedName)}.${PROJECT_EXT}`),
          filters: [{ name: 'Belegfuchs-Projekt', extensions: [PROJECT_EXT] }]
        });
        if (result.canceled || !result.filePath) return null;
        target = result.filePath;
      }
      await writeProject(target, args.payload);
      app.addRecentDocument(target);
      return { filePath: target };
    }
  );

  ipcMain.handle('project:open', async (_e, filePath?: string) => {
    let target = filePath;
    if (!target) {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Projekt öffnen',
        defaultPath: app.getPath('desktop'),
        properties: ['openFile'],
        filters: [{ name: 'Belegfuchs-Projekt', extensions: [PROJECT_EXT] }]
      });
      if (result.canceled || !result.filePaths[0]) return null;
      target = result.filePaths[0];
    }
    const payload = await readProject(target);
    app.addRecentDocument(target);
    return { filePath: target, payload };
  });

  ipcMain.handle('export:run', async (_e, payload: ExportPayload) => {
    const ext = payload.format;
    let target = E2E_OUT ? path.join(E2E_OUT, `${safeName(payload.defaultName)}.${ext}`) : undefined;
    if (!target) {
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: ext === 'xlsx' ? 'Als Excel-Datei exportieren' : 'Als CSV-Datei exportieren',
        defaultPath: path.join(app.getPath('desktop'), `${safeName(payload.defaultName)}.${ext}`),
        filters: [ext === 'xlsx' ? { name: 'Excel-Arbeitsmappe', extensions: ['xlsx'] } : { name: 'CSV-Datei', extensions: ['csv'] }]
      });
      if (result.canceled || !result.filePath) return null;
      target = result.filePath;
    }
    if (ext === 'xlsx') await writeXlsx(target, payload);
    else await writeCsv(target, payload);
    return { filePath: target };
  });

  ipcMain.handle('shell:showItem', (_e, p: string) => shell.showItemInFolder(p));
  ipcMain.handle('shell:openPath', (_e, p: string) => shell.openPath(p));

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
    modelsDir: llm.modelsDir(),
    packaged: app.isPackaged
  }));
  ipcMain.handle('app:ready', () => pendingOpen.splice(0));
  ipcMain.on('app:setDirty', (_e, value: boolean) => {
    dirty = value;
  });
  ipcMain.on('app:setTitle', (_e, title: string) => mainWindow?.setTitle(title));
  ipcMain.on('app:closeNow', () => {
    forceClose = true;
    mainWindow?.close();
  });
}

const multiInstance = Boolean(process.env.BELEGFUCHS_MULTI_INSTANCE || E2E_OUT);
if (!multiInstance && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    openFilesInRenderer(filesFromArgv(argv));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  pendingOpen.push(...filesFromArgv(process.argv));

  void app.whenReady().then(() => {
    app.setAppUserModelId('ch.belegfuchs.app');
    registerIpc();
    createWindow();
    llm.refreshStatus();
  });

  app.on('window-all-closed', async () => {
    await Promise.race([Promise.all([shutdownOcr(), llm.shutdownLlm()]), new Promise((r) => setTimeout(r, 2000))]);
    app.quit();
  });
}
