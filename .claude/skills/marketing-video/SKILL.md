---
name: marketing-video
description: Ruhiges Erklärvideo („App-Rundgang“) zu Belegfuchs aus echter App-UI bauen, mit Sprecher, eingebrannten Untertiteln und Auslieferung per WhatsApp. Verwenden bei „mach ein Video“, „Erklärvideo“, „App-Rundgang als Video“, „Feature-Video“, „Video für WhatsApp“ oder einer neuen Videoidee. Nicht für Screenshots, statische Grafiken oder Icons.
---

# Erklärvideo (Belegfuchs)

Verbindliche Arbeitsanweisung. Stil, Pipeline und Timing stammen 1:1 aus dem Projekt
„HA Fleet Manager“ (`D:\Coding\ha-fleet-manager`). Nichts davon neu erfinden: Vorlage kopieren
und anpassen.

## Prinzip

Ruhiges Erklärvideo aus **echter App-UI**. Produkt-UI wird nie nachgezeichnet, sondern per
Playwright als Screenshot aufgenommen und danach nur gecroppt, bewegt und hervorgehoben.
Hervorhebungsrahmen, Cursor, Schrift und Untertitel liegen als Ebenen darüber. Alles ist
deterministisch und reproduzierbar:

echte UI-Screenshots (Playwright) → HTML-Komposition mit `window.seek(t)` → Frame-für-Frame-Render
mit Playwright + ffmpeg → Musik vollständig im Code synthetisiert (numpy) → Voiceover von Fish Audio.
**Das Voiceover führt die Zeit**: `script.json` → `build_timeline.py` → `timeline.json`.

Länge: so lang wie die Erklärung braucht (bisher 2:30–3:30 min). 16:9, 30 fps, Master 1920 × 1080.
Tempo ruhig: lange Einstellungen, `inOutCubic`, kein Motion-Blur, Cursor in Lesegeschwindigkeit,
nach jeder Aktion eine Pause. Kein Showreel-Gerüttel, keine Whip-Pans, keine Wort-Slams.

## Vorlage kopieren

- Quelle: `D:\Coding\ha-fleet-manager\marketing-videos\remote-maintenance-explainer-en\` (neuester Stand).
- Neubau-Anleitung: `D:\Coding\ha-fleet-manager\marketing-videos\getting-started-explainer-en\README.md`,
  Abschnitt „Neu bauen“.

Die Vorlage selbst nie verändern. Neue Projekte liegen unter `marketing-videos/<projekt>/`:

```
script.json            Quelle der Wahrheit (Szenen, Sprechertext, Aktionen)
build_timeline.py      script.json → timeline.json + SRT (Zeiten aus den VO-Längen)
composition/index.html datengetriebene Komposition, kennt nur Bausteine, keine Zeiten
render.cjs             Static-Server + Playwright-Frames + ffmpeg (--sheet, --from/--to, --variant)
still.cjs              Einzelbild (Poster/Thumbnail)
sheet.py               Kontaktabzug aus den Sheet-Frames
capture-ui.cjs         UI-Aufnahmen aus der lokal gestarteten App
mock/mock-api.cjs      gestellte Daten für die Aufnahmen (bei Belegfuchs: Bridge statt HTTP, s. u.)
audio/vo_prep.py       VO trimmen/normalisieren → vo_meta.json
audio/synth.py         Musik + UI-Klänge aus timeline.json
audio/mix.py           Endmischung
assets/{ui,logo,fonts,vo}/ + assets/ASSETS.md (Herkunft jedes Assets)
SKRIPT.md  README.md  .gitignore
```

Nicht übernehmen: `capture-ha.cjs`, `ha-session.cjs`, `assets/ha/`, `timeline-youtube.json`,
`YOUTUBE.md`, `vo.de.json`, `assets/vo-de/`, `subs.de.txt` (Belegfuchs-Videos sind von vornherein
deutsch; `vo/` und `script.json` enthalten direkt den deutschen Text).

Regenerierbares (Master-MP4s, stumme Zwischenvideos, WAVs, `scratch/`, `out/sheet-*`) per
`.gitignore` im Projektordner draußen halten — MP4s kratzen am GitHub-Limit von 100 MB.

### Anpassungen an Belegfuchs

- **Playwright** kommt aus diesem Repo (devDependency): in `render.cjs`, `still.cjs` und
  `capture-ui.cjs` den Pfad `D:/Coding/ha-fleet-manager/e2e/node_modules/playwright` durch
  `require('playwright')` bzw. den absoluten Pfad `D:/Coding/ai-invoice-checker/node_modules/playwright`
  ersetzen. Im Worktree fehlende `node_modules` per Junction aufs Hauptrepo legen:
  `cmd /c mklink /J node_modules D:\Coding\ai-invoice-checker\node_modules`.
- **Belegfuchs ist eine Electron-App ohne HTTP-Backend.** Die Oberfläche spricht über die
  Preload-Brücke `window.belegfuchs` (`src/preload/index.ts`) mit dem Hauptprozess. Der „Mock“
  ersetzt deshalb nicht eine API, sondern stellt Demodaten bereit — Weg siehe offene Punkte unten.
  Bewährtes Vorbild für das Fernsteuern der echten App: `scripts/e2e-flow.mjs`
  (`_electron.launch`, Einstellungen vorher sichern und danach wiederherstellen).
- **Demo-Rechnungen** aus `npm run samples` (`scripts/make-samples.mjs`) oder eigens erzeugten,
  erkennbar erfundenen PDFs. Nie echte Rechnungen von Kunden oder Lieferanten.

## Optik (genau so übernehmen)

- Dunkle Bühne. Farb-Tokens als `oklch` aus dem **Design-System dieses Projekts**
  (`src/renderer/src/styles.css`). Im Original: `--bg: oklch(0.135 0.005 240)`,
  `--surface: oklch(0.175 0.008 240)`, `--text: oklch(0.96 0.005 240)`,
  `--muted: oklch(0.58 0.01 240)`, `--accent: oklch(0.74 0.16 158)`, `--warn: oklch(0.8 0.15 75)`.
  Belegfuchs: Akzent ist das Fuchs-Orange `#e8661c`; die App selbst ist hell — die Bühne bleibt
  trotzdem dunkel, die hellen UI-Aufnahmen stehen darauf. Endgültige Tokens siehe offene Punkte.
