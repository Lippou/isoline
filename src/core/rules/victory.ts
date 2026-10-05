// Win conditions and mode-specific pressure (overtime, doomsday clock, battle royale).
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import {
  DOOM_MIDNIGHT,
  DOOM_NUKE_DISCOUNT,
  DOOM_PUSH,
  DOOM_RATION,
  DOOM_STAGES,
  DOOM_SURVIVAL_FFA,
  DOOM_SURVIVAL_TEAMS,
  DOOM_UNIT,
  N,
  OVERTIME_START,
  OVERTIME_STEP,
  OVERTIME_THRESHOLDS,
  ROYALE_CANDIDATES,
  ROYALE_CLOSE,
  ROYALE_FINAL,
  ROYALE_FIRST,
  ROYALE_LAND_KEEP,
  ROYALE_MIN,
  ROYALE_SHRINK,
  ROYALE_SWEEP,
  ROYALE_WAIT,
} from '../game/constants';
import { U } from '../units/unit';
import { Rng } from '../rng';
import { HARSH, IS_LAND } from '../map/terrain';
import { breakAlliance } from './diplomacy';

/**
 * Battle royale (GAME_DESIGN.md §14.1). The safe zone in force is (cx, cy, r); the next
 * one, announced, is (nx, ny, nr), inside it. From `closeAt` the circle slides and shrinks
 * to the next one over ROYALE_CLOSE, and the land it leaves dies.
 */
export interface RingState {
  cx: number;
  cy: number;
  r: number;
  nx: number;
  ny: number;
  nr: number;
  /** Tick the next closing starts. */
  closeAt: number;
  /** Closings done, out of `steps`. */
  step: number;
  steps: number;
  /** Once the last zone has closed: the tick the game ends (-1 before). */
  endAt: number;
  /** Sweep cursor over the bounding box of the zone in force. */
  cursor: number;
}

/** A push of the doomsday clock (the HUD shows the last ones). */
export interface DoomPush {
  tick: number;
  /** Clock seconds (negative: pulled back). */
  secs: number;
  why: keyof typeof DOOM_PUSH;
  /** Who did it (0: nobody in particular). */
  by: number;
}

/** Doomsday clock (GAME_DESIGN.md §14.2). */
export interface DoomState {
  /** Clock units gone since the start (DOOM_UNIT per clock second; one per tick at rest). */
  units: number;
  /** Milestones passed (0..DOOM_STAGES.length). */
  stage: number;
  /** The last pushes, oldest first. */
  pushes: DoomPush[];
}

export interface VictoryState {
  winner: number;
  winnerTeam: number;
  threshold: number;
  reason: string;
  /** Tick at which the match ended (absent until then). */
  endTick?: number;
  /**
   * Play resumed after the end ("keep playing"): no victory is checked any more, the
   * recorded winner, team, reason and end tick stay as they were.
   */
  continued?: boolean;
  /** Doomsday: the share (percent) under which troops melt, -1 while not in force. */
  doomsday?: number;
  doom?: DoomState;
  /** Battle royale zone. */
  ring?: RingState;
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
  // Above 100 %: sandbox without territorial victory (no overtime either).
  if (th > 100) return th;
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
  game.victory.endTick = game.tick;
  game.phase = 'ended';
  game.emit({ k: 'gameOver', winner, team, reason });
}

/**
 * "Keep playing" after the end of the match: back to 'playing' as a sandbox, with the
 * recorded result kept and no further victory. Returns false unless the match had ended.
 */
export function continueAfterVictory(game: Game, by: number): boolean {
  if (game.phase !== 'ended') return false;
  game.victory.continued = true;
  game.phase = 'playing';
  game.emit({ k: 'gameContinued', by });
  return true;
}

function leader(game: Game): Player | null {
  let best: Player | null = null;
  for (const p of game.alivePlayers()) if (!best || p.usefulTiles > best.usefulTiles) best = p;
  return best;
}

