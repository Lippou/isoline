/// <reference lib="webworker" />
// Dedicated simulation worker: owns the deterministic Game, steps it on each
// turn and streams compact deltas (tiles, units, views, events, fog, labels).
import { Game } from '../core/game/state';
import { GameMap } from '../core/map/gamemap';
import { decodeGreyPng, decodeTerrainPng } from '../core/map/format';
import { generateMapData } from '../core/map/generator';
import { restoreSnapshot, takeSnapshot } from '../core/net/snapshot';
import { hashGame } from '../core/net/hash';
import { B, BUILDING_COUNT, HASH_EVERY, N, RADAR_RANGE } from '../core/game/constants';
import { buildCost, checkPlacement } from '../core/buildings/buildings';
import { warshipCost, planBoat } from '../core/units/ships';
import { maxLaunchable, nukeCost } from '../core/units/nukes';
import { nextTechCost, researchRate } from '../core/rules/tech';
import { resourceBonus } from '../core/rules/resources';
import { isNight } from '../core/rules/features';
import { U } from '../core/units/unit';
import type { Player } from '../core/game/player';
import type {
  BuildingView,
  FinalStats,
  FromWorker,
  LocalView,
  MapSource,
  PlayerView,
  RailView,
  TickUpdate,
  ToWorker,
  WorldView,
} from './protocol';
import { UNIT_STRIDE } from './protocol';
import type { Turn } from '../core/net/commands';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let game: Game | null = null;
let viewer = 0;
let fogEnabled = false;
let loyaltyLayer = false;
let seen: Uint8Array | null = null;
let labels = new Map<number, [number, number, number]>();
let unitBuf = new Float32Array(UNIT_STRIDE * 256);
let lastBuildingSend = -1;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function buildMap(src: MapSource): GameMap {
  if (src.kind === 'builtin') {
    const t = decodeTerrainPng(new Uint8Array(src.terrainPng), src.meta.width, src.meta.height);
    const e = decodeGreyPng(new Uint8Array(src.elevPng), src.meta.width, src.meta.height);
    return new GameMap(src.meta, t, e);
  }
  const d = generateMapData(src.params);
  return new GameMap(d.meta, d.terrain, d.elevation);
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'init': {
        const map = buildMap(msg.map);
        game = msg.snapshot ? restoreSnapshot(map, msg.snapshot) : new Game(map, msg.config);
        viewer = msg.viewer;
        fogEnabled = game.config.features.fog;
        seen = null;
        labels = new Map();
        lastBuildingSend = -1;
        computeLabels(game);
        const ready: FromWorker = {
          type: 'ready',
          meta: map.meta,
          width: map.width,
          height: map.height,
          terrain: map.terrain.slice(),
          elevation: map.elevation.slice(),
          coastDist: map.coastDist.slice(),
          resource: map.resource.slice(),
          owner: game.owner.slice(),
          fallout: game.fallout.slice(),
          flags: game.flags.slice(),
          tick: game.tick,
          phase: game.phase,
          viewer,
        };
        post(ready, [
          ready.terrain.buffer,
          ready.elevation.buffer,
          ready.coastDist.buffer,
          ready.resource.buffer,
          ready.owner.buffer,
          ready.fallout.buffer,
          ready.flags.buffer,
        ]);
        sendUpdate(game, [], [], 0, true);
        break;
      }
      case 'turn':
        if (game) stepTurns([msg.turn]);
        break;
      case 'turns':
        if (game) stepTurns(msg.turns);
        break;
      case 'setViewer':
        viewer = msg.viewer;
        fogEnabled = msg.fogEnabled;
        seen = null;
        if (game) sendUpdate(game, [], [], 0, true);
        break;
      case 'layers':
        loyaltyLayer = msg.loyalty;
        if (game) sendUpdate(game, [], [], 0, false);
        break;
      case 'snapshot':
        if (game) post({ type: 'snapshot', id: msg.id, snapshot: takeSnapshot(game) });
        break;
      case 'query':
        if (game) post({ type: 'answer', id: msg.id, a: answer(game, msg.q) });
        break;
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) });
  }
};

/** Step one or many turns, then send a single merged update. */
function stepTurns(turns: Turn[]): void {
  const g = game!;
  const changed = new Set<number>();
  const state = new Set<number>();
  const events: Game['events'] = [];
  const t0 = performance.now();
  let stepped = 0;
  for (const turn of turns) {
    if (turn.tick !== g.tick) continue; // out-of-order / duplicate turn
    g.step(turn.cmds);
    stepped++;
    for (const t of g.changedTiles) changed.add(t);
    for (const t of g.changedFallout) state.add(t);
    if (turns.length === 1 || events.length < 400) events.push(...g.events);
  }
  if (stepped === 0) return;
  const ms = (performance.now() - t0) / stepped;
  sendUpdate(g, [...changed], [...state], ms, turns.length > 1, events);
}

