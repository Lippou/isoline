import { describe, expect, it } from 'vitest';
import { asciiMap, testGame, startWith, cmd, makeGame, run } from '../helpers';
import { A, B, BUILD_TICKS, CAPTURE_OCCUPATION_TICKS, N } from '../../src/core/game/constants';
import {
  buildCost,
  checkPlacement,
  placeBuilding,
  upgradeBuilding,
} from '../../src/core/buildings/buildings';
import { maxLaunchable } from '../../src/core/units/nukes';
import { launchAircraft } from '../../src/core/units/air';
import { maxTroops } from '../../src/core/game/economy';
import { restoreSnapshot, snapshotFromJson, snapshotToJson, takeSnapshot } from '../../src/core/net/snapshot';
import { hashGame } from '../../src/core/net/hash';
import { isWellFormed } from '../../src/core/net/commands';
import {
  BRANCHES,
  LEVELS,
  MAX_REPEAT,
  NATION_RESEARCH,
  NODES,
  REPEAT_COST,
  REPEAT_GROWTH,
  RESEARCH_BASE,
  RESEARCH_PER_LAB_LEVEL,
  TIERS,
  TIER_COST,
  UNLOCK_NODE,
  costOf,
  isAvailable,
  isResearched,
  migrateTech,
  nextStep,
  pathCost,
  planGoal,
  repeatCount,
  repeatId,
  researchPath,
  researchRate,
  setResearch,
  techBuildCost,
  techBuildTime,
  techEconomy,
  techId,
  techKey,
  techNukes,
  techSam,
  techTroopCap,
  updateResearch,
} from '../../src/core/rules/tech';
import { researchIdle, researchPlan } from '../../src/ui/hud/research';
import type { Game } from '../../src/core/game/state';
import type { LocalView } from '../../src/engine/protocol';

const FIELD = [
  '~~~~~~~~~~~~~~~~~~~~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~~~~~~~~~~~~~~~~~~~~',
];

/** One player owning the whole field, rich, with the tech tree on or off. */
function field(tech: boolean): Game {
  const g = testGame(asciiMap(FIELD, 6), 1, { victoryThreshold: 101 });
  g.config.features.tech = tech;
  startWith(g, [[30, 20]]);
  const p = g.players[1]!;
  for (let i = 0; i < g.map.size; i++) if (g.map.terrain[i]! > 2) g.setOwner(i, p.id);
  p.gold = 200_000_000;
  return g;
}

const id = (key: string) => {
  const n = techId(key);
  expect(n).toBeGreaterThanOrEqual(0);
  return n;
};
/** Research `key` and everything it needs, instantly. */
const grant = (g: Game, key: string) => {
  const p = g.players[1]!;
  for (const s of researchPath(p.tech, id(key))) p.tech[NODES[s]!.branch] = NODES[s]!.level;
};
const none = () => new Uint8Array(BRANCHES.length);

