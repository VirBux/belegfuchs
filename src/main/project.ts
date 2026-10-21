import { app } from 'electron';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectData, ProjectFilePayload } from '../shared/types';

/** Eigene Dateiendung für Belegfuchs-Projekte. */
export const PROJECT_EXT = 'fuchs';

/**
 * Eine .fuchs-Datei ist ein ZIP-Container mit project.json und den Original-PDFs,
 * damit ein Projekt auch ohne die Ursprungsdateien wieder geöffnet werden kann.
 */
export async function writeProject(filePath: string, payload: ProjectFilePayload): Promise<void> {
  const manifest = {
    format: 'belegfuchs',
    version: 1,
    app: app.getVersion(),
    savedAt: new Date().toISOString(),
    documents: payload.project.docs.length
  };
  const files: Zippable = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'project.json': strToU8(JSON.stringify(payload.project))
  };
  for (const pdf of payload.pdfs) {
    // PDFs sind meist schon komprimiert – nur speichern
    files[`pdfs/${pdf.id}.pdf`] = [pdf.bytes, { level: 0 }];
  }
  const zipped = zipSync(files, { level: 6 });
  const tmp = `${filePath}.tmp-${process.pid}`;
  await fs.promises.writeFile(tmp, zipped);
  await fs.promises.rename(tmp, filePath);
}

export async function readProject(filePath: string): Promise<ProjectFilePayload> {
  const data = new Uint8Array(await fs.promises.readFile(filePath));
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    throw new Error('Die Datei ist kein gültiges Belegfuchs-Projekt.');
  }
  const projectRaw = entries['project.json'];
  if (!projectRaw) throw new Error('Die Projektdatei ist unvollständig (project.json fehlt).');
  const project = JSON.parse(strFromU8(projectRaw)) as ProjectData;
  if (project.format !== 'belegfuchs-project') throw new Error('Unbekanntes Projektformat.');
  const pdfs = project.docs
    .map((d) => ({ id: d.id, bytes: entries[`pdfs/${d.id}.pdf`] }))
    .filter((p): p is { id: string; bytes: Uint8Array } => Boolean(p.bytes));
  if (!project.name) project.name = path.basename(filePath, `.${PROJECT_EXT}`);
  return { project, pdfs };
}
