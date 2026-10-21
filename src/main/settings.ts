import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS } from '../shared/models';
import type { Settings } from '../shared/types';

let cache: Settings | null = null;

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function getSettings(): Settings {
  if (!cache) {
    try {
      cache = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
    } catch {
      cache = { ...DEFAULT_SETTINGS };
    }
  }
  return cache!;
}

export function updateSettings(partial: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...partial };
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.error('Einstellungen konnten nicht gespeichert werden', err);
  }
  return cache;
}
