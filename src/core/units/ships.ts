// Naval units: transports (amphibious attacks), warships (targeting, veterancy,
// repair, patrol), merchant ships (trade income, piracy) and shells.
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import {
  B,
  MAX_TRANSPORTS,
  MERCHANT_DAMPING,
  MERCHANT_HP,
  MERCHANT_INTERVAL,
  MERCHANT_SPEED,
  PIRACY_RANGE,
  SHELL_SPEED,
  TRADE_BASE,
  TRADE_LEVEL_BONUS,
  TRADE_PER_TILE,
  TRANSPORT_HP,
  TRANSPORT_SPEED,
  VETERANCY_BONUS,
  VETERANCY_KILLS,
  WARSHIP_COSTS,
  WARSHIP_DAMAGE,
  WARSHIP_FIRE_TICKS,
  WARSHIP_HP,
  WARSHIP_PATROL_RADIUS,
  WARSHIP_RANGE,
  WARSHIP_REPAIR,
  portRange,
  WARSHIP_SPEED,
} from '../game/constants';
import { U, advanceOnPath, makeUnit, type Unit } from './unit';
import { launchAttack } from '../rules/combat';
import { addGold } from '../game/economy';
import type { Building } from '../buildings/building';
import { IS_LAND } from '../map/terrain';
import { techNaval } from '../rules/tech';

// ------------------------------------------------------------- helpers
function tileOf(game: Game, u: Unit): number {
  const w = game.map.width;
  const x = Math.min(w - 1, Math.max(0, Math.floor(u.x)));
  const y = Math.min(game.map.height - 1, Math.max(0, Math.floor(u.y)));
  return y * w + x;
}

function center(game: Game, tile: number): [number, number] {
  const w = game.map.width;
  return [(tile % w) + 0.5, ((tile / w) | 0) + 0.5];
}

export function unitById(game: Game, id: number): Unit | undefined {
  // Units are kept sorted by id: binary search.
  const arr = game.units;
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = arr[mid]!.id;
    if (v === id) return arr[mid];
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

export function addUnit(game: Game, u: Unit): Unit {
  game.units.push(u); // ids are monotonic, order stays sorted
  return u;
}

/** Nearest land tile touching a sizeable water body, searching around `tile`. */
export function findLanding(game: Game, tile: number, radius = 40): number {
  const map = game.map;
  const w = map.width;
  const x0 = tile % w;
  const y0 = (tile / w) | 0;
  let best = -1;
  let bestD = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d = dx * dx + dy * dy;
      if (d >= bestD || d > radius * radius) continue;
      const x = x0 + dx;
      const y = y0 + dy;
      if (!map.inBounds(x, y)) continue;
      const i = y * w + x;
      if (!map.isCoastalLand(i) || game.isDead(i)) continue;
      const wt = map.adjacentWater(i);
      if (wt < 0 || (map.componentSize[map.component[wt]!] ?? 0) < 120) continue;
      best = i;
      bestD = d;
    }
  }
  return best;
}

/** Owned coastal tile of p closest to `near`, adjacent to water body `body`. */
function bestDeparture(game: Game, p: Player, body: number, near: number): number {
  const w = game.map.width;
  const nx = near % w;
  const ny = (near / w) | 0;
  let best = -1;
  let bestD = Infinity;
  const coast = p.coast;
  // Sample at most ~4000 coastal tiles deterministically for very long coastlines.
  const step = Math.max(1, Math.floor(coast.length / 4000));
  for (let k = 0; k < coast.length; k += step) {
    const c = coast[k]!;
    const d = ((c % w) - nx) ** 2 + (((c / w) | 0) - ny) ** 2;
    if (d >= bestD) continue;
    const wt = game.map.adjacentWater(c);
    if (wt < 0 || game.map.component[wt] !== body) continue;
    best = c;
    bestD = d;
  }
  return best;
}

export type BoatError = 'ok' | 'max' | 'noLanding' | 'noCoast' | 'noPath' | 'friendly' | 'troops' | 'immune';

export function planBoat(
  game: Game,
  p: Player,
  tile: number,
): { error: BoatError; landing: number; from: number; path: number[] | null } {
  const landing = findLanding(game, tile);
  if (landing < 0) return { error: 'noLanding', landing, from: -1, path: null };
  const owner = game.owner[landing]!;
  if (owner === p.id || (owner > 0 && game.sameTeam(p.id, owner))) {
    return { error: 'friendly', landing, from: -1, path: null };
  }
  const wDst = game.map.adjacentWater(landing);
  const body = game.map.component[wDst]!;
  const dep = bestDeparture(game, p, body, landing);
  if (dep < 0) return { error: 'noCoast', landing, from: -1, path: null };
  const wSrc = game.map.adjacentWater(dep);
  const path = game.map.nav.findPath(wSrc, wDst);
  if (!path) return { error: 'noPath', landing, from: dep, path: null };
  return { error: 'ok', landing, from: wSrc, path };
}