describe('tech tree: structure', () => {
  it('6 branches × 6 technologies on 6 tiers, plus one endless technology per branch', () => {
    expect(BRANCHES.length).toBe(6);
    expect(LEVELS).toBe(6);
    expect(NODES.length).toBe(BRANCHES.length * (LEVELS + 1));
    for (const n of NODES) {
      if (n.repeat) {
        expect(n.tier).toBe(TIERS + 1);
        expect(n.cost).toBe(REPEAT_COST);
        expect(techKey(n.id)).toBe(`tech.${BRANCHES[n.branch]}.r`);
        expect(techId(`${BRANCHES[n.branch]}.r`)).toBe(n.id);
        continue;
      }
      expect(n.cost).toBe(TIER_COST[n.tier - 1]);
      expect(techKey(n.id)).toBe(`tech.${BRANCHES[n.branch]}.${n.level}`);
      // Tiers grow along a branch; prerequisites never sit in a later tier or the same branch.
      if (n.level > 1) expect(n.tier).toBeGreaterThan(NODES[n.id - 1]!.tier);
      for (const r of n.requires) {
        expect(NODES[r]!.branch).not.toBe(n.branch);
        expect(NODES[r]!.tier).toBeLessThanOrEqual(n.tier);
      }
    }
  });

  it('the economy comes first: every war technology past the first needs economy or industry', () => {
    for (const br of ['military', 'naval', 'defense', 'nuclear']) {
      for (let l = 2; l <= LEVELS; l++) {
        const path = researchPath(none(), id(`${br}.${l}`)).map((s) => BRANCHES[NODES[s]!.branch]);
        expect(path).toContain('economy');
      }
    }
    // The nuclear programme needs atomic physics, the central bank and heavy industry.
    const path = researchPath(none(), id('nuclear.2')).map(techKey);
    expect(path).toEqual([
      'tech.economy.1',
      'tech.nuclear.1',
      'tech.economy.2',
      'tech.industry.1',
      'tech.industry.2',
      'tech.nuclear.2',
    ]);
    expect(pathCost(none(), id('nuclear.2'))).toBe(3 * TIER_COST[0] + 3 * TIER_COST[1]);
  });

  it('unlocks: silos and A-bombs, then H-bombs, MIRVs deep; SAMs, radars and airfields', () => {
    expect(UNLOCK_NODE.silo).toBe(id('nuclear.2'));
    expect(UNLOCK_NODE.atom).toBe(id('nuclear.2'));
    expect(UNLOCK_NODE.hydrogen).toBe(id('nuclear.3'));
    expect(UNLOCK_NODE.mirv).toBe(id('nuclear.5'));
    expect(UNLOCK_NODE.sam).toBe(id('defense.1'));
    expect(UNLOCK_NODE.radar).toBe(id('defense.2'));
    expect(UNLOCK_NODE.airfield).toBe(id('industry.3'));
    // SAM batteries are cheaper to reach than the bombs they stop.
    expect(pathCost(none(), UNLOCK_NODE.sam)).toBeLessThan(pathCost(none(), UNLOCK_NODE.atom));
    // The whole tree is long: far more than the old 17,300 points.
    const all = NODES.filter((n) => !n.repeat).reduce((s, n) => s + n.cost, 0);
    expect(all).toBeGreaterThan(80_000);
  });

  it('paths resolve prerequisites first, in a stable order, and end', () => {
    const lv = none();
    expect(nextStep(lv, id('nuclear.5'))).toBe(id('economy.1'));
    expect(isAvailable(lv, id('economy.1'))).toBe(true);
    expect(isAvailable(lv, id('industry.1'))).toBe(false);
    for (const s of researchPath(lv, id('nuclear.6'))) {
      expect(isAvailable(lv, s)).toBe(true);
      lv[NODES[s]!.branch] = NODES[s]!.level;
    }
    expect(isResearched(lv, id('nuclear.6'))).toBe(true);
    expect(nextStep(lv, id('nuclear.6'))).toBe(-1);
  });

  it('endless technologies: after the branch, one level at a time, dearer each time, capped', () => {
    const lv = none();
    const r = repeatId(0);
    expect(isAvailable(lv, r)).toBe(false);
    const path = researchPath(lv, r);
    expect(path.at(-1)).toBe(r);
    expect(path).toContain(id('economy.6'));
    lv[0] = LEVELS;
    expect(isAvailable(lv, r)).toBe(true);
    expect(isResearched(lv, r)).toBe(false); // never "done" while levels remain
    expect(costOf(lv, r)).toBe(REPEAT_COST);
    lv[0] = LEVELS + 3;
    expect(repeatCount(lv, 0)).toBe(3);
    expect(costOf(lv, r)).toBe(Math.round(REPEAT_COST * REPEAT_GROWTH ** 3));
    lv[0] = LEVELS + MAX_REPEAT;
    expect(isAvailable(lv, r)).toBe(false);
    expect(nextStep(lv, r)).toBe(-1);
  });
});

