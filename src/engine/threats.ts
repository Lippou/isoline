// Threatened borders: view-only intelligence computed in the simulation worker, never
// part of the simulation (no state, no command). Troops are a national pool, so a
// "massed army" is read from the neighbour's whole army: a land neighbour that is not
// a friend becomes a threat when it holds THREAT_ON times the viewer's troops and shows
// hostile intent — it fought the viewer in the last 3 minutes, it resents the viewer
// (relation below 0), or, for an AI nation, the AI's own state points at the viewer
// (a grudge, or an idle army whose weakest neighbour is the viewer). Hysteresis keeps
// the alert from flickering: it leaves under THREAT_OFF, 30 s after the intent lapsed,
// and never before it has been shown for 20 s.
import type { Game } from '../core/game/state';
import type { Player } from '../core/game/player';
import { IS_LAND } from '../core/map/terrain';
import { U } from '../core/units/unit';

/** Why the neighbour is a threat: it fought us lately, it is hostile, the AI aims at us. */
export type ThreatWhy = 'war' | 'hostile' | 'plan';

export interface Threat {
  /** The threatening neighbour. */
  id: number;
  /** Its troops / the viewer's (one decimal). */
  ratio: number;
  why: ThreatWhy;
  /** A point on the shared border (tile centre). */
  x: number;
  y: number;
  /** Tick at which the alert went up. */
  since: number;
}

/** A neighbour this many times stronger, with hostile intent, raises the alert… */
export const THREAT_ON = 1.75;
/** …which only clears once it falls under this ratio (hysteresis). */
export const THREAT_OFF = 1.4;
/** Hostilities (attacks, landings, missiles, either way) are remembered this long. */
export const THREAT_MEMORY = 1800;
/** The intent may lapse this long before the alert clears. */
export const THREAT_GRACE = 300;
/** An alert stays up at least this long. */
export const THREAT_MIN_TICKS = 200;
/** An AI grudge (≈ thousands of troops it took from us) this large reads as a plan against us. */
const GRUDGE_PLAN = 5;
/** An AI army above this share of its ceiling is idle: it is about to strike its weakest neighbour. */
const IDLE_ARMY = 0.85;
/** The border scan runs once a second. */
const SCAN_EVERY = 10;
/** Border tiles of the neighbour read to find its other neighbours (the AI's options). */
const NEIGHBOUR_SAMPLES = 1500;

const NB = new Int32Array(4);

interface Live {
  since: number;
  lastIntent: number;
  why: ThreatWhy;
  ratio: number;
  x: number;
  y: number;
}

export class ThreatWatch {
  /** Last tick each country fought the viewer (attack, landing or missile, either way). */
  private fought = new Map<number, number>();
  private live = new Map<number, Live>();
  private viewer = -1;
  private lastScan = -1;
  private cache: Threat[] = [];

  reset(): void {
    this.fought.clear();
    this.live.clear();
    this.viewer = -1;
    this.lastScan = -1;
    this.cache = [];
  }

  /** The viewer's threatened borders (call every tick: hostilities are tracked tick by tick). */
  update(g: Game, p: Player): Threat[] {
    const t = g.tick;
    if (p.id !== this.viewer || t < this.lastScan) {
      // Another viewer, or a replay rewound: start afresh.
      this.reset();
      this.viewer = p.id;
    }
    this.track(g, p, t);
    if (this.lastScan >= 0 && t - this.lastScan < SCAN_EVERY) return this.cache;
    this.lastScan = t;
    this.cache = this.scan(g, p, t);
    return this.cache;
  }

  private track(g: Game, p: Player, t: number): void {
    const touch = (id: number) => {
      if (id > 0 && id !== p.id) this.fought.set(id, t);
    };
    for (const a of g.attacks) {
      if (a.done) continue;
      if (a.attacker === p.id) touch(a.target);
      else if (a.target === p.id) touch(a.attacker);
    }
    for (const u of g.units) {
      if (!u.alive) continue;
      if (u.type === U.Transport) {
        if (u.owner === p.id) touch(u.dest);
        else if (u.dest === p.id) touch(u.owner);
      } else if (u.type === U.Nuke && u.dest >= 0) {
        const o = g.owner[u.dest]!;
        if (u.owner === p.id) touch(o);
        else if (o === p.id) touch(u.owner);
      }
    }
  }

