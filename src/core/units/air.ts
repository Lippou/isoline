// Air units (original feature): fighters, bombers, reconnaissance planes.
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import {
  A,
  AIR_COST,
  AIR_HP,
  AIR_SPEED,
  AIRFIELD_CAPACITY,
  B,
  BOMBER_KILL,
  BOMBER_RADIUS,
  FIGHTER_RANGE,
  RECON_RADIUS,
  RECON_TICKS,
  samRange,
  sec,
} from '../game/constants';
import { U, makeUnit, type Unit } from './unit';
import { addUnit, unitById } from './ships';
import type { Building } from '../buildings/building';
import { destroyRailsInRadius } from './trains';
import { samFire, samLoaded } from './nukes';
import { airLock } from '../rules/tech';
import { airSpeedAt } from '../rules/weather';

const TYPE_OF: Record<number, U> = { [A.Fighter]: U.Fighter, [A.Bomber]: U.Bomber, [A.Recon]: U.Recon };

function airfieldFor(game: Game, p: Player, tx: number, ty: number): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of game.buildings.values()) {
    if (b.owner !== p.id || b.type !== B.Airfield || b.buildLeft > 0) continue;
    let used = 0;
    for (const u of game.units) if (u.alive && u.home === b.id && u.type >= U.Fighter) used++;
    if (used >= AIRFIELD_CAPACITY * b.level) continue;
    const d = (b.x - tx) ** 2 + (b.y - ty) ** 2;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

export function launchAircraft(game: Game, p: Player, kind: A, tile: number): boolean {
  if (!game.config.features.air || game.phase !== 'playing') return false;
  if (airLock(game, p) >= 0) return false; // tech tree: Aerospace (even from a captured airfield)
  const cost = AIR_COST[kind];
  if (p.gold < cost) return false;
  const w = game.map.width;
  const tx = (tile % w) + 0.5;
  const ty = ((tile / w) | 0) + 0.5;
  const field = airfieldFor(game, p, tx, ty);
  if (!field) return false;
  if (kind === A.Fighter && Math.hypot(field.x - tx, field.y - ty) > FIGHTER_RANGE) return false;
  if (kind === A.Bomber) {
    const victim = game.owner[tile]!;
    if (victim > 0 && !game.attackAllowed(p.id, victim, true)) return false;
  }
  p.gold -= cost;
  const u = makeUnit(game.nextId(), TYPE_OF[kind]!, p.id, field.x + 0.5, field.y + 0.5);
  u.hp = u.maxHp = AIR_HP[kind];
  u.speed = AIR_SPEED[kind];
  u.home = field.id;
  u.sx = field.x + 0.5;
  u.sy = field.y + 0.5;
  u.tx = tx;
  u.ty = ty;
  u.t0 = game.tick;
  u.t1 = game.tick + (kind === A.Fighter ? sec(60) : kind === A.Recon ? RECON_TICKS + sec(20) : sec(90));
  addUnit(game, u);
  return true;
}

/** Fly one tick towards (tx, ty) at `speed` (storms slow aircraft); true on arrival. */
function flyTo(u: Unit, tx: number, ty: number, speed: number): boolean {
  const dx = tx - u.x;
  const dy = ty - u.y;
  const d = Math.hypot(dx, dy);
  if (d <= speed) {
    u.x = tx;
    u.y = ty;
    return true;
  }
  u.x += (dx / d) * speed;
  u.y += (dy / d) * speed;
  return false;
}

function bomb(game: Game, u: Unit): void {
  const w = game.map.width;
  const cx = Math.floor(u.tx);
  const cy = Math.floor(u.ty);
  const hits = new Map<number, number>();
  for (let dy = -BOMBER_RADIUS; dy <= BOMBER_RADIUS; dy++) {
    for (let dx = -BOMBER_RADIUS; dx <= BOMBER_RADIUS; dx++) {
      if (dx * dx + dy * dy > BOMBER_RADIUS * BOMBER_RADIUS) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (!game.map.inBounds(x, y)) continue;
      const o = game.owner[y * w + x]!;
      if (o > 0 && !game.friendly(o, u.owner)) hits.set(o, (hits.get(o) ?? 0) + 1);
    }
  }
  for (const [o, n] of hits) {
    const p = game.players[o]!;
    const density = p.troops / Math.max(1, p.tiles);
    const kill = Math.min(p.troops * BOMBER_KILL, density * n * 4 + p.troops * 0.02);
    p.troops -= kill;
    p.stats.troopsLost += kill;
    game.notify(o, 'notify.bombed', 'danger', { by: u.owner, troops: Math.round(kill) });
  }
  for (const v of game.units) {
    if (
      v.alive &&
      v.type === U.Train &&
      !game.friendly(v.owner, u.owner) &&
      (v.x - u.tx) ** 2 + (v.y - u.ty) ** 2 <= BOMBER_RADIUS ** 2
    ) {
      v.alive = false;
    }
  }
  destroyRailsInRadius(game, u.tx, u.ty, BOMBER_RADIUS / 2);
  game.emit({ k: 'explosion', x: u.tx, y: u.ty, kind: 11, radius: BOMBER_RADIUS, owner: u.owner });
}

export function updateAir(game: Game): void {
  const planes: Unit[] = [];
  for (const u of game.units) if (u.alive && u.type >= U.Fighter && u.type <= U.Recon) planes.push(u);
  if (planes.length === 0) return;
  // SAMs also shoot down bombers in range.
  for (const sam of game.buildings.values()) {
    if (sam.type !== B.Sam || sam.buildLeft > 0) continue;
    const slot = samLoaded(game, sam);
    if (slot < 0) continue;
    const r = samRange(sam.level);
    for (const u of planes) {
      if (!u.alive || u.type !== U.Bomber || game.friendly(u.owner, sam.owner)) continue;
      if ((u.x - sam.x) ** 2 + (u.y - sam.y) ** 2 > r * r) continue;
      u.alive = false;
      samFire(sam, slot);
      game.emit({ k: 'intercept', x: u.x, y: u.y, owner: sam.owner });
      game.notify(u.owner, 'notify.planeLost', 'warn');
      break;
    }
  }
  for (const u of planes) {
    if (!u.alive) continue;
    const owner = game.players[u.owner];
    if (!owner || !owner.alive || game.tick >= u.t1 || u.hp <= 0) {
      u.alive = false;
      continue;
    }
    const speed = u.speed * airSpeedAt(game, u.x, u.y);
    if (u.type === U.Bomber) {
      if (u.kind === 0 && flyTo(u, u.tx, u.ty, speed)) {
        bomb(game, u);
        u.kind = 1; // returning
      } else if (u.kind === 1 && flyTo(u, u.sx, u.sy, speed)) {
        u.alive = false;
      }
    } else if (u.type === U.Recon) {
      if (u.kind === 0 && flyTo(u, u.tx, u.ty, speed)) {
        u.kind = 1;
        game.features.reveals.push({
          owner: u.owner,
          x: u.tx,
          y: u.ty,
          r: RECON_RADIUS,
          until: game.tick + RECON_TICKS,
        });
      } else if (u.kind === 1) {
        // Orbit the target.
        const a = (game.tick - u.t0) * 0.08;
        u.x = u.tx + Math.cos(a) * 10;
        u.y = u.ty + Math.sin(a) * 10;
      }
    } else if (u.type === U.Fighter) {
      // Engage enemy bombers / transports / recon within 30 tiles of the fighter.
      let tgt = u.target >= 0 ? unitById(game, u.target) : undefined;
      if (!tgt || !tgt.alive) {
        tgt = undefined;
        let bestD = 30 * 30;
        for (const v of game.units) {
          if (!v.alive || game.friendly(v.owner, u.owner)) continue;
          if (v.type !== U.Bomber && v.type !== U.Transport && v.type !== U.Recon && v.type !== U.Fighter)
            continue;
          const d = (v.x - u.x) ** 2 + (v.y - u.y) ** 2;
          if (d < bestD) {
            bestD = d;
            tgt = v;
          }
        }
        u.target = tgt ? tgt.id : -1;
      }
      if (tgt) {
        if (Math.hypot(tgt.x - u.sx, tgt.y - u.sy) > FIGHTER_RANGE) {
          u.target = -1;
        } else if (flyTo(u, tgt.x, tgt.y, speed) || Math.hypot(tgt.x - u.x, tgt.y - u.y) < 3) {
          tgt.hp -= 60;
          if (tgt.hp <= 0) {
            tgt.alive = false;
            if (tgt.type === U.Transport)
              game.notify(tgt.owner, 'notify.transportSunk', 'danger', { troops: Math.round(tgt.troops) });
            game.emit({ k: 'shipSunk', x: tgt.x, y: tgt.y, owner: tgt.owner, by: u.owner });
          }
        }
      } else {
        const a = (game.tick - u.t0) * 0.06;
        flyTo(u, u.tx + Math.cos(a) * 14, u.ty + Math.sin(a) * 14, speed);
      }
    }
  }
  game.features.reveals = game.features.reveals.filter((r) => r.until > game.tick);
}