function sendUpdate(
  g: Game,
  changedTiles: number[],
  stateTiles: number[],
  tickMs: number,
  full: boolean,
  events: Game['events'] = [],
): void {
  const changed = new Uint32Array(changedTiles);
  const owners = new Uint16Array(changed.length);
  for (let k = 0; k < changed.length; k++) owners[k] = g.owner[changed[k]!]!;
  const st = new Uint32Array(stateTiles);
  const sf = new Uint8Array(st.length);
  const sl = new Uint8Array(st.length);
  for (let k = 0; k < st.length; k++) {
    sf[k] = g.fallout[st[k]!]!;
    sl[k] = g.flags[st[k]!]!;
  }
  const unitCount = packUnits(g);
  const units = unitBuf.slice(0, unitCount * UNIT_STRIDE);
  const tick = g.tick;
  const up: TickUpdate = {
    type: 'tick',
    tick,
    phase: g.phase,
    changed,
    owners,
    stateTiles: st,
    stateFallout: sf,
    stateFlags: sl,
    units,
    unitCount,
    events,
    tickMs,
  };
  if (full || tick % 20 === 0) computeLabels(g);
  if (
    full ||
    tick % 5 === 0 ||
    events.some(
      (e) => e.k === 'eliminated' || e.k === 'alliance' || e.k === 'secession' || e.k === 'betrayal',
    )
  ) {
    up.players = playerViews(g);
  }
  up.local = localView(g);
  if (
    full ||
    tick % 5 === 0 ||
    events.some((e) => e.k === 'gameOver' || e.k === 'worldEvent' || e.k === 'council')
  )
    up.world = worldView(g);
  const constructing = [...g.buildings.values()].some((b) => b.buildLeft > 0);
  if (
    full ||
    g.buildingsDirty ||
    (constructing && tick - lastBuildingSend >= 5) ||
    (tick % 10 === 0 && g.buildings.size > 0)
  ) {
    up.buildings = buildingViews(g);
    g.buildingsDirty = false;
    lastBuildingSend = tick;
  }
  if (full || g.railsDirty) {
    up.rails = g.rails
      .filter((r) => r.alive)
      .map((r): RailView => ({ id: r.id, owner: r.owner, tiles: r.tiles }));
    g.railsDirty = false;
  }
  if (fogEnabled && (full || tick % 5 === 0)) up.fog = computeFog(g);
  if (loyaltyLayer && (full || tick % 10 === 0)) up.loyalty = computeLoyalty(g);
  if (tick % HASH_EVERY === 0) up.hash = hashGame(g);
  const transfer: Transferable[] = [
    changed.buffer,
    owners.buffer,
    st.buffer,
    sf.buffer,
    sl.buffer,
    units.buffer,
  ];
  if (up.fog) transfer.push(up.fog.data.buffer);
  if (up.loyalty) transfer.push(up.loyalty.data.buffer);
  post(up, transfer);
}

function packUnits(g: Game): number {
  let n = 0;
  for (const u of g.units) {
    if (!u.alive) continue;
    if (u.type === U.Nuke && g.tick < u.t0) continue;
    if ((n + 1) * UNIT_STRIDE > unitBuf.length) {
      const nb = new Float32Array(unitBuf.length * 2);
      nb.set(unitBuf);
      unitBuf = nb;
    }
    const o = n * UNIT_STRIDE;
    unitBuf[o] = u.id;
    unitBuf[o + 1] = u.type;
    unitBuf[o + 2] = u.owner;
    unitBuf[o + 3] = u.x;
    unitBuf[o + 4] = u.y;
    unitBuf[o + 5] = u.maxHp > 0 ? u.hp / u.maxHp : 1;
    unitBuf[o + 6] = u.kind;
    unitBuf[o + 7] = u.level;
    unitBuf[o + 8] = u.sx;
    unitBuf[o + 9] = u.sy;
    unitBuf[o + 10] = u.tx;
    unitBuf[o + 11] = u.ty;
    unitBuf[o + 12] = u.t0;
    unitBuf[o + 13] = u.t1;
    unitBuf[o + 14] = u.type === U.Transport ? u.troops : u.type === U.Train ? u.dir : 0;
    n++;
  }
  return n;
}

