// Nuclear weapons: silo launch queues, ballistic flight, MIRV split, SAM
// interception with trajectory prediction, detonation and fallout.
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import {
  B,
  DECONTAMINATION_TICKS,
  MAX_NUKE_BATCH,
  MIRV_COST_STEP,
  MIRV_SPLIT_AT,
  MIRV_SPREAD,
  MIRV_WARHEADS,
  N,
  NUKE_COST,
  NUKE_FALLOUT_RADIUS,
  NUKE_RADIUS,
  NUKE_SPEED,
  NUKE_TROOP_KILL,
  SAM_COOLDOWN,
  SAM_INTERCEPTOR_SPEED,
  SILO_MIRV_COOLDOWN,
  SILO_RELOAD_TICKS,
  samRange,
} from '../game/constants';
import { U, makeUnit, type Unit } from './unit';
import { addUnit } from './ships';
import type { Building } from '../buildings/building';
import { removeBuilding } from '../buildings/buildings';
import { destroyRailsInRadius } from './trains';
import { IS_LAND } from '../map/terrain';
import { hash2 } from '../rng';
import { resourceBonus } from '../rules/resources';
import { techNukes, techSam } from '../rules/tech';

export function nukeCost(game: Game, p: Player, kind: N): number {
  let c: number = NUKE_COST[kind];
  if (kind === N.Mirv) c += MIRV_COST_STEP * game.features.mirvLaunches;
  if (game.config.features.resources) c *= 1 - resourceBonus(game, p).nukeDiscount;
  if (game.config.features.tech) c *= techNukes(p).cost;
  return Math.round(c);
}

function readySilos(game: Game, p: Player, kind: N): Building[] {
  const out: Building[] = [];
  for (const b of game.buildings.values()) {
    if (b.owner !== p.id || b.type !== B.Silo || b.buildLeft > 0) continue;
    if (kind === N.Mirv && b.cooldown > 0) continue;
    out.push(b);
  }
  return out;
}

/** How many bombs of `kind` p could launch right now (gold, loaded tubes, batch cap). */
export function maxLaunchable(game: Game, p: Player, kind: N): number {
  if (!game.config.allowNukes || game.phase !== 'playing' || game.features.nukeBanUntil > game.tick) return 0;
  const cost = nukeCost(game, p, kind);
  let tubes = 0;
  for (const s of readySilos(game, p, kind)) for (const t of s.tubes) if (t === 0) tubes++;
  if (kind === N.Mirv) tubes = Math.min(tubes, 1);
  return Math.max(0, Math.min(MAX_NUKE_BATCH, tubes, Math.floor(p.gold / Math.max(1, cost))));
}

/** Players whose land lies on the ground track (or at the impact). */
function threatened(game: Game, sx: number, sy: number, tx: number, ty: number, radius: number): number[] {
  const set = new Set<number>();
  const w = game.map.width;
  const steps = Math.max(1, Math.ceil(Math.hypot(tx - sx, ty - sy) / 6));
  for (let k = 0; k <= steps; k++) {
    const x = Math.floor(sx + ((tx - sx) * k) / steps);
    const y = Math.floor(sy + ((ty - sy) * k) / steps);
    if (!game.map.inBounds(x, y)) continue;
    const o = game.owner[y * w + x]!;
    if (o > 0) set.add(o);
  }
  for (let a = 0; a < 8; a++) {
    const x = Math.floor(tx + Math.cos((a / 8) * Math.PI * 2) * radius);
    const y = Math.floor(ty + Math.sin((a / 8) * Math.PI * 2) * radius);
    if (!game.map.inBounds(x, y)) continue;
    const o = game.owner[y * w + x]!;
    if (o > 0) set.add(o);
  }
  return [...set].sort((a, b) => a - b);
}