describe('tech tree: research centres', () => {
  it('a buildable, upgradable building with an OpenFront-style price ladder, only with the tree on', () => {
    const g = field(true);
    const p = g.players[1]!;
    const tile = g.map.idx(30, 20);
    expect(checkPlacement(g, p, B.Lab, tile)).toBe('ok');
    expect(buildCost(g, p, B.Lab)).toBe(250_000);
    const lab = placeBuilding(g, p, B.Lab, tile)!;
    expect(buildCost(g, p, B.Lab)).toBe(500_000);
    for (let k = 0; k < BUILD_TICKS[B.Lab]; k++) g.step([]);
    expect(lab.buildLeft).toBe(0);
    // Each upgrade is built in turn (one at a time); the price counts it once paid.
    const upgrade = () => {
      expect(upgradeBuilding(g, p, lab)).toBe(true);
      expect(upgradeBuilding(g, p, lab)).toBe(false);
      for (let k = 0; k < BUILD_TICKS[B.Lab]; k++) g.step([]);
    };
    upgrade();
    upgrade();
    expect(lab.level).toBe(3);
    expect(buildCost(g, p, B.Lab)).toBe(2_000_000);
    upgrade();
    expect(buildCost(g, p, B.Lab)).toBe(4_000_000);
    upgrade();
    expect(buildCost(g, p, B.Lab)).toBe(5_000_000); // capped
    upgrade();
    expect(buildCost(g, p, B.Lab)).toBe(5_000_000);
    const off = field(false);
    expect(checkPlacement(off, off.players[1]!, B.Lab, tile)).toBe('disabled');
  });

  it('research points come from completed centres (a trickle without), cities give none', () => {
    const g = field(true);
    const p = g.players[1]!;
    placeBuilding(g, p, B.City, g.map.idx(60, 20), true);
    placeBuilding(g, p, B.City, g.map.idx(80, 20), true);
    g.step([]);
    expect(researchRate(p) * 10).toBeCloseTo(RESEARCH_BASE);
    const lab = placeBuilding(g, p, B.Lab, g.map.idx(30, 20))!;
    g.step([]);
    expect(p.labLevels).toBe(0); // still under construction
    for (let k = 0; k < BUILD_TICKS[B.Lab]; k++) g.step([]);
    expect(p.labLevels).toBe(1);
    for (let n = 0; n < 2; n++) {
      upgradeBuilding(g, p, lab);
      g.step([]);
      expect(p.labLevels).toBe(1 + n); // the new level produces once built
      for (let k = 0; k < BUILD_TICKS[B.Lab]; k++) g.step([]);
    }
    expect(p.labLevels).toBe(3);
    expect(researchRate(p) * 10).toBeCloseTo(RESEARCH_BASE + 3 * RESEARCH_PER_LAB_LEVEL);
    // Universities and Atomic physics speed it up.
    grant(g, 'economy.3');
    grant(g, 'nuclear.1');
    expect(researchRate(p) * 10).toBeCloseTo((RESEARCH_BASE + 3 * RESEARCH_PER_LAB_LEVEL) * 1.35);
  });

  it('journal: a centre ready, then captured (it changes hands with its output, after the occupation)', () => {
    const g = testGame(asciiMap(FIELD, 6), 2, { victoryThreshold: 101 });
    g.config.features.tech = true;
    startWith(g, [
      [20, 20],
      [90, 20],
    ]);
    const [a, b] = [g.players[1]!, g.players[2]!];
    a.gold = 10_000_000;
    const tile = g.map.idx(22, 20);
    g.step([cmd(1, { t: 'build', kind: B.Lab, tile })]);
    const keys: string[] = [];
    for (let k = 0; k < BUILD_TICKS[B.Lab] + 2; k++) {
      g.step([]);
      for (const e of g.events) if (e.k === 'notify') keys.push(e.key);
    }
    expect(keys).toContain('notify.labReady');
    expect(a.labLevels).toBe(1);
    g.events.length = 0;
    g.setOwner(tile, b.id);
    const ev = g.events.filter((e) => e.k === 'notify').map((e) => (e.k === 'notify' ? e.key : ''));
    expect(ev).toEqual(expect.arrayContaining(['notify.labLost', 'notify.labTaken']));
    g.step([]);
    expect(a.labLevels).toBe(0);
    // Occupied first (GAME_DESIGN.md §6.4): it researches for its new owner once that ends.
    expect(b.labLevels).toBe(0);
    for (let k = 0; k < CAPTURE_OCCUPATION_TICKS; k++) g.step([]);
    expect(b.labLevels).toBe(1);
  });

  it('nations build research centres and keep researching', () => {
    const g = makeGame('black-sea', { nations: 8, tribes: 10, players: [] });
    run(g, 4200); // 7 min
    const nations = g.players.filter((p) => p && p.kind === 'nation' && p.alive);
    expect(nations.filter((p) => p!.labLevels > 0).length).toBeGreaterThanOrEqual(nations.length / 2);
    expect(nations.every((p) => p!.tech.some((x) => x > 0))).toBe(true);
    expect(nations.filter((p) => p!.researching >= 0).length).toBeGreaterThanOrEqual(nations.length / 2);
  });
});

