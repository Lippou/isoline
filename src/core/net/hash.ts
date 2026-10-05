// State hash used to detect lockstep desyncs (every HASH_EVERY ticks) and to
// verify determinism in tests (same seed + same commands = same hash).
import type { Game } from '../game/state';

function mix(h: number, v: number): number {
  h ^= v;
  h = Math.imul(h, 0x01000193);
  return h >>> 0;
}

function hashBytes(h: number, a: Uint8Array | Uint16Array | Int32Array): number {
  // Hash through 32-bit words when aligned, bytes for the tail.
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const words = Math.floor(bytes.byteLength / 4);
  if (a.byteOffset % 4 === 0) {
    const u32 = new Uint32Array(a.buffer, a.byteOffset, words);
    for (let i = 0; i < words; i++) {
      h ^= u32[i]!;
      h = Math.imul(h, 0x01000193);
      h ^= h >>> 15;
    }
  } else {
    for (let i = 0; i < words * 4; i++) h = mix(h, bytes[i]!);
  }
  for (let i = words * 4; i < bytes.byteLength; i++) h = mix(h, bytes[i]!);
  return h >>> 0;
}

const q = (v: number) => Math.round(v * 16) | 0;

export function hashGame(game: Game): number {
  let h = 0x811c9dc5;
  h = mix(h, game.tick);
  h = hashBytes(h, game.owner);
  h = hashBytes(h, game.fallout);
  h = hashBytes(h, game.flags);
  for (const s of game.rng.getState()) h = mix(h, s);
  for (const p of game.players) {
    if (!p) continue;
    h = mix(h, p.id);
    h = mix(h, p.alive ? 1 : 0);
    h = mix(h, q(p.troops));
    h = mix(h, q(p.gold));
    h = mix(h, p.tiles);
    h = mix(h, p.border.length);
    h = mix(mix(h, p.capital + 1), p.disorgUntil + 1);
    h = mix(mix(h, p.researching + 1), q(p.researchPoints));
    for (let k = 0; k < p.tech.length; k++) h = mix(h, p.tech[k]!);
    // Revolutions (rules/revolution.ts): the rebels' clock, the countries' cooldown, the
    // barricades and the contagion.
    h = mix(mix(mix(h, p.revolution ? 1 : 0), p.revoltUntil + 1), p.revoltReadyTick);
    h = mix(mix(mix(mix(h, p.revoltStart + 1), p.revoltSpreadAt + 1), p.revoltLand), q(p.revoltDensity));
    for (const [a, e] of p.allies) h = mix(mix(h, a), e);
  }
  for (const a of game.attacks) h = mix(mix(mix(h, a.id), q(a.troops)), a.frontierSize);
  for (const b of game.buildings.values()) {
    h = mix(mix(mix(mix(mix(mix(h, b.id), b.owner), b.level), b.buildLeft), b.upgradeLeft), b.occupiedLeft);
    h = mix(h, b.demolishLeft);
  }
  for (const u of game.units) h = mix(mix(mix(mix(h, u.id), u.owner), q(u.x)), q(u.y));
  h = mix(h, game.rails.length);
  return h >>> 0;
}

/** Cheap hash of only the per-tile ownership (for quick diagnostics). */
export function hashOwners(game: Game): number {
  return hashBytes(0x811c9dc5, game.owner);
}
