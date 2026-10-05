// Undo / redo of the map editor, as diffs: a painting step keeps only the tiles it changed
// (runs of tile indices with their terrain and altitude before and after), a marker step
// the marker lists before and after. Bounded in steps and in bytes, so a 3200 × 1612 map
// can be painted for hours without the history eating the memory.
import type { DepositSpec, NationSpawn } from '../../core/map/gamemap';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The markers of a map (what a marker step restores). */
export interface Markers {
  nations: NationSpawn[];
  spawnPoints: [number, number][];
  deposits: DepositSpec[];
}

export interface TileStep {
  kind: 'tiles';
  /** Runs of changed tiles: [start, length, start, length, …] in increasing order. */
  runs: Int32Array;
  beforeT: Uint8Array;
  beforeE: Uint8Array;
  afterT: Uint8Array;
  afterE: Uint8Array;
  box: Box;
}

export interface MarkerStep {
  kind: 'markers';
  before: Markers;
  after: Markers;
}

export type Step = (TileStep | MarkerStep) & { id: number; label: string };

export function stepBytes(s: Step): number {
  if (s.kind === 'tiles') return s.runs.byteLength + s.beforeT.length * 4 + 64;
  return JSON.stringify(s.before).length + JSON.stringify(s.after).length + 64;
}

export function cloneMarkers(m: Markers): Markers {
  return {
    nations: m.nations.map((n) => ({ ...n, name: { ...n.name } })),
    spawnPoints: m.spawnPoints.map(([x, y]) => [x, y] as [number, number]),
    deposits: m.deposits.map((d) => ({ ...d })),
  };
}

export function sameMarkers(a: Markers, b: Markers): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

let nextId = 1;

export class History {
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private bytes = 0;

  constructor(
    readonly maxSteps = 200,
    readonly maxBytes = 96 * 1024 * 1024,
  ) {}

  /** Records a new step (the redo branch is dropped), then trims the oldest past the bounds. */
  push(step: Omit<TileStep, 'id' | 'label'> | Omit<MarkerStep, 'id' | 'label'>, label: string): Step {
    const s = { ...step, id: nextId++, label } as Step;
    for (const r of this.redoStack) this.bytes -= stepBytes(r);
    this.redoStack = [];
    this.undoStack.push(s);
    this.bytes += stepBytes(s);
    // Keep at least the newest step, whatever its size.
    while (
      this.undoStack.length > 1 &&
      (this.undoStack.length > this.maxSteps || this.bytes > this.maxBytes)
    ) {
      this.bytes -= stepBytes(this.undoStack.shift()!);
    }
    return s;
  }

  /** The step to undo (moved to the redo stack), or null. */
  undo(): Step | null {
    const s = this.undoStack.pop();
    if (!s) return null;
    this.redoStack.push(s);
    return s;
  }

  redo(): Step | null {
    const s = this.redoStack.pop();
    if (!s) return null;
    this.undoStack.push(s);
    return s;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get size(): number {
    return this.undoStack.length;
  }
  get byteSize(): number {
    return this.bytes;
  }
  /** Id of the newest applied step (0 = none): what "saved" compares against. */
  get head(): number {
    return this.undoStack[this.undoStack.length - 1]?.id ?? 0;
  }
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
  }
}