export function launchBoat(game: Game, p: Player, tile: number, ratio: number): BoatError {
  if (game.phase !== 'playing') return 'noPath';
  let active = 0;
  for (const u of game.units) if (u.alive && u.type === U.Transport && u.owner === p.id) active++;
  if (active >= MAX_TRANSPORTS) return 'max';
  const troops = p.troops * ratio;
  if (troops < 50) return 'troops';
  const plan = planBoat(game, p, tile);
  if (plan.error !== 'ok') return plan.error;
  const targetOwner = game.owner[plan.landing]!;
  if (targetOwner > 0 && !game.attackAllowed(p.id, targetOwner, true)) return 'immune';
  p.troops -= troops;
  const [sx, sy] = center(game, plan.from);
  const u = makeUnit(game.nextId(), U.Transport, p.id, sx, sy);
  u.hp = u.maxHp = TRANSPORT_HP;
  u.path = plan.path!;
  u.pathIdx = 1;
  u.speed = TRANSPORT_SPEED;
  u.troops = troops;
  u.target = plan.landing;
  u.dest = targetOwner;
  u.t0 = game.tick;
  addUnit(game, u);
  return 'ok';
}

function landTransport(game: Game, u: Unit): void {
  const p = game.players[u.owner]!;
  const tile = u.target;
  const owner = game.owner[tile]!;
  if (!p.alive) return;
  if (owner === p.id || (owner > 0 && game.friendly(p.id, owner)) || !IS_LAND[game.map.terrain[tile]!]) {
    p.troops += u.troops; // bounce back home
    return;
  }
  if (owner > 0 && !game.attackAllowed(p.id, owner, true)) {
    p.troops += u.troops;
    return;
  }
  launchAttack(game, p.id, owner, u.troops, tile);
}

// -------------------------------------------------------------- warships
export function warshipCost(game: Game, p: Player): number {
  let owned = 0;
  for (const u of game.units) if (u.alive && u.type === U.Warship && u.owner === p.id) owned++;
  return WARSHIP_COSTS[Math.min(WARSHIP_COSTS.length - 1, owned)]!;
}

/** Ready ports of p whose water body contains `waterTile` (or any if -1), nearest first. */
function portsNear(game: Game, p: Player, tile: number): Building[] {
  const w = game.map.width;
  const tx = tile % w;
  const ty = (tile / w) | 0;
  const body = game.isWaterTile(tile) ? game.map.component[tile]! : -1;
  const ports: Building[] = [];
  for (const b of game.buildings.values()) {
    if (b.owner !== p.id || b.type !== B.Port || b.buildLeft > 0) continue;
    const wt = game.map.adjacentWater(b.tile);
    if (wt < 0) continue;
    if (body >= 0 && game.map.component[wt] !== body) continue;
    ports.push(b);
  }
  ports.sort(
    (a, b) => (a.x - tx) ** 2 + (a.y - ty) ** 2 - ((b.x - tx) ** 2 + (b.y - ty) ** 2) || a.id - b.id,
  );
  return ports;
}

export function buildWarship(game: Game, p: Player, tile: number): boolean {
  if (!game.config.allowPorts || game.phase !== 'playing') return false;
  const cost = warshipCost(game, p);
  if (p.gold < cost) return false;
  // The ship is laid down at the nearest own port whose radius of action covers the click.
  const w = game.map.width;
  const tx = tile % w;
  const ty = (tile / w) | 0;
  const port = portsNear(game, p, tile).find(
    (b) => (b.x - tx) ** 2 + (b.y - ty) ** 2 <= portRange(b.level) ** 2,
  );
  if (!port) return false;
  const wt = game.map.adjacentWater(port.tile);
  p.gold -= cost;
  p.warshipsBought++;
  const [x, y] = center(game, wt);
  const u = makeUnit(game.nextId(), U.Warship, p.id, x, y);
  const naval = techNaval(p);
  u.hp = u.maxHp = WARSHIP_HP * naval.hp;
  u.speed = WARSHIP_SPEED;
  u.home = port.id;
  u.patrol = game.isWaterTile(tile) && game.map.component[tile] === game.map.component[wt] ? tile : wt;
  u.cooldown = 10;
  addUnit(game, u);
  return true;
}

