/// <reference lib="webworker" />
// Dedicated simulation worker: owns the deterministic Game, steps it on each
// turn and streams compact deltas (tiles, units, views, events, fog, labels).
import {
  endWorldEvent,
  researchMult,
  startWorldEvent,
  WORLD_EVENTS,
  type WorldEventId,
} from '../core/rules/worldEvents';
import { Game } from '../core/game/state';
import { GameMap } from '../core/map/gamemap';
import { decodeGreyPng, decodeTerrainPng } from '../core/map/format';
import { generateMapData } from '../core/map/generator';
import { restoreSnapshot, takeSnapshot } from '../core/net/snapshot';
import { barricadesUp, nextSpread, startRevolution } from '../core/rules/revolution';
import { lineDefended, lineStrength } from '../core/rules/lines';
import { hashGame } from '../core/net/hash';
import {
  B,
  BUILDING_COUNT,
  HASH_EVERY,
  N,
  REVOLUTION_BARRICADE_TICKS,
  radarRange,
} from '../core/game/constants';
import { buildCost, levelsByType, planBuild } from '../core/buildings/buildings';
import { inService } from '../core/buildings/building';
import { warshipCost, planBoat, TRANSPORT_RETREATING } from '../core/units/ships';
import { maxLaunchable, nukeCost } from '../core/units/nukes';
import { nextTechCost, researchRate, researchSources, techKey, techSam } from '../core/rules/tech';
import { resourceBonus } from '../core/rules/resources';
import { isNight } from '../core/rules/features';
import { sightAt } from '../core/rules/weather';
import { U } from '../core/units/unit';
import { IS_LAND } from '../core/map/terrain';
import type { Player } from '../core/game/player';
import type {
  BuildingView,
  FinalStats,
  FromWorker,
  LocalView,
  MapSource,
  PlacementView,
  PlayerView,
  RailView,
  LineView,
  TickUpdate,
  ToWorker,
  WorldView,
} from './protocol';
import { UNIT_STRIDE } from './protocol';
import { unitDestTile } from './unitDest';
import { sanitizeFlag, type PlayerFlag } from '../core/data/flagSpec';
import type { Turn } from '../core/net/commands';
import { TradeLedger, embargoesOf } from './tradeLedger';
import { TradeRoutes } from './tradeRoutes';
import { ThreatWatch } from './threats';
import { RadarWatch } from './radarWatch';
import { bestCapitalSpot, capitalCooldown } from '../core/rules/capital';
import { opinionsOf, type Opinion } from '../core/rules/opinion';
import { computeLabels, type Label } from '../core/game/labels';
import { outsideNextZone } from '../core/rules/victory';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let game: Game | null = null;
let viewer = 0;
let fogEnabled = false;
let loyaltyLayer = false;
let seen: Uint8Array | null = null;
let labels = new Map<number, Label>();
let unitBuf = new Float32Array(UNIT_STRIDE * 256);
let lastBuildingSend = -1;
let lastLinesVersion = -1;
const ledger = new TradeLedger();
const routes = new TradeRoutes();
/** Threatened borders of the viewer (view-only intelligence). */
const threats = new ThreatWatch();
const radar = new RadarWatch();
/** Safest spot for a new capital while the viewer has none (recomputed every 2 s). */
let capitalHint = { tick: -1, tile: -1 };
/** What the nations think of the viewer (recomputed every second). */
let opinions: { tick: number; list: Opinion[] } = { tick: -1, list: [] };
let zoneOut = { tick: -1, id: -1, share: 0 };

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
        lastLinesVersion = -1;
        ledger.reset();
        routes.reset();
        threats.reset();
        radar.reset();
        capitalHint = { tick: -1, tile: -1 };
        opinions = { tick: -1, list: [] };
        neighbors = { tick: -1, id: -1, list: [] };
        labels = computeLabels(game);
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
        ledger.reset();
        routes.resetViewer();
        threats.reset();
        radar.reset();
        capitalHint = { tick: -1, tile: -1 };
        opinions = { tick: -1, list: [] };
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
      case 'qa':
        // Outside the command stream (solo QA only): the outbreak is sent as a tick's update.
        if (game && msg.action === 'revolution') {
          const p = game.players[msg.player];
          game.events.length = 0;
          game.changedTiles.length = 0;
          if (p) startRevolution(game, p);
          sendUpdate(game, [...game.changedTiles], [], 0, true, [...game.events]);
        }
        if (game && msg.action === 'worldEvent' && (WORLD_EVENTS as readonly string[]).includes(msg.id)) {
          game.events.length = 0;
          game.changedTiles.length = 0;
          if (game.features.event) endWorldEvent(game);
          startWorldEvent(game, msg.id as WorldEventId, game.tick - game.startTick);
          if (msg.zone && game.features.event) Object.assign(game.features.event, msg.zone);
          sendUpdate(game, [], [], 0, true, [...game.events]);
        }
        if (game && msg.action === 'summit') {
          const until = game.tick + Math.round(msg.secs * 10);
          if (game.features.event) endWorldEvent(game);
          game.features.event = { id: 'peaceSummit', until };
          game.features.ceasefireUntil = Math.max(game.features.ceasefireUntil, until);
          game.events.length = 0;
          game.changedTiles.length = 0;
          sendUpdate(game, [], [], 0, true, []);
        }
        if (game && msg.action === 'shrink') {
          const p = game.players[msg.player];
          game.events.length = 0;
          game.changedTiles.length = 0;
          if (p) {
            const w = game.map.width;
            const [cx, cy] = p.centroid(w);
            const own: number[] = [];
            for (let t = 0; t < game.owner.length; t++) if (game.owner[t] === p.id) own.push(t);
            const d = (t: number) => ((t % w) - cx) ** 2 + (((t / w) | 0) - cy) ** 2;
            own.sort((a, b) => d(a) - d(b));
            for (const t of own.slice(Math.max(1, msg.keep))) game.setOwner(t, 0);
          }
          sendUpdate(game, [...game.changedTiles], [], 0, true, [...game.events]);
        }
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
    ledger.track(g.events, viewer, g.tick);
    routes.track(g, g.events);
    stepped++;
    for (const t of g.changedTiles) changed.add(t);
    for (const t of g.changedFallout) state.add(t);
    if (turns.length === 1 || events.length < 400) events.push(...g.events);
    // Radar early warnings (view-only): what the viewer's radars pick up this tick.
    events.push(...radar.scan(g, viewer));
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
  if (full || tick % 20 === 0) labels = computeLabels(g);
  if (
    full ||
    tick % 5 === 0 ||
    events.some(
      (e) =>
        e.k === 'eliminated' ||
        e.k === 'alliance' ||
        e.k === 'secession' ||
        e.k === 'revolution' ||
        e.k === 'betrayal' ||
        e.k === 'capitalLost' ||
        e.k === 'capitalMoved',
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
  const constructing = [...g.buildings.values()].some(
    (b) => b.buildLeft > 0 || b.upgradeLeft > 0 || b.occupiedLeft > 0 || b.demolishLeft > 0,
  );
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
  // Front lines: when they change, and every second while any stands (their strength drifts).
  if (full || g.linesVersion !== lastLinesVersion || (tick % 10 === 0 && g.lines.length > 0)) {
    up.lines = g.lines.map((l): LineView => ({
      id: l.id,
      owner: l.owner,
      kind: l.kind,
      pts: l.pts,
      side: l.side,
      troops: l.troops,
      tiles: l.tiles,
      readyTick: l.readyTick,
      strength: lineStrength(g, l),
      target: l.target,
      aim: l.owner === viewer ? l.aim : -1,
      attack: l.attack,
    }));
    lastLinesVersion = g.linesVersion;
  }
  if (fogEnabled && (full || tick % 5 === 0)) up.fog = computeFog(g);
  if (loyaltyLayer && (full || tick % 10 === 0)) up.loyalty = computeLoyalty(g);
  if (full || tick % 20 === 0) up.routes = routes.view(g, viewer);
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
  // Trains name the station they run to (the hover card's destination): rails by id.
  let rails: Map<number, Game['rails'][number]> | undefined;
  for (const u of g.units) {
    if (u.alive && u.type === U.Train && !rails) rails = new Map(g.rails.map((r) => [r.id, r]));
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
    // Trains: their progress along the rail and the rail (the renderer draws them on the track).
    unitBuf[o + 13] = u.type === U.Train ? u.troops : u.t1;
    unitBuf[o + 14] =
      u.type === U.Transport
        ? u.troops
        : u.type === U.Train || u.type === U.Nuke || u.type === U.Interceptor
          ? u.dir
          : 0;
    unitBuf[o + 15] = unitDestTile(g, u, rails);
    unitBuf[o + 16] = u.type === U.Train ? u.rail : -1;
    n++;
  }
  return n;
}

/**
 * Flags chosen by the human slots, sanitised once per config (saves, replays and LAN
 * configs come from outside). Cosmetic: only copied into the views.
 */
let flagConfig: Game['config'] | null = null;
let flagBySlot = new Map<number, PlayerFlag>();
function slotFlag(g: Game, p: Player): PlayerFlag | undefined {
  if (p.kind !== 'human' || p.slot < 0) return undefined;
  if (flagConfig !== g.config) {
    flagConfig = g.config;
    flagBySlot = new Map();
    for (const s of g.config.players ?? []) {
      const f = sanitizeFlag(s.flag);
      if (f) flagBySlot.set(s.slot, f);
    }
  }
  return flagBySlot.get(p.slot);
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
      flag: slotFlag(g, p),
      alive: p.alive,
      spawned: p.spawned,
      tiles: p.tiles,
      usefulTiles: p.usefulTiles,
      troops: Math.round(p.troops),
      gold: Math.round(p.gold),
      traitor: p.isTraitor(g.tick),
      traitorFor: Math.max(0, p.traitorUntil - g.tick),
      inactive: p.inactive,
      immune: p.immuneUntil > g.tick,
      allies: [...p.allies.keys()],
      personality: p.personality,
      label: labels.get(p.id) ?? [0, 0, 0],
      bigMalus: g.bigEmpireMalus(p),
      samBonus: g.config.features.tech ? techSam(p).range : 0,
      capital: p.capital,
      disorgFor: Math.max(0, p.disorgUntil - g.tick),
      rebelOf: p.rebelOf,
      ...(p.revolution ? revoltView(g, p) : {}),
    });
  }
  return out;
}