describe('tech tree: research', () => {
  it('points build up while idle and pay the path in order', () => {
    const g = field(true);
    const p = g.players[1]!;
    p.labLevels = 3; // refreshed from the buildings every tick: give it real centres
    placeBuilding(g, p, B.Lab, g.map.idx(30, 20), true)!.level = 3;
    for (let k = 0; k < 100; k++) g.step([]);
    const perSec = RESEARCH_BASE + 3 * RESEARCH_PER_LAB_LEVEL;
    expect(p.researchPoints).toBeCloseTo(perSec * 10, 0); // 10 s banked, nothing studied
    const target = id('nuclear.2');
    g.step([cmd(1, { t: 'research', tech: target })]);
    const done: string[] = [];
    for (let k = 0; k < 20_000 && p.researching >= 0; k++) {
      g.step([]);
      for (const e of g.events)
        if (e.k === 'notify' && e.key === 'notify.researchDone') done.push(`${e.params!.tech}`);
    }
    expect(done).toEqual(researchPath(none(), target).map(techKey));
    expect(isResearched(p.tech, target)).toBe(true);
    expect(p.researching).toBe(-1); // reached: research stops, points keep banking
  });

  it('invalid or finished targets are ignored; -1 stops and clears the queue', () => {
    const g = field(true);
    const p = g.players[1]!;
    grant(g, 'economy.2');
    setResearch(p, id('economy.2')); // already researched
    expect(p.researching).toBe(-1);
    setResearch(p, 999);
    expect(p.researching).toBe(-1);
    setResearch(p, id('naval.4'));
    expect(p.researching).toBe(id('naval.4'));
    setResearch(p, id('defense.2'), 'queue');
    expect(p.researchQueue).toEqual([id('defense.2')]);
    setResearch(p, -1);
    expect(p.researching).toBe(-1);
    expect(p.researchQueue).toEqual([]);
  });

  it('queue: goals follow one another; unqueue and "research now" reshuffle it', () => {
    const g = field(true);
    const p = g.players[1]!;
    setResearch(p, id('economy.1'), 'queue'); // idle: studied at once
    expect(p.researching).toBe(id('economy.1'));
    setResearch(p, id('military.1'), 'queue');
    setResearch(p, id('naval.1'), 'queue');
    setResearch(p, id('naval.1'), 'queue'); // no duplicates
    expect(p.researchQueue).toEqual([id('military.1'), id('naval.1')]);
    // Research now: the queue stays behind the new goal (and loses it).
    setResearch(p, id('naval.1'));
    expect(p.researching).toBe(id('naval.1'));
    expect(p.researchQueue).toEqual([id('military.1')]);
    // Dropping the current goal: the next one takes over.
    setResearch(p, id('naval.1'), 'unqueue');
    expect(p.researching).toBe(id('military.1'));
    expect(p.researchQueue).toEqual([]);
    // Completion moves the queue on.
    setResearch(p, id('naval.1'), 'queue');
    p.researchPoints = 10_000;
    expect(updateResearch(p)).toBe(id('military.1'));
    expect(p.researching).toBe(id('naval.1'));
    expect(updateResearch(p)).toBe(id('naval.1'));
    expect(p.researching).toBe(-1);
    // The command is validated (op is optional).
    expect(isWellFormed({ t: 'research', tech: 3, op: 'queue' })).toBe(true);
    expect(isWellFormed({ t: 'research', tech: 3, op: 'later' })).toBe(false);
  });

  it('an endless goal keeps going while nothing is queued; journal says when research stops', () => {
    const g = field(true);
    const p = g.players[1]!;
    p.tech[0] = LEVELS;
    const r = repeatId(0);
    g.step([cmd(1, { t: 'research', tech: r })]);
    p.researchPoints = 1e9;
    const keys: string[] = [];
    for (let k = 0; k < 3; k++) {
      g.step([]);
      for (const e of g.events) if (e.k === 'notify') keys.push(e.key);
    }
    expect(repeatCount(p.tech, 0)).toBe(3);
    expect(p.researching).toBe(r);
    expect(keys.filter((k) => k === 'notify.researchRepeat').length).toBe(3);
    expect(techEconomy(p)).toBeCloseTo(1.1 * 1.15 * 1.1 * 1.06);
    // A queued goal takes over after the next level; once reached, research stops.
    g.step([cmd(1, { t: 'research', tech: id('military.1'), op: 'queue' })]);
    keys.length = 0;
    for (let k = 0; k < 3; k++) {
      g.step([]);
      for (const e of g.events) if (e.k === 'notify') keys.push(e.key);
    }
    expect(isResearched(p.tech, id('military.1'))).toBe(true);
    expect(p.researching).toBe(-1);
    expect(keys).toContain('notify.researchIdle');
  });

  it('plan and reminder helpers (UI)', () => {
    const plan = researchPlan(none(), [id('industry.1'), id('military.2')]);
    expect(plan.map((s) => techKey(s.id))).toEqual([
      'tech.economy.1',
      'tech.industry.1',
      'tech.military.1',
      'tech.military.2',
    ]);
    expect(plan.at(-1)!.cum).toBe(3 * TIER_COST[0] + TIER_COST[1]);
    const view = {
      alive: true,
      tech: [0, 0, 0, 0, 0, 0],
      researching: -1,
      researchQueue: [],
      researchPoints: 0,
      research: { base: 0.5, labs: 0, labLevels: 0, mult: 1 },
    } as unknown as LocalView;
    expect(researchIdle(view, true)).toBe(false); // nothing to remind yet
    expect(researchIdle({ ...view, researchPoints: 200 }, true)).toBe(true);
    expect(researchIdle({ ...view, research: { ...view.research, labLevels: 1 } }, true)).toBe(true);
    expect(researchIdle({ ...view, researchPoints: 200 }, false)).toBe(false);
    expect(researchIdle({ ...view, researchPoints: 200, researching: 0 }, true)).toBe(false);
  });

  it('effects of the new tree', () => {
    const g = field(true);
    const p = g.players[1]!;
    grant(g, 'economy.2');
    expect(techEconomy(p)).toBeCloseTo(1.1 * 1.15);
    grant(g, 'industry.6');
    expect(techBuildCost(p)).toBeCloseTo(0.729);
    expect(techBuildTime(p)).toBe(0.5);
    grant(g, 'nuclear.6');
    expect(techNukes(p).cost).toBeCloseTo(0.8 * 0.75);
    expect(techNukes(p).reload).toBeCloseTo(1.25);
    grant(g, 'defense.6');
    expect(techSam(p)).toEqual({ range: 35, targets: 3 });
    const before = maxTroops(g, p);
    grant(g, 'military.5');
    expect(techTroopCap(p)).toBe(1.1);
    expect(maxTroops(g, p)).toBeCloseTo(before * 1.1);
    // Megaprojects: construction twice as fast.
    const lab = placeBuilding(g, p, B.Lab, g.map.idx(30, 20))!;
    expect(lab.buildLeft).toBe(BUILD_TICKS[B.Lab] / 2);
  });
});

