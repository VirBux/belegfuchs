# Belegfuchs 🦊

Belegfuchs liest Kreditorenrechnungen (PDF, digital erstellt oder gescannt) aus. Die App erkennt den Text per OCR, ein **lokales KI-Modell** markiert die relevanten Angaben, und du prüfst alles bequem nebeneinander. Am Schluss exportierst du nach **Excel oder CSV**.

Die KI läuft vollständig auf dem eigenen PC. Rechnungsdaten verlassen den Rechner nie.

## Funktionen

- **PDFs hinzufügen:** per Dialog oder Drag & Drop, mehrere Dateien gleichzeitig. Die PDF darf auch per Doppelklick bzw. aufs Programmsymbol gezogen werden.
- **Scannen:**
  - Digitale PDFs liefern ihren Text direkt, gescannte PDFs laufen durch die Texterkennung (Tesseract: DE/EN/FR/IT).
  - Danach analysiert das lokale Sprachmodell den Inhalt. Eine regelbasierte Erkennung arbeitet zusätzlich als Rückfallebene, auch ganz ohne KI-Modell.
- **Erkannte Felder:**
  - Kreditor, Titel (Betreff), Rechnungsnummer
  - Rechnungsdatum, Zahlungsdatum (Fälligkeit, bei «zahlbar innert 30 Tagen» berechnet)
  - Totalbetrag, Steueranteil (Summe aller MWST-Sätze), Währung
  - Positionen sowie Scan-Datum und Dateiname
- **Prüfmodus:**
  - Rechts das PDF mit farbigen Markierungen (jede Feldart hat ihre Farbe), links die Ergebniszeile als Excel-Vorschau, Plausibilitätskontrollen und alle Werte zum Bearbeiten.
  - Korrigieren: Feld in der Kopfzeile wählen (oder Taste 1–9), dann im PDF auf einen Platzhalter klicken. Alternativ einen **Rahmen ziehen**: Angeschnittene Wörter werden dabei im Ausschnitt neu erkannt.
  - Als letzte Möglichkeit lässt sich jeder Wert frei von Hand eingeben.
  - **Linsenmodus** (`L`): zeigt jeden gefundenen Wert einzeln und stark vergrössert neben seinem Ausschnitt aus dem PDF, um Abschreibefehler Zeichen für Zeichen zu erkennen. `Enter`/`→` = stimmt, `←` zurück, `K` korrigieren, `Esc` schliessen.
  - `Ctrl+Enter` markiert das Dokument als geprüft und springt zum nächsten.
- **Eigene Spalten:** z.B. «Kundennummer» mit einem Hinweis für die KI. Die KI sucht sie automatisch, auch in bereits gescannten Dokumenten.
- **Projektdatei `.fuchs`:** speichert den kompletten Stand inklusive der PDFs. So lässt sich ein Projekt überall wieder öffnen, auch per Doppelklick.
- **Export:**
  - Excel mit echten Zahlen- und Datumswerten, farbiger Kopfzeile, Filter und einem zusätzlichen Blatt «Positionen».
  - CSV (UTF-8, `;` als Trenner, einstellbar).
  - Die Positionen stehen als JSON in einer Spalte: `{"pos1":{"titel":"…","menge":12,"preis":1176}}`.

## Schnellstart (Entwicklung)

```bash
npm install
npm run assets     # OCR-Sprachdaten kopieren, Programmsymbole erzeugen
npm run dev        # App mit Hot-Reload starten
```

Beim ersten Start bietet die App den Download des KI-Modells an (Qwen3.5 4B, ca. 2.7 GB, einmalig). Bis dahin arbeitet die regelbasierte Erkennung.

Testrechnungen erzeugen: `npm run samples` legt sechs Beispiel-PDFs in `samples/` an, darunter eine gescannte Bild-PDF.

## Installer / EXE bauen

```bash
npm run dist
```

Erzeugt in `release/`:

- `Belegfuchs-Setup-<version>.exe`: Installer mit Startmenü- und Desktop-Verknüpfung sowie Dateizuordnung für `.fuchs`
- `Belegfuchs-<version>-portable.exe`: läuft ohne Installation
- `win-unpacked/`: entpackte App (`Belegfuchs.exe`)