/**
 * Attacks involving the viewer and, for each, one point per separate stretch of its
 * front: frontier tiles are bucketed on a coarse grid, touching cells form a stretch,
 * and its point is the frontier tile closest to the stretch's centre (on the line).
 */
const FRONT_CELL = 24;
const FRONT_SAMPLES = 240;
const FRONT_MAX_STRETCHES = 4;

function frontsOf(g: Game, p: Player): LocalView['fronts'] {
  const w = g.map.width;
  const out: LocalView['fronts'] = [];
  for (const a of g.attacks) {
    if (a.done || a.troops < 1 || (a.attacker !== p.id && a.target !== p.id)) continue;
    const heap = a.heapTiles;
    const n = Math.min(heap.length, FRONT_SAMPLES);
    if (n === 0) continue;
    const step = heap.length / n;
    const cells = new Map<number, number[]>();
    const cw = Math.ceil(w / FRONT_CELL);
    for (let k = 0; k < n; k++) {
      const t = heap[Math.floor(k * step)]!;
      const c = Math.floor(((t / w) | 0) / FRONT_CELL) * cw + Math.floor((t % w) / FRONT_CELL);
      const list = cells.get(c);
      if (list) list.push(t);
      else cells.set(c, [t]);
    }
    // Touching cells (8-neighbourhood) form one stretch of front.
    const seen = new Set<number>();
    const stretches: number[][] = [];
    for (const c0 of [...cells.keys()].sort((x, y) => x - y)) {
      if (seen.has(c0)) continue;
      const tiles: number[] = [];
      const stack = [c0];
      seen.add(c0);
      while (stack.length) {
        const c = stack.pop()!;
        tiles.push(...cells.get(c)!);
        const cx = c % cw;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const d = c + dy * cw + dx;
            if ((dx || dy) && cx + dx >= 0 && cx + dx < cw && cells.has(d) && !seen.has(d)) {
              seen.add(d);
              stack.push(d);
            }
          }
      }
      stretches.push(tiles);
    }
    stretches.sort((x, y) => y.length - x.length);
    const points: [number, number][] = [];
    for (const tiles of stretches.slice(0, FRONT_MAX_STRETCHES)) {
      if (points.length > 0 && tiles.length < 3) break; // stray tiles are not a front
      let cx = 0;
      let cy = 0;
      for (const t of tiles) {
        cx += t % w;
        cy += (t / w) | 0;
      }
      cx /= tiles.length;
      cy /= tiles.length;
      let best = tiles[0]!;
      let bd = Infinity;
      for (const t of tiles) {
        const d = ((t % w) - cx) ** 2 + (((t / w) | 0) - cy) ** 2;
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      points.push([(best % w) + 0.5, ((best / w) | 0) + 0.5]);
    }
    out.push({ id: a.id, attacker: a.attacker, target: a.target, troops: Math.round(a.troops), points });
  }
  return out;
}

