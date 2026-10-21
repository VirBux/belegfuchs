// Prüft Prompt + Modell an Beispieltexten: node scripts/llm-eval.mjs [modell.gguf]
import path from 'node:path';
import { getLlama, LlamaChatSession, LlamaGrammar, QwenChatWrapper } from 'node-llama-cpp';
import { GRAMMAR_STOP, SYSTEM_PROMPT, buildSchema, buildUserPrompt, schemaToGbnf } from '../src/shared/prompt.ts';

const modelPath =
  process.argv[2] ?? path.join(process.env.APPDATA ?? '', 'Belegfuchs', 'models', 'Qwen3.5-4B-Q4_K_M.gguf');

const samples = {
  ch: `[1.1] Muster Elektro AG   Bahnhofstrasse 12   8001 Zürich
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
[1.16] Zahlbar innert 30 Tagen netto.`,
  de: `[1.1] Druckerei Schmidt GmbH · Industriestr. 4 · 70565 Stuttgart
[1.2] Belegfuchs GmbH
[1.3] Seestrasse 5
[1.4] 6300 Zug
[1.5] RECHNUNG
[1.6] Rechnungsnummer:   2026/10-337   Kundennummer:   K-55120
[1.7] Rechnungsdatum:   02.10.2026   Lieferdatum:   30.09.2026
[1.8] Artikel   Beschreibung   Anzahl   Preis   Gesamt
[1.9] FL-A5   Flyer A5, 4/4-farbig, 170g   5.000   0,042 €   210,00 €
[1.10] VK-85   Visitenkarten 85x55, matt   1.000   0,089 €   89,00 €
[1.11] ROLL   Roll-Up Display 85x200   2   119,00 €   238,00 €
[1.12] Nettobetrag   537,00 €
[1.13] zzgl. 19% USt.   102,03 €
[1.14] Rechnungsbetrag   639,03 €
[1.15] Bitte überweisen Sie den Betrag bis zum 16.10.2026 auf unser Konto.
[1.16] IBAN DE89 3704 0044 0532 0130 00 · Geschäftsführer: Hans Schmidt · USt-IdNr. DE123456789`,
  fr: `[1.1] Garage du Lac SA
[1.2] Route de Lausanne 88, 1110 Morges
[1.3] Facture n° F-88123
[1.4] Morges, le 3 octobre 2026
[1.5] Objet : Service annuel véhicule VD 123 456
[1.6] Désignation   Qté   Prix unit.   Montant
[1.7] Main d'oeuvre service   2.5 h   145.00   362.50
[1.8] Huile moteur 5W30   4.5 l   18.40   82.80
[1.9] Filtre à huile   1   24.50   24.50
[1.10] Total HT   CHF   469.80
[1.11] TVA 8.1 %   CHF   38.05
[1.12] Total TTC   CHF   507.85
[1.13] Payable dans les 20 jours.`
};

const fields = [
  ['kreditor', 'Kreditor', 'text'],
  ['titel', 'Titel', 'text'],
  ['rechnungsnummer', 'Rechnungsnummer', 'id'],
  ['rechnungsdatum', 'Rechnungsdatum', 'date'],
  ['zahlungsdatum', 'Zahlungsdatum', 'date'],
  ['totalbetrag', 'Totalbetrag', 'amount'],
  ['steueranteil', 'Steueranteil', 'amount'],
  ['waehrung', 'Währung', 'currency']
].map(([id, label, type]) => ({ key: id, columnId: id, label, type }));
fields.push({ key: 'kundennummer', columnId: 'c_test', label: 'Kundennummer', type: 'text', description: 'Kundennummer des Empfängers beim Lieferanten' });

const llama = await getLlama({ gpu: 'auto', build: 'never', logLevel: 'error' });
const model = await llama.loadModel({ modelPath });
const context = await model.createContext({ contextSize: { min: 4096, max: 12288 } });
const sequence = context.getSequence();
const grammar = new LlamaGrammar(llama, { grammar: schemaToGbnf(buildSchema(fields, true)), stopGenerationTriggers: [GRAMMAR_STOP], trimWhitespaceSuffix: true });
console.log('model:', path.basename(modelPath), '| gpu:', llama.gpu);

for (const [name, text] of Object.entries(samples)) {
  const session = new LlamaChatSession({
    contextSequence: sequence,
    autoDisposeSequence: false,
    chatWrapper: new QwenChatWrapper({ variation: '3.5', thoughts: 'discourage' }),
    systemPrompt: SYSTEM_PROMPT
  });
  const prompt = buildUserPrompt({ text, fields, withPositions: true, ownCompany: 'Belegfuchs GmbH' });
  const t = Date.now();
  const out = await session.prompt(prompt, { grammar, temperature: 0, maxTokens: 3000 });
  const ms = Date.now() - t;
  const tokens = model.tokenize(out).length;
  const r = JSON.parse(out.trim());
  console.log(`\n=== ${name}: ${ms} ms, ${tokens} Tokens (${(tokens / (ms / 1000)).toFixed(1)} tok/s), Prompt ${model.tokenize(prompt).length} Tokens`);
  for (const [k, v] of Object.entries(r)) {
    if (Array.isArray(v)) {
      console.log(`  ${k}:`);
      for (const it of v) console.log('    ', JSON.stringify(it));
    } else console.log(`  ${k}: ${JSON.stringify(v)}`);
  }
  session.dispose({ disposeSequence: false });
  await sequence.clearHistory();
}
await context.dispose();
await model.dispose();
