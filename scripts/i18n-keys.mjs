// Lists every i18n key referenced in the sources (static t('…') calls + simulation
// notify keys + dynamic families) and reports keys missing from fr.json / en.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|svelte)$/.test(f)) files.push(p);
  }
})(path.join(root, 'src'));

const keys = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\bt\(\s*'([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
  for (const m of s.matchAll(/notify\([^,]+,\s*'([a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
  for (const m of s.matchAll(/notify\([^,]+,\s*`([a-zA-Z0-9_.]+)\.\$\{/g)) keys.add(m[1] + '.*');
}
const flatten = (o, p = '', out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else flatten(v, key, out);
  }
  return out;
};
const fr = flatten(JSON.parse(fs.readFileSync(path.join(root, 'src/ui/i18n/fr.json'), 'utf8')));
const en = flatten(JSON.parse(fs.readFileSync(path.join(root, 'src/ui/i18n/en.json'), 'utf8')));
const missing = { fr: [], en: [] };
for (const k of [...keys].sort()) {
  if (k.endsWith('.*')) continue;
  if (!(k in fr)) missing.fr.push(k);
  if (!(k in en)) missing.en.push(k);
}
const onlyFr = Object.keys(fr).filter((k) => !(k in en));
const onlyEn = Object.keys(en).filter((k) => !(k in fr));
console.log(
  JSON.stringify({ used: keys.size, missingFr: missing.fr, missingEn: missing.en, onlyFr, onlyEn }, null, 1),
);
process.exitCode = missing.fr.length || missing.en.length || onlyFr.length || onlyEn.length ? 1 : 0;