describe('tech tree: saves', () => {
  it('a 4-level save (before 1.4.0) shifts the nuclear branch and keeps its goal', () => {
    const g = field(true);
    const p = g.players[1]!;
    p.tech = new Uint8Array([2, 1, 0, 3, 1]); // 5 branches, nuclear at 3 (miniaturisation)
    p.researching = 3 * 4 + 3; // old nuclear.4 (MIRV)
    migrateTech(p, true);
    expect(p.tech.length).toBe(BRANCHES.length);
    expect(p.tech[3]).toBe(4); // miniaturisation is nuclear.4 now
    expect(p.researching).toBe(id('nuclear.5')); // MIRV
    expect(p.researchQueue).toEqual([]);
  });

  it('snapshots keep centres, queue and endless levels; old saves without them load', () => {
    const g = field(true);
    const p = g.players[1]!;
    placeBuilding(g, p, B.Lab, g.map.idx(30, 20), true);
    setResearch(p, id('economy.2'));
    setResearch(p, id('defense.1'), 'queue');
    for (let k = 0; k < 20; k++) g.step([]);
    const snap = snapshotFromJson(snapshotToJson(takeSnapshot(g)));
    const r = restoreSnapshot(g.map, snap);
    expect(r.players[1]!.researchQueue).toEqual([id('defense.1')]);
    for (let k = 0; k < 50; k++) [g, r].forEach((x) => x.step([]));
    expect(hashGame(r)).toBe(hashGame(g));
    // A 1.3 save: version 2, eight building types, a 4-level tree, no queue.
    const old = snapshotFromJson(snapshotToJson(takeSnapshot(g)));
    old.version = 2;
    const raw = old.players[1] as Record<string, unknown>;
    raw.buildingCount = { __i32: [0, 0, 0, 0, 0, 0, 0, 0] };
    raw.levelsBuilt = { __i32: [0, 0, 0, 0, 0, 0, 0, 0] };
    raw.tech = { __u8: 'AQAAAgAA' }; // economy 1, nuclear 2
    delete raw.researchQueue;
    delete raw.labLevels;
    raw.researching = 3 * 4 + 1; // old nuclear.2 (H-bomb)
    old.buildings = [];
    const o = restoreSnapshot(g.map, old).players[1]!;
    expect(o.buildingCount.length).toBe(9);
    expect(o.levelsBuilt[B.Lab]).toBe(0);
    expect(o.tech[3]).toBe(3);
    expect(o.researching).toBe(UNLOCK_NODE.hydrogen);
    expect(o.researchQueue).toEqual([]);
  });
});