- Schrift Geist / Geist Mono als lokale `woff2` in `assets/fonts/` (sofern nicht anders entschieden).
- Hintergrund: zwei langsam driftende radiale Glows (Akzent + kühler Zweitton), Raster mit
  `opacity 0.045` und langsamem Drift, Vignette, **statische Körnung** `opacity 0.035`,
  `mixBlendMode: screen` (4 vorgerenderte 256er-Tiles, nie pro Frame neu — das vervielfacht die
  Dateigröße).
- UI-Bühne („plane“) als eigenes Rechteck, Kamera fährt darauf: typisch Zoom 0.86 → 0.96 über die
  Szene, Ziel-Rechtecke aus `assets/ui/boxes.json` (beim Aufnehmen mitgeschrieben).
- Ebenen: jede Ebene braucht einen eigenen `z-index` (ein `transform` erzeugt einen
  Stapelkontext). `show()` über `visibility`, nicht `display`, sonst gehen Flex-Layouts verloren.
- Easing-Satz: `outCubic, inCubic, inOutCubic, inOutSine, outExpo, inExpo, spring`.
- Untertitelband unten: Scrim-Gradient, die UI läuft weich darunter aus, Untertitel liegen nie über
  der erklärten Oberfläche.
- Titelkarte am Anfang (Eyebrow / Titel / Unterzeile), Kapitelkarten zwischendurch,
  Outro-Lockup mit Titel, Akzentzeile und URL.

## script.json — Schema

`fps: 30`, `size: [1920,1080]`, `subsBurned`, `planes` (je Bühne w/h), `layers` (je Bühne Ebenen
mit `parent`, `rect`, `slideX`, `onlyWith`), `scenes[]`, `variants`.

Szene: `id, label, plane, vo, lead, tail, sheetAt, text, say?, chapter?, intro?, steps?, diagram?,
outro?, actions[]`.
- `text` = Untertitel und Transkript (Produktbegriffe korrekt geschrieben).
- `say` = der Text, mit dem das VO erzeugt wurde (nur Aussprache-Varianten).
- `lead`/`tail` = Vorlauf/Nachlauf um das Voiceover.