export function launchNukes(game: Game, p: Player, kind: N, tile: number, count: number): number {
  const n = Math.min(count, maxLaunchable(game, p, kind));
  if (n <= 0) return 0;
  const w = game.map.width;
  const tx = (tile % w) + 0.5;
  const ty = ((tile / w) | 0) + 0.5;
  const silos = readySilos(game, p, kind).sort(
    (a, b) => (a.x - tx) ** 2 + (a.y - ty) ** 2 - ((b.x - tx) ** 2 + (b.y - ty) ** 2) || a.id - b.id,
  );
  let launched = 0;
  const queue = new Map<number, number>();
  for (const s of silos) {
    for (let k = 0; k < s.tubes.length && launched < n; k++) {
      if (s.tubes[k] !== 0) continue;
      const cost = nukeCost(game, p, kind);
      if (p.gold < cost) break;
      p.gold -= cost;
      const reloadTech = game.config.features.tech ? techNukes(p).reload : 1;
      const reload = SILO_RELOAD_TICKS / (1 + 0.5 * (s.level - 1)) / reloadTech;
      s.tubes[k] = Math.round(reload);
      if (kind === N.Mirv) {
        s.cooldown = SILO_MIRV_COOLDOWN;
        game.features.mirvLaunches++;
      }
      const delay = queue.get(s.id) ?? 0;
      queue.set(s.id, delay + 1);
      const sx = s.x + 0.5;
      const sy = s.y + 0.5;
      const dist = Math.hypot(tx - sx, ty - sy);
      const u = makeUnit(game.nextId(), U.Nuke, p.id, sx, sy);
      u.kind = kind;
      u.sx = sx;
      u.sy = sy;
      u.tx = tx;
      u.ty = ty;
      u.t0 = game.tick + delay;
      u.t1 = u.t0 + Math.max(10, Math.ceil(dist / NUKE_SPEED));
      u.home = s.id;
      addUnit(game, u);
      launched++;
      p.stats.nukesLaunched++;
      const radius = kind === N.Mirv ? MIRV_SPREAD : NUKE_FALLOUT_RADIUS[kind];
      const victims = threatened(game, sx, sy, tx, ty, radius).filter((v) => v !== p.id);
      game.emit({
        k: 'nukeLaunch',
        id: u.id,
        owner: p.id,
        kind,
        sx,
        sy,
        tx,
        ty,
        impact: u.t1,
        threatened: victims,
      });
      for (const v of victims) {
        game.notify(
          v,
          kind === N.Mirv ? 'alert.mirv' : 'alert.nuke',
          'danger',
          { by: p.id, eta: u.t1 - game.tick },
          tile,
        );
        game.ai.nukedBy.set(v, p.id);
      }
    }
    if (launched >= n) break;
  }
  return launched;
}

function nukePos(u: Unit, tick: number): [number, number] {
  const f = Math.max(0, Math.min(1, (tick - u.t0) / Math.max(1, u.t1 - u.t0)));
  return [u.sx + (u.tx - u.sx) * f, u.sy + (u.ty - u.sy) * f];
}

function splitMirv(game: Game, u: Unit): void {
  const rng = game.rng;
  const owner = game.players[u.owner]!;
  const extra = game.config.features.tech && owner.tech[3]! >= 4 ? 2 : 0;
  const count = rng.int(MIRV_WARHEADS[0], MIRV_WARHEADS[1]) + extra;
  const w = game.map.width;
  const victim = game.owner[Math.floor(u.ty) * w + Math.floor(u.tx)]!;
  const [x, y] = nukePos(u, game.tick);
  for (let k = 0; k < count; k++) {
    let bx = u.tx;
    let by = u.ty;
    for (let tries = 0; tries < 12; tries++) {
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * MIRV_SPREAD;
      const cx = Math.floor(u.tx + Math.cos(a) * r);
      const cy = Math.floor(u.ty + Math.sin(a) * r);
      if (!game.map.inBounds(cx, cy)) continue;
      bx = cx + 0.5;
      by = cy + 0.5;
      const o = game.owner[cy * w + cx]!;
      if (victim > 0 ? o === victim : IS_LAND[game.map.terrain[cy * w + cx]!]) break;
    }
    const h = makeUnit(game.nextId(), U.Nuke, u.owner, x, y);
    h.kind = N.MirvWarhead;
    h.sx = x;
    h.sy = y;
    h.tx = bx;
    h.ty = by;
    h.t0 = game.tick;
    h.t1 = game.tick + Math.max(6, u.t1 - game.tick + rng.int(0, 6));
    addUnit(game, h);
  }
}

