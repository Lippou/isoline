import { describe, expect, it } from 'vitest';
import { asciiMap, testGame, startWith } from '../helpers';
import { AIR_SPEED, TRANSPORT_HP, WARSHIP_HP, WARSHIP_RANGE } from '../../src/core/game/constants';
import { U, makeUnit, type Unit } from '../../src/core/units/unit';
import { addUnit } from '../../src/core/units/ships';
import {
  FOG_SIGHT,
  STORM_AIR_SPEED,
  STORM_SHIP_SPEED,
  WEATHER_MAX_CELLS,
  sightAt,
  sightBetween,
  updateWeather,
  weatherAt,
  type WeatherCell,
} from '../../src/core/rules/weather';
import type { Game } from '../../src/core/game/state';

// A wide sea with three small islands (players 1 west, 2 east, 3 south).
const SEA = Array.from({ length: 12 }, (_, y) =>
  Array.from({ length: 50 }, (_, x) =>
    (y >= 1 && y <= 2 && ((x >= 1 && x <= 3) || (x >= 46 && x <= 48))) ||
    (y >= 9 && y <= 10 && x >= 24 && x <= 26)
      ? '.'
      : '~',
  ).join(''),
);

function sea(): Game {
  const g = testGame(asciiMap(SEA, 6), 3);
  g.config.features.weather = true;
  startWith(g, [
    [14, 11],
    [284, 11],
    [152, 59],
  ]);
  for (let i = 0; i < g.map.size; i++)
    if (g.map.isLand(i)) g.setOwner(i, g.map.y(i) > 40 ? 3 : g.map.x(i) < 150 ? 1 : 2);
  // No random cells: each test sets its own sky.
  g.features.weather = [];
  g.features.nextWeatherTick = Infinity;
  return g;
}

const cell = (x: number, y: number, r: number, kind: 0 | 1): WeatherCell => ({
  x,
  y,
  r,
  vx: 0,
  vy: 0,
  until: 1e9,
  kind,
  born: 0,
});

/** A ship of `owner` at (x, y) heading for (tx, ty) at `speed` tiles a tick. */
function ship(
  g: Game,
  type: U,
  owner: number,
  x: number,
  y: number,
  tx: number,
  ty: number,
  speed = 1,
): Unit {
  const u = makeUnit(g.nextId(), type, owner, x + 0.5, y + 0.5);
  u.hp = u.maxHp = type === U.Warship ? WARSHIP_HP : TRANSPORT_HP;
  u.speed = speed;
  u.path = [g.map.idx(tx, ty)];
  u.pathIdx = 0;
  if (type === U.Transport) {
    u.troops = 1_000;
    u.target = g.map.idx(14, 11);
  }
  return addUnit(g, u);
}

