import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Llama, LlamaContext, LlamaContextSequence, LlamaModel, ModelDownloader } from 'node-llama-cpp';
import { MODELS, findModel } from '../shared/models';
import { GRAMMAR_STOP, SYSTEM_PROMPT, buildSchema, buildUserPrompt, schemaToGbnf } from '../shared/prompt';
import type { AiField, AiResult, ExtractRequest, ExtractResponse, LlmModelInfo, LlmStatus } from '../shared/types';
import { getSettings } from './settings';

type NodeLlamaCpp = typeof import('node-llama-cpp');

const MAX_OUTPUT_TOKENS = 4000;

let lib: NodeLlamaCpp | null = null;
let llama: Llama | null = null;
let llamaGpuSetting: string | null = null;
let model: LlamaModel | null = null;
let context: LlamaContext | null = null;
let sequence: LlamaContextSequence | null = null;
let loadedModelId: string | null = null;
let loading: Promise<void> | null = null;
let downloader: ModelDownloader | null = null;
let downloadCancelled = false;
let currentAbort: AbortController | null = null;
let chain: Promise<unknown> = Promise.resolve();
let status: LlmStatus = { state: 'missing', modelId: '', modelName: '' };

async function nlc(): Promise<NodeLlamaCpp> {
  // node-llama-cpp ist ein reines ES-Modul und wird erst bei Bedarf geladen.
  if (!lib) lib = await import('node-llama-cpp');
  return lib;
}

export function modelsDir(): string {
  return path.join(app.getPath('userData'), 'models');
}

function modelFile(info: LlmModelInfo): string {
  return path.join(modelsDir(), info.file);
}