/** Last tick each country was seen fighting the viewer (attacks, landings, missiles). */
const warContact = new Map<number, number>();
const WAR_LINGER = 100;

/** Land neighbours of the viewer, as combat's sharesBorder sees them (recomputed every second). */
let neighbors: { tick: number; id: number; list: number[] } = { tick: -1, id: -1, list: [] };
const NB4 = new Int32Array(4);

function neighborsOf(g: Game, p: Player): number[] {
  if (
    neighbors.id === p.id &&
    neighbors.tick >= 0 &&
    g.tick - neighbors.tick < 10 &&
    g.tick >= neighbors.tick
  )
    return neighbors.list;
  const found = new Set<number>();
  const map = g.map;
  for (const t of p.border) {
    const n = map.neighbors4(t, NB4);
    for (let k = 0; k < n; k++) {
      const j = NB4[k]!;
      const o = g.owner[j]!;
      if (o > 0 && o !== p.id && IS_LAND[map.terrain[j]!] && !g.isDead(j)) found.add(o);
    }
  }
  neighbors = { tick: g.tick, id: p.id, list: [...found] };
  return neighbors.list;
}

function warsOf(g: Game, p: Player): number[] {
  const t = g.tick;
  const touch = (id: number) => {
    if (id > 0 && id !== p.id) warContact.set(id, t);
  };
  for (const a of g.attacks) {
    if (a.done) continue;
    if (a.attacker === p.id) touch(a.target);
    else if (a.target === p.id) touch(a.attacker);
  }
  for (const u of g.units) {
    if (!u.alive) continue;
    if (u.type === U.Transport) {
      const o = u.dest; // the landing's owner at launch
      if (u.owner === p.id) touch(o);
      else if (o === p.id) touch(u.owner);
    } else if ((u.type === U.Nuke || u.type === U.Bomber) && u.dest >= 0) {
      const o = g.owner[u.dest]!;
      if (u.owner === p.id) touch(o);
      else if (o === p.id) touch(u.owner);
    }
  }
  const out: number[] = [];
  for (const [id, last] of warContact) {
    const q = g.players[id];
    if (t - last > WAR_LINGER || last > t || !q?.alive || p.allies.has(id)) warContact.delete(id);
    else out.push(id);
  }
  return out.sort((a, b) => a - b);
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
    popCap: p.popCap,
    lineCount: [
      g.lines.filter((l) => l.owner === p.id && l.kind === 0 && l.troops >= 1).length,
      g.lines.filter((l) => l.owner === p.id && l.kind === 1 && l.attack < 0 && l.troops >= 1).length,
    ],
    lineTroops: p.lineTroops,
    growth: p.lastGrowth,
    income: p.income,
    incomeBreakdown: { ...p.incomeBreakdown },
    attacks: g.attacks
      .filter((a) => a.attacker === p.id && !a.done)
      .map((a) => ({ id: a.id, target: a.target, troops: a.troops, retreating: a.retreatAt >= 0 })),
    boats,
    tech: [...p.tech],
    researching: p.researching,
    researchPoints: p.researchPoints,
    researchCost: p.researching >= 0 ? nextTechCost(p, p.researching) : 0,
    // (A scientific breakthrough, world event, speeds it up.)
    researchRate: researchRate(p) * researchMult(g) * 10,
    research: researchSources(p),
    researchQueue: [...(p.researchQueue ?? [])],
    immuneFor: Math.max(0, p.immuneUntil - t),
    traitorFor: Math.max(0, p.traitorUntil - t),
    debuffFor: Math.max(0, p.debuffUntil - t),
    allyRequests: [...p.allyRequests.keys()],
    allyRequestsIn: [...p.allyRequests.values()].map((exp) => Math.max(0, exp - t)),
    allies: [...p.allies].map(([id, exp]) => ({ id, expiresIn: exp - t })),
    embargo: [...p.embargo],
    fronts: frontsOf(g, p),
    transports: g.units
      .filter((u) => u.alive && u.type === U.Transport && u.owner === p.id)
      .map((u) => ({
        id: u.id,
        troops: Math.round(u.troops),
        x: u.x,
        y: u.y,
        tx: u.target >= 0 ? (u.target % g.map.width) + 0.5 : u.x,
        ty: u.target >= 0 ? Math.floor(u.target / g.map.width) + 0.5 : u.y,
        retreating: u.kind === TRANSPORT_RETREATING,
      })),
    missiles: g.units
      .filter((u) => u.alive && u.type === U.Nuke && u.owner === p.id)
      .map((u) => ({
        id: u.id,
        kind: u.kind,
        x: u.x,
        y: u.y,
        tx: u.tx,
        ty: u.ty,
        left: Math.max(0, u.t1 - t),
      })),
    wars: warsOf(g, p),
    neighbors: neighborsOf(g, p),
    noTrade: g.players
      .filter((q) => q && q.alive && q.id !== p.id && p.hasEmbargoWith(q, t))
      .map((q) => q!.id),
    trade: ledger.partners(g, p),
    embargoes: embargoesOf(g, p),
    buildCosts: costs,
    warshipCost: warshipCost(g, p),
    nukeCosts: [nukeCost(g, p, N.Atom), nukeCost(g, p, N.Hydrogen), nukeCost(g, p, N.Mirv)],
    maxLaunch: [maxLaunchable(g, p, N.Atom), maxLaunchable(g, p, N.Hydrogen), maxLaunchable(g, p, N.Mirv)],
    resources: [res[0], res[1], res[2], res[3]],
    buildingCount: [...p.buildingCount],
    buildingLevels: levelsByType(g, p),
    stats: { ...p.stats },
    capital: p.capital,
    capitalLostBy: p.capitalLostBy,
    disorgFor: Math.max(0, p.disorgUntil - t),
    capitalCooldown: capitalCooldown(g, p),
    capitalHint: capitalHintOf(g, p),
    threats: threats.update(g, p),
    opinions: opinionsFor(g, p),
  };
}

