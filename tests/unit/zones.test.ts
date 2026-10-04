import { describe, expect, it } from 'vitest';
import {
  computeZones,
  layoutClass,
  allocate,
  columnHeight,
  placeInStage,
  readingRect,
  clampInto,
  findOverlaps,
  overlaps,
  PIECES,
  MARGIN,
  type Box,
  type PieceId,
  type PieceState,
  type Rect,
  type ZoneInput,
} from '../../src/ui/stores/zones';
import { autoUiScale } from '../../src/ui/stores/uiScale';

/** The screens the HUD must fit (window pixels, device pixel ratio). */
const SCREENS: [number, number, number][] = [
  [1280, 720, 1],
  [1366, 768, 1],
  [1440, 900, 1],
  [1470, 956, 2],
  [1512, 982, 2],
  [1600, 900, 1],
  [1920, 1080, 1],
  [2560, 1440, 1],
  [3440, 1440, 1],
  [3840, 2160, 1],
  // Windowed, and the smallest window the game allows.
  [1200, 700, 1],
  [1100, 680, 1],
];

/** The CSS pixels of a screen once the automatic interface scale is applied. */
function css(w: number, h: number, dpr: number): { w: number; h: number } {
  const s = autoUiScale(w, h, dpr);
  return { w: Math.round(w / s), h: Math.round(h / s) };
}

/** Typical measured sizes of the pieces (1.9.0, standard layout). */
function input(w: number, h: number, over: Partial<ZoneInput> = {}): ZoneInput {
  return {
    w,
    h,
    railW: 74,
    topH: 72,
    resH: 262,
    barH: 88,
    nudgeH: 44,
    bottomReserve: 0,
    reading: false,
    stripH: 44,
    ...over,
  };
}

