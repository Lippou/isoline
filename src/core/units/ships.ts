// Naval units: transports (amphibious attacks, retreat), warships (targeting, veterancy,
// repair retreats to port, patrol), merchant ships (trade income, piracy) and shells.
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import {
  B,
  MAX_TRANSPORTS,
  MERCHANT_HP,
  MERCHANT_SPEED,
  PIRACY_RANGE,
  RETREAT_MALUS,
  RIVER_SAIL_SPEED,
  SHELL_SPEED,
  TRADE_PER_TILE,
  TRADE_ROLL_TICKS,
  TRADE_SHORT_RANGE,
  TRADE_SIGMOID_GOLD,
  TRADE_SIGMOID_K,
  TRADE_SPAWN_RATE,
  TRADE_CAPACITY_KNEE,
  TRANSPORT_HP,
  TRANSPORT_MIN_TROOPS,
  TRANSPORT_SPEED,
  VETERANCY_BONUS,
  VETERANCY_KILLS,
  WARSHIP_COST_CAP,
  WARSHIP_COST_STEP,
  WARSHIP_DAMAGE,
  WARSHIP_DOCK_RANGE,
  WARSHIP_FIRE_TICKS,
  WARSHIP_HP,
  WARSHIP_HUNT_SPEED,
  WARSHIP_MANUAL_LOCK_TICKS,
  WARSHIP_PASSIVE_HEAL,
  WARSHIP_PASSIVE_HEAL_RANGE,
  WARSHIP_PATROL_RANGE,
  WARSHIP_PORT_HEAL_PER_LEVEL,
  WARSHIP_PORT_SWITCH,
  WARSHIP_RANGE,
  WARSHIP_RETREAT_HP,
  portRange,
  WARSHIP_SPEED,
} from '../game/constants';
import { U, makeUnit, sailOnPath, type Unit } from './unit';
import { launchAttack } from '../rules/combat';
import { navalHostilities, noteTrade, openHostilities } from '../rules/diplomacy';
import { addGold } from '../game/economy';
import { inService, type Building } from '../buildings/building';
import { IS_LAND, T } from '../map/terrain';
import { techNaval } from '../rules/tech';
import { FOG_SIGHT, inFogBank, sightBetween } from '../rules/weather';

/** Transport `kind`: 0 sailing to its landing, 1 turned back home. */
export const TRANSPORT_RETREATING = 1;
/** Warship `kind` (OpenFront's warship state); `home` holds the port it repairs at. */
export const enum WS {
  Patrolling = 0,
  Retreating = 1,
  Docked = 2,
}

// ------------------------------------------------------------- helpers
function tileOf(game: Game, u: Unit): number {
  const w = game.map.width;
  const x = Math.min(w - 1, Math.max(0, Math.floor(u.x)));
  const y = Math.min(game.map.height - 1, Math.max(0, Math.floor(u.y)));
  return y * w + x;
}

/** Steps a ship sails this tick: weather, and the slow going up a river. */
function sailSpeed(game: Game, u: Unit): number {
  const river = game.map.terrain[tileOf(game, u)] === T.River ? RIVER_SAIL_SPEED : 1;
  return u.speed * game.features.shipSpeedAt(u.x, u.y) * river;
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

/**
 * Nearest land tile touching a sizeable naval body (a sea or a lake of 120+ tiles, or a
 * river flowing into one), searching around `tile`.
 */
export function findLanding(game: Game, tile: number, radius = 40, skipOwner = -1): number {
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
      if (skipOwner > 0 && friendlyLand(game, skipOwner, i)) continue;
      const wt = map.adjacentWater(i);
      if (wt < 0 || map.navWater(wt) < 120) continue;
      best = i;
      bestD = d;
    }
  }
  return best;
}

/** Navigable tiles of naval body `body` beside the 4 sides of `tile`. */
function waterBeside(game: Game, tile: number, body: number, out: number[] = []): number[] {
  const map = game.map;
  const w = map.width;
  const x = tile % w;
  if (x > 0 && map.navBody[tile - 1] === body) out.push(tile - 1);
  if (x < w - 1 && map.navBody[tile + 1] === body) out.push(tile + 1);
  if (tile >= w && map.navBody[tile - w] === body) out.push(tile - w);
  if (tile < map.size - w && map.navBody[tile + w] === body) out.push(tile + w);
  return out;
}

/**
 * The water of naval body `body` along p's coasts (sea, lake or river banks): the sources
 * of OpenFront's closestShoreByWater, a multi-source water search from every coastal tile
 * that finds p's shore nearest a point by sea. The nearest shore as the crow flies could
 * lie across a cape or an isthmus: the boat left from there, not from the island the
 * player meant, and sailed all the way round.
 */
