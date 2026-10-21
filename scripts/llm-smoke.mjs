// Schnelltest für das lokale KI-Modell: node scripts/llm-smoke.mjs [modell.gguf]
import path from 'node:path';
import { getLlama, LlamaChatSession, QwenChatWrapper } from 'node-llama-cpp';

const modelPath =
  process.argv[2] ?? path.join(process.env.APPDATA ?? '', 'Belegfuchs', 'models', 'Qwen3.5-4B-Q4_K_M.gguf');

const invoice = `[1.1] Muster Elektro AG   Bahnhofstrasse 12   8001 Zürich
[1.2] Tel. 044 123 45 67   info@muster-elektro.ch   MWST-Nr. CHE-123.456.789 MWST
[1.3] Belegfuchs GmbH
[1.4] Seestrasse 5
[1.5] 6300 Zug
[1.6] Zürich, 14. Oktober 2026
[1.7] Rechnung Nr. RE-2026-0412
[1.8] Betreff: Elektroinstallation Büro 2. OG
[1.9] Pos   Bezeichnung   Menge   Einzelpreis   Betrag
[1.10] 1   Installationsarbeiten Elektriker   12 Std   98.00   1'176.00
[1.11] 2   Kabel NYM-J 3x1.5 mm2   150 m   1.85   277.50
[1.12] 3   Steckdosen 3-fach weiss   8 Stk   24.90   199.20
[1.13] Zwischentotal   CHF   1'652.70
[1.14] MWST 8.1%   CHF   133.87
[1.15] Total CHF   1'786.57
[1.16] Zahlbar innert 30 Tagen netto.`;

const field = { type: 'object', properties: { zeile: { type: 'string', maxLength: 12 }, text: { type: 'string', maxLength: 200 } } };
const schema = {
  type: 'object',
  properties: {
    kreditor: field,
    titel: field,
    rechnungsnummer: field,
    rechnungsdatum: field,
    zahlungsdatum: field,
    zahlungsfrist_tage: { type: 'integer' },
    totalbetrag: field,
    mwst: { type: 'array', maxItems: 6, items: { type: 'object', properties: { zeile: { type: 'string' }, betrag: { type: 'string' }, satz: { type: 'string' } } } },
    waehrung: { type: 'string', maxLength: 3 },
    positionen: {
      type: 'array',
      maxItems: 80,
      items: { type: 'object', properties: { zeile: { type: 'string' }, titel: { type: 'string' }, menge: { type: 'string' }, preis: { type: 'string' } } }
    }
  }
};

const t0 = Date.now();
const llama = await getLlama({ gpu: 'auto', build: 'never', logLevel: 'error' });
console.log('gpu:', llama.gpu, await llama.getGpuDeviceNames());
const vram = await llama.getVramState();
console.log('vram total GB:', (vram.total / 1e9).toFixed(1));
const model = await llama.loadModel({ modelPath });
console.log('load ms:', Date.now() - t0, '| arch:', model.fileInfo.metadata.general.architecture, '| train ctx:', model.trainContextSize);
const context = await model.createContext({ contextSize: { min: 4096, max: 12288 } });
console.log('ctx:', context.contextSize);

const sequence = context.getSequence();
for (const variant of ['qwen-discourage', 'qwen-discourage-2']) {
  const chatWrapper = variant === 'auto' ? undefined : new QwenChatWrapper({ variation: '3.5', thoughts: 'discourage' });
  const session = new LlamaChatSession({
    contextSequence: sequence,
    autoDisposeSequence: false,
    chatWrapper: chatWrapper ?? 'auto',
    systemPrompt: 'Du extrahierst Daten aus Kreditorenrechnungen exakt und erfindest nichts.'
  });
  console.log(`\n--- ${variant}: wrapper=${session.chatWrapper.wrapperName} variation=${session.chatWrapper.variation ?? '-'}`);
  const grammar = await llama.createGrammarForJsonSchema(schema);
  const t1 = Date.now();
  let thoughts = '';
  const res = await session.promptWithMeta(
    `Rechnungstext (jede Zeile beginnt mit ihrer ID):\n${invoice}\n\nExtrahiere die Felder als JSON. "zeile" = ID der Zeile, "text" = Wert genau wie gedruckt (leer, wenn nicht vorhanden). Kreditor ist der Rechnungssteller, nicht der Empfänger.`,
    {
      grammar,
      temperature: 0,
      maxTokens: 2500,
      budgets: { thoughtTokens: 0 },
      onResponseChunk: (c) => {
        if (c.type === 'segment') thoughts += c.text;
      }
    }
  );
  const ms = Date.now() - t1;
  const text = res.responseText;
  console.log('ms:', ms, '| thought chars:', thoughts.length, '| stop:', res.stopReason);
  console.log('RAW >>>' + JSON.stringify(text.slice(0, 400)) + '<<<');
  console.log('response items:', JSON.stringify(res.response).slice(0, 300));
  try {
    console.log(JSON.stringify(grammar.parse(text), null, 1).slice(0, 2500));
  } catch (e) {
    console.log('PARSE ERROR', e.message);
  }
  session.dispose({ disposeSequence: false });
  await sequence.clearHistory();
}
await context.dispose();
await model.dispose();