/** The largest country or team (tribes aside), as [winner, team]: the end of a timed mode. */
function largest(game: Game): [number, number] {
  const land = new Map<number, number>();
  for (const p of game.alivePlayers()) {
    if (p.kind === 'tribe') continue;
    const key = p.team > 0 ? -p.team : p.id;
    land.set(key, (land.get(key) ?? 0) + p.usefulTiles);
  }
  let key = 0;
  let most = -1;
  for (const [k, v] of land)
    if (v > most || (v === most && k < key)) {
      key = k;
      most = v;
    }
  if (most < 0) return [-1, -1];
  if (key > 0) return [key, game.players[key]!.team];
  let best: Player | null = null;
  for (const p of game.alivePlayers())
    if (p.team === -key && p.kind !== 'tribe' && (!best || p.usefulTiles > best.usefulTiles)) best = p;
  return [best ? best.id : -1, -key];
}

export function updateVictory(game: Game): void {
  if (game.phase !== 'playing') return;
  const mode = game.config.mode;
  if (mode === 'doomsday') updateDoomsday(game);
  if (mode === 'battleRoyale') updateBattleRoyale(game);
  if (game.phase !== 'playing') return; // midnight, or the last zone
  if (game.tick % 10 !== 0) return;

  const th = currentThreshold(game);
  game.victory.threshold = th;
  if (mode === 'campaign') return; // objectives drive the end
  if (game.victory.continued) return; // sandbox after the victory

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
  // Battle royale: no territorial victory, the zone decides (the last one standing, or the
  // largest in the last zone).
  if (mode === 'battleRoyale') return;
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
/** Milestones passed on the doomsday clock (0 outside the mode). */
export function doomStage(game: Game): number {
  return game.config.mode === 'doomsday' ? (game.victory.doom?.stage ?? 0) : 0;
}

/** Rationing: passive income × this. */
export function doomIncomeMult(game: Game): number {
  return doomStage(game) >= 2 ? DOOM_RATION : 1;
}

/** Arms race: bombs cost × this. */
export function doomNukeMult(game: Game): number {
  return doomStage(game) >= 1 ? 1 - DOOM_NUKE_DISCOUNT : 1;
}

/** Last minute: no alliance may be signed any more. */
export function pactsFrozen(game: Game): boolean {
  return doomStage(game) >= 4;
}

/** Survival of the strongest: the share (%) under which troops melt, -1 while not in force. */
export function doomSurvivalShare(game: Game): number {
  const stage = doomStage(game);
  if (stage < 3) return -1;
  const table = game.players.some((p) => p && p.team > 0) ? DOOM_SURVIVAL_TEAMS : DOOM_SURVIVAL_FFA;
  return table[stage >= 4 ? 1 : 0];
}

function pushDoom(game: Game, d: DoomState, why: keyof typeof DOOM_PUSH, by: number): void {
  const secs = DOOM_PUSH[why];
  d.units += secs * DOOM_UNIT;
  // The same cause twice in a tick (a salvo, a MIRV's fall): one line, the seconds added up.
  const last = d.pushes[d.pushes.length - 1];
  if (last && last.tick === game.tick && last.why === why && last.by === by) last.secs += secs;
  else {
    d.pushes.push({ tick: game.tick, secs, why, by });
    if (d.pushes.length > 4) d.pushes.shift();
  }
}

/** What happened this tick that moves the clock (read from the tick's events). */
function readPushes(game: Game, d: DoomState): void {
  for (const e of game.events) {
    switch (e.k) {
      case 'explosion':
        if (e.kind === N.Atom) pushDoom(game, d, 'atom', e.owner);
        else if (e.kind === N.Hydrogen) pushDoom(game, d, 'hydrogen', e.owner);
        break;
      case 'nukeLaunch':
        if (e.kind === N.Mirv) pushDoom(game, d, 'mirv', e.owner);
        break;
      case 'eliminated':
        if (game.players[e.player]?.kind !== 'tribe') pushDoom(game, d, 'fall', e.by > 0 ? e.by : 0);
        break;
      case 'betrayal':
        pushDoom(game, d, 'betrayal', e.traitor);
        break;
      case 'worldEvent':
        if (e.id === 'crisis') pushDoom(game, d, 'crisis', 0);
        else if (e.id === 'peaceSummit') pushDoom(game, d, 'peace', 0);
        else if (e.id === 'armsRace') pushDoom(game, d, 'rearm', 0);
        else if (e.id === 'worldGames') pushDoom(game, d, 'games', 0);
        break;
      case 'council':
        // The Council's nuclear ban (1) or ceasefire (2).
        if (e.phase === 'result' && (e.option === 1 || e.option === 2)) pushDoom(game, d, 'council', 0);
        break;
    }
  }
  // The nuclear pushes and the pull-backs make the news (falls and betrayals have their own).
  for (const p of d.pushes) {
    if (p.tick !== game.tick || p.why === 'fall' || p.why === 'betrayal') continue;
    const key = p.secs < 0 ? 'event.doomPull' : p.by > 0 ? 'event.doomPushBy' : 'event.doomPush';
    const params: Record<string, string | number> = { secs: Math.abs(p.secs), why: p.why };
    if (p.by > 0) params.by = p.by;
    game.notify(-1, key, p.secs > 0 ? 'warn' : 'good', params);
  }
}

function enterDoomStage(game: Game, stage: number): void {
  game.notify(-1, 'event.doomStage', 'warn', { stage, share: Math.max(0, doomSurvivalShare(game)) });
  if (stage !== 4) return;
  // The last minute: every pact is torn up (no traitor), no offer stands.
  for (const p of game.alivePlayers()) {
    for (const id of [...p.allies.keys()]) {
      const q = game.players[id];
      if (q) breakAlliance(game, p, q, true);
    }
    p.allyRequests.clear();
  }
}

function updateDoomsday(game: Game): void {
  let d = game.victory.doom;
  if (!d) {
    d = { units: 0, stage: 0, pushes: [] };
    game.victory.doom = d;
  }
  const midnight = DOOM_MIDNIGHT * DOOM_UNIT;
  if (d.units < midnight) {
    d.units++;
    readPushes(game, d);
    // Pulled back, never beyond a milestone already passed.
    const floor = d.stage > 0 ? DOOM_STAGES[d.stage - 1]! * DOOM_UNIT : 0;
    d.units = Math.min(midnight, Math.max(floor, d.units));
    while (d.stage < DOOM_STAGES.length && d.units >= DOOM_STAGES[d.stage]! * DOOM_UNIT) {
      d.stage++;
      enterDoomStage(game, d.stage);
    }
    if (d.units >= midnight) {
      game.notify(-1, 'event.midnight', 'danger');
      if (!game.victory.continued) {
        const [winner, team] = largest(game);
        end(game, winner, team, 'midnight');
        return;
      }
    }
  }
  const need = doomSurvivalShare(game);
  game.victory.doomsday = need;
  if (need < 0 || game.tick % 10 !== 0) return;
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
/** The circle in force at `tick` (sliding towards the next zone during a closing). */
export function liveRing(
  ring: Pick<RingState, 'cx' | 'cy' | 'r' | 'nx' | 'ny' | 'nr' | 'closeAt' | 'endAt'>,
  tick: number,
): [number, number, number] {
  if (ring.endAt >= 0 || tick <= ring.closeAt) return [ring.cx, ring.cy, ring.r];
  const f = Math.min(1, (tick - ring.closeAt) / ROYALE_CLOSE);
  return [
    ring.cx + (ring.nx - ring.cx) * f,
    ring.cy + (ring.ny - ring.cy) * f,
    ring.r + (ring.nr - ring.r) * f,
  ];
}

/** Battle royale: the tile lies outside the announced next zone (it dies at the next closing). */
export function outsideNextZone(game: Game, tile: number): boolean {
  const ring = game.victory.ring;
  if (!ring || game.config.mode !== 'battleRoyale') return false;
  const w = game.map.width;
  const dx = (tile % w) + 0.5 - ring.nx;
  const dy = ((tile / w) | 0) + 0.5 - ring.ny;
  return dx * dx + dy * dy > ring.nr * ring.nr;
}

/** Zone choice: weight of a glacier or high-peak tile (slow to take, holds nothing to build). */
const ROYALE_HARSH_WEIGHT = 0.4;

/** Land of the zone in force that the living countries can walk to, and its centroid. */
interface Reach {
  /** 1 = reachable on foot. */
  seen: Uint8Array;
  /** Reachable tiles (0: no living country inside the zone). */
  n: number;
  x: number;
  y: number;
}

/**
 * Land of the zone in force (cx, cy, r) that the living countries can reach on foot: a
 * flood fill over live land inside the circle from every tile they hold there. Land cut
 * off by the sea (or by dead land) is only reached by boat.
 */
function reachableLand(game: Game, cx: number, cy: number, r: number): Reach {
  const map = game.map;
  const { width: w, height: h, size } = map;
  const seen = new Uint8Array(size);
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  const r2 = r * r;
  const inside = (i: number): boolean => {
    const dx = (i % w) + 0.5 - cx;
    const dy = ((i / w) | 0) + 0.5 - cy;
    return dx * dx + dy * dy <= r2;
  };
  const open = (i: number): boolean => IS_LAND[map.terrain[i]!] === 1 && !game.isDead(i) && inside(i);
  const queue = new Int32Array(size);
  let qt = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      const o = game.owner[i]!;
      if (o > 0 && game.players[o]!.alive && open(i)) {
        seen[i] = 1;
        queue[qt++] = i;
      }
    }
  const visit = (j: number): void => {
    if (seen[j] || !open(j)) return;
    seen[j] = 1;
    queue[qt++] = j;
  };
  let sx = 0;
  let sy = 0;
  for (let qh = 0; qh < qt; qh++) {
    const i = queue[qh]!;
    const x = i % w;
    sx += x + 0.5;
    sy += (i - x) / w + 0.5;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < size - w) visit(i + w);
  }
  return { seen, n: qt, x: qt > 0 ? sx / qt : cx, y: qt > 0 ? sy / qt : cy };
}

