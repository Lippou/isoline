// The map editor's glyphs (Lucide, ISC licence): its tools, and one glyph per terrain so
// the palette never relies on colour alone (a colour-blind player reads the shape).
import {
  BrickWall,
  CircleCheck,
  CloudSnow,
  Diamond,
  Droplet,
  Droplets,
  Eraser,
  FolderOpen,
  Grid3x3,
  Hand,
  LocateFixed,
  Mountain,
  MountainSnow,
  OctagonX,
  PaintBucket,
  Paintbrush,
  Pipette,
  Redo2,
  Scan,
  Snowflake,
  Spline,
  Sprout,
  Square,
  Circle,
  Sun,
  TreePine,
  TriangleAlert,
  Undo2,
  Wand,
  Waves,
  Wheat,
  ZoomIn,
  ZoomOut,
  Keyboard,
  Dices,
  Grip,
  Slash,
  type IconNode,
} from 'lucide';

// Rolling hills: two arcs (Lucide has none).
const Hills: IconNode = [
  ['path', { d: 'M2 19c2.5-7 8.5-7 11 0' }],
  ['path', { d: 'M10.5 19c2.5-5.5 9-5.5 11.5 0' }],
  ['path', { d: 'M2 19h20' }],
];
// The relief tool: a contour line over a rise.
const Relief: IconNode = [
  ['path', { d: 'M3 20 9 9l4 6 3-4 5 9' }],
  ['path', { d: 'M6 4h4M8 2v4' }],
];
// A spawn point: a ring with its centre.
const SpawnRing: IconNode = [
  ['circle', { cx: '12', cy: '12', r: '7' }],
  ['circle', { cx: '12', cy: '12', r: '1.5' }],
];
// A deposit: a tag.
const Tag: IconNode = [
  ['rect', { x: '5', y: '5', width: '14', height: '14', rx: '1' }],
  ['path', { d: 'M9 9h6M9 12h6M9 15h3' }],
];

export const ED_ICONS = {
  brush: Paintbrush,
  eraser: Eraser,
  line: Slash,
  rect: Square,
  ellipse: Circle,
  fill: PaintBucket,
  picker: Pipette,
  relief: Relief,
  markers: Diamond,
  hand: Hand,
  undo: Undo2,
  redo: Redo2,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  fit: Scan,
  grid: Grid3x3,
  motifs: Grip,
  open: FolderOpen,
  locate: LocateFixed,
  fix: Wand,
  error: OctagonX,
  warn: TriangleAlert,
  ok: CircleCheck,
  keys: Keyboard,
  dice: Dices,
  spawn: SpawnRing,
  deposit: Tag,
  // terrains, in T order
  deepOcean: Waves,
  shallow: Droplet,
  lake: Droplets,
  river: Spline,
  plains: Wheat,
  hills: Hills,
  mountain: Mountain,
  desert: Sun,
  forest: TreePine,
  tundra: Sprout,
  impassable: BrickWall,
  glacier: Snowflake,
  peaks: MountainSnow,
  snow: CloudSnow,
} satisfies Record<string, IconNode>;

export type EdIconName = keyof typeof ED_ICONS;

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export function edIconMarkup(name: EdIconName): string {
  return (ED_ICONS[name] as IconNode)
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs as Record<string, string | number>)
        .map(([k, v]) => `${k}="${esc(String(v))}"`)
        .join(' ');
      return `<${tag} ${a}/>`;
    })
    .join('');
}