Aktionen (`do`): `img` (Ebenenbild setzen, mit `fade`), `cam` (Kamerafahrt auf `rect`/`to` mit
`zoom`, `dur`), `ring` (Hervorhebungsrahmen auf ein Ziel, `pad`, `until`), `move` (Cursor zu `to`,
`arrive`), `click`, `type` (`prefix`, `n`), `slide` (`dir`), `hideCursor`.

Zeitangaben in Aktionen — das ist der Kern des ruhigen Timings:
- Zahl = Sekunden ab Szenenstart
- `"vo"` = Beginn des Voiceovers
- `"w:Wort"` / `"w:Wort#2"` = geschätzter Zeitpunkt des (zweiten) Vorkommens dieses Wortes im VO,
  optional mit `+0.3` / `-0.2`
- `"+0.4"` = Ende der vorigen Aktion plus 0,4 s
- `"end-1"` = Szenenende minus 1 s

Ziele (`to`, `rect`) sind Namen aus `assets/ui/boxes.json` oder Rechtecke `{x,y,w,h}` in
Ebenen-Koordinaten.

## Ton

- Musik komplett in `audio/synth.py` synthetisiert: gleiche Klangwelt wie der Kurz-Spot, aber
  **92 BPM**, A-Moll-Feld Am – F – C – G, Supersaw-Flächen, Sub, leises Pluck-Arpeggio, leichte
  Percussion, **keine harte Kick**. Während Kapitel-Titeln setzt die Percussion aus. UI-Klänge
  (Klicks, Tippen, Whooshes) aus der Cue-Liste in `timeline.json`, damit Bild und Ton denselben
  Zeitplan teilen. SR 48000.
- `audio/mix.py`: `MUSIC_GAIN 0.20`, `DUCK 0.5` (≈ −6 dB unter der Stimme), `FX_GAIN 0.30`,
  `VO_GAIN 0.9`, Hüllkurvenfolger fürs Ducking, weicher Limiter auf der Summe. Schreibt
  `audio/final-mix.wav` und `out/soundtrack-preview.mp3`.
- Reihenfolge: `vo_prep.py` → `build_timeline.py` → `synth.py` → `mix.py`.

## Stimmen (gesetzt, nicht neu wählen)

- Sprache ist **nur Deutsch**, es gibt keine englischen Belegfuchs-Videos.
- Deutsch: **„Sorgfältiger deutscher Erzähler (männlich)“ `b32ca890b33a4cb2a576afc2a5137e01`**
  (Fish Audio, Wahl Denny 2026-10-22). Sie ersetzt bei Belegfuchs die Fleet-Manager-Stimmen
  „Adrian“ (EN) und „German“ (DE).
- Keine andere Stimme, auch nicht „zum Ausprobieren“ — sonst klingt die Serie uneinheitlich. Nur
  für eine **neue** Sprache per `search_voices` 2–3 Kandidaten vorschlagen und wählen lassen. Keine
  Promi-Klon-Stimmen.
- Vor der Aufnahme `get_credit_balance`, Verbrauch nennen (1 Credit pro Byte), Zeilen unter
  500 Byte pro Aufruf. Aussprache prüfen, notfalls per `speech_to_text`.
- Aussprache im `say`-Text: Abkürzungen ausschreiben oder punktieren (im Original „H.A.“ statt
  „HA“, „Hacks“ statt „HACS“), `text` bleibt korrekt geschrieben. Kandidaten bei Belegfuchs:
  siehe „Entscheidungen“ unten; neue Begriffe vor der Aufnahme klären und dort eintragen.

## Ablauf (so und nicht anders)

**Eine Session, ein Video.** Kommt die Videoidee mitten in einer anderen Aufgabe, nicht dort bauen,
sondern einen eigenständigen Auftrag (eigene Session) anlegen: Feature, Sprache, Verweis auf diesen
Skill, offene Fragen.

1. **Klären, bevor gebaut wird** (eine Fragerunde): Zielgruppe, Umfang, Sprache, wie der
   Produktname gesprochen wird, Farb-Tokens/Fonts/Logo (falls noch nicht unten entschieden),
   welches Feature genau. Fremde Marken (Kundenfirma, Arbeitgeber, Lieferanten auf Demo-Rechnungen):
   erst klären, ob das Branding verwendet werden darf und wer verschickt; Ablage dann außerhalb des
   Repos, nichts veröffentlichen.