/**
 * Land inside a circle (sampled on a grid of about 60 × 60 points), glaciers and high
 * peaks counting less: [land the countries can walk to, all land].
 */
function landIn(game: Game, cx: number, cy: number, r: number, reach: Uint8Array): [number, number] {
  const map = game.map;
  const s = Math.max(1, Math.floor(r / 30));
  const x0 = Math.max(0, Math.ceil(cx - r));
  const x1 = Math.min(map.width - 1, Math.floor(cx + r));
  const y0 = Math.max(0, Math.ceil(cy - r));
  const y1 = Math.min(map.height - 1, Math.floor(cy + r));
  let walk = 0;
  let all = 0;
  for (let y = y0; y <= y1; y += s) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x += s) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy > r * r) continue;
      const i = y * map.width + x;
      const t = map.terrain[i]!;
      if (!IS_LAND[t] || game.isDead(i)) continue;
      const v = HARSH[t] ? ROYALE_HARSH_WEIGHT : 1;
      all += v;
      if (reach[i]) walk += v;
    }
  }
  return [walk, all];
}

/**
 * Draws the next zone inside the one in force: a random centre (the mode's own PRNG, from
 * the game's seed and the step), among the candidates holding most of the land the
 * countries can walk to — never a zone over open ocean, nor one that pens the survivors
 * behind the sea (land only boats reach counts only when no candidate holds any other)
 * or leaves them a field of ice and peaks. Besides the random candidates, one leans
 * towards the heart of that land, so a zone drifting off it can always come back.
 */