function samCanTarget(game: Game, sam: Building, m: Unit): boolean {
  if (m.kind === N.Mirv) return false; // the carrier cannot be intercepted
  if (game.friendly(sam.owner, m.owner)) return false;
  return m.target < 0;
}

/** First tick at which an interceptor from the SAM can meet missile m, or -1. */
function interceptTick(game: Game, sam: Building, m: Unit, range: number): number {
  const sx = sam.x + 0.5;
  const sy = sam.y + 0.5;
  for (let k = 1; game.tick + k < m.t1; k++) {
    const [x, y] = nukePos(m, game.tick + k);
    const d = Math.hypot(x - sx, y - sy);
    if (d > range) continue;
    if (d <= SAM_INTERCEPTOR_SPEED * k) return game.tick + k;
  }
  return -1;
}

function updateSams(game: Game, missiles: Unit[]): void {
  if (missiles.length === 0) return;
  for (const sam of game.buildings.values()) {
    if (sam.type !== B.Sam || sam.buildLeft > 0 || sam.cooldown > 0) continue;
    const owner = game.players[sam.owner]!;
    if (!owner.alive) continue;
    const tech = game.config.features.tech ? techSam(owner) : { range: 0, targets: 0 };
    const range = samRange(sam.level) + tech.range;
    let shots = 1 + tech.targets;
    let fired = false;
    for (const m of missiles) {
      if (shots <= 0) break;
      if (!m.alive || m.t0 > game.tick || !samCanTarget(game, sam, m)) continue;
      // Quick reject: neither the current position nor the impact point is near the SAM.
      const [cx, cy] = nukePos(m, game.tick);
      const near =
        Math.hypot(cx - sam.x, cy - sam.y) <= range + 40 || Math.hypot(m.tx - sam.x, m.ty - sam.y) <= range;
      if (!near) continue;
      const at = interceptTick(game, sam, m, range);
      if (at < 0) continue;
      const [ix, iy] = nukePos(m, at);
      const i = makeUnit(game.nextId(), U.Interceptor, sam.owner, sam.x + 0.5, sam.y + 0.5);
      i.sx = sam.x + 0.5;
      i.sy = sam.y + 0.5;
      i.tx = ix;
      i.ty = iy;
      i.t0 = game.tick;
      i.t1 = at;
      i.target = m.id;
      addUnit(game, i);
      m.target = i.id;
      shots--;
      fired = true;
    }
    if (fired) sam.cooldown = SAM_COOLDOWN;
  }
}

export function updateNukes(game: Game): void {
  const missiles: Unit[] = [];
  for (const u of game.units) if (u.alive && u.type === U.Nuke) missiles.push(u);
  updateSams(game, missiles);
  for (const u of game.units) {
    if (!u.alive) continue;
    if (u.type === U.Interceptor) {
      const [x, y] = nukePos(u, game.tick);
      u.x = x;
      u.y = y;
      if (game.tick >= u.t1) {
        u.alive = false;
        const m = game.units.find((v) => v.id === u.target);
        if (m && m.alive) {
          m.alive = false;
          game.emit({ k: 'intercept', x: u.x, y: u.y, owner: u.owner });
          const sp = game.players[u.owner]!;
          sp.stats.nukesIntercepted++;
          game.notify(u.owner, 'notify.intercepted', 'good');
          game.notify(m.owner, 'notify.nukeIntercepted', 'warn');
        }
      }
      continue;
    }
    if (u.type !== U.Nuke) continue;
    if (game.tick < u.t0) continue;
    const [x, y] = nukePos(u, game.tick);
    u.x = x;
    u.y = y;
    if (u.kind === N.Mirv && game.tick >= u.t0 + Math.floor((u.t1 - u.t0) * MIRV_SPLIT_AT)) {
      u.alive = false;
      splitMirv(game, u);
      continue;
    }
    if (game.tick >= u.t1) {
      u.alive = false;
      detonate(game, u.kind, u.tx, u.ty, u.owner);
    }
  }
  if (game.config.decontamination && game.tick % Math.max(1, Math.round(DECONTAMINATION_TICKS / 255)) === 0) {
    decayFallout(game);
  }
}

