// Minimal chat filter (FR + EN insults masked); players can also mute senders.
const WORDS = [
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigger',
  'faggot',
  'retard',
  'putain',
  'merde',
  'connard',
  'connasse',
  'salope',
  'enculé',
  'encule',
  'pute',
  'batard',
  'bâtard',
  'nique',
];
const RE = new RegExp(`\\b(${WORDS.join('|')})\\w*`, 'gi');

export function filterProfanity(text: string): string {
  return text.replace(RE, (m) => m[0] + '*'.repeat(Math.max(2, m.length - 1)));
}