function pickNextZone(game: Game, ring: RingState): void {
  const { width: w, height: h } = game.map;
  const rMin = ROYALE_MIN * Math.min(w, h);
  const nr = ring.step + 1 >= ring.steps ? rMin : Math.max(rMin, ring.r * ROYALE_SHRINK);
  const slack = Math.max(0, ring.r - nr);
  const rng = new Rng((game.config.seed ^ Math.imul(ring.step + 1, 0x9e3779b1)) >>> 0);
  const reach = reachableLand(game, ring.cx, ring.cy, ring.r);
  const cands: [number, number, number, number][] = [];
  const add = (x: number, y: number) => cands.push([x, y, ...landIn(game, x, y, nr, reach.seen)]);
  for (let tries = 0; cands.length < ROYALE_CANDIDATES && tries < 200; tries++) {
    const a = rng.next() * Math.PI * 2;
    const d = Math.sqrt(rng.next()) * slack;
    const x = ring.cx + Math.cos(a) * d;
    const y = ring.cy + Math.sin(a) * d;
    if (x < 0 || y < 0 || x > w || y > h) continue; // the centre stays on the map
    add(x, y);
  }
  if (reach.n > 0) {
    const d = Math.hypot(reach.x - ring.cx, reach.y - ring.cy);
    const k = d > slack ? slack / d : 1;
    add(ring.cx + (reach.x - ring.cx) * k, ring.cy + (reach.y - ring.cy) * k);
  }
  if (cands.length === 0) cands.push([ring.cx, ring.cy, 0, 0]);
  let bestWalk = 0;
  let bestAll = 0;
  for (const c of cands) {
    bestWalk = Math.max(bestWalk, c[2]);
    bestAll = Math.max(bestAll, c[3]);
  }
  const pool = cands.filter((c) =>
    bestWalk > 0 ? c[2] >= bestWalk * ROYALE_LAND_KEEP : c[3] >= bestAll * ROYALE_LAND_KEEP,
  );
  const [x, y] = pool[rng.int(0, pool.length - 1)]!;
  ring.nx = x;
  ring.ny = y;
  ring.nr = nr;
}