function opinionsFor(g: Game, p: Player): Opinion[] {
  const t = g.tick;
  if (opinions.tick < 0 || t < opinions.tick || t - opinions.tick >= 10)
    opinions = { tick: t, list: p.alive ? opinionsOf(g, p) : [] };
  return opinions.list;
}

/** While the viewer has no capital: the spot a nation would choose (the prompt's « safest » button). */
function capitalHintOf(g: Game, p: Player): number {
  if (p.capital >= 0 || !p.alive || p.kind === 'tribe' || g.phase !== 'playing') return -1;
  const t = g.tick;
  if (capitalHint.tick < 0 || t < capitalHint.tick || t - capitalHint.tick >= 20)
    capitalHint = { tick: t, tile: bestCapitalSpot(g, p) };
  return capitalHint.tile;
}

/** Share of the viewer's useful land outside the next zone (battle royale; refreshed every second). */
function landOutsideZone(g: Game): number {
  const p = g.players[viewer];
  if (!p || !p.alive || p.usefulTiles === 0) return -1;
  const t = g.tick;
  if (zoneOut.tick >= 0 && t >= zoneOut.tick && t - zoneOut.tick < 10 && zoneOut.id === p.id)
    return zoneOut.share;
  let out = 0;
  const owner = g.owner;
  for (let i = 0; i < owner.length; i++)
    if (owner[i] === p.id && g.isUsefulLand(i) && outsideNextZone(g, i)) out++;
  zoneOut = { tick: t, id: p.id, share: out / p.usefulTiles };
  return zoneOut.share;
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
    doom: g.victory.doom
      ? {
          units: g.victory.doom.units,
          stage: g.victory.doom.stage,
          pushes: g.victory.doom.pushes.map((p) => ({ ...p })),
        }
      : null,
    ring: ring
      ? {
          cx: ring.cx,
          cy: ring.cy,
          r: ring.r,
          nx: ring.nx,
          ny: ring.ny,
          nr: ring.nr,
          closeAt: ring.closeAt,
          step: ring.step,
          steps: ring.steps,
          endAt: ring.endAt,
          mineOut: landOutsideZone(g),
        }
      : null,
    weather: f.weather.map((c) => ({ ...c })),
    event: f.event ? { ...f.event } : null,
    council: f.council
      ? { closes: f.council.closes, votes: f.council.votes.size, myVote: f.council.votes.get(viewer) ?? -1 }
      : null,
    councilNext: g.config.features.council ? g.startTick + f.nextCouncilTick : -1,
    sanction: f.sanction ? { ...f.sanction } : null,
    ceasefireUntil: f.ceasefireUntil,
    nukeBanUntil: f.nukeBanUntil,
    radarsOffUntil: f.radarsOffUntil,
    usefulLand: g.usefulLand,
    winner: g.victory.winner,
    winnerTeam: g.victory.winnerTeam,
    reason: g.victory.reason,
  };
}

