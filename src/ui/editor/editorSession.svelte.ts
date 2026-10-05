// The editor's working state, kept at module level: the map being edited, the tool and
// its settings, the view. It outlives the screen, so a play-test (a game launched from
// the editor) comes back to the same map, tool and view, undo history included.
import type { EditorModel, MarkerKind, MarkerRef } from './editorModel';
import type { FillTolerance } from './raster';
import { T } from '../../core/map/terrain';
import { settings } from '../stores/settings.svelte';

export type ToolId =
  'brush' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'picker' | 'relief' | 'markers' | 'hand';

export interface ToolDef {
  id: ToolId;
  /** Shortcut: the letter typed (KeyboardEvent.key), the same key on AZERTY and QWERTY. */
  key: string;
  /** Uses the terrain palette. */
  paints: boolean;
  /** Uses the brush size. */
  sized: boolean;
}

export const TOOLS: readonly ToolDef[] = [
  { id: 'brush', key: 'b', paints: true, sized: true },
  { id: 'eraser', key: 'e', paints: false, sized: true },
  { id: 'line', key: 'l', paints: true, sized: true },
  { id: 'rect', key: 'r', paints: true, sized: false },
  { id: 'ellipse', key: 'o', paints: true, sized: false },
  { id: 'fill', key: 'f', paints: true, sized: false },
  { id: 'picker', key: 'i', paints: true, sized: false },
  { id: 'relief', key: 't', paints: false, sized: true },
  { id: 'markers', key: 'n', paints: false, sized: false },
  { id: 'hand', key: 'h', paints: false, sized: false },
];

/** Other shortcuts (letters as typed, plus the modifiers). */
export const KEYS = {
  grid: 'g',
  motifs: 'p',
  fit: 'v',
} as const;

export type SideTab = 'tool' | 'map' | 'nations' | 'check';

export const ed = $state({
  model: null as EditorModel | null,
  tool: 'brush' as ToolId,
  /** The tool the picker hands back to once it has picked. */
  lastPaintTool: 'brush' as ToolId,
  terrain: T.Plains as number,
  size: 8,
  tolerance: 'same' as FillTolerance,
  relief: 'raise' as 'raise' | 'lower' | 'smooth',
  strength: 8,
  markerKind: 'nation' as MarkerKind,
  depositType: 1,
  grid: true,
  motifs: settings.access.vision !== 'none',
  selected: null as MarkerRef | null,
  tab: 'tool' as SideTab,
  /** Tile under the pointer. */
  hover: null as null | { x: number; y: number },
  /** Bumped when the model changes (UI facts, validation). */
  rev: 0,
  /** Zoom in screen pixels per tile (shown in the view bar). */
  zoom: 1,
  /** Space held: the hand, whatever the tool. */
  spaceHand: false,
});

/** Pan and zoom of the plate (not reactive: the canvas redraws itself). */
export const view = { x: 0, y: 0, z: 1, modelId: '' };

/** Set by the canvas: what the toolbar and the validation panel ask of the view. */
export const viewCtl = {
  fit: () => {},
  zoomBy: (_f: number) => {},
  focus: (_x: number, _y: number) => {},
};

export function setModel(m: EditorModel | null): void {
  ed.model = m;
  ed.selected = null;
  ed.hover = null;
  ed.rev++;
}

/** The model changed (a stroke, an undo…): facts and validation follow. */
export function touched(): void {
  ed.rev++;
}

export function setTool(id: ToolId): void {
  ed.tool = id;
  if (id !== 'picker' && TOOLS.find((d) => d.id === id)?.paints) ed.lastPaintTool = id;
}
