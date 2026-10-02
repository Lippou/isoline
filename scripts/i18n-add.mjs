// Adds or overwrites translation keys in both languages from a JSON patch file:
//   node scripts/i18n-add.mjs patch.json   with { "fr": { "a.b": "…" }, "en": { "a.b": "…" } }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const patch = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const lang of ['fr', 'en']) {
  const file = path.join(root, 'src/ui/i18n', `${lang}.json`);
  const dict = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(patch[lang] ?? {})) {
    const parts = key.split('.');
    let o = dict;
    for (const p of parts.slice(0, -1)) o = o[p] ??= {};
    o[parts.at(-1)] = value;
  }
  fs.writeFileSync(file, JSON.stringify(dict, null, 2) + '\n');
}
console.log('i18n updated');