export function detonate(game: Game, kind: N, cx: number, cy: number, by: number): void {
  const r = NUKE_RADIUS[kind];
  const rf = NUKE_FALLOUT_RADIUS[kind];
  const w = game.map.width;
  const lost = new Map<number, number>();
  const before = new Map<number, number>();
  const water = game.config.waterNukes;
  const seed = game.config.seed;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  for (let dy = -rf; dy <= rf; dy++) {
    for (let dx = -rf; dx <= rf; dx++) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (!game.map.inBounds(x, y)) continue;
      const d = Math.hypot(dx, dy);
      if (d > rf) continue;
      const t = y * w + x;
      const land = IS_LAND[game.map.terrain[t]!] === 1;
      if (!land && !water) continue;
      // Ragged edge unless "water nukes" (smooth circle).
      const edge = water ? 0 : ((hash2(x, y, seed) & 255) / 255 - 0.5) * 0.18 * r;
      if (d <= r + edge) {
        if (land) {
          const o = game.owner[t]!;
          if (o > 0) {
            if (!before.has(o)) before.set(o, game.players[o]!.tiles);
            lost.set(o, (lost.get(o) ?? 0) + 1);
            game.setOwner(t, 0);
          }
          game.setFallout(t, 255);
        }
      } else if (land) {
        const f = Math.min(1, 1 - (d - r) / Math.max(1, rf - r)); // d may be < r on the ragged edge
        if ((hash2(x, y, seed + 7) & 1023) / 1023 < f * 0.85) {
          game.setFallout(t, Math.max(game.fallout[t]!, Math.round(110 + 120 * f)));
        }
      }
    }
  }
  // Buildings, units and rails inside the blast.
  const doomed: Building[] = [];
  game.grid.query(cx, cy, r, (id) => {
    const b = game.buildings.get(id)!;
    if ((b.x + 0.5 - cx) ** 2 + (b.y + 0.5 - cy) ** 2 <= r * r) doomed.push(b);
  });
  for (const b of doomed) removeBuilding(game, b, false);
  for (const u of game.units) {
    if (!u.alive || u.type === U.Nuke || u.type === U.Interceptor) continue;
    if ((u.x - cx) ** 2 + (u.y - cy) ** 2 <= r * r) u.alive = false;
  }
  destroyRailsInRadius(game, cx, cy, r);
  // Population losses proportional to territory destroyed.
  for (const [o, n] of lost) {
    const p = game.players[o]!;
    const frac = Math.min(1, (n / Math.max(1, before.get(o) ?? 1)) * NUKE_TROOP_KILL);
    const kt = p.troops * frac;
    p.troops -= kt;
    p.workers -= p.workers * frac;
    p.stats.troopsLost += kt;
    if (o !== by) game.ai.nukedBy.set(o, by);
  }
  game.emit({ k: 'explosion', x: cx, y: cy, kind, radius: r, owner: by });
}

function decayFallout(game: Game): void {
  const f = game.fallout;
  for (let i = game.tick % 4; i < f.length; i += 4) {
    const v = f[i]!;
    if (v > 0) game.setFallout(i, v > 4 ? v - 4 : 0);
  }
}