  private scan(g: Game, p: Player, t: number): Threat[] {
    for (const [id, last] of this.fought) if (t - last > THREAT_MEMORY) this.fought.delete(id);
    if (g.phase !== 'playing' || !p.alive) {
      this.live.clear();
      return [];
    }
    // Countries along our land border, with a sample of the contact tiles.
    const w = g.map.width;
    const contact = new Map<number, { n: number; sx: number; sy: number; samples: number[] }>();
    for (const b of p.border) {
      const k = g.map.neighbors4(b, NB);
      for (let j = 0; j < k; j++) {
        const v = NB[j]!;
        const o = g.owner[v]!;
        if (o === 0 || o === p.id || !IS_LAND[g.map.terrain[v]!]) continue;
        let c = contact.get(o);
        if (!c) contact.set(o, (c = { n: 0, sx: 0, sy: 0, samples: [] }));
        c.n++;
        c.sx += v % w;
        c.sy += (v / w) | 0;
        if (c.samples.length < 256 && (c.n <= 64 || c.n % 8 === 0)) c.samples.push(v);
      }
    }
    for (const id of [...this.live.keys()]) {
      const q = g.players[id];
      if (!contact.has(id) || !q?.alive || g.friendly(p.id, id)) this.live.delete(id);
    }
    for (const [id, c] of contact) {
      const q = g.players[id];
      if (!q || !q.alive || q.kind === 'tribe' || g.friendly(p.id, id)) continue;
      const ratio = q.troops / Math.max(1, p.troops);
      const why = this.intent(g, p, q, t);
      let cur = this.live.get(id);
      if (!cur) {
        if (ratio < THREAT_ON || !why) continue;
        cur = { since: t, lastIntent: t, why, ratio, x: 0, y: 0 };
        this.live.set(id, cur);
      } else {
        if (why) {
          cur.lastIntent = t;
          cur.why = why;
        }
        const keep =
          t - cur.since < THREAT_MIN_TICKS || (ratio >= THREAT_OFF && t - cur.lastIntent <= THREAT_GRACE);
        if (!keep) {
          this.live.delete(id);
          continue;
        }
      }
      cur.ratio = ratio;
      // The contact tile nearest the middle of the shared border (a real border tile).
      const mx = c.sx / c.n;
      const my = c.sy / c.n;
      let best = c.samples[0]!;
      let bd = Infinity;
      for (const s of c.samples) {
        const d = ((s % w) - mx) ** 2 + (((s / w) | 0) - my) ** 2;
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      cur.x = (best % w) + 0.5;
      cur.y = ((best / w) | 0) + 0.5;
    }
    return [...this.live]
      .map(([id, l]) => ({
        id,
        ratio: Math.round(l.ratio * 10) / 10,
        why: l.why,
        x: l.x,
        y: l.y,
        since: l.since,
      }))
      .sort((a, b) => b.ratio - a.ratio || a.id - b.id);
  }

  /** Hostile intent of q towards p, strongest reason first (null: none). */
  private intent(g: Game, p: Player, q: Player, t: number): ThreatWhy | null {
    const last = this.fought.get(q.id);
    if (last !== undefined && t - last <= THREAT_MEMORY) return 'war';
    if (q.relation(p.id) < 0) return 'hostile';
    if (q.kind === 'nation' && aiAimsAt(g, q, p)) return 'plan';
    return null;
  }
}

/**
 * Intelligence on an AI nation (a read of its state, view only): it holds a grudge
 * against p, or its army idles near its ceiling and p is the weakest country it borders
 * — the one its next offensive is most likely to hit.
 */
export function aiAimsAt(g: Game, q: Player, p: Player): boolean {
  if ((g.ai.mem.get(q.id)?.grudge.get(p.id) ?? 0) >= GRUDGE_PLAN) return true;
  if (q.popCap <= 0 || q.troops < q.popCap * IDLE_ARMY) return false;
  const border = q.border;
  const step = Math.max(1, Math.floor(border.length / NEIGHBOUR_SAMPLES));
  let weakest: Player | null = null;
  for (let i = 0; i < border.length; i += step) {
    const k = g.map.neighbors4(border[i]!, NB);
    for (let j = 0; j < k; j++) {
      const o = g.owner[NB[j]!]!;
      if (o === 0 || o === q.id) continue;
      const r = g.players[o];
      if (!r || !r.alive || r.kind === 'tribe' || g.friendly(q.id, o)) continue;
      if (!weakest || r.troops < weakest.troops || (r.troops === weakest.troops && r.id < weakest.id))
        weakest = r;
    }
  }
  return weakest?.id === p.id;
}
