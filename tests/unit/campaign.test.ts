// Campaign missions (the campaign is the tutorial): objective checks, what the director
// remembers from events, the guide's gold waits, hints and the mission result — all pure
// functions over a fake view of the game.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  HINTS,
  MISSIONS,
  evaluate,
  missionResult,
  observe,
  shortfall,
  starsFor,
  type Mission,
  type MissionCtx,
} from '../../src/ui/campaign/missions';
import type { LocalView, PlayerView } from '../../src/engine/protocol';
import type { GameEvent } from '../../src/core/game/events';
import { B, BUILDING_COUNT, N } from '../../src/core/game/constants';
import { BRANCHES, LEVELS, techId } from '../../src/core/rules/tech';

const ME = 1;
const mission = (id: string): Mission => MISSIONS.find((m) => m.id === id)!;

function player(id: number, kind: PlayerView['kind'], over: Partial<PlayerView> = {}): PlayerView {
  return {
    id,
    name: { fr: `P${id}`, en: `P${id}` },
    kind,
    team: 0,
    color: id,
    flagSeed: id,
    iso: '',
    alive: true,
    spawned: true,
    tiles: 100,
    usefulTiles: 100,
    troops: 1000,
    gold: 0,
    traitor: false,
    traitorFor: 0,
    inactive: false,
    immune: false,
    allies: [],
    personality: 'balanced' as PlayerView['personality'],
    general: 'blitz',
    label: [10 * id, 10 * id, 5],
    bigMalus: 0,
    samBonus: 0,
    capital: 0,
    disorgFor: 0,
    ...over,
  };
}

function local(over: Partial<LocalView> = {}): LocalView {
  const base = {
    id: ME,
    alive: true,
    gold: 0,
    troops: 10_000,
    popCap: 100_000,
    income: 100,
    buildingCount: new Array<number>(BUILDING_COUNT).fill(0),
    buildCosts: [125_000, 125_000, 125_000, 50_000, 1_000_000, 1_500_000, 300_000, 800_000, 250_000],
    warshipCost: 250_000,
    nukeCosts: [750_000, 5_000_000, 25_000_000],
    stats: {
      tilesConquered: 0,
      tilesLost: 0,
      buildingsBuilt: 0,
      shipsSunk: 0,
      shipsLost: 0,
      nukesLaunched: 0,
      nukesIntercepted: 0,
      goldEarned: 0,
      tradeGold: 0,
      trainGold: 0,
      troopsLost: 0,
      enemiesKilled: 0,
      maxTiles: 0,
      betrayals: 0,
    },
    tech: new Array<number>(BRANCHES.length).fill(0),
    researching: -1,
    researchQueue: [],
    researchPoints: 0,
    researchCost: 0,
    researchRate: 0,
    research: { base: 0.5, labs: 0, labLevels: 0, mult: 1 },
    transports: [],
    allies: [],
    allyRequests: [],
    allyRequestsIn: [],
    threats: [],
    capital: 5,
  };
  return { ...base, ...over } as unknown as LocalView;
}

/** A fresh mission context: me (human, 100 of 1000 useful tiles), a nation, a tribe. */
function ctx(over: Partial<MissionCtx> = {}, L: Partial<LocalView> = {}): MissionCtx {
  return {
    tick: 600,
    local: local(L),
    players: [player(ME, 'human'), player(2, 'nation'), player(3, 'tribe')],
    world: null,
    me: ME,
    events: [],
    memory: {},
    usefulLand: 1000,
    phase: 'playing',
    warships: 0,
    ...over,
  };
}

const withShare = (c: MissionCtx, share: number) => {
  c.players = c.players.map((p) => (p.id === ME ? { ...p, usefulTiles: share * c.usefulLand } : p));
  return c;
};
const eliminated = (player: number, by = ME): GameEvent => ({
  k: 'eliminated',
  player,
  by,
  cause: 'conquered',
});
const research = (key: string) => {
  const id = techId(key);
  const tech = new Array<number>(BRANCHES.length).fill(0);
  tech[Math.floor(id / LEVELS)] = (id % LEVELS) + 1;
  return tech;
};
const fresh = (m: Mission) => m.objectives.map(() => false);

