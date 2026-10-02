// Names of the real flags offered by the flag picker, in French and English.
// ISO 3166 regions come from Intl.DisplayNames; flag-icons' regional and
// organisation codes (no ISO region) are named here.
import type { Lang } from '../i18n/i18n.svelte';

const EXTRA: Record<string, { fr: string; en: string }> = {
  'sh-ac': { fr: 'Île de l’Ascension', en: 'Ascension Island' },
  asean: { fr: 'ASEAN', en: 'ASEAN' },
  'es-pv': { fr: 'Pays basque', en: 'Basque Country' },
  ic: { fr: 'Îles Canaries', en: 'Canary Islands' },
  'es-ct': { fr: 'Catalogne', en: 'Catalonia' },
  cefta: { fr: 'ALECE', en: 'CEFTA' },
  cp: { fr: 'Île Clipperton', en: 'Clipperton Island' },
  dg: { fr: 'Diego Garcia', en: 'Diego Garcia' },
  eac: { fr: 'Communauté d’Afrique de l’Est', en: 'East African Community' },
  'gb-eng': { fr: 'Angleterre', en: 'England' },
  eu: { fr: 'Union européenne', en: 'European Union' },
  'es-ga': { fr: 'Galice', en: 'Galicia' },
  xk: { fr: 'Kosovo', en: 'Kosovo' },
  arab: { fr: 'Ligue arabe', en: 'Arab League' },
  'gb-nir': { fr: 'Irlande du Nord', en: 'Northern Ireland' },
  pc: { fr: 'Communauté du Pacifique', en: 'Pacific Community' },
  'sh-hl': { fr: 'Sainte-Hélène', en: 'Saint Helena' },
  'gb-sct': { fr: 'Écosse', en: 'Scotland' },
  'sh-ta': { fr: 'Tristan da Cunha', en: 'Tristan da Cunha' },
  un: { fr: 'Nations unies', en: 'United Nations' },
  'gb-wls': { fr: 'Pays de Galles', en: 'Wales' },
};

const displays = new Map<Lang, Intl.DisplayNames | null>();
function display(lang: Lang): Intl.DisplayNames | null {
  if (!displays.has(lang)) {
    try {
      displays.set(lang, new Intl.DisplayNames([lang], { type: 'region', fallback: 'none' }));
    } catch {
      displays.set(lang, null);
    }
  }
  return displays.get(lang)!;
}

/** Localised name of a flag code (falls back to the upper-case code). */
export function flagName(code: string, lang: Lang): string {
  const extra = EXTRA[code];
  if (extra) return extra[lang];
  if (/^[a-z]{2}$/.test(code)) {
    try {
      const n = display(lang)?.of(code.toUpperCase());
      if (n) return n;
    } catch {
      /* unknown region */
    }
  }
  return code.toUpperCase();
}

/** Lower-case, accent-free form for searching ("Côte d’Ivoire" ← "cote d'ivoire"). */
export function foldSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, "'")
    .toLowerCase();
}