2. **Inhalt belegen.** Nur zeigen und sagen, was es im Code bzw. in `README.md` wirklich gibt.
   **Nie eine Zahl erfinden** (auch keine Erkennungsquote, Geschwindigkeit oder Ersparnis). Demodaten
   sind erfunden und werden in `ASSETS.md` so gekennzeichnet.
3. **Skript und Storyboard freigeben lassen**, bevor das Voiceover entsteht. Format wie `SKRIPT.md`
   der Vorlage: Tabelle Szene → gezeigte UI-Aktion → Sprechertext, dazu „Bewusst nicht gezeigt“ und
   eine Credit-Schätzung.
4. **Assets aufnehmen und vor dem Animieren in `assets/ASSETS.md` auflisten.**
5. **Voiceover** erzeugen.
6. **Audio** bauen (Reihenfolge oben).
7. **Kontaktabzug zeigen** (`node render.cjs --sheet && python sheet.py`: ein Frame pro Szene),
   selbst kritisch prüfen, Fehler vorab beheben, dann **auf Freigabe warten**. Erst danach voll
   rendern (`node render.cjs 30`, im Hintergrund; Teilstrecken mit `--from/--to`).
8. **Ausliefern** (siehe WhatsApp unten), inklusive Stichproben-Frames aus dem fertigen MP4 und
   Lautheitsmessung (`ffmpeg -i <datei> -af volumedetect -f null -`).
9. **Abschluss:** `README.md` und `assets/ASSETS.md` im Projektordner pflegen. Commit erst nach
   Rückfrage.

## Auslieferung per WhatsApp, nicht YouTube

- **Eingebrannte Untertitel sind Pflicht** (`subsBurned: true`): WhatsApp hat keine Untertitelspur.
  Maximal 2 Zeilen à 42 Zeichen, im Band unter der UI, Scrim darunter. Die UI-Bühne ist dann
  `{x: W*0.035, y: H*0.035, w: W*0.93, h: H*0.79}` (ohne Untertitel wäre sie höher).
- **Keine YouTube-Fassung**: keine 2560 × 1440-Variante, keine Endcard-Phase im Outro, keine
  `chapters.txt`, keine `YOUTUBE.md`, kein Website-Registry-Eintrag, kein zweisprachiges
  Transkript. Die `variants` in `script.json` bleiben leer.
- **Eine Datei, eine Tonspur** (Deutsch): WhatsApp spielt nur eine Audiospur ab.
- **Encoding für WhatsApp** aus dem 1080p-Master (CRF 16):
  ```
  ffmpeg -i out/<name>-16x9.mp4 -c:v libx264 -profile:v high -level 4.0 -preset slow \
    -crf 23 -maxrate 4M -bufsize 8M -pix_fmt yuv420p -movflags +faststart \
    -c:a aac -b:a 128k -ac 2 out/<name>-whatsapp.mp4
  ```
  Zielgröße nennen und prüfen: als Medien-Video mit 16 MB Deckel rechnen (je nach Client bis
  64 MB). Reicht das nicht, entweder CRF auf 25–26 und `-maxrate 2.5M`, oder — besser für die
  Qualität — den Hinweis mitgeben, die Datei **als Dokument** zu senden (bleibt unkomprimiert).
  WhatsApp rekomprimiert Medien-Videos; deshalb nie knapp am Limit abliefern.
- **9:16-Fassung** nur auf Nachfrage (für Status); dann Untertitel größer und Kamera enger.
- `.srt` trotzdem mitschreiben und ausliefern — Rückfall und Quelle fürs Transkript.
- Ein Poster-Einzelbild (`node still.cjs <sekunde>`) als Vorschaubild mitliefern.
- Videos, SRT und Ton-Vorschau per `SendUserFile` als Dateien ausliefern, nicht nur beschreiben.

## Fallstricke (alle schon einmal passiert)

- **Playwright-Pfad** der Vorlage zeigt ins Fleet-Manager-Repo — ersetzen (s. o.). Fehlende
  `node_modules` im Worktree per Junction aufs Hauptrepo legen.
- **Komposition nie über `file://` laden** — `fetch()` scheitert. `render.cjs` bringt einen
  Static-Server mit.