describe('campaign: what the director remembers', () => {
  it('counts a tribe eliminated by me as a tribe, a nation or a human as a nation', () => {
    const c = ctx({ events: [eliminated(3)] });
    observe(c);
    expect(c.memory.tribes).toBe(1);
    expect(c.memory.nations).toBeUndefined();
    const d = ctx({ events: [eliminated(2)], memory: c.memory });
    observe(d);
    expect(d.memory.nations).toBe(1);
    const h = ctx({ players: [player(ME, 'human'), player(4, 'human')], events: [eliminated(4)] });
    observe(h);
    expect(h.memory.nations).toBe(1);
  });

  it('ignores eliminations by others, and counts a vanished (tribe) id as a tribe', () => {
    const c = ctx({ events: [eliminated(2, 7), eliminated(99)] });
    observe(c);
    expect(c.memory.nations).toBeUndefined();
    expect(c.memory.tribes).toBe(1);
  });

  it('tells landings from recalls and sinkings', () => {
    const boat = (id: number, retreating = false) => ({
      id,
      troops: 500,
      x: 1,
      y: 1,
      tx: 9,
      ty: 9,
      retreating,
    });
    const memory: Record<string, number> = {};
    observe(ctx({ memory }, { transports: [boat(1), boat(2), boat(3)] }));
    expect(memory.launched).toBe(3);
    // Boat 2 turns back, boat 3 is sunk, boat 1 lands.
    observe(ctx({ memory }, { transports: [boat(2, true), boat(3)] }));
    expect(memory.landed).toBe(1);
    observe(
      ctx(
        { memory, events: [{ k: 'shipSunk', x: 1, y: 1, owner: ME, by: 2 }] },
        { transports: [boat(2, true)] },
      ),
    );
    observe(ctx({ memory }, { transports: [] }));
    expect(memory.landed).toBe(1);
    expect(memory.launched).toBe(3);
  });

  it('counts my bombs by kind and my loot', () => {
    const launch = (kind: number, owner = ME): GameEvent => ({
      k: 'nukeLaunch',
      id: 1,
      owner,
      kind,
      sx: 0,
      sy: 0,
      tx: 1,
      ty: 1,
      impact: 50,
      threatened: [],
    });
    const c = ctx({
      events: [launch(N.Atom), launch(N.Hydrogen, 2), { k: 'loot', x: 0, y: 0, owner: ME, amount: 900 }],
    });
    observe(c);
    expect(c.memory.abomb).toBe(1);
    expect(c.memory.hbomb).toBeUndefined();
    expect(c.memory.loot).toBe(900);
  });
});

describe('campaign: objectives', () => {
  it('no mission is won (nor its bonus earned) at the start', () => {
    for (const m of MISSIONS) {
      const c = withShare(ctx({ tick: 0 }), 0.001);
      expect(evaluate(m, c, fresh(m)), m.id).toBe('playing');
      expect(m.bonus.check(c), m.id).toBe(false);
      for (const o of m.objectives)
        expect(o.progress?.(c).value ?? 0, o.key).toBeLessThan(o.progress?.(c).max ?? 1);
    }
  });

  it('a mission is lost when our country falls, not during the spawn phase', () => {
    const m = mission('m1');
    expect(evaluate(m, ctx({}, { alive: false }), fresh(m))).toBe('lost');
    expect(evaluate(m, ctx({ phase: 'spawn' }, { alive: false }), fresh(m))).toBe('playing');
  });

  it('m1: 15 % of the land and a city; bonus two cities', () => {
    const m = mission('m1');
    const counts = new Array<number>(BUILDING_COUNT).fill(0);
    counts[B.City] = 1;
    expect(evaluate(m, withShare(ctx({}, { buildingCount: counts }), 0.149), fresh(m))).toBe('playing');
    expect(evaluate(m, withShare(ctx(), 0.15), fresh(m))).toBe('playing');
    expect(evaluate(m, withShare(ctx({}, { buildingCount: counts }), 0.15), fresh(m))).toBe('won');
    expect(m.bonus.check(ctx({}, { buildingCount: counts }))).toBe(false);
    counts[B.City] = 2;
    expect(m.bonus.check(ctx({}, { buildingCount: counts }))).toBe(true);
  });

  it('m2: hold 20 minutes', () => {
    const m = mission('m2');
    expect(evaluate(m, ctx({ tick: 11_999 }), fresh(m))).toBe('playing');
    expect(evaluate(m, ctx({ tick: 12_000 }), fresh(m))).toBe('won');
  });

  it('m3: eliminating a tribe does not end the mission; a landing and a nation do', () => {
    const m = mission('m3');
    const reached = fresh(m);
    const memory: Record<string, number> = {};
    const tribe = ctx({ memory, events: [eliminated(3)] });
    observe(tribe);
    expect(evaluate(m, tribe, reached)).toBe('playing');
    const nation = ctx({ memory, events: [eliminated(2)] });
    observe(nation);
    // A nation without any landing: still one objective to go.
    expect(evaluate(m, nation, reached)).toBe('playing');
    memory.landed = 1;
    expect(evaluate(m, ctx({ memory }), reached)).toBe('won');
    // Sinking ships is the bonus, never the mission.
    expect(m.bonus.check(ctx({}, { stats: { ...local().stats, shipsSunk: 2 } }))).toBe(true);
    expect(evaluate(m, ctx({}, { stats: { ...local().stats, shipsSunk: 5 } }), fresh(m))).toBe('playing');
  });

  it('m4: trade and train gold, and Railways researched', () => {
    const m = mission('m4');
    const stats = { ...local().stats, tradeGold: 1_000_000, trainGold: 500_000 };
    expect(evaluate(m, ctx({}, { stats }), fresh(m))).toBe('playing');
    expect(evaluate(m, ctx({}, { stats, tech: research('industry.1') }), fresh(m))).toBe('won');
  });

  it('m5: an H-bomb launched by me (an A-bomb is not enough)', () => {
    const m = mission('m5');
    const memory: Record<string, number> = { abomb: 2 };
    expect(evaluate(m, ctx({ memory }), fresh(m))).toBe('playing');
    memory.hbomb = 1;
    expect(evaluate(m, ctx({ memory }), fresh(m))).toBe('won');
  });

  it('m6: 40 % of the world; bonus under 45 minutes', () => {
    const m = mission('m6');
    expect(evaluate(m, withShare(ctx(), 0.39), fresh(m))).toBe('playing');
    const c = withShare(ctx({ tick: 20_000 }), 0.4);
    expect(evaluate(m, c, fresh(m))).toBe('won');
    expect(m.bonus.check(c)).toBe(true);
    expect(m.bonus.check(withShare(ctx({ tick: 30_000 }), 0.4))).toBe(false);
  });

  it('a reached objective stays reached', () => {
    const m = mission('m4');
    const reached = fresh(m);
    evaluate(m, ctx({}, { tech: research('industry.1') }), reached);
    const rich = { ...local().stats, tradeGold: 2_000_000 };
    // Railways no longer shown as researched (a view glitch): the objective holds.
    expect(evaluate(m, ctx({}, { stats: rich }), reached)).toBe('won');
  });

  it('stars: success, reference time, bonus', () => {
    const m = mission('m1');
    expect(starsFor(m, ctx({ tick: m.parTicks }), true)).toBe(3);
    expect(starsFor(m, ctx({ tick: m.parTicks + 1 }), false)).toBe(1);
  });
});