function playerViews(g: Game): PlayerView[] {
  const out: PlayerView[] = [];
  for (const p of g.players) {
    if (!p) continue;
    if (!p.alive && p.kind === 'tribe' && p.eliminatedTick < g.tick - 60) continue;
    out.push({
      id: p.id,
      name: p.name,
      kind: p.kind,
      team: p.team,
      color: p.color,
      flagSeed: p.flagSeed,
      iso: p.iso,
      alive: p.alive,
      spawned: p.spawned,
      tiles: p.tiles,
      usefulTiles: p.usefulTiles,
      troops: Math.round(p.troops),
      workers: Math.round(p.workers),
      gold: Math.round(p.gold),
      traitor: p.isTraitor(g.tick),
      inactive: p.inactive,
      immune: p.immuneUntil > g.tick,
      allies: [...p.allies.keys()],
      personality: p.personality,
      general: p.general,
      label: labels.get(p.id) ?? [0, 0, 0],
      bigMalus: g.bigEmpireMalus(p),
    });
  }
  return out;
}

function localView(g: Game): LocalView | undefined {
  const p = g.player(viewer);
  if (!p) return undefined;
  const t = g.tick;
  const costs: number[] = [];
  for (let k = 0; k < BUILDING_COUNT; k++) costs.push(buildCost(g, p, k as B));
  let boats = 0;
  for (const u of g.units) if (u.alive && u.owner === p.id && u.type === U.Transport) boats++;
  const res = resourceBonus(g, p).counts;
  return {
    id: p.id,
    alive: p.alive,
    gold: p.gold,
    troops: p.troops,
    workers: p.workers,
    popCap: p.popCap,
    growth: p.lastGrowth,
    income: p.income,
    incomeBreakdown: { ...p.incomeBreakdown },
    troopRatio: p.troopRatio,
    attacks: g.attacks
      .filter((a) => a.attacker === p.id && !a.done)
      .map((a) => ({ id: a.id, target: a.target, troops: a.troops })),
    boats,
    tech: [...p.tech],
    researching: p.researching,
    researchPoints: p.researchPoints,
    researchCost: p.researching >= 0 ? nextTechCost(p, p.researching) : 0,
    researchRate: researchRate(p) * 10,
    generalReadyIn: Math.max(0, p.generalReadyTick - t),
    general: p.general,
    immuneFor: Math.max(0, p.immuneUntil - t),
    traitorFor: Math.max(0, p.traitorUntil - t),
    debuffFor: Math.max(0, p.debuffUntil - t),
    allyRequests: [...p.allyRequests.keys()],
    allies: [...p.allies].map(([id, exp]) => ({ id, expiresIn: exp - t })),
    embargo: [...p.embargo],
    buildCosts: costs,
    warshipCost: warshipCost(g, p),
    nukeCosts: [nukeCost(g, p, N.Atom), nukeCost(g, p, N.Hydrogen), nukeCost(g, p, N.Mirv)],
    maxLaunch: [maxLaunchable(g, p, N.Atom), maxLaunchable(g, p, N.Hydrogen), maxLaunchable(g, p, N.Mirv)],
    resources: [res[0], res[1], res[2], res[3]],
    buildingCount: [...p.buildingCount],
    stats: { ...p.stats },
    blitzFor: Math.max(0, p.blitzUntil - t),
    rampartFor: Math.max(0, p.rampartUntil - t),
    propagandaFor: Math.max(0, p.propagandaUntil - t),
  };
}

function worldView(g: Game): WorldView {
  const f = g.features;
  const ring = g.victory.ring;
  return {
    tick: g.tick,
    startTick: g.startTick,
    spawnEndTick: g.spawnEndTick,
    threshold: g.victory.threshold,
    doomsday: g.victory.doomsday ?? -1,
    ring: ring ? { cx: ring.cx, cy: ring.cy, r: ring.r, nextR: ring.nextR } : null,
    weather: f.weather.map((c) => ({ ...c })),
    event: f.event ? { ...f.event } : null,
    council: f.council
      ? { closes: f.council.closes, votes: f.council.votes.size, myVote: f.council.votes.get(viewer) ?? -1 }
      : null,
    ceasefireUntil: f.ceasefireUntil,
    nukeBanUntil: f.nukeBanUntil,
    radarsOffUntil: f.radarsOffUntil,
    usefulLand: g.usefulLand,
    winner: g.victory.winner,
    winnerTeam: g.victory.winnerTeam,
    reason: g.victory.reason,
  };
}