const inside = (r: Rect, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
const area = (r: Rect) => r.w * r.h;

describe('layout classes', () => {
  it('chooses wide from 1920 CSS pixels, compact up to 1440, standard between', () => {
    expect(layoutClass(1920)).toBe('wide');
    expect(layoutClass(3072)).toBe('wide');
    expect(layoutClass(1919)).toBe('standard');
    expect(layoutClass(1600)).toBe('standard');
    expect(layoutClass(1441)).toBe('standard');
    expect(layoutClass(1440)).toBe('compact');
    expect(layoutClass(1280)).toBe('compact');
  });

  it('gives each screen of the list its intended class after the automatic scale', () => {
    const cls = (w: number, h: number, dpr: number) => {
      const c = css(w, h, dpr);
      return layoutClass(c.w);
    };
    expect(cls(1280, 720, 1)).toBe('standard'); // 1506 CSS px (scale 0.85)
    expect(cls(1600, 900, 1)).toBe('standard');
    expect(cls(1920, 1080, 1)).toBe('wide');
    expect(cls(2560, 1440, 1)).toBe('wide');
    expect(cls(3440, 1440, 1)).toBe('wide');
    expect(cls(3840, 2160, 1)).toBe('wide');
    expect(cls(1200, 700, 1)).toBe('compact'); // a small window: 1412 CSS px
  });
});

describe('zones', () => {
  it.each(SCREENS)('%i × %i (dpr %i): the zones never overlap and stay on screen', (sw, sh, dpr) => {
    const { w, h } = css(sw, sh, dpr);
    const z = computeZones(input(w, h));
    const rail = { ...z.rail };
    const pieces: [string, Rect][] = [
      ['rail', rail],
      ['left', z.left],
      ['right', z.right],
      ['top', z.top],
      ['bottom', z.bottom],
      ['stage', z.stage],
      // The resources panel under the left column, the build bar in the bottom strip.
      ['res', { x: MARGIN, y: h - MARGIN - 262, w: z.sizes.res, h: 262 }],
      ['bar', { x: z.bar.x, y: h - MARGIN - 88, w: z.bar.w, h: 88 }],
    ];
    for (const [name, r] of pieces) {
      expect(inside(r, w, h), `${name} on screen`).toBe(true);
      expect(r.w, `${name} has width`).toBeGreaterThan(0);
    }
    for (let i = 0; i < pieces.length; i++)
      for (let j = i + 1; j < pieces.length; j++) {
        const [a, ra] = pieces[i]!;
        const [b, rb] = pieces[j]!;
        // The top and bottom strips are the band's; the bar stretches under the left column.
        if ((a === 'bottom' && b === 'bar') || (a === 'top' && b === 'stage')) continue;
        expect(overlaps(ra, rb), `${a} × ${b}`).toBe(false);
      }
    // A stage worth the name: at least a column's window side by side with the map.
    expect(z.stage.w).toBeGreaterThanOrEqual(600);
    expect(z.stage.h).toBeGreaterThanOrEqual(380);
  });

  it('keeps the stage above the mission dock and the research reminder', () => {
    const z = computeZones(input(1600, 900, { bottomReserve: 260 }));
    expect(z.stage.y + z.stage.h).toBeLessThanOrEqual(900 - 260);
    const n = computeZones(input(1600, 900));
    expect(n.stage.y + n.stage.h).toBeLessThanOrEqual(900 - MARGIN - 88 - 44);
  });

  it('opens the reading room: the strip at the top, the window beside the rail, the dock kept', () => {
    const z = computeZones(input(1600, 900, { reading: true }));
    expect(z.reading).toBe(true);
    expect(z.strip).toEqual({ x: MARGIN, y: MARGIN, w: 1600 - 2 * MARGIN, h: 44 });
    expect(z.stage.y).toBeGreaterThan(z.strip.y + z.strip.h);
    expect(z.stage.x).toBeGreaterThan(z.rail.x + z.rail.w);
    expect(z.stage.x + z.stage.w).toBe(1600 - MARGIN);
    expect(z.stage.y + z.stage.h).toBe(900 - MARGIN);
    const normal = computeZones(input(1600, 900));
    expect(area(z.stage)).toBeGreaterThan(area(normal.stage) * 1.8);
    const dock = computeZones(input(1600, 900, { reading: true, bottomReserve: 240 }));
    expect(dock.stage.y + dock.stage.h).toBeLessThanOrEqual(900 - 240);
  });

  it('widens the columns on wide screens and narrows them on compact ones', () => {
    const wide = computeZones(input(2560, 1440));
    const std = computeZones(input(1600, 900));
    const compact = computeZones(input(1400, 800));
    expect(wide.sizes.card).toBeGreaterThan(std.sizes.card);
    expect(std.sizes.card).toBeGreaterThan(compact.sizes.card);
    expect(compact.sizes.railLabels).toBe(false);
  });
});

/** A column's pieces with their heights (measured or guessed). */
function pieces(
  ids: PieceId[],
  heights: Partial<Record<PieceId, Record<string, number>>> = {},
): PieceState[] {
  return ids.map((id) => ({ id, def: PIECES[id], heights: heights[id] ?? {} }));
}

describe('a column short of room', () => {
  const left: PieceId[] = ['nukeAlerts', 'council', 'flash', 'alliances'];
  const H = {
    nukeAlerts: { full: 110 },
    council: { full: 300, compact: 130 },
    flash: { full: 330, compact: 40 },
    alliances: { full: 150, compact: 36 },
  };

  it('prints everything whole when it fits', () => {
    const lv = allocate(pieces(left, H), 1200);
    expect(Object.values(lv).every((l) => l === 'full')).toBe(true);
  });

  it('folds the least important first: compact, then chips; urgent pieces stay whole', () => {
    const ps = pieces(left, H);
    const lv = allocate(ps, 560);
    expect(lv.nukeAlerts).toBe('full');
    expect(lv.council).toBe('full');
    expect(lv.flash).toBe('compact');
    expect(lv.alliances).toBe('compact');
    expect(columnHeight(ps, lv)).toBeLessThanOrEqual(560);
    const tight = allocate(ps, 300);
    expect(tight.nukeAlerts).toBe('full');
    expect(tight.flash).toBe('chip');
    expect(tight.alliances).toBe('chip');
    expect(columnHeight(ps, tight)).toBeLessThanOrEqual(300);
  });

  it('unfolds a piece the player asked for, the others giving way', () => {
    const ps = pieces(left, H);
    ps.find((p) => p.id === 'alliances')!.pinned = true;
    const lv = allocate(ps, 560);
    expect(lv.alliances).toBe('full');
    expect(lv.flash).not.toBe('full');
    expect(columnHeight(ps, lv)).toBeLessThanOrEqual(560);
  });

  it('gives room back to the most important folded piece when another folds further', () => {
    const right: PieceId[] = ['offers', 'leaderboard', 'minimap', 'dispatches'];
    const ps = pieces(right, {
      offers: { full: 330 },
      leaderboard: { full: 300, compact: 190, chip: 36 },
      minimap: { full: 230, chip: 30 },
      dispatches: { full: 220, compact: 120 },
    });
    const lv = allocate(ps, 760);
    expect(lv.offers).toBe('full');
    expect(columnHeight(ps, lv)).toBeLessThanOrEqual(760);
    // The leaderboard folded to its title: the dispatches come back on one line.
    expect(lv.leaderboard).toBe('chip');
    expect(lv.dispatches).toBe('compact');
  });
});

describe('windows in the stage', () => {
  const stage = { x: 404, y: 92, w: 860, h: 600 };

  it('tiles windows side by side, then cascades them, always inside the stage', () => {
    const a = placeInStage(stage, { w: 400, h: 820 }, []);
    expect(a).toEqual({ x: 404, y: 92, w: 400, h: 600 });
    const b = placeInStage(stage, { w: 400, h: 820 }, [a]);
    expect(b.x).toBe(a.x + a.w + 10);
    expect(overlaps(a, b)).toBe(false);
    const c = placeInStage(stage, { w: 400, h: 820 }, [a, b]);
    for (const r of [a, b, c]) expect(clampInto(r, stage)).toEqual(r);
  });

  it('keeps a remembered place inside the stage', () => {
    expect(clampInto({ x: 20, y: 10, w: 500, h: 900 }, stage, 300, 220)).toEqual({
      x: 404,
      y: 92,
      w: 500,
      h: 600,
    });
  });

  it('centres a maximised window in the reading room, no wider than its page', () => {
    const room = { x: 96, y: 66, w: 2880, h: 1170 };
    expect(readingRect(room, 1920)).toEqual({ x: 576, y: 66, w: 1920, h: 1170 });
    expect(readingRect({ x: 96, y: 66, w: 1400, h: 760 }, 1920)).toEqual({ x: 96, y: 66, w: 1400, h: 760 });
  });
});

describe('the overlap check (QA)', () => {
  it('finds overlapping pieces and pieces off screen, not windows stacked or pieces nested', () => {
    const boxes: Box[] = [
      { id: 'offer', x: 1270, y: 300, w: 310, h: 120 },
      { id: 'window:tech', group: 'window', x: 100, y: 60, w: 1440, h: 800 },
      { id: 'window:log', group: 'window', x: 100, y: 60, w: 468, h: 800 },
      { id: 'strip', x: 12, y: 12, w: 1576, h: 44 },
      { id: 'chip', inside: 'strip', x: 300, y: 18, w: 120, h: 30 },
      { id: 'minimap', x: 1300, y: 880, w: 290, h: 40 },
    ];
    const r = findOverlaps(boxes, 1600, 900);
    expect(r.overlaps).toEqual([['offer', 'window:tech']]);
    expect(r.offscreen).toEqual(['minimap']);
  });
});