function shoreWater(game: Game, p: Player, body: number): number[] {
  const out: number[] = [];
  for (const c of p.coast) waterBeside(game, c, body, out);
  return out;
}

/** p's coastal tile beside the water tile `wt` (-1 none). */
function shoreOf(game: Game, p: Player, wt: number): number {
  const map = game.map;
  const w = map.width;
  const x = wt % w;
  for (const n of [x > 0 ? wt - 1 : -1, x < w - 1 ? wt + 1 : -1, wt - w, wt + w]) {
    if (n >= 0 && n < map.size && game.owner[n] === p.id && map.isLand(n)) return n;
  }
  return -1;
}

/** Tile held by p or a teammate (no landing there). */
function friendlyLand(game: Game, p: number, tile: number): boolean {
  const owner = game.owner[tile]!;
  return owner === p || (owner > 0 && game.sameTeam(p, owner));
}

export type BoatError = 'ok' | 'max' | 'noLanding' | 'noCoast' | 'noPath' | 'friendly' | 'troops' | 'immune';

export function planBoat(
  game: Game,
  p: Player,
  tile: number,
): { error: BoatError; landing: number; from: number; path: number[] | null } {
  // Aiming at foreign land, our own banks in between are skipped (a river often runs
  // along the frontier): the boat lands on the far side.
  const landing = findLanding(game, tile, 40, friendlyLand(game, p.id, tile) ? -1 : p.id);
  if (landing < 0) return { error: 'noLanding', landing, from: -1, path: null };
  if (friendlyLand(game, p.id, landing)) {
    return { error: 'friendly', landing, from: -1, path: null };
  }
  // Every side of the landing on its sea counts: a spit or a point has water on two.
  const body = game.map.navBody[game.map.adjacentWater(landing)]!;
  const sources = shoreWater(game, p, body);
  if (sources.length === 0) return { error: 'noCoast', landing, from: -1, path: null };
  const path = game.map.nav.route(sources, waterBeside(game, landing, body));
  if (!path) return { error: 'noPath', landing, from: -1, path: null };
  return { error: 'ok', landing, from: path[0]!, path };
}

/**
 * Transport fields: `troops` aboard, `target` the land tile it sails to (the landing, or
 * the home coast once turned back), `dest` the landing's owner at launch, `kind`
 * TRANSPORT_RETREATING once turned back, (`sx`, `sy`) the launch point.
 */
export function launchBoat(game: Game, p: Player, tile: number, ratio: number): BoatError {
  if (game.phase !== 'playing') return 'noPath';
  let active = 0;
  for (const u of game.units) if (u.alive && u.type === U.Transport && u.owner === p.id) active++;
  if (active >= MAX_TRANSPORTS) return 'max';
  const troops = p.troops * ratio;
  if (troops < TRANSPORT_MIN_TROOPS) return 'troops';
  const plan = planBoat(game, p, tile);
  if (plan.error !== 'ok') return plan.error;
  const targetOwner = game.owner[plan.landing]!;
  if (targetOwner > 0 && !game.attackAllowed(p.id, targetOwner, true)) return 'immune';
  if (targetOwner > 0) navalHostilities(game, p, game.players[targetOwner]!);
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
  u.sx = sx;
  u.sy = sy;
  addUnit(game, u);
  return 'ok';
}

/**
 * Navigable tile under a ship. A leg between waypoints is a straight line that may cut a
 * corner of land: then the last waypoint it passed, or else the first navigable tile
 * around it (a ship whose path was cleared on such a corner used to be stranded there).
 */
function waterUnder(game: Game, u: Unit): number {
  const t = tileOf(game, u);
  const map = game.map;
  if (map.isNavigable(t)) return t;
  const prev = u.path[Math.min(u.pathIdx, u.path.length) - 1];
  if (prev !== undefined && map.isNavigable(prev)) return prev;
  const w = map.width;
  const x = t % w;
  const y = (t / w) | 0;
  // A warship belongs to its patrol's body: a lake beside the corner is not its water (a
  // ship that took it for its own was penned in that lake for good).
  const body = u.type === U.Warship && u.patrol >= 0 ? map.navBody[u.patrol]! : 0;
  for (let pass = body > 0 ? 0 : 1; pass < 2; pass++)
    for (let r = 1; r <= (pass === 0 ? 8 : 2); r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !map.inBounds(x + dx, y + dy)) continue;
          const n = t + dy * w + dx;
          if (map.isNavigable(n) && (pass === 1 || map.navBody[n] === body)) return n;
        }
  return -1;
}

