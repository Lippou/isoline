// Player creation, nation/tribe placement and the spawn phase.
import type { Game } from './state';
import type { Player } from './player';
import { PERSONALITIES } from './player';
import { SPAWN_IMMUNITY_TICKS, SPAWN_RADIUS, START_GOLD, START_TROOPS } from './constants';
import { IS_LAND } from '../map/terrain';
import { inventTribeName } from '../names';
import { hashString } from '../rng';
import { GENERALS } from './config';

export function setupPlayers(game: Game): void {
  const cfg = game.config;
  const rng = game.rng;
  const teams = cfg.mode === 'teams' ? Math.max(2, Math.min(8, cfg.teamCount)) : 0;

  // Humans first (their ids are stable: 1..k in slot order).
  let colorIdx = 0;
  for (const slot of cfg.players) {
    if (slot.spectator) continue;
    if (slot.kind !== 'human') continue;
    const p = game.addPlayer({ fr: slot.name, en: slot.name }, 'human');
    p.slot = slot.slot;
    p.general = slot.general;
    p.team =
      cfg.mode === 'teams'
        ? Math.max(1, Math.min(teams, slot.team || 1))
        : cfg.mode === 'humansVsNations'
          ? 1
          : 0;
    p.color = slot.color ?? colorIdx;
    colorIdx++;
    p.flagSeed = hashString(slot.name + slot.slot);
    p.troops = START_TROOPS.human;
    p.gold = START_GOLD.human;
  }

  // Nations from the map (most important first), placed immediately.
  const nationSpecs = cfg.mode === 'tribes' ? [] : game.map.meta.nations.slice(0, cfg.nations);
  let teamRR = 0;
  for (const spec of nationSpecs) {
    const tile = game.map.idx(spec.x, spec.y);
    if (!IS_LAND[game.map.terrain[tile]!] || game.owner[tile] !== 0) continue;
    const p = game.addPlayer(spec.name, 'nation');
    p.flagSeed = spec.flagSeed;
    p.color = colorIdx++;
    p.personality = PERSONALITIES[spec.flagSeed % PERSONALITIES.length]!;
    p.general = GENERALS[(spec.flagSeed >>> 8) % GENERALS.length]!;
    if (cfg.mode === 'teams') p.team = (teamRR++ % teams) + 1;
    else if (cfg.mode === 'humansVsNations') p.team = 2;
    p.troops = START_TROOPS.nation * game.difficulty().troops;
    p.gold = START_GOLD.nation;
    claimDisc(game, p, tile);
  }
  if (cfg.mode === 'teams') {
    // In team games every member of a team shares the team ink.
    for (const p of game.players) if (p && p.team > 0) p.color = p.team - 1;
  }

  // Tribes on reserved spawn points away from nations.
  const points = rng.shuffle([...game.map.meta.spawnPoints]);
  let tribes = 0;
  for (const [x, y] of points) {
    if (tribes >= cfg.tribes) break;
    const tile = game.map.idx(x, y);
    if (!IS_LAND[game.map.terrain[tile]!] || game.owner[tile] !== 0) continue;
    if (nearOwned(game, tile, 14)) continue;
    const p = game.addPlayer(inventTribeName(rng), 'tribe');
    p.color = -1;
    p.flagSeed = rng.nextU32();
    p.troops = START_TROOPS.tribe;
    claimDisc(game, p, tile, SPAWN_RADIUS - 3);
    tribes++;
  }
}

function nearOwned(game: Game, tile: number, r: number): boolean {
  const w = game.map.width;
  const x0 = tile % w;
  const y0 = (tile / w) | 0;
  for (let dy = -r; dy <= r; dy += 2) {
    for (let dx = -r; dx <= r; dx += 2) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (!game.map.inBounds(x, y)) continue;
      if (game.owner[y * w + x] !== 0) return true;
    }
  }
  return false;
}

/** Claims a land disc around `tile` for player p (free tiles only). */
export function claimDisc(game: Game, p: Player, tile: number, radius = SPAWN_RADIUS): void {
  const w = game.map.width;
  const x0 = tile % w;
  const y0 = (tile / w) | 0;
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = x0 + dx;
      const y = y0 + dy;
      if (!game.map.inBounds(x, y)) continue;
      const i = y * w + x;
      if (!IS_LAND[game.map.terrain[i]!] || game.owner[i] !== 0 || game.isDead(i)) continue;
      // Only claim tiles connected to the same landmass as the centre.
      if (game.map.component[i] !== game.map.component[tile]) continue;
      game.setOwner(i, p.id);
    }
  }
  p.spawned = true;
  p.spawnTile = tile;
}

export function releaseSpawn(game: Game, p: Player): void {
  if (p.spawnTile < 0) return;
  const w = game.map.width;
  const x0 = p.spawnTile % w;
  const y0 = (p.spawnTile / w) | 0;
  const r = SPAWN_RADIUS;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (!game.map.inBounds(x, y)) continue;
      const i = y * w + x;
      if (game.owner[i] === p.id) game.setOwner(i, 0);
    }
  }
  p.spawned = false;
}

export function validSpawnTile(game: Game, tile: number): boolean {
  if (tile < 0 || tile >= game.map.size) return false;
  if (!IS_LAND[game.map.terrain[tile]!] || game.owner[tile] !== 0 || game.isDead(tile)) return false;
  return (game.map.componentSize[game.map.component[tile]!] ?? 0) >= 30;
}

export function handleSpawnCommand(game: Game, p: Player, tile: number): void {
  if (game.phase !== 'spawn' || p.kind !== 'human') return;
  if (!validSpawnTile(game, tile)) return;
  releaseSpawn(game, p);
  claimDisc(game, p, tile);
}

export function updateSpawnPhase(game: Game): void {
  if (game.tick < game.spawnEndTick) return;
  // Humans who did not choose get a random spawn point.
  for (const p of game.players) {
    if (!p || p.kind !== 'human' || p.spawned) continue;
    const pts = game.map.meta.spawnPoints;
    for (let k = 0; k < pts.length * 2; k++) {
      const [x, y] = pts[game.rng.int(0, pts.length - 1)]!;
      const tile = game.map.idx(x, y);
      if (validSpawnTile(game, tile)) {
        claimDisc(game, p, tile);
        break;
      }
    }
  }
  game.phase = 'playing';
  game.startTick = game.tick;
  for (const p of game.players) {
    if (!p) continue;
    if (!p.spawned || p.tiles === 0) {
      p.alive = false;
      continue;
    }
    if (p.kind === 'human') p.immuneUntil = game.tick + SPAWN_IMMUNITY_TICKS;
    p.generalReadyTick = game.tick + 600;
  }
  game.notify(-1, 'event.gameStart', 'good');
}
