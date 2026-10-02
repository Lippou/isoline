// Trade routes for the map (a view, kept by the simulation worker outside the
// deterministic state): the sea lanes merchants actually sail between two ports and
// the gold each one paid over the last five minutes, the traffic on every railway,
// and the routes of the viewer that an embargo has just cut.
import type { Game } from '../core/game/state';
import type { GameEvent } from '../core/game/events';
import { TRAIN_SPEED } from '../core/game/constants';
import { U } from '../core/units/unit';
import {
  TRADE_WINDOW_TICKS,
  type RailTrafficView,
  type TradeRouteView,
  type TradeRoutesView,
} from './protocol';

/** Gold and traffic are summed in 30 s buckets over the window. */
const BUCKET = 300;
const BUCKETS = Math.round(TRADE_WINDOW_TICKS / BUCKET);
/** How long a route cut by an embargo is drawn broken (ticks). */
export const ROUTE_CUT_TICKS = 100;
/** Units are scanned (ships on each lane, trains on each rail) every SAMPLE ticks. */
const SAMPLE = 5;

/** A sliding sum over the last BUCKETS × BUCKET ticks. */
class Window {
  private sums = new Float64Array(BUCKETS);
  private stamps = new Int32Array(BUCKETS).fill(-1);

  add(tick: number, v: number): void {
    const idx = Math.floor(tick / BUCKET);
    const k = idx % BUCKETS;
    if (this.stamps[k] !== idx) {
      this.stamps[k] = idx;
      this.sums[k] = 0;
    }
    this.sums[k]! += v;
  }

  sum(tick: number): number {
    const cur = Math.floor(tick / BUCKET);
    let s = 0;
    for (let k = 0; k < BUCKETS; k++) if (this.stamps[k]! > cur - BUCKETS) s += this.sums[k]!;
    return s;
  }
}

interface SeaLane {
  id: number;
  /** Port building ids (pa < pb) and their owners when the lane was first seen. */
  pa: number;
  pb: number;
  oa: number;
  ob: number;
  path: number[];
  gold: Window;
  ships: number;
  last: number;
}

interface RailStat {
  samples: Window;
  last: number;
}

type Pay = Extract<GameEvent, { k: 'tradePay' }>;
const isTradePay = (e: GameEvent | undefined): e is Pay => !!e && e.k === 'tradePay';
/** Both ends of a voyage earn the same cargo (each × its naval research, up to ×1.3). */
const sameCargo = (x: number, y: number) => Math.max(x, y) <= Math.min(x, y) * 1.31 + 1;

export class TradeRoutes {
  private lanes = new Map<string, SeaLane>();
  private rails = new Map<number, RailStat>();
  private nextLane = 1;
  /** The viewer's embargoed partners, and when each embargo began (route cuts). */
  private embargoed = new Set<number>();
  private cutAt = new Map<number, number>();

  reset(): void {
    this.lanes.clear();
    this.rails.clear();
    this.embargoed.clear();
    this.cutAt.clear();
  }

  /** Forget the viewer-specific state (another player is watched). */
  resetViewer(): void {
    this.embargoed.clear();
    this.cutAt.clear();
  }

  private lane(g: Game, a: number, b: number): SeaLane | null {
    if (a === b) return null;
    const [pa, pb] = a < b ? [a, b] : [b, a];
    const key = `${pa}>${pb}`;
    let l = this.lanes.get(key);
    const A = g.buildings.get(pa);
    const B = g.buildings.get(pb);
    if (!A || !B) return null;
    if (l && (l.oa !== A.owner || l.ob !== B.owner)) {
      // A port changed hands: the old lane is gone, a new one starts.
      this.lanes.delete(key);
      l = undefined;
    }
    if (!l) {
      l = {
        id: this.nextLane++,
        pa,
        pb,
        oa: A.owner,
        ob: B.owner,
        path: [],
        gold: new Window(),
        ships: 0,
        last: g.tick,
      };
      this.lanes.set(key, l);
    }
    return l;
  }

  /**
   * Read one tick's events (call after every step). A delivery pays the merchant's home
   * port then its destination, back to back: that pair is one voyage on one lane.
   */
  track(g: Game, events: readonly GameEvent[]): void {
    const w = g.map.width;
    for (let i = 0; i + 1 < events.length; i++) {
      const a = events[i];
      const b = events[i + 1];
      if (!isTradePay(a) || !isTradePay(b) || a.owner === b.owner || !sameCargo(a.amount, b.amount)) continue;
      i++;
      const l = this.lane(g, g.buildingAt[a.y * w + a.x]!, g.buildingAt[b.y * w + b.x]!);
      if (!l) continue;
      l.gold.add(g.tick, a.amount + b.amount);
      l.last = g.tick;
    }
    if (g.tick % SAMPLE === 0) this.sample(g);
  }