/** Points a transport at its owner's nearest coast by sea (OpenFront's bestShoreDeploymentSource). */
function routeHome(game: Game, u: Unit): boolean {
  const here = waterUnder(game, u);
  if (here < 0) return false;
  const p = game.players[u.owner]!;
  const path = game.map.nav.route(shoreWater(game, p, game.map.navBody[here]!), [here]);
  if (!path) return false;
  path.reverse();
  const home = shoreOf(game, p, path[path.length - 1]!);
  if (home < 0) return false;
  u.path = path;
  u.pathIdx = 0;
  u.target = home;
  return true;
}

/**
 * OpenFront's BoatRetreatExecution: the transport turns back to its owner's nearest coast
 * on its sea; landing there, its troops rejoin the pool, RETREAT_MALUS of them lost. With
 * no coast (or no route) to go back to, they come home at once, in full.
 */
export function retreatTransport(game: Game, p: Player, id: number): boolean {
  const u = unitById(game, id);
  if (!u || !u.alive || u.owner !== p.id || u.type !== U.Transport || u.kind === TRANSPORT_RETREATING)
    return false;
  u.kind = TRANSPORT_RETREATING;
  if (!routeHome(game, u)) {
    p.troops += u.troops;
    u.troops = 0;
    u.alive = false;
  }
  return true;
}

/** A transport reaches its target tile (OpenFront's TransportShipExecution, path complete). */
function landTransport(game: Game, u: Unit): void {
  const p = game.players[u.owner]!;
  const tile = u.target;
  const owner = game.owner[tile]!;
  if (!p.alive) return;
  if (owner === p.id) {
    // Back on its own land (a retreat): the troops rejoin the pool, a quarter lost.
    const deaths = u.troops * RETREAT_MALUS;
    p.troops += u.troops - deaths;
    p.stats.troopsLost += deaths;
    return;
  }
  if ((owner > 0 && game.friendly(p.id, owner)) || !IS_LAND[game.map.terrain[tile]!] || game.isDead(tile)) {
    p.troops += u.troops; // bounce back home
    return;
  }
  if (owner > 0 && !game.attackAllowed(p.id, owner, true)) {
    p.troops += u.troops;
    return;
  }
  // The landing tile is taken outright; the attack spreads from it.
  if (owner > 0) openHostilities(game, p, game.players[owner]!);
  game.setOwner(tile, p.id);
  launchAttack(game, p.id, owner, u.troops, tile);
}

// -------------------------------------------------------------- warships
/** min(1M, 250k × (n + 1)) with n = min(warships afloat, warships ever built). */
export function warshipCost(game: Game, p: Player): number {
  let owned = 0;
  for (const u of game.units) if (u.alive && u.type === U.Warship && u.owner === p.id) owned++;
  const n = Math.min(owned, p.warshipsBuilt);
  const cost = Math.min(WARSHIP_COST_CAP, WARSHIP_COST_STEP * (n + 1));
  return game.config.features.tech ? Math.round(cost * techNaval(p).shipCost) : cost; // Shipyards
}