describe('campaign: guide', () => {
  it('every guide ends on a step that never completes by itself, and starts by placing the capital', () => {
    for (const m of MISSIONS) {
      expect(m.guide.at(-1)!.done(ctx({ tick: 99_999 })), m.id).toBe(false);
      expect(m.guide[0]!.key, m.id).toMatch(/spawn/);
    }
  });

  it('a step asking to build waits for the gold: the cost, the gold held and the wait', () => {
    const step = mission('m1').guide.find((s) => s.key === 'guide.m1.city')!;
    const need = shortfall(step, ctx({}, { gold: 25_000, income: 100 }));
    expect(need).toEqual({ cost: 125_000, gold: 25_000, eta: 100 });
    expect(shortfall(step, ctx({}, { gold: 125_000 }))).toBeNull();
    expect(shortfall(step, ctx({}, { gold: 0, income: 0 }))!.eta).toBe(Infinity);
  });

  it('every step that asks for a building, a warship or a bomb says what it costs', () => {
    const asksToBuild = /city|port|factory|defense|lab|silo|warship|cities|economy|launch/;
    for (const m of MISSIONS)
      for (const s of m.guide) {
        if (!asksToBuild.test(s.key.split('.').at(-1)!)) continue;
        expect(s.cost, s.key).toBeTypeOf('function');
        expect(s.cost!(ctx()), s.key).toBeGreaterThan(0);
      }
  });

  it('the starting treasury pays for the first build of the missions that start with one', () => {
    for (const id of ['m1', 'm2', 'm3', 'm4', 'm5']) {
      const m = mission(id);
      const first = m.guide.find((s) => s.cost)!;
      expect(m.config(1, 'X').startGold, `${id} ${first.key}`).toBeGreaterThanOrEqual(first.cost!(ctx()));
    }
  });

  it('explanation steps move on after a while; the camera step wants the camera moved', () => {
    const cap = mission('m1').guide.find((s) => s.key === 'guide.m1.capital')!;
    expect(cap.done(ctx({ tick: 700, memory: { stepAt: 600 } }))).toBe(false);
    expect(cap.done(ctx({ tick: 800, memory: { stepAt: 600 } }))).toBe(true);
    const cam = mission('m1').guide.find((s) => s.key === 'guide.m1.camera')!;
    expect(cam.done(ctx({ memory: { camMoves: 12, stepCam: 10 } }))).toBe(false);
    expect(cam.done(ctx({ memory: { camMoves: 15, stepCam: 10 } }))).toBe(true);
  });

  it('research steps accept a queued, studied or researched technology', () => {
    const step = mission('m5').guide.find((s) => s.key === 'guide.m5.research')!;
    const programme = techId('nuclear.2');
    expect(step.done(ctx())).toBe(false);
    expect(step.done(ctx({}, { researching: techId('economy.1'), researchQueue: [programme] }))).toBe(true);
    expect(step.done(ctx({}, { researching: programme }))).toBe(true);
    expect(step.done(ctx({}, { tech: research('nuclear.2') }))).toBe(true);
  });
});