  /** Ships on each lane (and the path they sail), trains on each railway. */
  private sample(g: Game): void {
    for (const l of this.lanes.values()) l.ships = 0;
    for (const u of g.units) {
      if (!u.alive) continue;
      if (u.type === U.Merchant && u.kind !== 1) {
        const l = this.lane(g, u.home, u.dest);
        if (!l) continue;
        l.ships++;
        l.last = g.tick;
        // Kept from port a to port b (merchants sail home → destination).
        if (l.path.length === 0 && u.path.length > 0)
          l.path = u.home === l.pa ? u.path.slice() : u.path.slice().reverse();
      } else if (u.type === U.Train) {
        let r = this.rails.get(u.rail);
        if (!r) this.rails.set(u.rail, (r = { samples: new Window(), last: g.tick }));
        r.samples.add(g.tick, 1);
        r.last = g.tick;
      }
    }
    const old = g.tick - TRADE_WINDOW_TICKS;
    for (const [key, l] of this.lanes) {
      const A = g.buildings.get(l.pa);
      const B = g.buildings.get(l.pb);
      if (!A || !B || A.owner !== l.oa || B.owner !== l.ob || l.last < old) this.lanes.delete(key);
    }
    for (const [id, r] of this.rails) if (r.last < old) this.rails.delete(id);
  }

  /** Note when an embargo begins between the viewer and a partner (its routes are cut). */
  private watchEmbargoes(g: Game, viewer: number): void {
    const me = g.player(viewer);
    if (!me) return;
    const now = new Set<number>();
    for (const q of g.alivePlayers()) if (q.id !== me.id && me.hasEmbargoWith(q, g.tick)) now.add(q.id);
    for (const id of now) if (!this.embargoed.has(id)) this.cutAt.set(id, g.tick);
    for (const [id, t] of this.cutAt) if (g.tick - t > ROUTE_CUT_TICKS && !now.has(id)) this.cutAt.delete(id);
    this.embargoed = now;
  }

  /** The lanes and railways worth drawing now. */
  view(g: Game, viewer: number): TradeRoutesView {
    this.watchEmbargoes(g, viewer);
    const t = g.tick;
    const cutOf = (a: number, b: number): number => {
      if (viewer <= 0 || (a !== viewer && b !== viewer)) return -1;
      const at = this.cutAt.get(a === viewer ? b : a);
      return at !== undefined && t - at <= ROUTE_CUT_TICKS ? at : -1;
    };
    const blocked = (a: number, b: number): boolean => {
      const A = g.players[a];
      const B = g.players[b];
      return !A || !B || !A.alive || !B.alive || A.hasEmbargoWith(B, t);
    };
    const sea: TradeRouteView[] = [];
    for (const l of this.lanes.values()) {
      if (l.path.length < 1) continue;
      const gold = l.gold.sum(t);
      if (gold <= 0 && l.ships === 0) continue;
      let cut = -1;
      if (blocked(l.oa, l.ob)) {
        // Embargo: the viewer sees its own lanes broken for a few seconds; the rest vanish.
        cut = cutOf(l.oa, l.ob);
        if (cut < 0) continue;
      }
      sea.push({ id: l.id, a: l.oa, b: l.ob, path: l.path, gold, ships: l.ships, last: l.last, cut });
    }
    const rail: RailTrafficView[] = [];
    if (this.rails.size) {
      const byId = new Map(g.rails.map((r) => [r.id, r]));
      for (const [id, s] of this.rails) {
        const r = byId.get(id);
        if (!r || !r.alive || r.tiles.length < 2) continue;
        // Train-ticks on the rail, over the ticks one trip takes: trips run over the window.
        const trips = (s.samples.sum(t) * SAMPLE * TRAIN_SPEED) / r.tiles.length;
        const oa = g.buildings.get(r.a)?.owner ?? 0;
        const ob = g.buildings.get(r.b)?.owner ?? 0;
        let cut = -1;
        if (oa > 0 && ob > 0 && oa !== ob && blocked(oa, ob)) {
          cut = cutOf(oa, ob);
          if (cut < 0) continue;
        }
        if (trips > 0) rail.push({ id, trips: Math.round(trips * 10) / 10, cut });
      }
    }
    return { tick: t, sea, rail };
  }
}