/** Ready ports of p on the naval body of `tile` (any when it is not navigable), nearest first. */
function portsNear(game: Game, p: Player, tile: number): Building[] {
  const w = game.map.width;
  const tx = tile % w;
  const ty = (tile / w) | 0;
  const body = game.map.isNavigable(tile) ? game.map.navBody[tile]! : -1;
  const ports: Building[] = [];
  for (const b of game.buildings.values()) {
    if (b.owner !== p.id || b.type !== B.Port || !inService(b)) continue;
    const wt = game.map.adjacentWater(b.tile);
    if (wt < 0) continue;
    if (body >= 0 && game.map.navBody[wt] !== body) continue;
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
  p.warshipsBuilt++;
  const [x, y] = center(game, wt);
  const u = makeUnit(game.nextId(), U.Warship, p.id, x, y);
  const naval = techNaval(p);
  u.hp = u.maxHp = WARSHIP_HP * naval.hp;
  u.speed = WARSHIP_SPEED;
  u.patrol = game.map.isNavigable(tile) && game.map.navBody[tile] === game.map.navBody[wt] ? tile : wt;
  u.cooldown = 10;
  addUnit(game, u);
  return true;
}

/** A move order: new patrol point; a repair retreat is called off and auto-retreat held for a while (OpenFront). */
export function orderShips(game: Game, p: Player, ids: number[], tile: number): void {
  if (!game.map.isNavigable(tile)) return;
  for (const id of ids) {
    const u = unitById(game, id);
    if (!u || !u.alive || u.owner !== p.id || u.type !== U.Warship) continue;
    const here = waterUnder(game, u);
    if (here < 0 || game.map.navBody[here] !== game.map.navBody[tile]) continue;
    u.patrol = tile;
    u.path = [];
    u.pathIdx = 0;
    u.target = -1;
    u.kind = WS.Patrolling;
    u.home = -1;
    u.t1 = game.tick + WARSHIP_MANUAL_LOCK_TICKS;
  }
}

function priorityOf(t: U): number {
  return t === U.Transport ? 3 : t === U.Warship ? 2 : t === U.Merchant ? 1 : 0;
}

/**
 * OpenFront's target choice within WARSHIP_RANGE of the ship: the nearest transport, else
 * the nearest warship, else the nearest merchant worth pirating — one sailing within
 * WARSHIP_PATROL_RANGE of the patrol point, bound for a port that is neither ours nor a
 * friend's, while we have a port on this sea to bring it home.
 */
function acquireTarget(game: Game, ship: Unit): void {
  let best: Unit | null = null;
  let bestScore = -Infinity;
  const r2 = WARSHIP_RANGE * WARSHIP_RANGE;
  const pr2 = WARSHIP_PATROL_RANGE * WARSHIP_PATROL_RANGE;
  const [px, py]: [number, number] = ship.patrol >= 0 ? center(game, ship.patrol) : [ship.x, ship.y];
  let hasPort: boolean | undefined;
  let shipBody: number | undefined;
  // Weather: across a fog bank (around the warship or its prey) it spots at half range.
  const fogged = inFogBank(game, ship.x, ship.y);
  const fr2 = r2 * FOG_SIGHT * FOG_SIGHT;
  for (const v of game.units) {
    if (!v.alive || v.owner === ship.owner) continue;
    if (v.type !== U.Transport && v.type !== U.Warship && v.type !== U.Merchant) continue;
    if (v.type === U.Warship && v.kind === WS.Docked) continue; // safe in port (OpenFront)
    if (game.friendly(ship.owner, v.owner)) continue;
    const d2 = (v.x - ship.x) ** 2 + (v.y - ship.y) ** 2;
    if (d2 > r2) continue;
    if (d2 > fr2 && (fogged || inFogBank(game, v.x, v.y))) continue;
    if (v.type === U.Merchant) {
      // Merchants are only pirated from players we could attack.
      if (!game.attackAllowed(ship.owner, v.owner, false)) continue;
      if ((v.x - px) ** 2 + (v.y - py) ** 2 > pr2) continue;
      const dest = game.buildings.get(v.dest);
      if (dest && game.friendly(ship.owner, dest.owner)) continue;
      hasPort ??= portsNear(game, game.players[ship.owner]!, tileOf(game, ship)).length > 0;
      if (!hasPort) continue;
      // Across land (another sea, a lake) it could never be reached: the ship parked.
      shipBody ??= game.map.navBody[waterUnder(game, ship)] ?? -1;
      if (game.map.navBody[waterUnder(game, v)] !== shipBody) continue;
    }
    const score = priorityOf(v.type) * 1e6 - d2;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  ship.target = best ? best.id : -1;
}

function moveToward(game: Game, u: Unit, goal: number, speed: number, budget = 20_000): void {
  if (goal < 0 || !game.map.isNavigable(goal)) return;
  // Routes start from water: off a land corner, the ship first sails back to that tile.
  const here = waterUnder(game, u);
  if (here < 0) return;
  const onWater = here === tileOf(game, u);
  if (onWater && game.map.nav.lineOfWater(here, goal)) {
    u.path = [goal];
    u.pathIdx = 0;
  } else if (u.path.length === 0 || u.pathIdx >= u.path.length || u.dest !== goal) {
    const path = game.map.nav.findPath(here, goal, budget);
    u.path = path ?? [];
    u.pathIdx = path && onWater ? 1 : 0;
    u.dest = goal;
  }
  sailOnPath(u, speed, game.map.width);
}

/** Random draws per patrol square before it grows (OpenFront's randomTile). */
const PATROL_DRAWS = 500;

/**
 * OpenFront's randomTile: a waypoint on the patrol's water within ± range / 2 of the patrol
 * point, off the shore (and off the rivers, unless the ship is posted on one); after
 * PATROL_DRAWS misses the square grows by half, three times; then shores and rivers do.
 * Six draws a tick used to leave a ship posted where open water is scarce (a river mouth,
 * a narrow fjord) standing still, or for good at the dead end of a river. -1: none.
 */
function patrolWaypoint(game: Game, u: Unit): number {
  const map = game.map;
  const w = map.width;
  const px = u.patrol % w;
  const py = (u.patrol / w) | 0;
  const body = map.navBody[u.patrol]!;
  const onRiver = map.terrain[u.patrol] === T.River;
  for (let loose = 0; loose < 2; loose++) {
    let range = WARSHIP_PATROL_RANGE;
    for (let grow = 0; grow <= 3; grow++) {
      const half = range >> 1;
      for (let k = 0; k < PATROL_DRAWS; k++) {
        const x = px + game.rng.int(-half, half);
        const y = py + game.rng.int(-half, half);
        if (!map.inBounds(x, y)) continue;
        const t = y * w + x;
        if (map.navBody[t] !== body) continue;
        if (!loose && (map.coastDist[t] === 0 || (!onRiver && map.terrain[t] === T.River))) continue;
        return t;
      }
      range += range >> 1;
    }
  }
  return -1;
}

function patrolStep(game: Game, u: Unit, speed: number): void {
  if (u.patrol < 0) return;
  if (u.pathIdx < u.path.length) {
    sailOnPath(u, speed, game.map.width);
    return;
  }
  const here = waterUnder(game, u);
  if (here < 0) return;
  // A ship carried onto another body of water (older saves) patrols where it is.
  if (game.map.navBody[here] !== game.map.navBody[u.patrol]) {
    u.patrol = here;
    return;
  }
  const t = patrolWaypoint(game, u);
  if (t >= 0) {
    // Far from its patrol point (a move order, back from a repair or a chase), the short
    // search would not reach the waypoint: the full one.
    const w = game.map.width;
    const far =
      Math.max(Math.abs((here % w) - (u.patrol % w)), Math.abs(((here / w) | 0) - ((u.patrol / w) | 0))) >
      WARSHIP_PATROL_RANGE;
    const path = game.map.nav.findPath(here, t, far ? 400_000 : 20_000);
    if (path) {
      u.path = path;
      u.pathIdx = here === tileOf(game, u) ? 1 : 0;
      return;
    }
  }
  // No waypoint, or no route to it: head back to the patrol point, or else patrol where it is.
  const back = game.map.nav.findPath(here, u.patrol);
  if (back) {
    u.path = back;
    u.pathIdx = here === tileOf(game, u) ? 1 : 0;
  } else u.patrol = here;
}

function fire(game: Game, ship: Unit, target: Unit): void {
  const s = makeUnit(game.nextId(), U.Shell, ship.owner, ship.x, ship.y);
  s.target = target.id;
  s.speed = SHELL_SPEED;
  s.kind = WARSHIP_DAMAGE * (1 + VETERANCY_BONUS * ship.level) * techNaval(game.players[ship.owner]!).damage;
  s.home = ship.id;
  addUnit(game, s);
}

// ---------------------------------------------------------- warship repairs
/** Warships of the port's owner docked at it (`except` left out). */
function dockedAt(game: Game, port: Building, except?: Unit): number {
  let n = 0;
  for (const v of game.units)
    if (v.alive && v.type === U.Warship && v.kind === WS.Docked && v.home === port.id && v !== except) n++;
  return n;
}

/** A port holds one docked ship per level. */
function portFull(game: Game, port: Building, except?: Unit): boolean {
  return dockedAt(game, port, except) >= port.level;
}

/** The port a retreating or docked warship repairs at, while it is still one of its owner's. */
function repairPort(game: Game, u: Unit): Building | null {
  const b = game.buildings.get(u.home);
  return b && b.type === B.Port && b.owner === u.owner && inService(b) ? b : null;
}

/** OpenFront's healing: 1 hp a tick near one of your ports, plus the docked share of the port's pool. */
function healWarship(game: Game, u: Unit): void {
  if (u.hp >= u.maxHp) return;
  const r2 = WARSHIP_PASSIVE_HEAL_RANGE * WARSHIP_PASSIVE_HEAL_RANGE;
  let near = false;
  game.grid.query(u.x, u.y, WARSHIP_PASSIVE_HEAL_RANGE, (id) => {
    if (near) return;
    const b = game.buildings.get(id)!;
    if (b.type === B.Port && b.owner === u.owner && inService(b) && (b.x - u.x) ** 2 + (b.y - u.y) ** 2 <= r2)
      near = true;
  });
  let heal = near ? WARSHIP_PASSIVE_HEAL : 0;
  if (u.kind === WS.Docked) {
    const port = repairPort(game, u);
    if (port) heal += (port.level * WARSHIP_PORT_HEAL_PER_LEVEL) / Math.max(1, dockedAt(game, port));
  }
  u.hp = Math.min(u.maxHp, u.hp + heal);
}

/** A warship with no route to a port tries again after 10 s. */
const WARSHIP_REPAIR_RETRY_TICKS = 100;

function endRepair(u: Unit): void {
  u.kind = WS.Patrolling;
  u.home = -1;
  u.path = [];
  u.pathIdx = 0;
}

/** Breaks off for the nearest of its owner's ports on its sea (none: it keeps patrolling). */
function startRepair(game: Game, u: Unit): void {
  const here = waterUnder(game, u);
  const port = here >= 0 ? portsNear(game, game.players[u.owner]!, here)[0] : undefined;
  if (!port) return;
  u.kind = WS.Retreating;
  u.home = port.id;
  u.target = -1;
  u.path = [];
  u.pathIdx = 0;
}

/**
 * OpenFront's refreshRetreatPortTile: a lost port is replaced by the nearest one with a free
 * berth; a full one too, when there is a free one; and a free port markedly closer
 * (under WARSHIP_PORT_SWITCH of the squared distance) is preferred. False: nowhere to go.
 */
function refreshRepairPort(game: Game, u: Unit): boolean {
  const current = repairPort(game, u);
  if (current && (game.tick + u.id) % 5 !== 0) return true;
  const here = waterUnder(game, u);
  if (here < 0) return current !== null;
  const ports = portsNear(game, game.players[u.owner]!, here);
  const free = ports.find((b) => !portFull(game, b, u));
  const onSea = current !== null && ports.includes(current);
  if (!onSea) {
    if (!free) return false;
    u.home = free.id;
    return true;
  }
  if (!free || free === current) return true;
  const d2 = (b: Building) => (b.x - u.x) ** 2 + (b.y - u.y) ** 2;
  if (portFull(game, current, u) || d2(free) < d2(current) * WARSHIP_PORT_SWITCH) u.home = free.id;
  return true;
}

/**
 * A retreating warship sails for its port without firing, and docks within
 * WARSHIP_DOCK_RANGE if a berth is free (else it waits off the port, or resumes its patrol
 * once healed). Returns false when the retreat is over.
 */
function sailToRepair(game: Game, u: Unit, speed: number): boolean {
  if (!refreshRepairPort(game, u)) {
    endRepair(u);
    return false;
  }
  const port = repairPort(game, u)!;
  u.target = -1;
  if ((port.x + 0.5 - u.x) ** 2 + (port.y + 0.5 - u.y) ** 2 <= WARSHIP_DOCK_RANGE * WARSHIP_DOCK_RANGE) {
    if (!portFull(game, port, u)) {
      u.kind = WS.Docked;
      u.path = [];
      u.pathIdx = 0;
      return true;
    }
    if (u.hp < u.maxHp) return true;
    endRepair(u);
    return false;
  }
  // The whole route home: a far port is beyond the chase's short search.
  moveToward(game, u, game.map.adjacentWater(port.tile), speed, 400_000);
  if (u.path.length === 0) {
    // No route to the port: patrol on, and only try again a while later (retrying every
    // tick wiped the patrol route each time, freezing the ship).
    endRepair(u);
    u.t1 = game.tick + WARSHIP_REPAIR_RETRY_TICKS;
    return false;
  }
  return true;
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
  const here = waterUnder(game, m);
  const path = here >= 0 ? game.map.nav.findPath(here, dst) : null;
  if (!path) {
    m.alive = false;
    return;
  }
  m.path = path;
  m.pathIdx = here === tileOf(game, m) ? 1 : 0;
  m.dest = home.id;
  m.kind = 1; // pirated
  game.emit({ k: 'capture', x: m.x, y: m.y, owner: prev, by: ship.owner });
  game.notify(prev, 'notify.merchantPirated', 'warn', { by: ship.owner });
}

// --------------------------------------------------------------- merchants
// Keyed by the map object, not its id: two custom or generated maps can share an id
// (e.g. successive LAN games hosted by the same process), and a lane of one must never
// be sailed on the other.
const pathCaches = new WeakMap<Game['map'], Map<number, number[] | null>>();

/** Port-to-port routes are memoised (merchants keep sailing the same lanes). */
function tradePath(game: Game, from: Building, to: Building): number[] | null {
  let cache = pathCaches.get(game.map);
  if (!cache) pathCaches.set(game.map, (cache = new Map()));
  const key = from.tile * game.map.size + to.tile;
  if (cache.has(key)) return cache.get(key)!;
  const a = game.map.adjacentWater(from.tile);
  const b = game.map.adjacentWater(to.tile);
  const path = a >= 0 && b >= 0 ? game.map.nav.findPath(a, b) : null;
  if (cache.size > 20_000) cache.clear();
  cache.set(key, path);
  return path;
}

const sigmoid = (x: number, k: number, mid: number) => 1 / (1 + Math.exp(-k * (x - mid)));

/**
 * OpenFront's global trade throttle for `n` merchants at sea: a mild boost while
 * the world fleet is small, damping past ~330 ships onto a 25 % plateau, and a
 * hard cap far beyond (~800).
 */
export function tradeShipSaturation(n: number): number {
  const boost = 1 + 0.45 * Math.exp(-n / 120);
  const damping = 1 - sigmoid(n, Math.LN2 / 50, 330);
  const plateau = 0.25 * (1 - sigmoid(n, Math.LN2 / 100, 800));
  return boost * Math.max(damping, plateau);
}

/** One spawn roll succeeds with probability 1 / rate; failed rolls (pity timer) raise the odds. */
export function tradeSpawnRate(rejections: number, merchants: number): number {
  return Math.max(1, Math.floor(TRADE_SPAWN_RATE / (rejections + 1) / tradeShipSaturation(merchants)));
}

/** Value of a cargo sailed over `dist` tiles (before the gold multiplier and bonuses). */
export function tradeGold(dist: number): number {
  return (
    TRADE_SIGMOID_GOLD / (1 + Math.exp(-TRADE_SIGMOID_K * (dist - TRADE_SHORT_RANGE))) + TRADE_PER_TILE * dist
  );
}

/**
 * Trade capacity of a player with `portLevels` completed port levels: the share of its
 * successful launch rolls that sail, and the factor on its ports' weight as destinations.
 * 1 for a single port; P ports trade like P × (1 + K) / (P + K), never more than K + 1.
 */
export function tradeCapacity(portLevels: number): number {
  return Math.min(1, (1 + TRADE_CAPACITY_KNEE) / (Math.max(1, portLevels) + TRADE_CAPACITY_KNEE));
}

// Scratch buffer: completed port levels per player id, rebuilt at every launch window.
let portLevelsBuf = new Float64Array(0);

function countPortLevels(game: Game): Float64Array {
  if (portLevelsBuf.length < game.players.length) portLevelsBuf = new Float64Array(game.players.length * 2);
  portLevelsBuf.fill(0);
  for (const b of game.buildings.values())
    if (b.type === B.Port && inService(b)) portLevelsBuf[b.owner]! += b.level;
  return portLevelsBuf;
}

/** A port rolls once per level; the first success launches a merchant. */
function rollMerchant(game: Game, port: Building, merchants: number): boolean {
  for (let k = 0; k < port.level; k++) {
    if (game.rng.chance(1 / tradeSpawnRate(port.rejections, merchants))) {
      port.rejections = 0;
      return true;
    }
    port.rejections++;
  }
  return false;
}

/**
 * Destination of a merchant leaving `port`: a port of another player on the same
 * water body, both sides trading (no embargo). Weight = level; the closest third
 * (at least 4) count twice and friendly ports once more, unless they lie within
 * TRADE_SHORT_RANGE tiles (Manhattan).
 */
function pickTradePort(game: Game, port: Building, owner: Player, portLevels: Float64Array): Building | null {
  const wt = game.map.adjacentWater(port.tile);
  if (wt < 0) return null;
  const body = game.map.navBody[wt];
  const candidates: { b: Building; d: number }[] = [];
  for (const other of game.buildings.values()) {
    if (other.type !== B.Port || other.owner === port.owner || !inService(other)) continue;
    const o = game.players[other.owner]!;
    if (!o.alive || o.kind === 'tribe' || owner.hasEmbargoWith(o, game.tick)) continue;
    const ow = game.map.adjacentWater(other.tile);
    if (ow < 0 || game.map.navBody[ow] !== body) continue;
    candidates.push({ b: other, d: Math.abs(other.x - port.x) + Math.abs(other.y - port.y) });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.d - b.d || a.b.id - b.b.id);
  const closeBonus = Math.min(Math.max(candidates.length / 3, 4), candidates.length);
  const weights = candidates.map(({ b, d }, i) => {
    const far = d >= TRADE_SHORT_RANGE;
    let w = b.level;
    if (far && i < closeBonus) w += b.level;
    if (far && game.friendly(port.owner, b.owner)) w += b.level;
    return w * tradeCapacity(portLevels[b.owner]!);
  });
  return candidates[game.rng.weighted(weights)]!.b;
}

function spawnMerchants(game: Game, merchants: number): void {
  let portLevels: Float64Array | null = null;
  for (const port of game.buildings.values()) {
    if (port.type !== B.Port || !inService(port)) continue;
    if ((game.tick + port.createdTick) % TRADE_ROLL_TICKS !== 0) continue;
    const owner = game.players[port.owner]!;
    if (!owner.alive || owner.kind === 'tribe') continue;
    if (!rollMerchant(game, port, merchants)) continue;
    portLevels ??= countPortLevels(game);
    // Trade capacity: past the first port, a success only sails with probability (1 + K) / (P + K).
    const capacity = tradeCapacity(portLevels[owner.id]!);
    if (capacity < 1 && !game.rng.chance(capacity)) continue;
    const dest = pickTradePort(game, port, owner, portLevels);
    if (!dest) continue;
    const path = tradePath(game, port, dest);
    if (!path) continue;
    const [x, y] = center(game, game.map.adjacentWater(port.tile));
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

/** Whether a (not pirated) merchant may still deliver its cargo; otherwise it is scrapped. */
function voyageValid(game: Game, m: Unit): boolean {
  const dest = game.buildings.get(m.dest);
  if (!dest || dest.owner === m.owner || !inService(dest)) return false;
  const host = game.players[dest.owner]!;
  return host.alive && host.kind !== 'tribe' && !game.players[m.owner]!.hasEmbargoWith(host, game.tick);
}

function payTrade(game: Game, p: Player, amount: number, at: Building): void {
  const gold = amount * (game.config.features.tech ? techNaval(p).trade : 1);
  addGold(p, gold);
  p.stats.tradeGold += gold;
  p.incomeBreakdown.trade += gold;
  game.emit({ k: 'tradePay', x: at.x, y: at.y, owner: p.id, amount: Math.round(gold) });
}

function arriveMerchant(game: Game, m: Unit): void {
  const dest = game.buildings.get(m.dest);
  const owner = game.players[m.owner]!;
  if (!dest || !owner.alive) return;
  // d = tiles actually sailed (kept in m.troops); both ends of the route earn the full value.
  const value = Math.floor(tradeGold(m.troops) * game.config.goldMultiplier) * game.features.tradeMult;
  if (m.kind === 1) {
    // Pirated cargo unloads in the pirate's own port.
    payTrade(game, owner, value, dest);
    return;
  }
  if (!voyageValid(game, m)) return;
  payTrade(game, owner, value, game.buildings.get(m.home) ?? dest);
  payTrade(game, game.players[dest.owner]!, value, dest);
  noteTrade(game, owner, game.players[dest.owner]!);
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
        sailOnPath(u, sailSpeed(game, u), w);
        if (u.pathIdx >= u.path.length) {
          // Turned back but its home coast was lost meanwhile: on to the next one, if any.
          if (u.kind === TRANSPORT_RETREATING && game.owner[u.target] !== u.owner && routeHome(game, u))
            break;
          u.alive = false;
          if (u.kind === TRANSPORT_RETREATING && game.owner[u.target] !== u.owner) owner.troops += u.troops;
          else landTransport(game, u);
        }
        break;
      }
      case U.Merchant: {
        // Embargo, lost or captured destination: the voyage is cancelled.
        if (!owner || !owner.alive || (u.kind !== 1 && !voyageValid(game, u))) {
          u.alive = false;
          break;
        }
        // Tiles sailed (OpenFront's tilesTraveled) price the cargo.
        u.troops += sailOnPath(u, sailSpeed(game, u), w);
        if (u.pathIdx >= u.path.length) {
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
  // Repairs (OpenFront's WarshipExecution): heal, stay docked until full, break off below half hp.
  const hpBefore = u.hp;
  healWarship(game, u);
  if (u.cooldown > 0) u.cooldown--;
  const speed = sailSpeed(game, u);
  if (u.kind === WS.Docked) {
    if (repairPort(game, u) && u.hp < u.maxHp) return;
    endRepair(u);
  }
  if (u.kind === WS.Patrolling && game.tick >= u.t1 && hpBefore < Math.floor(u.maxHp * WARSHIP_RETREAT_HP))
    startRepair(game, u);
  if (u.kind === WS.Retreating && sailToRepair(game, u, speed)) return;
  if ((game.tick + u.id) % 5 === 0) acquireTarget(game, u);
  const target = u.target >= 0 ? unitById(game, u.target) : undefined;
  if (target && target.alive && !(target.type === U.Warship && target.kind === WS.Docked)) {
    const d = Math.hypot(target.x - u.x, target.y - u.y);
    if (target.type === U.Merchant) {
      // Hunted down at two steps a tick, captured once alongside.
      if (d <= PIRACY_RANGE) {
        captureMerchant(game, u, target);
        u.target = -1;
      } else {
        // The water under it: a merchant cutting a land corner used to stop the hunt dead.
        moveToward(game, u, waterUnder(game, target), speed * (WARSHIP_HUNT_SPEED / WARSHIP_SPEED));
      }
      return;
    }
    // Transports and warships are shelled while the patrol goes on: no chase (OpenFront).
    if (u.cooldown === 0 && d <= sightBetween(game, u.x, u.y, target.x, target.y, WARSHIP_RANGE)) {
      fire(game, u, target);
      u.cooldown = WARSHIP_FIRE_TICKS;
    }
  }
  patrolStep(game, u, speed);
}

export { tileOf as unitTile };
export type { Player };
