// CSV export of end-of-game statistics (one row per player + per-sample timeline).
import type { FinalStats } from '../../engine/protocol';

const esc = (v: string | number) => {
  const s = String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function exportStatsCsv(stats: FinalStats, lang: 'fr' | 'en'): string {
  const lines: string[] = [];
  const keys = Object.keys(stats.players[0]?.stats ?? {}) as (keyof FinalStats['players'][number]['stats'])[];
  lines.push(['player', 'kind', 'team', 'alive', 'tiles', ...keys].map(esc).join(','));
  for (const p of stats.players) {
    lines.push(
      [
        p.name[lang] || p.name.en,
        p.kind,
        p.team,
        p.alive ? 1 : 0,
        p.tiles,
        ...keys.map((k) => Math.round(p.stats[k])),
      ]
        .map(esc)
        .join(','),
    );
  }
  lines.push('');
  lines.push(['player', 'tick', 'tiles', 'gold', 'troops'].join(','));
  for (const p of stats.players) {
    for (const h of p.history)
      lines.push([p.name[lang] || p.name.en, h.tick, h.tiles, h.gold, h.troops].map(esc).join(','));
  }
  return lines.join('\n');
}