function isDownloaded(info: LlmModelInfo): boolean {
  try {
    const file = modelFile(info);
    if (fs.existsSync(`${file}.ipull`)) return false;
    return fs.statSync(file).size > info.sizeGB * 1e9 * 0.97;
  } catch {
    return false;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function setStatus(patch: Partial<LlmStatus>): void {
  status = { ...status, ...patch };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('llm:status', status);
  }
}

export function getStatus(): LlmStatus {
  return status;
}

/** Leitet den Zustand aus Einstellungen und Dateisystem ab (ausser während Download/Laden). */
export function refreshStatus(): LlmStatus {
  if (downloader || loading) return status;
  const info = findModel(getSettings().modelId);
  const base = { modelId: info.id, modelName: info.name, progress: undefined, error: undefined };
  if (model && loadedModelId === info.id) setStatus({ ...base, state: 'loaded' });
  else if (isDownloaded(info)) setStatus({ ...base, state: 'ready', gpu: undefined, gpuName: undefined });
  else setStatus({ ...base, state: 'missing', gpu: undefined, gpuName: undefined });
  return status;
}

export function listModels(): LlmModelInfo[] {
  return MODELS.map((m) => ({ ...m, downloaded: isDownloaded(m) }));
}

export async function downloadModel(modelId: string): Promise<boolean> {
  if (downloader) return false;
  const info = findModel(modelId);
  if (isDownloaded(info)) {
    refreshStatus();
    return true;
  }
  const { createModelDownloader } = await nlc();
  fs.mkdirSync(modelsDir(), { recursive: true });
  downloadCancelled = false;
  setStatus({
    state: 'downloading',
    modelId: info.id,
    modelName: info.name,
    progress: 0,
    downloadedBytes: 0,
    totalBytes: Math.round(info.sizeGB * 1e9),
    error: undefined
  });
  let lastUpdate = 0;
  try {
    downloader = await createModelDownloader({
      modelUri: info.url,
      dirPath: modelsDir(),
      fileName: info.file,
      showCliProgress: false,
      deleteTempFileOnCancel: false,
      skipExisting: true,
      onProgress: ({ totalSize, downloadedSize }) => {
        const now = Date.now();
        if (now - lastUpdate < 300 && downloadedSize < totalSize) return;
        lastUpdate = now;
        setStatus({ progress: totalSize ? downloadedSize / totalSize : 0, downloadedBytes: downloadedSize, totalBytes: totalSize });
      }
    });
    await downloader.download();
    downloader = null;
    refreshStatus();
    return true;
  } catch (err) {
    downloader = null;
    if (downloadCancelled) refreshStatus();
    else setStatus({ state: 'error', error: `Download fehlgeschlagen: ${errorMessage(err)}` });
    return false;
  }
}

export async function cancelDownload(): Promise<void> {
  if (!downloader) return;
  downloadCancelled = true;
  try {
    await downloader.cancel();
  } catch {
    // ignorieren – der Download-Promise meldet den Abbruch
  }
}

export async function unloadModel(): Promise<void> {
  try {
    sequence?.dispose();
    await context?.dispose();
    await model?.dispose();
  } catch (err) {
    console.error('Fehler beim Entladen des Modells', err);
  }
  sequence = null;
  context = null;
  model = null;
  loadedModelId = null;
}

export async function deleteModel(modelId: string): Promise<void> {
  const info = findModel(modelId);
  if (loadedModelId === info.id) await unloadModel();
  for (const f of [modelFile(info), `${modelFile(info)}.ipull`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      // Datei existiert nicht
    }
  }
  refreshStatus();
}

export function ensureLoaded(): Promise<void> {
  const settings = getSettings();
  const info = findModel(settings.modelId);
  if (model && loadedModelId === info.id && llamaGpuSetting === settings.gpu) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    try {
      await unloadModel();
      if (!isDownloaded(info)) throw new Error(`Das KI-Modell «${info.name}» ist noch nicht heruntergeladen.`);
      setStatus({ state: 'loading', modelId: info.id, modelName: info.name, error: undefined, progress: undefined });
      const { getLlama, LlamaLogLevel } = await nlc();
      if (!llama || llamaGpuSetting !== settings.gpu) {
        if (llama) await llama.dispose();
        llama = await getLlama({
          // Vulkan deckt NVIDIA, AMD und Intel ab; ohne passende GPU fällt es auf die CPU zurück.
          gpu: settings.gpu === 'cpu' ? false : { type: 'auto', exclude: ['cuda'] },
          build: 'never',
          logLevel: LlamaLogLevel.error,
          progressLogs: false
        });
        llamaGpuSetting = settings.gpu;
      }
      model = await llama.loadModel({ modelPath: modelFile(info) });
      context = await model.createContext({ contextSize: { min: 4096, max: 16384 } });
      sequence = context.getSequence();
      loadedModelId = info.id;
      const names = llama.gpu ? await llama.getGpuDeviceNames() : [];
      setStatus({ state: 'loaded', gpu: llama.gpu, gpuName: names.join(', ') || undefined });
    } catch (err) {
      await unloadModel();
      setStatus({ state: 'error', error: errorMessage(err) });
      throw err;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

function normalizeResult(raw: Record<string, unknown>, req: ExtractRequest): AiResult {
  const fields: Record<string, AiField> = {};
  for (const f of req.fields) {
    if (f.columnId === 'steueranteil' || f.columnId === 'waehrung') continue;
    const v = (raw[f.key] ?? {}) as Record<string, unknown>;
    fields[f.key] = { zeile: str(v.zeile), text: str(v.text) };
  }
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const frist = Number(raw.zahlungsfrist_tage);
  return {
    fields,
    zahlungsfristTage: Number.isFinite(frist) && frist > 0 && frist < 400 ? Math.round(frist) : 0,
    mwst: arr(raw.mwst).map((m) => ({ zeile: str(m.zeile), betrag: str(m.betrag), satz: str(m.satz) })),
    waehrung: str(raw.waehrung),
    positionen: arr(raw.positionen).map((p) => ({ zeile: str(p.zeile), titel: str(p.titel), menge: str(p.menge), preis: str(p.preis) }))
  };
}

async function runExtraction(req: ExtractRequest): Promise<ExtractResponse> {
  const started = Date.now();
  try {
    await ensureLoaded();
    const { LlamaChatSession, LlamaGrammar, QwenChatWrapper } = await nlc();
    const grammar = new LlamaGrammar(llama!, {
      grammar: schemaToGbnf(buildSchema(req.fields, req.withPositions)),
      stopGenerationTriggers: [GRAMMAR_STOP],
      trimWhitespaceSuffix: true
    });
    // Prompt notfalls kürzen, damit Prompt + Antwort in den Kontext passen.
    let prompt = buildUserPrompt(req);
    const budget = context!.contextSize - MAX_OUTPUT_TOKENS - 400;
    let text = req.text;
    while (model!.tokenize(prompt).length > budget && text.length > 2000) {
      text = text.slice(0, Math.floor(text.length * 0.8));
      prompt = buildUserPrompt({ ...req, text });
    }
    const session = new LlamaChatSession({
      contextSequence: sequence!,
      autoDisposeSequence: false,
      chatWrapper: new QwenChatWrapper({ variation: '3.5', thoughts: 'discourage' }),
      systemPrompt: SYSTEM_PROMPT
    });
    currentAbort = new AbortController();
    setStatus({ state: 'busy' });
    let chars = 0;
    let lastProgress = 0;
    try {
      const answer = await session.prompt(prompt, {
        grammar,
        temperature: 0,
        maxTokens: MAX_OUTPUT_TOKENS,
        signal: currentAbort.signal,
        stopOnAbortSignal: false,
        onTextChunk: (chunk) => {
          // Fortschritt der entstehenden Antwort melden (gedrosselt)
          chars += chunk.length;
          const now = Date.now();
          if (!req.requestId || now - lastProgress < 250) return;
          lastProgress = now;
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.webContents.send('llm:progress', { requestId: req.requestId, chars });
          }
        }
      });
      const raw = JSON.parse(answer.trim()) as Record<string, unknown>;
      return { ok: true, result: normalizeResult(raw, req), modelId: loadedModelId ?? undefined, ms: Date.now() - started };
    } finally {
      session.dispose({ disposeSequence: false });
      await sequence?.clearHistory();
      currentAbort = null;
      if (status.state === 'busy') setStatus({ state: 'loaded' });
    }
  } catch (err) {
    const aborted = err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));
    return { ok: false, error: aborted ? 'Abgebrochen' : errorMessage(err), ms: Date.now() - started };
  }
}

/** Extraktionen laufen nacheinander, da das Modell nur einen Kontext hat. */
export function extract(req: ExtractRequest): Promise<ExtractResponse> {
  const result = chain.then(
    () => runExtraction(req),
    () => runExtraction(req)
  );
  chain = result.catch(() => undefined);
  return result;
}

export function cancelExtraction(): void {
  currentAbort?.abort();
}

export async function shutdownLlm(): Promise<void> {
  await cancelDownload();
  await unloadModel();
  try {
    await llama?.dispose();
  } catch {
    // beim Beenden egal
  }
  llama = null;
}
