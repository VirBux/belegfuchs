import type { LlmModelInfo, Settings } from './types';

/** Lokale Sprachmodelle (GGUF, Q4_K_M). Werden beim ersten Gebrauch von Hugging Face geladen. */
export const MODELS: LlmModelInfo[] = [
  {
    id: 'qwen3.5-4b',
    name: 'Qwen3.5 4B',
    description: 'Empfohlen: sehr gute Erkennung bei moderatem Bedarf (ca. 4 GB Grafik- oder Arbeitsspeicher).',
    sizeGB: 2.74,
    url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf',
    file: 'Qwen3.5-4B-Q4_K_M.gguf',
    recommended: true
  },
  {
    id: 'qwen3.5-2b',
    name: 'Qwen3.5 2B',
    description: 'Klein und schnell, etwas ungenauer. Für schwächere PCs ohne Grafikkarte.',
    sizeGB: 1.28,
    url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf',
    file: 'Qwen3.5-2B-Q4_K_M.gguf'
  },
  {
    id: 'qwen3.5-9b',
    name: 'Qwen3.5 9B',
    description: 'Höchste Genauigkeit. Braucht ca. 7 GB Grafikspeicher, auf der CPU deutlich langsamer.',
    sizeGB: 5.68,
    url: 'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf',
    file: 'Qwen3.5-9B-Q4_K_M.gguf'
  }
];

export function findModel(id: string): LlmModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export const DEFAULT_SETTINGS: Settings = {
  modelId: MODELS[0].id,
  gpu: 'auto',
  ocrLangs: ['deu', 'eng', 'fra'],
  forceOcr: false,
  maxPages: 8,
  ownCompany: '',
  defaultCurrency: 'CHF',
  numberFormat: 'ch',
  dateFormat: 'dd.MM.yyyy',
  csvDelimiter: ';',
  csvDecimal: '.',
  positionsSheet: true
};

export const OCR_LANGUAGES: { code: string; label: string }[] = [
  { code: 'deu', label: 'Deutsch' },
  { code: 'eng', label: 'Englisch' },
  { code: 'fra', label: 'Französisch' },
  { code: 'ita', label: 'Italienisch' }
];