/** A revolution's countdowns (rules/revolution.ts): the end, the barricades, the next spread. */
function revoltView(g: Game, p: Player): Partial<PlayerView> {
  const spread = nextSpread(g, p);
  return {
    revoltFor: Math.max(0, p.revoltUntil - g.tick),
    revoltBarricades: barricadesUp(g, p) ? p.revoltStart + REVOLUTION_BARRICADE_TICKS - g.tick : 0,
    revoltSpreadIn: spread.in,
    revoltHolds: spread.holds,
    revoltLand: p.revoltLand,
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
      ready: inService(b),
      upgrade: b.upgradeLeft > 0 ? 1 - b.upgradeLeft / b.upgradeTotal : -1,
      occupied: b.occupiedLeft,
      occupiedTotal: b.occupiedTotal,
      demolish: b.demolishLeft,
      demolishTotal: b.demolishTotal,
      // Airfields: their alert interceptors (a slot not created yet is loaded, units/air.ts).
      tubesReady:
        b.type === B.Airfield
          ? Math.max(0, b.level - b.tubes.slice(0, b.level).filter((x) => x > 0).length)
          : b.tubes.filter((x) => x === 0).length,
      cooldown: b.cooldown,
    });
  }
  return out;
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
    // Weather: a radar (or a ship, a plane) inside a fog bank sees half as far.
    if (b.type === B.Radar && b.buildLeft === 0 && radarsOn)
      disc(b.x, b.y, sightAt(g, b.x + 0.5, b.y + 0.5, radarRange(b.level)));
  }
  for (const u of g.units) {
    if (!u.alive || !friends.has(u.owner)) continue;
    if (u.type === U.Warship || u.type === U.Transport || u.type === U.Fighter || u.type === U.Bomber)
      disc(u.x, u.y, sightAt(g, u.x, u.y, 25));
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
        defended: lineDefended(g, t),
        building: b
          ? {
              id: b.id,
              type: b.type,
              owner: b.owner,
              level: b.level,
              ready: b.buildLeft === 0,
              upgrading: b.upgradeLeft > 0,
              occupied: b.occupiedLeft,
            }
          : null,
      };
    }
    case 'placement': {
      const p = g.player(viewer);
      if (!p || q.kind < 0 || q.kind >= BUILDING_COUNT || q.tile < 0 || q.tile >= g.map.size)
        return {
          upgrade: false,
          at: -1,
          level: 1,
          error: 'notOwned',
          cost: 0,
          tech: '',
        } satisfies PlacementView;
      const plan = planBuild(g, p, q.kind as B, q.tile);
      return {
        upgrade: !!plan.building,
        at: plan.tile,
        level: plan.building ? plan.building.level + 1 : 1,
        error: plan.error,
        cost: plan.cost,
        tech: plan.lock >= 0 ? techKey(plan.lock) : '',
      } satisfies PlacementView;
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
            flag: slotFlag(g, p),
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
