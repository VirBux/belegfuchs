import { Cpu, FileOutput, FolderOpen, Info, LoaderCircle, ScanText, Sparkles, Trash, CloudDownload, Building2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { OCR_LANGUAGES } from '../../../shared/models';
import type { LlmModelInfo, Settings } from '../../../shared/types';
import { askConfirm, saveSettings, setDialog, useStore } from '../store';
import { cls, formatBytes, Modal, ProgressBar, Switch } from './ui';

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.value)} className={cls(o.value === value && 'on')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="form-row">
      <label className="l">{label}</label>
      <div>{children}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function AiTab({ settings }: { settings: Settings }) {
  const llm = useStore((s) => s.llm);
  const [models, setModels] = useState<LlmModelInfo[]>([]);
  const [info, setInfo] = useState<{ modelsDir: string } | null>(null);
  const refresh = () => void window.belegfuchs.llm.models().then(setModels);
  useEffect(() => {
    refresh();
    void window.belegfuchs.app.info().then(setInfo);
  }, [llm.state]);

  const remove = async (m: LlmModelInfo) => {
    const answer = await askConfirm({
      title: `«${m.name}» löschen?`,
      text: `Die Modelldatei (${m.sizeGB.toFixed(1)} GB) wird von diesem PC entfernt. Sie kann später erneut heruntergeladen werden.`,
      confirmLabel: 'Löschen',
      danger: true
    });
    if (answer === 'confirm') {
      await window.belegfuchs.llm.remove(m.id);
      refresh();
    }
  };

  return (
    <>
      <p className="muted" style={{ marginTop: 6, lineHeight: 1.5 }}>
        Die KI läuft vollständig lokal auf diesem PC – Rechnungsdaten werden nie ins Internet übertragen. Grafikkarten von NVIDIA, AMD und Intel werden
        über Vulkan genutzt, sonst rechnet der Prozessor.
      </p>
      <div className="model-list">
        {models.map((m) => {
          const on = settings.modelId === m.id;
          const downloading = llm.state === 'downloading' && llm.modelId === m.id;
          return (
            <div key={m.id} className={cls('model-card', on && 'on')} onClick={() => !on && void saveSettings({ modelId: m.id })}>
              <span className="radio" />
              <div>
                <div className="title">
                  {m.name}
                  {m.recommended && <span className="badge accent">Empfohlen</span>}
                  {m.downloaded && <span className="badge ok">Installiert</span>}
                  <span className="badge">{m.sizeGB.toFixed(1)} GB</span>
                </div>
                <div className="desc">{m.description}</div>
                {downloading && (
                  <div style={{ marginTop: 8, maxWidth: 360 }}>
                    <ProgressBar value={llm.progress} />
                    <small className="muted">
                      {Math.round((llm.progress ?? 0) * 100)} % · {formatBytes(llm.downloadedBytes ?? 0)} von {formatBytes(llm.totalBytes ?? 0)}
                    </small>
                  </div>
                )}
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                {downloading ? (
                  <button className="btn btn-sm" onClick={() => void window.belegfuchs.llm.cancelDownload()}>
                    Abbrechen
                  </button>
                ) : m.downloaded ? (
                  <button className="btn btn-ghost btn-sm btn-danger" onClick={() => void remove(m)} title="Modelldatei löschen">
                    <Trash />
                  </button>
                ) : (
                  <button className="btn btn-sm" disabled={llm.state === 'downloading'} onClick={() => void window.belegfuchs.llm.download(m.id)}>
                    <CloudDownload /> Laden
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <h4>Recheneinheit</h4>
      <Seg
        value={settings.gpu}
        options={[
          { value: 'auto', label: 'Automatisch (Grafikkarte, falls vorhanden)' },
          { value: 'cpu', label: 'Nur Prozessor (CPU)' }
        ]}
        onChange={(v) => void saveSettings({ gpu: v })}
      />
      <div className="device-box">
        <Cpu />
        <div style={{ flex: 1 }}>
          {llm.state === 'loaded' || llm.state === 'busy' ? (
            <>
              <strong>{llm.modelName} ist geladen</strong>
              <div className="muted">{llm.gpu ? `${String(llm.gpu).toUpperCase()} · ${llm.gpuName ?? 'Grafikkarte'}` : 'Prozessor (CPU)'}</div>
            </>
          ) : llm.state === 'loading' ? (
            <strong>
              <LoaderCircle size={14} className="spin" /> Modell wird geladen …
            </strong>
          ) : llm.state === 'error' ? (
            <>
              <strong>Fehler</strong>
              <div className="muted">{llm.error}</div>
            </>
          ) : (
            <>
              <strong>{llm.state === 'ready' ? 'Bereit – wird beim ersten Scan geladen' : 'Kein Modell installiert'}</strong>
              <div className="muted">Das gewählte Modell wird automatisch beim Scannen verwendet.</div>
            </>
          )}
        </div>
        {(llm.state === 'ready' || llm.state === 'error') && (
          <button className="btn btn-sm" onClick={() => void window.belegfuchs.llm.load()}>
            Jetzt laden
          </button>
        )}
      </div>
      {info && (
        <p className="muted" style={{ fontSize: 12 }}>
          Modellordner: {info.modelsDir}{' '}
          <button className="btn btn-ghost btn-sm" onClick={() => void window.belegfuchs.shell.openPath(info.modelsDir)}>
            <FolderOpen /> Öffnen
          </button>
        </p>
      )}
    </>
  );
}

const TABS = [
  { id: 'ai', label: 'KI-Modell', icon: Sparkles },
  { id: 'ocr', label: 'Texterkennung', icon: ScanText },
  { id: 'recognition', label: 'Erkennung', icon: Building2 },
  { id: 'format', label: 'Format & Export', icon: FileOutput },
  { id: 'about', label: 'Info', icon: Info }
];

export function SettingsDialog() {
  const settings = useStore((s) => s.settings);
  const initialTab = useStore((s) => s.settingsTab);
  const [tab, setTab] = useState(initialTab);
  const [company, setCompany] = useState(settings.ownCompany);
  const [version, setVersion] = useState('');
  const [userData, setUserData] = useState('');
  useEffect(() => {
    void window.belegfuchs.app.info().then((i) => {
      setVersion(i.version);
      setUserData(i.userData);
    });
  }, []);
  const toggleLang = (code: string) => {
    const next = settings.ocrLangs.includes(code) ? settings.ocrLangs.filter((l) => l !== code) : [...settings.ocrLangs, code];
    if (next.length) void saveSettings({ ocrLangs: next });
  };

  return (
    <Modal title="Einstellungen" size="wide" onClose={() => setDialog(null)} footer={<><div className="spacer" /><button className="btn btn-primary" onClick={() => setDialog(null)}>Fertig</button></>}>
      <div className="settings-layout">
        <nav className="settings-nav">
          {TABS.map((t) => (
            <button key={t.id} className={cls(tab === t.id && 'on')} onClick={() => setTab(t.id)}>
              <t.icon /> {t.label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === 'ai' && <AiTab settings={settings} />}
          {tab === 'ocr' && (
            <>
              <Row label="Sprachen" hint="Für gescannte PDFs. Weniger Sprachen = schnellere Erkennung.">
                <div className="check-group">
                  {OCR_LANGUAGES.map((l) => (
                    <label key={l.code}>
                      <input type="checkbox" checked={settings.ocrLangs.includes(l.code)} onChange={() => toggleLang(l.code)} /> {l.label}
                    </label>
                  ))}
                </div>
              </Row>
              <Row label="OCR erzwingen" hint="Auch digitale PDFs per Texterkennung lesen – nur nötig, wenn deren eingebetteter Text fehlerhaft ist.">
                <Switch on={settings.forceOcr} onChange={(v) => void saveSettings({ forceOcr: v })} />
              </Row>
              <Row label="Max. Seiten pro PDF" hint="Weitere Seiten (z.B. AGB) werden beim Scannen übersprungen.">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={50}
                  style={{ width: 100 }}
                  value={settings.maxPages}
                  onChange={(e) => void saveSettings({ maxPages: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })}
                />
              </Row>
            </>
          )}
          {tab === 'recognition' && (
            <>
              <Row label="Eigene Firma" hint="Name des Rechnungsempfängers (eure Firma). Wird nie als Kreditor erkannt.">
                <input
                  className="input"
                  value={company}
                  placeholder="z.B. Muster Treuhand AG"
                  onChange={(e) => setCompany(e.target.value)}
                  onBlur={() => company !== settings.ownCompany && void saveSettings({ ownCompany: company.trim() })}
                />
              </Row>
              <Row label="Standardwährung" hint="Wird verwendet, wenn auf der Rechnung keine Währung erkennbar ist.">
                <Seg
                  value={settings.defaultCurrency}
                  options={['CHF', 'EUR', 'USD', 'GBP'].map((c) => ({ value: c, label: c }))}
                  onChange={(v) => void saveSettings({ defaultCurrency: v })}
                />
              </Row>
            </>
          )}
          {tab === 'format' && (
            <>
              <Row label="Zahlenformat (Anzeige)">
                <Seg
                  value={settings.numberFormat}
                  options={[
                    { value: 'ch', label: '1’234.50' },
                    { value: 'de', label: '1.234,50' },
                    { value: 'plain', label: '1234.50' }
                  ]}
                  onChange={(v) => void saveSettings({ numberFormat: v })}
                />
              </Row>
              <Row label="Datumsformat">
                <Seg
                  value={settings.dateFormat}
                  options={[
                    { value: 'dd.MM.yyyy', label: '31.12.2026' },
                    { value: 'yyyy-MM-dd', label: '2026-12-31' }
                  ]}
                  onChange={(v) => void saveSettings({ dateFormat: v })}
                />
              </Row>
              <Row label="CSV-Trennzeichen" hint="Semikolon passt für Excel mit Schweizer und deutschen Ländereinstellungen.">
                <Seg
                  value={settings.csvDelimiter}
                  options={[
                    { value: ';', label: 'Semikolon ;' },
                    { value: ',', label: 'Komma ,' },
                    { value: '\t', label: 'Tabulator' }
                  ]}
                  onChange={(v) => void saveSettings({ csvDelimiter: v })}
                />
              </Row>
              <Row label="CSV-Dezimalzeichen">
                <Seg
                  value={settings.csvDecimal}
                  options={[
                    { value: '.', label: 'Punkt 1234.50' },
                    { value: ',', label: 'Komma 1234,50' }
                  ]}
                  onChange={(v) => void saveSettings({ csvDecimal: v })}
                />
              </Row>
              <Row label="Positionsblatt" hint="Excel-Export: zusätzliches Blatt mit einer Zeile pro Position (die JSON-Spalte bleibt erhalten).">
                <Switch on={settings.positionsSheet} onChange={(v) => void saveSettings({ positionsSheet: v })} />
              </Row>
            </>
          )}
          {tab === 'about' && (
            <div style={{ lineHeight: 1.6 }}>
              <h4>Belegfuchs {version}</h4>
              <p>
                Liest Kreditorenrechnungen (PDF, digital oder gescannt) per OCR und lokaler KI aus, markiert Titel, Positionen, Rechnungsnummer, Beträge und
                Daten farbig und exportiert alles nach Excel oder CSV.
              </p>
              <p>
                Projekte werden als <b>.fuchs</b>-Datei gespeichert – inklusive der PDFs, sodass sie auf jedem PC mit Belegfuchs wieder geöffnet werden können.
              </p>
              <h4>Tastenkürzel</h4>
              <dl className="meta-list" style={{ padding: 0 }}>
                <dt>Ctrl+S / Ctrl+⇧+S</dt>
                <dd>Speichern / Speichern unter</dd>
                <dt>Ctrl+O / Ctrl+N</dt>
                <dd>Projekt öffnen / Neues Projekt</dd>
                <dt>1 – 9</dt>
                <dd>Feld im Prüfmodus auswählen</dd>
                <dt>Esc</dt>
                <dd>Auswahl beenden</dd>
                <dt>Ctrl+Enter</dt>
                <dd>Geprüft &amp; weiter</dd>
                <dt>Alt+← / Alt+→</dt>
                <dd>Vorheriges / nächstes Dokument</dd>
                <dt>Ctrl+Mausrad</dt>
                <dd>PDF zoomen</dd>
              </dl>
              <p className="muted" style={{ fontSize: 12 }}>
                Datenordner: {userData}
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