- **Mock/Demodaten:** Im Original nie mit 401 antworten (die App loggt aus), Catch-All mit leeren
  200-Antworten gegen rote Fehler-Snackbars, CORS-Header, WebSockets über `routeWebSocket`,
  Fake-Token im `localStorage`. Bei Belegfuchs gilt sinngemäß: Jeder Bridge-Aufruf, den die
  Oberfläche macht, braucht eine plausible Antwort, sonst erscheinen Fehlermeldungen oder
  Download-Dialoge (z. B. „KI-Modell herunterladen“). Echte Einstellungen des Nutzers unter
  `%APPDATA%\Belegfuchs` vorher sichern und danach wiederherstellen.
- **Demodaten konsistent halten**: Kreditor, Beträge, Steueranteil, Daten und Positionen müssen
  zwischen Übersicht, Prüfmodus, Linsenmodus und Export zusammenpassen.
- **Hohe Drawer/Dialoge im hohen Viewport aufnehmen** (z. B. 1440 × 1900), lange Listen ohne
  `max-height` aufnehmen und in der Komposition scrollen.
- **Kinetische Zeilen** mit `width: max-content` messen, sonst misst man die Containerbreite.
- **Dev-Server-Ports** sind oft belegt — eine Alt-Konfiguration bereithalten.
- **Python** auf der Windows-Konsole mit `PYTHONIOENCODING=utf-8`. numpy und Pillow sind da, scipy
  nicht.
- **VO-Slots:** Stille trimmen, lange Pausen kürzen, Tempo höchstens auf 1,3 anheben. Nichts darf
  überlappen oder über das Ende laufen. Lieber eine Zeile teilen und auf einen eigenen Bildmoment
  legen.
- **Renderzeit:** rund 0,5 s pro Frame bei 30 fps, also ~45–60 min für 3 Minuten. Im Hintergrund
  rendern.
- Ein Ordner, in dem das Arbeitsverzeichnis liegt, lässt sich unter Windows nicht umbenennen
  („Device or resource busy“) — erst das Arbeitsverzeichnis wechseln.

## Entscheidungen für Belegfuchs

Festgelegt mit Denny am 2026-10-22:

- **Sprache:** nur Deutsch, Stimme siehe oben. Untertitel schreiben UI-Begriffe genau wie die App
  (die App nutzt Schweizer Schreibweise: `ss` statt `ß`, «Guillemets»).
- **Bühne dunkel und warm**, obwohl die App hell ist: die hellen UI-Aufnahmen stehen auf der dunklen
  Bühne. Akzent = App-Orange `#e8661c` = `oklch(0.662 0.179 44.7)`. Grundton, Surface, Text und
  Muted wie im Original, aber mit warmem Farbton (Hue ≈ 45 statt 240); Zweit-Glow kühl (Hue ≈ 240).
  `--warn` wie im Original.
- **Schrift:** Geist / Geist Mono als `woff2` in `assets/fonts/`. Segoe UI (App-Schrift) darf nicht
  beigelegt werden; in den Screenshots erscheint sie trotzdem.
- **Logo:** App-Icon `build/icon.svg` plus Wortmarke „Belegfuchs“ in Geist gesetzt. Ein eigenes
  Logo gibt es nicht.
- **Outro:** Titel und Akzentzeile; eine URL gibt es noch nicht — vor dem ersten Video fragen,
  was dort steht (oder die Zeile weglassen).
- **Aufnahmeweg:** Renderer per Vite im Browser starten und `window.belegfuchs` durch einen
  gestellten Stub ersetzen (`mock/bridge-stub.js` statt `mock/mock-api.cjs`). Deterministisch,
  kein KI-Modell nötig. Jeder Bridge-Aufruf der Oberfläche braucht eine plausible Antwort.
- **Demodaten:** die Beispiel-PDFs aus `npm run samples`.
- **Aussprache im `say`-Text:** Abkürzungen ausschreiben oder punktieren, z. B. „K.I.“, „O.C.R.“,
  „Mehrwertsteuer“ für MWST, „Punkt fuchs“ für `.fuchs`, „C.S.V.“, „P.D.F.“. „Belegfuchs“ wird
  normal als ein Wort gesprochen; nach der ersten Aufnahme per `speech_to_text` prüfen.
