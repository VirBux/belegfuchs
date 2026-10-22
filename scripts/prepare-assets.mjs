// Bereitet Build-Ressourcen vor: OCR-Sprachdaten kopieren, Programm- und Dateisymbole erzeugen.
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tessDir = path.join(root, 'resources', 'tessdata');
const buildDir = path.join(root, 'build');
// Über die Modulauflösung suchen, damit auch Worktrees ohne eigenes node_modules die Daten finden
const require = createRequire(import.meta.url);

fs.mkdirSync(tessDir, { recursive: true });
for (const lang of ['deu', 'eng', 'fra', 'ita']) {
  const pkgDir = path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
  const src = path.join(pkgDir, '4.0.0_best_int', `${lang}.traineddata.gz`);
  const dst = path.join(tessDir, `${lang}.traineddata.gz`);
  if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
  console.log(`tessdata: ${lang} (${(fs.statSync(dst).size / 1e6).toFixed(1)} MB)`);
}

function renderPng(svgFile, size) {
  const svg = fs.readFileSync(path.join(buildDir, svgFile), 'utf8');
  return new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' }).render().asPng();
}

const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
fs.writeFileSync(path.join(buildDir, 'icon.png'), renderPng('icon.svg', 512));
fs.writeFileSync(path.join(buildDir, 'icon.ico'), await pngToIco(sizes.map((s) => renderPng('icon.svg', s))));
fs.writeFileSync(path.join(buildDir, 'fuchs-file.ico'), await pngToIco(sizes.map((s) => renderPng('file-icon.svg', s))));
console.log('Symbole erzeugt: build/icon.png, build/icon.ico, build/fuchs-file.ico');
