// Procedural nation / tribe names (deterministic from an Rng).
import type { Rng } from './rng';
import type { LocalizedName } from './map/gamemap';

const ONSET = [
  'b',
  'br',
  'c',
  'd',
  'dr',
  'f',
  'g',
  'gr',
  'h',
  'k',
  'kr',
  'l',
  'm',
  'n',
  'p',
  'r',
  's',
  'st',
  't',
  'tr',
  'v',
  'z',
  'th',
  'sh',
  'qu',
  'y',
  'ar',
  'el',
  'or',
  'is',
];
const NUCLEUS = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'ou', 'ei', 'au', 'y'];
const CODA = ['', '', '', 'n', 'r', 's', 'l', 'th', 'nd', 'rk', 'm', 'st', 'x'];
const SUFFIX = [
  'ia',
  'or',
  'and',
  'ene',
  'ar',
  'ovia',
  'esh',
  'ara',
  'heim',
  'mark',
  ' istan',
  'ica',
  'ora',
  'eth',
  'is',
  'una',
  'ane',
];

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Pronounceable invented place name, 2–3 syllables + suffix. */
export function inventName(rng: Rng): string {
  const syl = rng.int(1, 2);
  let s = '';
  for (let k = 0; k < syl; k++)
    s += rng.pick(ONSET) + rng.pick(NUCLEUS) + (k === syl - 1 ? '' : rng.pick(CODA));
  s += rng.pick(SUFFIX).trim();
  s = s.replace(/([aeiouy])\1+/g, '$1').replace(/(.)\1\1+/g, '$1$1');
  return capitalise(s.slice(0, 14));
}

const TRIBE_FR = ['Clan', 'Tribu', 'Horde', 'Peuple', 'Confrérie'];
const TRIBE_EN = ['Clan', 'Tribe', 'Horde', 'Folk', 'Brotherhood'];

export function inventNationName(rng: Rng): LocalizedName {
  const n = inventName(rng);
  return { fr: n, en: n };
}

export function inventTribeName(rng: Rng): LocalizedName {
  const k = rng.int(0, TRIBE_FR.length - 1);
  const n = inventName(rng);
  const de = /^[AEIOUYH]/.test(n) ? "d'" : 'de ';
  return { fr: `${TRIBE_FR[k]} ${de}${n}`, en: `${n} ${TRIBE_EN[k]}` };
}
