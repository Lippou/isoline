// Win conditions and mode-specific pressure (overtime, doomsday clock, battle royale).
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import {
  BATTLE_ROYALE_STEP,
  DOOMSDAY_FFA,
  DOOMSDAY_GRACE,
  DOOMSDAY_STEP,
  DOOMSDAY_TEAMS,
  OVERTIME_START,
  OVERTIME_STEP,
  OVERTIME_THRESHOLDS,
} from '../game/constants';
import { U } from '../units/unit';

export interface VictoryState {
  winner: number;
  winnerTeam: number;
  threshold: number;
  reason: string;
  /** Doomsday: current minimum share (percent), -1 inactive. */
  doomsday?: number;
  /** Battle royale ring. */
  ring?: { cx: number; cy: number; r: number; nextR: number; nextTick: number; cursor: number };
}

/** Share (0..1) of useful land held by each player/team. */
export function shares(game: Game): Map<number, number> {
  const m = new Map<number, number>();
  const total = Math.max(1, game.usefulLand);
  for (const p of game.alivePlayers()) {
    const key = p.team > 0 ? -p.team : p.id;
    m.set(key, (m.get(key) ?? 0) + p.usefulTiles / total);
  }
  return m;
}

export function currentThreshold(game: Game): number {
  let th = game.config.victoryThreshold;
  if (game.config.mode === 'ffa' && game.phase === 'playing') {
    const elapsed = game.tick - game.startTick;
    if (elapsed >= OVERTIME_START) {
      const k = Math.min(
        OVERTIME_THRESHOLDS.length - 1,
        Math.floor((elapsed - OVERTIME_START) / OVERTIME_STEP),
      );
      th = Math.min(th, OVERTIME_THRESHOLDS[k]!);
    }
  }
  return th;
}

function end(game: Game, winner: number, team: number, reason: string): void {
  game.victory.winner = winner;
  game.victory.winnerTeam = team;
  game.victory.reason = reason;
  game.phase = 'ended';
  game.emit({ k: 'gameOver', winner, team, reason });
}

function leader(game: Game): Player | null {
  let best: Player | null = null;
  for (const p of game.alivePlayers()) if (!best || p.usefulTiles > best.usefulTiles) best = p;
  return best;
}

export function updateVictory(game: Game): void {
  if (game.phase !== 'playing') return;
  const mode = game.config.mode;
  if (mode === 'doomsday') updateDoomsday(game);
  if (mode === 'battleRoyale') updateBattleRoyale(game);
  if (game.tick % 10 !== 0) return;

  const th = currentThreshold(game);
  game.victory.threshold = th;
  if (mode === 'campaign' || mode === 'tutorial') return; // objectives drive the end

  // Last player / team standing (ignoring tribes) — only if the match started with rivals.
  const contenders = [...game.alivePlayers()].filter((p) => p.kind !== 'tribe');
  const teamsAlive = new Set(contenders.map((p) => (p.team > 0 ? -p.team : p.id)));
  const startedWith = new Set(
    game.players
      .filter((p) => p && p.kind !== 'tribe' && p.spawned)
      .map((p) => (p!.team > 0 ? -p!.team : p!.id)),
  );
  if (startedWith.size >= 2 && contenders.length > 0 && teamsAlive.size === 1) {
    const p = contenders[0]!;
    end(game, p.id, p.team, 'lastStanding');
    return;
  }
  // No humans left in a game that had humans → the leader wins.
  const hadHumans = game.players.some((p) => p && p.kind === 'human');
  if (hadHumans && !contenders.some((p) => p.kind === 'human')) {
    const l = leader(game);
    end(game, l ? l.id : -1, l ? l.team : -1, 'humansEliminated');
    return;
  }
  for (const [key, share] of shares(game)) {
    if (share * 100 >= th) {
      if (key < 0) {
        const team = -key;
        const best = contenders
          .filter((p) => p.team === team)
          .sort((a, b) => b.usefulTiles - a.usefulTiles)[0];
        end(game, best ? best.id : -1, team, 'territory');
      } else {
        end(game, key, game.players[key]!.team, 'territory');
      }
      return;
    }
  }
}

// ------------------------------------------------------------- doomsday
function updateDoomsday(game: Game): void {
  const elapsed = game.tick - game.startTick;
  if (elapsed < DOOMSDAY_GRACE) {
    game.victory.doomsday = -1;
    return;
  }
  const table = game.players.some((p) => p && p.team > 0) ? DOOMSDAY_TEAMS : DOOMSDAY_FFA;
  const k = Math.min(table.length - 1, Math.floor((elapsed - DOOMSDAY_GRACE) / DOOMSDAY_STEP));
  const need = table[k]!;
  if (game.victory.doomsday !== need) {
    game.victory.doomsday = need;
    game.notify(-1, 'event.doomsdayStep', 'warn', { share: need });
  }
  if (game.tick % 10 !== 0) return;
  const s = shares(game);
  for (const p of game.alivePlayers()) {
    if (p.kind === 'tribe') continue;
    const share = (s.get(p.team > 0 ? -p.team : p.id) ?? 0) * 100;
    if (share >= need) {
      p.doomsdayWarned = false;
      continue;
    }
    if (!p.doomsdayWarned) {
      p.doomsdayWarned = true;
      game.notify(p.id, 'alert.doomsday', 'danger', { share: need });
      continue;
    }
    // Lose 2 % of troops per second down to a floor of 5 % of the cap.
    const floor = p.popCap * 0.05;
    if (p.troops > floor) p.troops = Math.max(floor, p.troops * 0.98);
    for (const u of game.units)
      if (u.alive && u.owner === p.id && u.type === U.Warship) u.hp -= u.maxHp * 0.02;
  }
}

// -------------------------------------------------------- battle royale
function updateBattleRoyale(game: Game): void {
  const map = game.map;
  let ring = game.victory.ring;
  if (!ring) {
    const r = Math.hypot(map.width, map.height) / 2;
    ring = {
      cx: map.width / 2,
      cy: map.height / 2,
      r,
      nextR: r,
      nextTick: game.tick + BATTLE_ROYALE_STEP,
      cursor: -1,
    };
    game.victory.ring = ring;
  }
  if (game.tick >= ring.nextTick && ring.cursor < 0) {
    ring.nextR = Math.max(Math.min(map.width, map.height) * 0.08, ring.r * 0.8);
    ring.nextTick = game.tick + BATTLE_ROYALE_STEP;
    ring.cursor = 0;
    game.notify(-1, 'event.ringShrink', 'warn');
  }
  if (ring.cursor >= 0) {
    // Kill tiles outside the new radius, ~1/40 of the map per tick.
    const chunk = Math.ceil(map.size / 40);
    const end = Math.min(map.size, ring.cursor + chunk);
    const r2 = ring.nextR * ring.nextR;
    const w = map.width;
    for (let i = ring.cursor; i < end; i++) {
      const x = (i % w) + 0.5 - ring.cx;
      const y = ((i / w) | 0) + 0.5 - ring.cy;
      if (x * x + y * y > r2 && map.isLand(i)) game.killTile(i);
    }
    ring.cursor = end >= map.size ? -1 : end;
    if (ring.cursor < 0) ring.r = ring.nextR;
  }
}