Die Builds sind nicht signiert. Windows SmartScreen zeigt deshalb beim ersten Start einen Hinweis («Weitere Informationen → Trotzdem ausführen»).

## KI-Modelle

| Modell | Grösse | Einsatz |
|---|---|---|
| Qwen3.5 4B (Standard) | 2.7 GB | sehr gute Erkennung, ~15 s pro Rechnung auf einer Mittelklasse-GPU |
| Qwen3.5 2B | 1.3 GB | schneller, für schwächere PCs |
| Qwen3.5 9B | 5.7 GB | höchste Genauigkeit, braucht ca. 7 GB Grafikspeicher |

- **Grafikkarten:** Über Vulkan funktionieren Grafikkarten von **NVIDIA, AMD und Intel**. Ohne passende GPU rechnet die CPU (langsamer).
- **Speicherort:** Die Modelle liegen unter `%APPDATA%\Belegfuchs\models`.
- **Wechsel:** in den Einstellungen.

## Bedienung im Prüfmodus

| Aktion | Bedienung |
|---|---|
| Feld zum Korrigieren wählen | Chip in der Kopfzeile, ⌖ neben dem Feld oder Taste `1`–`9` |
| Wert übernehmen | Platzhalter im PDF anklicken (`Ctrl+Klick` ergänzt Text) |
| Wert exakt umranden | Rahmen im PDF ziehen |
| Positionen erfassen | «Aus PDF erfassen», dann Zeilen anklicken oder einen Rahmen um die Tabelle ziehen |
| Auswahl beenden | `Esc` |
| Linsenmodus: Werte vergrössert mit dem PDF vergleichen | `L`, dann `Enter`/`→` stimmt, `←` zurück, `K` korrigieren |
| Geprüft & weiter | `Ctrl+Enter` |
| Dokument wechseln | `Alt+←` / `Alt+→` |
| Zoomen | `Ctrl+Mausrad` |

Tipp: Trag unter *Einstellungen → Erkennung* deine **eigene Firma** ein, damit sie nie als Kreditor erkannt wird. Steht eine Firma auf fast allen Rechnungen, schlägt Belegfuchs das nach dem Scannen von selbst vor.

## Architektur

```
src/
  main/        Electron-Hauptprozess: Fenster, IPC, KI (node-llama-cpp), OCR (tesseract.js),
               Projektdatei (.fuchs = ZIP mit project.json + PDFs), Excel/CSV-Export
  preload/     sichere Brücke window.belegfuchs
  renderer/    React-Oberfläche: Übersicht, Prüfmodus, PDF-Ansicht (pdf.js), Scan-Pipeline,
               regelbasierte Erkennung, Zuordnung KI-Werte → Markierungen
  shared/      Typen, Spalten, Zahlen-/Datumsparser, Prompt und Grammatik für die KI
```

Die KI erhält den Rechnungstext Zeile für Zeile mit IDs (`[1.12] Total CHF 1'786.57`) und antwortet über eine Grammatik garantiert mit gültigem JSON. Belegfuchs sucht jeden Wert anschliessend im Dokument, um ihn im PDF zu markieren.

## Erklärvideos

Erklärvideos («App-Rundgang» aus echter App-UI, mit Sprecher und eingebrannten Untertiteln, ausgeliefert per WhatsApp) entstehen nach einem festen Produktionsstandard: [.claude/skills/marketing-video/SKILL.md](.claude/skills/marketing-video/SKILL.md). Die Projekte liegen unter `marketing-videos/<projekt>/`.

## Tests

```bash
npm test                                   # Unit-Tests (Parser, Erkennung, Grammatik)
node scripts/llm-eval.mjs                  # Prompt-Qualität direkt am Modell prüfen
node scripts/e2e-flow.mjs <ausgabeordner>  # kompletter Ablauf in der gebauten App (vorher npm run build)
node scripts/e2e-lens.mjs <ausgabeordner>  # Linsenmodus: feste Lage beim Weiterschalten, vorab gerenderte Ausschnitte
```