function buildingViews(g: Game): BuildingView[] {
  const out: BuildingView[] = [];
  for (const b of g.buildings.values()) {
    out.push({
      id: b.id,
      type: b.type,
      owner: b.owner,
      x: b.x,
      y: b.y,
      level: b.level,
      progress: b.buildTotal > 0 ? 1 - b.buildLeft / b.buildTotal : 1,
      ready: b.buildLeft === 0,
      tubesReady: b.tubes.filter((x) => x === 0).length,
      cooldown: b.cooldown,
    });
  }
  return out;
}

// --------------------------------------------------------------- labels
/** Approximate "pole of inaccessibility" per player on a coarse grid. */
function computeLabels(g: Game): void {
  const C = Math.max(4, Math.round(Math.sqrt(g.map.size) / 240));
  const w = Math.ceil(g.map.width / C);
  const h = Math.ceil(g.map.height / C);
  const own = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tx = Math.min(g.map.width - 1, x * C + (C >> 1));
      const ty = Math.min(g.map.height - 1, y * C + (C >> 1));
      own[y * w + x] = g.owner[ty * g.map.width + tx]!;
    }
  }
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = own[i]!;
    if (o === 0) {
      d[i] = 0;
      continue;
    }
    const x = i % w;
    const edge =
      x === 0 ||
      x === w - 1 ||
      i < w ||
      i >= w * (h - 1) ||
      own[i - 1] !== o ||
      own[i + 1] !== o ||
      own[i - w] !== o ||
      own[i + w] !== o;
    d[i] = edge ? 1 : INF;
  }
  for (let i = 0; i < w * h; i++) {
    if (d[i] === 0) continue;
    const x = i % w;
    if (x > 0) d[i] = Math.min(d[i]!, d[i - 1]! + 1);
    if (i >= w) d[i] = Math.min(d[i]!, d[i - w]! + 1);
    if (i >= w && x > 0) d[i] = Math.min(d[i]!, d[i - w - 1]! + 1.414);
    if (i >= w && x < w - 1) d[i] = Math.min(d[i]!, d[i - w + 1]! + 1.414);
  }
  for (let i = w * h - 1; i >= 0; i--) {
    if (d[i] === 0) continue;
    const x = i % w;
    if (x < w - 1) d[i] = Math.min(d[i]!, d[i + 1]! + 1);
    if (i < w * (h - 1)) d[i] = Math.min(d[i]!, d[i + w]! + 1);
    if (i < w * (h - 1) && x < w - 1) d[i] = Math.min(d[i]!, d[i + w + 1]! + 1.414);
    if (i < w * (h - 1) && x > 0) d[i] = Math.min(d[i]!, d[i + w - 1]! + 1.414);
  }
  const best = new Map<number, [number, number, number]>();
  for (let i = 0; i < w * h; i++) {
    const o = own[i]!;
    if (o === 0) continue;
    const b = best.get(o);
    if (!b || d[i]! > b[2]) best.set(o, [((i % w) + 0.5) * C, (((i / w) | 0) + 0.5) * C, d[i]!]);
  }
  labels = new Map();
  for (const [o, [x, y, dist]] of best) labels.set(o, [x, y, dist * C]);
}

// -------------------------------------------------------------- loyalty
function computeLoyalty(g: Game): { w: number; h: number; data: Uint8Array } {
  const C = 4;
  const w = Math.ceil(g.map.width / C);
  const h = Math.ceil(g.map.height / C);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tx = Math.min(g.map.width - 1, x * C + 2);
      const ty = Math.min(g.map.height - 1, y * C + 2);
      const t = ty * g.map.width + tx;
      if (g.owner[t] === viewer) data[y * w + x] = Math.max(1, g.loyalty[t]!);
    }
  }
  return { w, h, data };
}