describe('campaign: hints', () => {
  const hint = (key: string) => HINTS.find((h) => h.key === key)!;
  it('the capital hint only while playing, alive and without a capital', () => {
    expect(hint('guide.hint.capital').when(ctx({}, { capital: -1 }))).toBe(true);
    expect(hint('guide.hint.capital').when(ctx({ phase: 'spawn' }, { capital: -1 }))).toBe(false);
    expect(hint('guide.hint.capital').when(ctx({}, { capital: 12 }))).toBe(false);
  });
  it('alliance offers, the transport cap and idle research centres', () => {
    expect(hint('guide.hint.allyOffer').when(ctx({}, { allyRequests: [2] }))).toBe(true);
    const boat = (id: number) => ({ id, troops: 1, x: 0, y: 0, tx: 0, ty: 0, retreating: false });
    expect(hint('guide.hint.boats').when(ctx({}, { transports: [boat(1), boat(2)] }))).toBe(false);
    expect(hint('guide.hint.boats').when(ctx({}, { transports: [boat(1), boat(2), boat(3)] }))).toBe(true);
    const labs = { base: 0.5, labs: 1, labLevels: 1, mult: 1 };
    expect(hint('guide.hint.research').when(ctx({}, { research: labs }))).toBe(true);
    expect(hint('guide.hint.research').when(ctx({}, { research: labs, researching: 0 }))).toBe(false);
  });
});

describe('campaign: result and texts', () => {
  const tr = (k: string, p?: Record<string, string | number>) => (p ? `${k}${JSON.stringify(p)}` : k);

  it('a won mission lists its objectives, the reference time and the bonus, and unlocks the next one', () => {
    const m = mission('m3');
    const r = missionResult(
      m,
      ctx({ tick: 9000 }),
      { reached: [true, true], bonusDone: false, stars: 2, best: 1 },
      tr,
    );
    expect(r.success).toBe(true);
    expect(r.best).toBe(2);
    expect(r.objectives.map((o) => o.done)).toEqual([true, true, true, false]);
    expect(r.objectives.at(-1)!.bonus).toBe(true);
    expect(r.next?.id).toBe('m4');
    expect(r.debrief).toBe('campaign.m3.outro');
    expect(r.index).toBe(3);
  });

  it('a failed mission unlocks nothing and keeps the best result', () => {
    const r = missionResult(
      mission('m6'),
      ctx(),
      { reached: [false], bonusDone: false, stars: 0, best: 3 },
      tr,
    );
    expect(r.success).toBe(false);
    expect(r.next).toBeNull();
    expect(r.best).toBe(3);
    expect(r.debrief).toBe('campaign.failed');
  });

  it('every mission line exists in French and English, and every spoken line has its voice', () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const flat = (lang: string) => {
      const out: Record<string, string> = {};
      const walk = (o: Record<string, unknown>, p: string) => {
        for (const [k, v] of Object.entries(o))
          if (typeof v === 'string') out[p + k] = v;
          else walk(v as Record<string, unknown>, `${p + k}.`);
      };
      walk(JSON.parse(fs.readFileSync(path.join(root, `src/ui/i18n/${lang}.json`), 'utf8')), '');
      return out;
    };
    const spoken = [
      'campaign.failed',
      ...MISSIONS.flatMap((m) => [`campaign.${m.id}.brief`, m.outro, ...m.guide.map((s) => s.key)]),
      ...HINTS.map((h) => h.key),
    ];
    const shown = MISSIONS.flatMap((m) => [
      `campaign.${m.id}.title`,
      `campaign.${m.id}.tip1`,
      `campaign.${m.id}.tip2`,
      m.bonus.key,
      ...m.objectives.map((o) => o.key),
    ]);
    for (const lang of ['fr', 'en']) {
      const d = flat(lang);
      for (const k of [...spoken, ...shown]) expect(d[k], `${lang} ${k}`).toBeTypeOf('string');
      for (const k of spoken)
        expect(fs.existsSync(path.join(root, `public/voice/${lang}/${k}.mp3`)), `${lang} voice ${k}`).toBe(
          true,
        );
      // The separate tutorial is gone.
      expect(Object.keys(d).filter((k) => k.startsWith('tutorial.'))).toEqual([]);
    }
  });
});
