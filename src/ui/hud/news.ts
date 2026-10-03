// The news: turns the journal's notices into newspaper stories (headlines with a
// deck, or briefs) and writes the special edition of a fallen country.
import { t, i18n } from '../i18n/i18n.svelte';
import type { Fall, LogEntry } from '../stores/game.svelte';
import type { WorldEventId } from '../../core/rules/features';
import { hasPressPhoto } from './pressPhotos';

export type Tone = LogEntry['level'];

export interface Story {
  entry: LogEntry;
  /** 0: a brief; higher: a headline, the highest leads its minute. */
  weight: number;
  title: string;
  deck: string;
  /** Countries pictured next to the headline (flags). */
  flags: number[];
  /** A world event's press photo (pressPhotos.ts). */
  photo?: WorldEventId;
}

type Name = (id: number) => string;

const num = (v: string | number | undefined) => (typeof v === 'number' ? v : Number(v ?? 0));

/** "1st", "2nd"… / "1re", "2e"… (a nation: feminine in French). */
export function ordinal(n: number): string {
  if (i18n.lang === 'fr') return n === 1 ? '1re' : `${n}e`;
  const s = new Intl.PluralRules('en-US', { type: 'ordinal' }).select(n);
  return `${n}${{ one: 'st', two: 'nd', few: 'rd' }[s as 'one'] ?? 'th'}`;
}

/** A game duration in words: "14 min", "40 s". */
export function span(ticks: number): string {
  const s = Math.max(0, Math.round(ticks / 10));
  return s >= 60 ? t('news.min', { n: Math.floor(s / 60) }) : t('news.sec', { n: s });
}

/** "France, Spain and 2 others". */
export function nameList(names: string[], max = 3): string {
  const list =
    names.length > max ? [...names.slice(0, max), t('news.others', { n: names.length - max })] : names;
  return new Intl.ListFormat(i18n.lang === 'fr' ? 'fr-FR' : 'en-GB', { type: 'conjunction' }).format(list);
}

/** Headline and deck of a fall: who, how, and by whose hand. */
export function fallHead(f: Pick<Fall, 'player' | 'by' | 'cause'>, name: Name) {
  const by = f.by > 0 ? name(f.by) : '';
  const deckKey = f.cause === 'nuked' && !by ? 'news.fall.deck.nukedUnknown' : `news.fall.deck.${f.cause}`;
  return { title: t(`news.fall.title.${f.cause}`, { name: name(f.player) }), deck: t(deckKey, { by }) };
}

/** The line of copy under it: the how-manyth fall, and when. */
export const fallBody = (f: Pick<Fall, 'at' | 'nth'>) =>
  t('news.fall.body', { nth: ordinal(f.nth), time: span(f.at) });

/** Notices kept out of the paper: refused orders are for the toasts only. */
export const inPaper = (e: LogEntry) => !e.key?.startsWith('error.');

/** How newsworthy each notice is: 0 makes a brief; the heaviest headline leads its minute. */
const WEIGHT: Record<string, number> = {
  'event.eliminated': 100,
  'alert.nuke': 90,
  'alert.mirv': 90,
  'event.betrayal': 80,
  'notify.capitalLost': 85,
  'notify.capitalRazed': 85,
  'notify.capitalTaken': 75,
  'notify.secession': 70,
  'event.capitalFell': 65,
  'event.capitalRazed': 65,
  'council.sanctions': 55,
  'council.nukeBan': 55,
  'council.ceasefire': 55,
  'event.doomsdayStep': 50,
  'event.ringShrink': 50,
  'notify.allianceFormed': 40,
  'event.gameStart': 30,
};
export const weightOf = (key = '') => (key.startsWith('worldEvent.') ? 60 : (WEIGHT[key] ?? 0));

