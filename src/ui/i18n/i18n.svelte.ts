// Reactive i18n: t('key', {param}) with French and English dictionaries.
import fr from './fr.json';
import en from './en.json';
import { phone } from '../tactile';

export type Lang = 'fr' | 'en';
type Dict = Record<string, string>;
const DICTS: Record<Lang, Dict> = { fr: flatten(fr), en: flatten(en) };

/**
 * A phone (tactile.ts) plays with a finger: the texts that speak of clicks, the right button,
 * the wheel or keys have a touch wording under `phone.` (the same key after it), used instead.
 * Never on a computer, a tablet or in the desktop app.
 */
if (phone)
  for (const d of Object.values(DICTS))
    for (const [k, v] of Object.entries(d)) if (k.startsWith('phone.')) d[k.slice(6)] = v;

/**
 * The browser version plays together online, through the Binotech server, not on a local
 * network: the texts about it are under `web.`. Never in the desktop app.
 */
if (typeof window !== 'undefined' && !window.isoline)
  for (const d of Object.values(DICTS))
    for (const [k, v] of Object.entries(d)) if (k.startsWith('web.')) d[k.slice(4)] = v;

function flatten(obj: unknown, prefix = '', out: Dict = {}): Dict {
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

export const i18n = $state<{ lang: Lang }>({ lang: navigator.language?.startsWith('fr') ? 'fr' : 'en' });

const missing = new Set<string>();

export function t(key: string, params?: Record<string, string | number>): string {
  const d = DICTS[i18n.lang];
  let s = d[key] ?? DICTS.en[key];
  if (s === undefined) {
    if (!missing.has(key)) {
      missing.add(key);
      if (import.meta.env.DEV) console.warn(`[i18n] missing key ${key}`);
    }
    return key;
  }
  if (params)
    s = s.replace(/\{(\w+)\}/g, (_, p: string) => (params[p] !== undefined ? String(params[p]) : `{${p}}`));
  return s;
}

export function has(key: string): boolean {
  return key in DICTS[i18n.lang] || key in DICTS.en;
}

/** The number formatters, by language and decimals (made once: the HUD writes figures every frame). */
const formats = new Map<string, Intl.NumberFormat>();
function numberFormat(digits: number): Intl.NumberFormat {
  const locale = i18n.lang === 'fr' ? 'fr-FR' : 'en-US';
  const key = `${locale}|${digits}`;
  let nf = formats.get(key);
  if (!nf) formats.set(key, (nf = new Intl.NumberFormat(locale, { maximumFractionDigits: digits })));
  return nf;
}

/** Locale-aware number formatting. */
export function num(v: number, digits = 0): string {
  return numberFormat(digits).format(v);
}

/** Abbreviated amounts: 125k, 1,2M (locale decimal separator). */
export function short(v: number): string {
  const a = Math.abs(v);
  const f = (x: number, d: number) => numberFormat(d).format(x);
  if (a >= 1e9) return f(v / 1e9, a >= 1e10 ? 0 : 1) + (i18n.lang === 'fr' ? ' Md' : 'B');
  if (a >= 1e6) return f(v / 1e6, a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return f(v / 1e3, a >= 1e4 ? 0 : 1) + 'k';
  return f(v, 0);
}

export function date(ms: number): string {
  return new Intl.DateTimeFormat(i18n.lang === 'fr' ? 'fr-FR' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ms));
}

export function clock(ticks: number): string {
  const s = Math.max(0, Math.floor(ticks / 10));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function allKeys(lang: Lang): string[] {
  return Object.keys(DICTS[lang]);
}