describe('tech tree: locks', () => {
  it('silos, SAMs, radars and airfields are locked until researched', () => {
    const g = field(true);
    const p = g.players[1]!;
    const tile = g.map.idx(30, 20);
    expect(checkPlacement(g, p, B.City, tile)).toBe('ok');
    expect(checkPlacement(g, p, B.DefensePost, tile)).toBe('ok');
    expect(checkPlacement(g, p, B.Lab, tile)).toBe('ok');
    for (const [kind, key] of [
      [B.Silo, 'nuclear.2'],
      [B.Sam, 'defense.1'],
      [B.Radar, 'defense.2'],
      [B.Airfield, 'industry.3'],
    ] as const) {
      expect(checkPlacement(g, p, kind, tile)).toBe('locked');
      grant(g, key);
      expect(checkPlacement(g, p, kind, tile)).toBe('ok');
    }
  });

  it('the build command reports the missing technology', () => {
    const g = field(true);
    g.step([cmd(1, { t: 'build', kind: B.Silo, tile: g.map.idx(30, 20) })]);
    const e = g.events.find((x) => x.k === 'notify' && x.key === 'error.build.locked');
    expect(e && e.k === 'notify' && e.params).toEqual({ tech: 'tech.nuclear.2' });
    expect(g.players[1]!.buildingCount[B.Silo]).toBe(0);
  });

  it('bombs: A with the programme, H with the thermonuclear bomb, MIRV last', () => {
    const g = field(true);
    const p = g.players[1]!;
    const silo = placeBuilding(g, p, B.Silo, g.map.idx(30, 20), true)!; // captured, say
    expect(silo).not.toBeNull();
    expect(upgradeBuilding(g, p, silo)).toBe(false); // no upgrade without the programme
    expect(maxLaunchable(g, p, N.Atom)).toBe(0);
    grant(g, 'nuclear.2');
    expect(maxLaunchable(g, p, N.Atom)).toBe(1);
    expect(maxLaunchable(g, p, N.Hydrogen)).toBe(0);
    grant(g, 'nuclear.3');
    expect(maxLaunchable(g, p, N.Hydrogen)).toBe(1);
    expect(maxLaunchable(g, p, N.Mirv)).toBe(0);
    grant(g, 'nuclear.5');
    expect(maxLaunchable(g, p, N.Mirv)).toBe(1);
    expect(upgradeBuilding(g, p, silo)).toBe(true);
  });

  it('aircraft need Aerospace, even from a captured airfield', () => {
    const g = field(true);
    const p = g.players[1]!;
    placeBuilding(g, p, B.Airfield, g.map.idx(30, 20), true);
    const target = g.map.idx(40, 20);
    expect(launchAircraft(g, p, A.Recon, target)).toBe(false);
    grant(g, 'industry.3');
    expect(launchAircraft(g, p, A.Recon, target)).toBe(true);
  });

  it('with the tech tree off, nothing is locked (OpenFront rules)', () => {
    const g = field(false);
    const p = g.players[1]!;
    const tile = g.map.idx(30, 20);
    for (const kind of [B.Silo, B.Sam, B.Radar, B.Airfield])
      expect(checkPlacement(g, p, kind, tile)).toBe('ok');
    placeBuilding(g, p, B.Silo, tile, true);
    expect(maxLaunchable(g, p, N.Atom)).toBe(1);
    expect(maxLaunchable(g, p, N.Hydrogen)).toBe(1);
    expect(maxLaunchable(g, p, N.Mirv)).toBe(1);
    placeBuilding(g, p, B.Airfield, g.map.idx(50, 20), true);
    expect(launchAircraft(g, p, A.Recon, g.map.idx(40, 20))).toBe(true);
  });
});

describe('tech tree: nations', () => {
  it('plans are valid, start with the economy and reach the programme and SAMs', () => {
    for (const plan of Object.values(NATION_RESEARCH)) {
      for (const key of plan) id(key);
      const lv = none();
      const order: number[] = [];
      for (let goal = planGoal(lv, plan); goal >= 0 && order.length < 200; goal = planGoal(lv, plan)) {
        for (const s of researchPath(lv, goal)) {
          order.push(s);
          lv[NODES[s]!.branch] = NODES[s]!.repeat ? lv[NODES[s]!.branch]! + 1 : NODES[s]!.level;
        }
      }
      // The whole regular tree, then endless levels until the cap (cheapest first).
      expect(NODES.filter((n) => !n.repeat).every((n) => isResearched(lv, n.id))).toBe(true);
      expect(order.indexOf(id('economy.1'))).toBeLessThanOrEqual(1);
      expect(order.indexOf(id('nuclear.2'))).toBeLessThan(10);
      expect(order.indexOf(id('defense.1'))).toBeLessThan(10);
    }
  });
});