// ------------------------------------------------------------------ fog
function computeFog(g: Game): { w: number; h: number; data: Uint8Array } {
  const C = 4;
  const w = Math.ceil(g.map.width / C);
  const h = Math.ceil(g.map.height / C);
  const data = new Uint8Array(w * h);
  if (!seen || seen.length !== w * h) seen = new Uint8Array(w * h);
  const me = g.player(viewer);
  if (!me) {
    data.fill(255);
    return { w, h, data };
  }
  const friends = new Set<number>([me.id, ...me.allies.keys()]);
  for (const p of g.players) if (p && p.team > 0 && p.team === me.team) friends.add(p.id);
  const night = g.config.features.weather && isNight(g.tick);
  const R = (night ? 24 : 30) / C;
  const INF = 1e9;
  const d = new Float32Array(w * h).fill(INF);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tx = Math.min(g.map.width - 1, x * C + 2);
      const ty = Math.min(g.map.height - 1, y * C + 2);
      if (friends.has(g.owner[ty * g.map.width + tx]!)) d[y * w + x] = 0;
    }
  }
  // Two-pass 8-neighbour chamfer distance (≈ Euclidean: round vision, no diamonds).
  const D = Math.SQRT2;
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    let v = d[i]!;
    if (x > 0) v = Math.min(v, d[i - 1]! + 1);
    if (i >= w) {
      v = Math.min(v, d[i - w]! + 1);
      if (x > 0) v = Math.min(v, d[i - w - 1]! + D);
      if (x < w - 1) v = Math.min(v, d[i - w + 1]! + D);
    }
    d[i] = v;
  }
  for (let i = w * h - 1; i >= 0; i--) {
    const x = i % w;
    let v = d[i]!;
    if (x < w - 1) v = Math.min(v, d[i + 1]! + 1);
    if (i < w * (h - 1)) {
      v = Math.min(v, d[i + w]! + 1);
      if (x < w - 1) v = Math.min(v, d[i + w + 1]! + D);
      if (x > 0) v = Math.min(v, d[i + w - 1]! + D);
    }
    d[i] = v;
  }
  for (let i = 0; i < w * h; i++) if (d[i]! <= R) data[i] = 255;
  const disc = (cx: number, cy: number, r: number) => {
    const rc = r / C;
    const x0 = Math.max(0, Math.floor(cx / C - rc));
    const x1 = Math.min(w - 1, Math.ceil(cx / C + rc));
    const y0 = Math.max(0, Math.floor(cy / C - rc));
    const y1 = Math.min(h - 1, Math.ceil(cy / C + rc));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if ((x + 0.5 - cx / C) ** 2 + (y + 0.5 - cy / C) ** 2 <= rc * rc) data[y * w + x] = 255;
  };
  const radarsOn = g.features.radarsOffUntil <= g.tick;
  for (const b of g.buildings.values()) {
    if (!friends.has(b.owner)) continue;
    if (b.type === B.Radar && b.buildLeft === 0 && radarsOn) disc(b.x, b.y, RADAR_RANGE + 20 * (b.level - 1));
  }
  for (const u of g.units) {
    if (!u.alive || !friends.has(u.owner)) continue;
    if (u.type === U.Warship || u.type === U.Transport || u.type === U.Fighter || u.type === U.Bomber)
      disc(u.x, u.y, 25);
  }
  for (const r of g.features.reveals) if (friends.has(r.owner)) disc(r.x, r.y, r.r);
  for (let i = 0; i < w * h; i++) {
    if (data[i] === 255) seen[i] = 1;
    else if (seen[i]) data[i] = 110;
  }
  return { w, h, data };
}

// -------------------------------------------------------------- queries
function answer(g: Game, q: import('./protocol').Query): unknown {
  switch (q.q) {
    case 'tile': {
      const t = q.tile;
      if (t < 0 || t >= g.map.size) return null;
      const bid = g.buildingAt[t]!;
      const b = bid >= 0 ? g.buildings.get(bid) : undefined;
      return {
        owner: g.owner[t],
        terrain: g.map.terrain[t],
        elevation: g.map.elevation[t],
        fallout: g.fallout[t],
        loyalty: g.loyalty[t],
        resource: g.map.resource[t],
        dead: g.isDead(t),
        defended: g.owner[t]! > 0 ? g.defenseMagMult(t, g.owner[t]!) > 1 : false,
        building: b
          ? { id: b.id, type: b.type, owner: b.owner, level: b.level, ready: b.buildLeft === 0 }
          : null,
      };
    }
    case 'placement': {
      const p = g.player(viewer);
      if (!p) return { error: 'notOwned', cost: 0 };
      return { error: checkPlacement(g, p, q.kind as B, q.tile), cost: buildCost(g, p, q.kind as B) };
    }
    case 'boat': {
      const p = g.player(viewer);
      if (!p) return null;
      const plan = planBoat(g, p, q.tile);
      return { error: plan.error, landing: plan.landing, path: plan.path };
    }
    case 'hash':
      return hashGame(g);
    case 'stats': {
      const out: FinalStats = {
        players: g.players
          .filter((p): p is Player => !!p && p.kind !== 'tribe')
          .map((p) => ({
            id: p.id,
            name: p.name,
            kind: p.kind,
            color: p.color,
            flagSeed: p.flagSeed,
            iso: p.iso,
            team: p.team,
            alive: p.alive,
            tiles: p.tiles,
            stats: { ...p.stats },
            history: p.history,
            eliminatedTick: p.eliminatedTick,
          })),
        tick: g.tick,
        startTick: g.startTick,
        winner: g.victory.winner,
        winnerTeam: g.victory.winnerTeam,
        reason: g.victory.reason,
      };
      return out;
    }
  }
  return null;
}