export function orderShips(game: Game, p: Player, ids: number[], tile: number): void {
  if (!game.isWaterTile(tile)) return;
  for (const id of ids) {
    const u = unitById(game, id);
    if (!u || !u.alive || u.owner !== p.id || u.type !== U.Warship) continue;
    if (game.map.component[tileOf(game, u)] !== game.map.component[tile]) continue;
    u.patrol = tile;
    u.path = [];
    u.pathIdx = 0;
    u.target = -1;
  }
}

function priorityOf(t: U): number {
  return t === U.Transport ? 3 : t === U.Warship ? 2 : t === U.Merchant ? 1 : 0;
}

function acquireTarget(game: Game, ship: Unit): void {
  let best: Unit | null = null;
  let bestScore = -Infinity;
  const r2 = WARSHIP_RANGE * WARSHIP_RANGE;
  for (const v of game.units) {
    if (!v.alive || v.owner === ship.owner) continue;
    if (v.type !== U.Transport && v.type !== U.Warship && v.type !== U.Merchant) continue;
    if (game.friendly(ship.owner, v.owner)) continue;
    // Merchants are only pirated from players we could attack.
    if (v.type === U.Merchant && !game.attackAllowed(ship.owner, v.owner, false)) continue;
    const d2 = (v.x - ship.x) ** 2 + (v.y - ship.y) ** 2;
    if (d2 > r2) continue;
    const score = priorityOf(v.type) * 1e6 - d2;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  ship.target = best ? best.id : -1;
}

function moveToward(game: Game, u: Unit, tx: number, ty: number, speed: number): void {
  const goal = Math.floor(ty) * game.map.width + Math.floor(tx);
  const here = tileOf(game, u);
  if (!game.isWaterTile(goal)) return;
  if (game.map.nav.lineOfWater(here, goal)) {
    u.path = [goal];
    u.pathIdx = 0;
  } else if (u.path.length === 0 || u.pathIdx >= u.path.length || u.dest !== goal) {
    const path = game.map.nav.findPath(here, goal, 20_000);
    u.path = path ?? [];
    u.pathIdx = path ? 1 : 0;
    u.dest = goal;
  }
  advanceOnPath(u, speed, game.map.width);
}

function patrolStep(game: Game, u: Unit, speed: number): void {
  if (u.patrol < 0) return;
  if (u.pathIdx < u.path.length) {
    advanceOnPath(u, speed, game.map.width);
    return;
  }
  // Pick a new deterministic waypoint around the patrol point.
  const w = game.map.width;
  const px = u.patrol % w;
  const py = (u.patrol / w) | 0;
  for (let tries = 0; tries < 6; tries++) {
    const a = game.rng.next() * Math.PI * 2;
    const r = game.rng.next() * WARSHIP_PATROL_RADIUS;
    const x = Math.round(px + Math.cos(a) * r);
    const y = Math.round(py + Math.sin(a) * r);
    if (!game.map.inBounds(x, y)) continue;
    const t = y * w + x;
    if (!game.isWaterTile(t) || game.map.component[t] !== game.map.component[u.patrol]) continue;
    const path = game.map.nav.findPath(tileOf(game, u), t, 20_000);
    if (path) {
      u.path = path;
      u.pathIdx = 1;
      u.cooldown = Math.max(u.cooldown, 0);
      return;
    }
  }
}

function fire(game: Game, ship: Unit, target: Unit): void {
  const s = makeUnit(game.nextId(), U.Shell, ship.owner, ship.x, ship.y);
  s.target = target.id;
  s.speed = SHELL_SPEED;
  s.kind = WARSHIP_DAMAGE * (1 + VETERANCY_BONUS * ship.level) * techNaval(game.players[ship.owner]!).damage;
  s.home = ship.id;
  addUnit(game, s);
}

function nearFriendlyPort(game: Game, u: Unit): boolean {
  let found = false;
  const maxR = portRange(10);
  game.grid.query(u.x, u.y, maxR, (id) => {
    if (found) return;
    const b = game.buildings.get(id)!;
    if (
      b.type === B.Port &&
      game.friendly(b.owner, u.owner) &&
      (b.x - u.x) ** 2 + (b.y - u.y) ** 2 < portRange(b.level) ** 2
    )
      found = true;
  });
  return found;
}

function killUnit(game: Game, victim: Unit, by: number): void {
  if (!victim.alive) return;
  victim.alive = false;
  const owner = game.players[victim.owner];
  if (owner) owner.stats.shipsLost++;
  const killer = game.players[by];
  if (killer) killer.stats.shipsSunk++;
  game.emit({ k: 'shipSunk', x: victim.x, y: victim.y, owner: victim.owner, by });
  if (victim.type === U.Transport) {
    game.notify(victim.owner, 'notify.transportSunk', 'danger', { troops: Math.round(victim.troops) });
  }
}

function captureMerchant(game: Game, ship: Unit, m: Unit): void {
  const pirate = game.players[ship.owner]!;
  const prev = m.owner;
  m.owner = ship.owner;
  const home = portsNear(game, pirate, tileOf(game, m))[0];
  if (!home) {
    m.alive = false;
    return;
  }
  const dst = game.map.adjacentWater(home.tile);
  const path = game.map.nav.findPath(tileOf(game, m), dst);
  if (!path) {
    m.alive = false;
    return;
  }
  m.path = path;
  m.pathIdx = 1;
  m.dest = home.id;
  m.kind = 1; // pirated
  game.emit({ k: 'capture', x: m.x, y: m.y, owner: prev, by: ship.owner });
  game.notify(prev, 'notify.merchantPirated', 'warn', { by: ship.owner });
}

// --------------------------------------------------------------- merchants
const pathCache = new Map<string, number[] | null>();

export function clearPathCache(): void {
  pathCache.clear();
}

function tradePath(game: Game, from: Building, to: Building): number[] | null {
  const key = `${game.map.meta.id}:${from.tile}>${to.tile}`;
  if (pathCache.has(key)) return pathCache.get(key)!;
  const a = game.map.adjacentWater(from.tile);
  const b = game.map.adjacentWater(to.tile);
  const path = a >= 0 && b >= 0 ? game.map.nav.findPath(a, b) : null;
  if (pathCache.size > 4000) pathCache.clear();
  pathCache.set(key, path);
  return path;
}

function spawnMerchants(game: Game, merchants: number): void {
  const tradeMult = game.features.tradeMult;
  for (const port of game.buildings.values()) {
    if (port.type !== B.Port || port.buildLeft > 0) continue;
    const owner = game.players[port.owner]!;
    if (!owner.alive || owner.kind === 'tribe') continue;
    port.timer++;
    const interval =
      ((MERCHANT_INTERVAL / (1 + 0.5 * (port.level - 1))) * (1 + merchants / MERCHANT_DAMPING)) /
      Math.max(0.2, tradeMult);
    if (port.timer < interval) continue;
    port.timer = 0;
    const wt = game.map.adjacentWater(port.tile);
    if (wt < 0) continue;
    const body = game.map.component[wt];
    const candidates: Building[] = [];
    for (const other of game.buildings.values()) {
      if (other.type !== B.Port || other.owner === port.owner || other.buildLeft > 0) continue;
      const o = game.players[other.owner]!;
      if (!o.alive || o.kind === 'tribe' || owner.hasEmbargoWith(o, game.tick)) continue;
      const ow = game.map.adjacentWater(other.tile);
      if (ow < 0 || game.map.component[ow] !== body) continue;
      candidates.push(other);
    }
    if (candidates.length === 0) continue;
    const dest = candidates[game.rng.int(0, candidates.length - 1)]!;
    const path = tradePath(game, port, dest);
    if (!path) continue;
    const [x, y] = center(game, wt);
    const m = makeUnit(game.nextId(), U.Merchant, port.owner, x, y);
    m.hp = m.maxHp = MERCHANT_HP;
    m.speed = MERCHANT_SPEED;
    m.path = path;
    m.pathIdx = 1;
    m.home = port.id;
    m.dest = dest.id;
    m.level = port.level;
    m.t0 = game.tick;
    m.sx = x;
    m.sy = y;
    addUnit(game, m);
    merchants++;
  }
}

function arriveMerchant(game: Game, m: Unit): void {
  const dest = game.buildings.get(m.dest);
  const owner = game.players[m.owner]!;
  if (!dest || !owner.alive) return;
  const dist = Math.hypot(m.x - m.sx, m.y - m.sy);
  const travelled = (game.tick - m.t0) * MERCHANT_SPEED;
  const base =
    (TRADE_BASE + Math.max(dist, travelled) * TRADE_PER_TILE) *
    (1 + TRADE_LEVEL_BONUS * (m.level - 1)) *
    game.features.tradeMult;
  if (m.kind === 1) {
    // Pirated cargo unloads in the pirate's own port.
    addGold(owner, base);
    owner.stats.tradeGold += base;
    owner.incomeBreakdown.trade += base;
    game.emit({ k: 'tradePay', x: dest.x, y: dest.y, owner: owner.id, amount: Math.round(base) });
    return;
  }
  const host = game.players[dest.owner]!;
  if (!host.alive || owner.hasEmbargoWith(host, game.tick)) return;
  addGold(owner, base);
  owner.stats.tradeGold += base;
  owner.incomeBreakdown.trade += base;
  addGold(host, base * 0.5);
  host.stats.tradeGold += base * 0.5;
  host.incomeBreakdown.trade += base * 0.5;
  game.emit({ k: 'tradePay', x: dest.x, y: dest.y, owner: owner.id, amount: Math.round(base) });
}

// ------------------------------------------------------------------ update
export function updateShips(game: Game): void {
  let merchants = 0;
  for (const u of game.units) if (u.alive && u.type === U.Merchant) merchants++;
  if (game.config.allowPorts) spawnMerchants(game, merchants);
  const w = game.map.width;

  for (const u of game.units) {
    if (!u.alive) continue;
    const owner = game.players[u.owner];
    switch (u.type) {
      case U.Transport: {
        if (!owner || !owner.alive) {
          u.hp -= 5;
          if (u.hp <= 0) u.alive = false;
          break;
        }
        const speed = u.speed * game.features.shipSpeedAt(u.x, u.y);
        if (advanceOnPath(u, speed, w)) {
          u.alive = false;
          landTransport(game, u);
        }
        break;
      }
      case U.Merchant: {
        if (!owner || !owner.alive) {
          u.alive = false;
          break;
        }
        const speed = u.speed * game.features.shipSpeedAt(u.x, u.y);
        if (advanceOnPath(u, speed, w)) {
          u.alive = false;
          arriveMerchant(game, u);
        }
        break;
      }
      case U.Warship:
        updateWarship(game, u);
        break;
      case U.Shell: {
        const t = unitById(game, u.target);
        if (!t || !t.alive) {
          u.alive = false;
          break;
        }
        const dx = t.x - u.x;
        const dy = t.y - u.y;
        const d = Math.hypot(dx, dy);
        if (d <= u.speed) {
          u.alive = false;
          t.hp -= u.kind;
          if (t.hp <= 0) {
            killUnit(game, t, u.owner);
            const shooter = unitById(game, u.home);
            if (shooter && shooter.alive) {
              shooter.kills++;
              let lvl = 0;
              for (const k of VETERANCY_KILLS) if (shooter.kills >= k) lvl++;
              if (lvl > shooter.level) {
                shooter.level = lvl;
                shooter.maxHp =
                  WARSHIP_HP * (1 + VETERANCY_BONUS * lvl) * techNaval(game.players[shooter.owner]!).hp;
                shooter.hp = Math.min(shooter.maxHp, shooter.hp + WARSHIP_HP * VETERANCY_BONUS);
                game.notify(shooter.owner, 'notify.veterancy', 'good', { level: lvl });
              }
            }
          }
        } else {
          u.x += (dx / d) * u.speed;
          u.y += (dy / d) * u.speed;
        }
        break;
      }
      default:
        break;
    }
  }
  if (game.units.some((u) => !u.alive)) game.units = game.units.filter((u) => u.alive);
}

function updateWarship(game: Game, u: Unit): void {
  const owner = game.players[u.owner];
  if (!owner || !owner.alive) {
    u.hp -= 8; // abandoned fleets sink progressively
    if (u.hp <= 0) u.alive = false;
    return;
  }
  if (u.hp <= 0) {
    u.alive = false;
    return;
  }
  if (u.hp < u.maxHp && game.tick % 5 === 0 && nearFriendlyPort(game, u))
    u.hp = Math.min(u.maxHp, u.hp + WARSHIP_REPAIR * 5);
  if (u.cooldown > 0) u.cooldown--;
  if ((game.tick + u.id) % 5 === 0) acquireTarget(game, u);
  const speed = u.speed * game.features.shipSpeedAt(u.x, u.y);
  const target = u.target >= 0 ? unitById(game, u.target) : undefined;
  if (target && target.alive) {
    if (target.type === U.Merchant) {
      const d = Math.hypot(target.x - u.x, target.y - u.y);
      if (d <= PIRACY_RANGE) {
        captureMerchant(game, u, target);
        u.target = -1;
      } else {
        moveToward(game, u, target.x, target.y, speed);
      }
      return;
    }
    if (u.cooldown === 0) {
      fire(game, u, target);
      u.cooldown = WARSHIP_FIRE_TICKS;
    }
    // Close in slowly on transports to keep them in range.
    if (target.type === U.Transport && Math.hypot(target.x - u.x, target.y - u.y) > 60) {
      moveToward(game, u, target.x, target.y, speed);
      return;
    }
  }
  patrolStep(game, u, speed * 0.6);
}

export { tileOf as unitTile };
export type { Player };
