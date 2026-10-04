// Static structures and the spatial hash used for range queries.
import type { B } from '../game/constants';

export interface Building {
  id: number;
  type: B;
  owner: number;
  tile: number;
  x: number;
  y: number;
  level: number;
  /** Remaining construction ticks (0 = operational). */
  buildLeft: number;
  buildTotal: number;
  cooldown: number;
  /** Silo tube reload timers (ticks until loaded, 0 = ready). */
  tubes: number[];
  /** Factory: first tick at which it may launch its next train. */
  timer: number;
  /** Port: consecutive failed merchant spawn rolls (OpenFront's pity timer). */
  rejections: number;
  createdTick: number;
  alive: boolean;
  /** Gold actually paid (for the 25 % demolition refund). */
  invested: number;
  /**
   * Upgrade under way: ticks left before `level` goes up by one (0 = none). Until then the
   * building keeps working at its current level.
   */
  upgradeLeft: number;
  upgradeTotal: number;
  /**
   * Occupation after a capture (GAME_DESIGN.md §6.4): ticks left before the building works
   * for its new owner (0 = none). Meanwhile it is out of service, like one under construction.
   */
  occupiedLeft: number;
  occupiedTotal: number;
}

/**
 * Whether a building works: built and not under occupation. Only then do cities raise the
 * troop ceiling, stations pay trains, ports trade, factories run trains, research centres
 * research, silos launch, SAMs fire and airfields fly.
 */
export function inService(b: Building): boolean {
  return b.buildLeft === 0 && b.occupiedLeft === 0;
}

const CELL = 32;

/** Uniform-grid spatial hash over building ids. */
export class BuildingGrid {
  private readonly cw: number;
  private readonly ch: number;
  private readonly cells: number[][];

  constructor(width: number, height: number) {
    this.cw = Math.ceil(width / CELL);
    this.ch = Math.ceil(height / CELL);
    this.cells = Array.from({ length: this.cw * this.ch }, () => []);
  }

  private cellOf(x: number, y: number): number {
    return ((y / CELL) | 0) * this.cw + ((x / CELL) | 0);
  }

  add(b: Building): void {
    this.cells[this.cellOf(b.x, b.y)]!.push(b.id);
  }

  remove(b: Building): void {
    const c = this.cells[this.cellOf(b.x, b.y)]!;
    const k = c.indexOf(b.id);
    if (k >= 0) c.splice(k, 1);
  }

  /** Calls fn(id) for every building whose cell intersects the circle (caller re-checks distance). */
  query(x: number, y: number, r: number, fn: (id: number) => void): void {
    const x0 = Math.max(0, ((x - r) / CELL) | 0);
    const x1 = Math.min(this.cw - 1, ((x + r) / CELL) | 0);
    const y0 = Math.max(0, ((y - r) / CELL) | 0);
    const y1 = Math.min(this.ch - 1, ((y + r) / CELL) | 0);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = this.cells[cy * this.cw + cx]!;
        for (let k = 0; k < c.length; k++) fn(c[k]!);
      }
    }
  }
}