function initRing(game: Game): RingState {
  const { width: w, height: h } = game.map;
  const r = Math.hypot(w, h) / 2;
  const rMin = ROYALE_MIN * Math.min(w, h);
  const steps = Math.max(1, Math.ceil(Math.log(r / rMin) / Math.log(1 / ROYALE_SHRINK)));
  const ring: RingState = {
    cx: w / 2,
    cy: h / 2,
    r,
    nx: w / 2,
    ny: h / 2,
    nr: r,
    closeAt: game.tick + ROYALE_FIRST,
    step: 0,
    steps,
    endAt: -1,
    cursor: 0,
  };
  pickNextZone(game, ring);
  return ring;
}

/** Kills the land outside the live circle, a 1/ROYALE_SWEEP of the zone's bounding box per tick. */
function sweepZone(game: Game, ring: RingState): void {
  const map = game.map;
  const w = map.width;
  const [lx, ly, lr] = liveRing(ring, game.tick);
  const x0 = Math.max(0, Math.floor(ring.cx - ring.r));
  const x1 = Math.min(w - 1, Math.ceil(ring.cx + ring.r));
  const y0 = Math.max(0, Math.floor(ring.cy - ring.r));
  const y1 = Math.min(map.height - 1, Math.ceil(ring.cy + ring.r));
  const bw = x1 - x0 + 1;
  const area = bw * (y1 - y0 + 1);
  if (area <= 0) return;
  const chunk = Math.ceil(area / ROYALE_SWEEP);
  const r2 = lr * lr;
  let c = ring.cursor % area;
  for (let k = 0; k < chunk; k++) {
    const x = x0 + (c % bw);
    const y = y0 + ((c / bw) | 0);
    const dx = x + 0.5 - lx;
    const dy = y + 0.5 - ly;
    if (dx * dx + dy * dy > r2) {
      const i = y * w + x;
      if (map.isLand(i) && !game.isDead(i)) game.killTile(i);
    }
    if (++c >= area) c = 0;
  }
  ring.cursor = c;
}

function updateBattleRoyale(game: Game): void {
  let ring = game.victory.ring;
  if (!ring) {
    ring = initRing(game);
    game.victory.ring = ring;
    game.notify(-1, 'event.zoneAnnounced', 'warn', {
      n: 1,
      steps: ring.steps,
      secs: Math.round(ROYALE_FIRST / 10),
    });
  }
  const t = game.tick;
  if (ring.endAt >= 0) {
    // The last zone held: the largest country in it wins.
    if (t === ring.endAt && !game.victory.continued) {
      const [winner, team] = largest(game);
      end(game, winner, team, 'lastZone');
    }
    return;
  }
  if (t < ring.closeAt) return;
  if (t === ring.closeAt)
    game.notify(-1, 'event.zoneClosing', 'warn', { n: ring.step + 1, steps: ring.steps });
  sweepZone(game, ring);
  if (t < ring.closeAt + ROYALE_CLOSE + ROYALE_SWEEP) return;
  ring.cx = ring.nx;
  ring.cy = ring.ny;
  ring.r = ring.nr;
  ring.step++;
  ring.cursor = 0;
  if (ring.step >= ring.steps) {
    ring.endAt = t + ROYALE_FINAL;
    game.notify(-1, 'event.zoneFinal', 'warn', { secs: Math.round(ROYALE_FINAL / 10) });
  } else {
    pickNextZone(game, ring);
    ring.closeAt = t + ROYALE_WAIT;
    game.notify(-1, 'event.zoneAnnounced', 'warn', {
      n: ring.step + 1,
      steps: ring.steps,
      secs: Math.round(ROYALE_WAIT / 10),
    });
  }
}