describe('weather', () => {
  it('storms slow ships to ×0.6 and aircraft to ×0.75; clear skies leave them be', () => {
    const g = sea();
    g.features.weather = [cell(100, 30, 20, 0)];
    const slow = ship(g, U.Transport, 1, 100, 30, 200, 30);
    const free = ship(g, U.Transport, 1, 100, 50, 200, 50);
    const bomber = makeUnit(g.nextId(), U.Bomber, 1, 95.5, 25.5);
    bomber.speed = AIR_SPEED[1];
    bomber.hp = bomber.maxHp = 100;
    bomber.tx = 95.5;
    bomber.ty = 70.5;
    bomber.t1 = 1e9;
    addUnit(g, bomber);
    const [x0, by0] = [slow.x, bomber.y];
    g.step([]);
    expect(slow.x - x0).toBeCloseTo(STORM_SHIP_SPEED, 5);
    expect(free.x - x0).toBeCloseTo(1, 5);
    expect(bomber.y - by0).toBeCloseTo(AIR_SPEED[1] * STORM_AIR_SPEED, 5);
    // Out of the cell, full speed again.
    g.features.weather = [];
    const x1 = slow.x;
    g.step([]);
    expect(slow.x - x1).toBeCloseTo(1, 5);
  });

  it('a fog bank halves the sight of radars and units inside it, and detection across it', () => {
    const g = sea();
    g.features.weather = [cell(100, 30, 15, 1)];
    expect(weatherAt(g, 100, 30)?.kind).toBe(1);
    expect(weatherAt(g, 100, 50)).toBeNull();
    expect(sightAt(g, 100, 30, 60)).toBe(60 * FOG_SIGHT);
    expect(sightAt(g, 100, 50, 60)).toBe(60);
    // Either end in the bank: half the reach; both outside: full.
    expect(sightBetween(g, 100, 30, 160, 30, WARSHIP_RANGE)).toBe(WARSHIP_RANGE * FOG_SIGHT);
    expect(sightBetween(g, 160, 30, 100, 30, WARSHIP_RANGE)).toBe(WARSHIP_RANGE * FOG_SIGHT);
    expect(sightBetween(g, 160, 50, 100, 50, WARSHIP_RANGE)).toBe(WARSHIP_RANGE);
    // Storms do not blind; with the weather feature off nothing applies.
    g.features.weather = [cell(100, 30, 15, 0)];
    expect(sightAt(g, 100, 30, 60)).toBe(60);
    g.features.weather = [cell(100, 30, 15, 1)];
    g.config.features.weather = false;
    expect(sightAt(g, 100, 30, 60)).toBe(60);
    expect(weatherAt(g, 100, 30)).toBeNull();
  });

  it('a warship does not spot a transport hidden in a fog bank beyond half its range', () => {
    const run = (fog: WeatherCell | null) => {
      const g = sea();
      const ws = ship(g, U.Warship, 2, 150, 30, 150, 30);
      ws.patrol = g.map.idx(150, 30);
      ws.path = [];
      // 60 tiles away (within WARSHIP_RANGE, beyond half of it), standing still.
      const prey = ship(g, U.Transport, 1, 90, 30, 40, 30, 0);
      if (fog) g.features.weather = [fog];
      for (let k = 0; k < 12; k++) g.step([]);
      return { target: ws.target, prey: prey.id };
    };
    expect(WARSHIP_RANGE * FOG_SIGHT).toBeLessThan(60);
    const clear = run(null);
    expect(clear.target).toBe(clear.prey);
    // The transport in the fog, or the warship in it: unseen.
    expect(run(cell(90, 30, 12, 1)).target).toBe(-1);
    expect(run(cell(150, 30, 12, 1)).target).toBe(-1);
    // A storm hides nothing.
    const storm = run(cell(90, 30, 12, 0));
    expect(storm.target).toBe(storm.prey);
  });

  it('cells form deterministically, a few at a time, storms over open water', () => {
    // West half sea, east half land.
    const rows = Array.from({ length: 10 }, () => '~'.repeat(10) + '.'.repeat(10));
    const sky = (seed: number) => {
      const g = testGame(asciiMap(rows, 20), 0, { seed });
      g.config.features.weather = true;
      const born: WeatherCell[] = [];
      let sum = 0;
      let most = 0;
      const ticks = 36_000; // one hour
      for (let t = 1; t <= ticks; t++) {
        g.tick = t;
        const n = g.features.weather.length;
        updateWeather(g);
        if (g.features.weather.length > n) born.push({ ...g.features.weather.at(-1)! });
        sum += g.features.weather.length;
        most = Math.max(most, g.features.weather.length);
      }
      return { g, born, mean: sum / ticks, most };
    };
    const a = sky(5);
    const b = sky(5);
    expect(b.born).toEqual(a.born);
    expect(a.most).toBeLessThanOrEqual(WEATHER_MAX_CELLS);
    expect(a.mean).toBeGreaterThan(2);
    expect(a.mean).toBeLessThan(4.5);
    const storms = a.born.filter((c) => c.kind === 0);
    const wet = storms.filter((c) => a.g.map.isWater(a.g.map.idx(Math.floor(c.x), Math.floor(c.y))));
    expect(storms.length).toBeGreaterThan(20);
    expect(wet.length / storms.length).toBeGreaterThan(0.9);
    // Fog banks form anywhere (about half over land here).
    const fogs = a.born.filter((c) => c.kind === 1);
    const fogLand = fogs.filter((c) => a.g.map.isLand(a.g.map.idx(Math.floor(c.x), Math.floor(c.y))));
    expect(fogLand.length / fogs.length).toBeGreaterThan(0.25);
  });
});
