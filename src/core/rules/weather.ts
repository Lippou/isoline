// Weather (original feature): drifting storm cells and fog banks, spawned by the
// game's PRNG. Storms slow ships and aircraft; fog banks halve sight across them.
// Kept free of unit imports so ships, aircraft and the views can all use it.
import type { Game } from '../game/state';
import { sec } from '../game/constants';

export interface WeatherCell {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  until: number;
  kind: 0 | 1; // 0 storm, 1 fog bank
  /** Tick it formed (identifies the cell; the map fades it in). */
  born: number;
}

/** Storms: ships (transports, warships, merchants) sail at ×0.6 inside, aircraft fly at ×0.75. */
export const STORM_SHIP_SPEED = 0.6;
export const STORM_AIR_SPEED = 0.75;
/**
 * Fog banks: sight across them is halved. Radar towers and units inside see half as far, and
 * a warship spots its prey at half range when either of them is in the bank.
 */
export const FOG_SIGHT = 0.5;
/** Weather cells: a new one every 40–80 s, lasting 150–240 s, at most 6 at once (≈ 3 on average). */
export const WEATHER_EVERY: readonly [number, number] = [sec(40), sec(80)];
export const WEATHER_LASTS: readonly [number, number] = [sec(150), sec(240)];
export const WEATHER_MAX_CELLS = 6;
/** Share of storms among new cells; a storm forms over open water when it can. */
export const STORM_SHARE = 0.6;

/** The weather cell covering (x, y), storms first (null: clear sky or weather off). */
export function weatherAt(game: Game, x: number, y: number): WeatherCell | null {
  if (!game.config.features.weather) return null;
  let fog: WeatherCell | null = null;
  for (const c of game.features.weather) {
    if ((c.x - x) ** 2 + (c.y - y) ** 2 >= c.r * c.r) continue;
    if (c.kind === 0) return c;
    fog ??= c;
  }
  return fog;
}

function inWeather(game: Game, kind: 0 | 1, x: number, y: number): boolean {
  if (!game.config.features.weather) return false;
  for (const c of game.features.weather)
    if (c.kind === kind && (c.x - x) ** 2 + (c.y - y) ** 2 < c.r * c.r) return true;
  return false;
}

export function inStorm(game: Game, x: number, y: number): boolean {
  return inWeather(game, 0, x, y);
}

export function inFogBank(game: Game, x: number, y: number): boolean {
  return inWeather(game, 1, x, y);
}

/** Speed factor of a ship at (x, y). */
export function shipSpeedAt(game: Game, x: number, y: number): number {
  return inStorm(game, x, y) ? STORM_SHIP_SPEED : 1;
}

/** Speed factor of an aircraft at (x, y). */
export function airSpeedAt(game: Game, x: number, y: number): number {
  return inStorm(game, x, y) ? STORM_AIR_SPEED : 1;
}

/** Vision of a radar, ship or plane at (x, y): `base` tiles, halved inside a fog bank. */
export function sightAt(game: Game, x: number, y: number, base: number): number {
  return inFogBank(game, x, y) ? base * FOG_SIGHT : base;
}

/** Detection reach between an observer and a target: halved when either is in a fog bank. */
export function sightBetween(
  game: Game,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  base: number,
): number {
  return inFogBank(game, ax, ay) || inFogBank(game, bx, by) ? base * FOG_SIGHT : base;
}

/** Drift the cells, retire the old ones and, now and then, form a new one. */
export function updateWeather(game: Game): void {
  const f = game.features;
  const { width, height } = game.map;
  for (const c of f.weather) {
    c.x += c.vx;
    c.y += c.vy;
  }
  if (f.weather.some((c) => c.until <= game.tick)) f.weather = f.weather.filter((c) => c.until > game.tick);
  if (game.tick < f.nextWeatherTick) return;
  const rng = game.rng;
  f.nextWeatherTick = game.tick + rng.int(WEATHER_EVERY[0], WEATHER_EVERY[1]);
  if (f.weather.length >= WEATHER_MAX_CELLS) return;
  const kind = rng.chance(STORM_SHARE) ? 0 : 1;
  const scale = Math.sqrt(width * height) / 1400;
  // Storms gather over open water: up to 6 draws to find a sea centre (else the last one stands).
  let x = 0;
  let y = 0;
  for (let k = 0; k < 6; k++) {
    x = rng.range(0.1, 0.9) * width;
    y = rng.range(0.1, 0.9) * height;
    if (kind === 1 || game.map.isWater(Math.floor(y) * width + Math.floor(x))) break;
  }
  const angle = rng.next() * Math.PI * 2;
  // A slow drift (≈ 1.2 tiles/s at scale 1): a storm crosses a sea in a few minutes.
  f.weather.push({
    x,
    y,
    r: rng.range(40, 95) * scale,
    vx: Math.cos(angle) * 0.12 * scale,
    vy: Math.sin(angle) * 0.12 * scale,
    until: game.tick + rng.int(WEATHER_LASTS[0], WEATHER_LASTS[1]),
    kind,
    born: game.tick,
  });
}
