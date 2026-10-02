// Commerce bookkeeping for the viewer, kept by the simulation worker (outside the
// deterministic state): who we trade with, how much it paid over the last minutes,
// and who blocks whom.
import type { Game } from '../core/game/state';
import type { GameEvent } from '../core/game/events';
import type { Player } from '../core/game/player';
import { U } from '../core/units/unit';
import { TRADE_WINDOW_TICKS, type LocalView } from './protocol';

type Pay = Extract<GameEvent, { k: 'tradePay' | 'trainPay' }>;

const isPay = (e: GameEvent | undefined): e is Pay => !!e && (e.k === 'tradePay' || e.k === 'trainPay');

/**
 * Both ends of a merchant voyage earn the same cargo value, each scaled by its own
 * naval research (×1 to ×1.3): two consecutive payouts that far apart are one voyage.
 */
const sameCargo = (x: number, y: number) => Math.max(x, y) <= Math.min(x, y) * 1.31 + 1;

interface Entry {
  tick: number;
  partner: number;
  amount: number;
  rail: boolean;
}

export class TradeLedger {
  private entries: Entry[] = [];
  private cache: LocalView['trade'] = [];
  private cacheTick = -Infinity;

  reset(): void {
    this.entries = [];
    this.cache = [];
    this.cacheTick = -Infinity;
  }

  /**
   * Read one tick's events (call after every step). A delivery between two countries
   * pays both of them back to back: a merchant pays its home port then its destination,
   * a train pays its owner then the host of the station (same station). Pirated cargo
   * and stops in one's own stations pay a single owner: domestic, not a partner.
   */
  track(events: readonly GameEvent[], viewer: number, tick: number): void {
    if (viewer <= 0) return;
    for (let i = 0; i + 1 < events.length; i++) {
      const a = events[i];
      const b = events[i + 1];
      if (!isPay(a) || !isPay(b) || a.k !== b.k || a.owner === b.owner) continue;
      if (a.k === 'trainPay' ? a.x !== b.x || a.y !== b.y : !sameCargo(a.amount, b.amount)) continue;
      i++;
      const rail = a.k === 'trainPay';
      if (a.owner === viewer) this.entries.push({ tick, partner: b.owner, amount: a.amount, rail });
      else if (b.owner === viewer) this.entries.push({ tick, partner: a.owner, amount: b.amount, rail });
    }
  }

  /** Partners of `p`: gold over the window and the ships / trains running between us now. */
  partners(g: Game, p: Player): LocalView['trade'] {
    if (g.tick - this.cacheTick < 10 && g.tick >= this.cacheTick) return this.cache;
    const from = g.tick - TRADE_WINDOW_TICKS;
    if (this.entries.length && this.entries[0]!.tick < from)
      this.entries = this.entries.filter((e) => e.tick >= from);
    const rows = new Map<number, LocalView['trade'][number]>();
    const row = (id: number) => {
      let r = rows.get(id);
      if (!r) {
        r = { id, sea: 0, rail: 0, ships: 0, trains: 0 };
        rows.set(id, r);
      }
      return r;
    };
    for (const e of this.entries) {
      const r = row(e.partner);
      if (e.rail) r.rail += e.amount;
      else r.sea += e.amount;
    }
    let rails: Map<number, Game['rails'][number]> | null = null;
    for (const u of g.units) {
      if (!u.alive) continue;
      if (u.type === U.Merchant && u.kind !== 1) {
        const dest = g.buildings.get(u.dest);
        if (!dest) continue;
        if (u.owner === p.id && dest.owner !== p.id) row(dest.owner).ships++;
        else if (dest.owner === p.id && u.owner !== p.id) row(u.owner).ships++;
      } else if (u.type === U.Train) {
        rails ??= new Map(g.rails.map((r) => [r.id, r]));
        const r = rails.get(u.rail);
        if (!r || !r.alive) continue;
        const a = g.buildings.get(r.a)?.owner ?? 0;
        const b = g.buildings.get(r.b)?.owner ?? 0;
        if (u.owner === p.id) {
          if (a > 0 && a !== p.id) row(a).trains++;
          if (b > 0 && b !== p.id && b !== a) row(b).trains++;
        } else if (a === p.id || b === p.id) row(u.owner).trains++;
      }
    }
    this.cache = [...rows.values()]
      .filter((r) => {
        const q = g.players[r.id];
        return q && q.alive && q.kind !== 'tribe';
      })
      .sort(
        (x, y) =>
          y.sea + y.rail - (x.sea + x.rail) || y.ships + y.trains - (x.ships + x.trains) || x.id - y.id,
      );
    this.cacheTick = g.tick;
    return this.cache;
  }
}

/** Every embargo between `p` and another country, in either direction. */
export function embargoesOf(g: Game, p: Player): LocalView['embargoes'] {
  const t = g.tick;
  const out: LocalView['embargoes'] = [];
  for (const q of g.alivePlayers()) {
    if (q.id === p.id || q.kind === 'tribe') continue;
    const mine = p.embargo.has(q.id);
    const theirs = q.embargo.has(p.id);
    const mineFor = Math.max(0, (p.embargoUntil.get(q.id) ?? 0) - t);
    const theirsFor = Math.max(0, (q.embargoUntil.get(p.id) ?? 0) - t);
    if (mine || theirs || mineFor > 0 || theirsFor > 0)
      out.push({ id: q.id, mine, theirs, mineFor, theirsFor });
  }
  return out;
}