/** Headline and deck of a notice (a brief keeps its own text as the title). */
function headline(key: string, p: Record<string, string | number>, name: Name): [string, string, number[]] {
  if (key.startsWith('worldEvent.')) {
    const id = key.slice('worldEvent.'.length);
    return [t(`worldEvent.${id}.title`), t(`worldEvent.${id}.desc`), []];
  }
  switch (key) {
    case 'event.eliminated': {
      const player = num(p.player);
      const cause = (p.cause as Fall['cause'] | undefined) ?? 'conquered';
      const c = fallHead({ player, by: num(p.by), cause }, name);
      return [c.title, c.deck, [player]];
    }
    case 'alert.nuke':
    case 'alert.mirv':
      return [
        t(key === 'alert.nuke' ? 'news.head.nuke' : 'news.head.mirv', { by: name(num(p.by)) }),
        '',
        [num(p.by)],
      ];
    case 'event.betrayal': {
      const [a, b] = [num(p.traitor), num(p.victim)];
      const names = { traitor: name(a), victim: name(b) };
      return [t('news.head.betrayal', names), t('news.deck.betrayal', names), [a, b]];
    }
    case 'notify.secession':
      return [t('news.head.secession', { tiles: num(p.tiles) }), t('news.deck.secession'), []];
    // Capitals (rules/capital.ts): ours lost or razed, one we took, one falling elsewhere.
    case 'notify.capitalLost':
      return [
        t('news.head.capitalLost', { by: name(num(p.by)) }),
        t('news.deck.capitalLost', { gold: num(p.gold).toLocaleString(i18n.lang) }),
        [num(p.by)],
      ];
    case 'notify.capitalRazed':
      return [t('news.head.capitalRazed'), t('news.deck.capitalRazed'), []];
    case 'notify.capitalTaken':
      return [
        t('news.head.capitalTaken', { player: name(num(p.player)) }),
        t('news.deck.capitalTaken', { gold: num(p.gold).toLocaleString(i18n.lang) }),
        [num(p.player)],
      ];
    case 'event.capitalFell':
      return [
        t('news.head.capitalFell', { player: name(num(p.player)), by: name(num(p.by)) }),
        t('news.deck.capitalFell'),
        [num(p.player), num(p.by)],
      ];
    case 'event.capitalRazed':
      return [
        t('news.head.capitalRazedOther', { player: name(num(p.player)) }),
        t('news.deck.capitalFell'),
        [num(p.player)],
      ];
    case 'council.sanctions':
      return [
        t('news.head.councilSanctions', { target: name(num(p.target)) }),
        t('news.deck.councilSanctions'),
        [num(p.target)],
      ];
    case 'council.nukeBan':
      return [t('news.head.councilNukeBan'), t('news.deck.councilNukeBan'), []];
    case 'council.ceasefire':
      return [t('news.head.councilCeasefire'), t('news.deck.councilCeasefire'), []];
    case 'event.doomsdayStep':
      return [t('news.head.doomsday', { share: num(p.share) }), t('news.deck.doomsday'), []];
    case 'event.ringShrink':
      return [t('news.head.ring'), t('news.deck.ring'), []];
    case 'notify.allianceFormed':
      return [t('news.head.alliance', { with: name(num(p.with)) }), '', [num(p.with)]];
    case 'event.gameStart':
      return [t('news.head.gameStart'), t('news.deck.gameStart'), []];
  }
  return ['', '', []];
}

/** Classify a journal notice: a headline (with its deck and flags) or a brief. */
export function storyOf(e: LogEntry, name: Name): Story {
  const weight = weightOf(e.key);
  if (weight === 0) return { entry: e, weight, title: e.text, deck: '', flags: [] };
  const [title, deck, flags] = headline(e.key ?? '', e.params ?? {}, name);
  const event = e.key?.startsWith('worldEvent.') ? e.key.slice('worldEvent.'.length) : '';
  const photo = hasPressPhoto(event) ? { photo: event } : {};
  return { entry: e, weight, title: title || e.text, deck, flags, ...photo };
}

/** Section heading of a minute of play: "13e minute" / "Minute 13". */
export function minuteLabel(m: number): string {
  return m === 0 ? t('news.minuteFirst') : t('news.minute', { n: m + 1 });
}
