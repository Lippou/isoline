// Mouse / trackpad / keyboard → camera moves and game commands.
import type { GameRenderer } from '../../render/renderer';
import type { Session } from '../../engine/session';
import { hud } from '../stores/game.svelte';
import { confirmModal } from '../stores/app.svelte';
import { i18n, t } from '../i18n/i18n.svelte';
import { settings } from '../stores/settings.svelte';
import { B, N } from '../../core/game/constants';
import { U } from '../../core/units/unit';
import { IS_LAND, T } from '../../core/map/terrain';
import { UNIT_STRIDE } from '../../engine/protocol';
import { capitalPx } from '../../render/badgeSize';
import { isTeammate } from './team';
import { note } from '../stores/note.svelte';
import { short } from '../i18n/i18n.svelte';
import { LINE_MAX_POINTS } from '../../core/game/constants';
import { lineMaxTiles, sideOf, traceTiles } from '../../core/rules/lines';
import { ownLineAt } from './lines';

/**
 * A front line being drawn (core/rules/lines.ts): its points (tile centres, flat x, y…),
 * the pointer, and the stage — tracing (a drag from one point to another, or click after
 * click, a double click or Enter to end), then picking the side it faces.
 */
export interface LineDraft {
  kind: number;
  pts: number[];
  cursor: [number, number];
  stage: 'trace' | 'side';
  side: 1 | -1;
  /** Our tiles the line can hold with the troops it would take (core/rules/lines.ts lineMaxTiles). */
  maxTiles: number;
}

/**
 * An offensive line being laid (1.22): on our border with the country under the pointer (a
 * click), or along the stretch swept with the right button held.
 */
export interface BorderDraft {
  /** That country's tiles swept so far (the right button held). */
  tiles: Set<number>;
  /** The brush under the pointer while sweeping: x, y, radius (tiles). */
  brush: [number, number, number] | null;
  /** Our tiles the line would stand on, and those past what its troops allow. */
  preview: number[];
  over: number[];
}

/** An offensive line's arrow being aimed (a click on the line): from the line to the pointer. */
export interface AimDraft {
  line: number;
  to: [number, number] | null;
}

export interface InputHooks {
  onAction: (tile: number, ev: PointerEvent) => void;
  onRadial: (tile: number, sx: number, sy: number) => void;
  onEmoji: (tile: number, sx: number, sy: number) => void;
  onKey: (action: string, ev: KeyboardEvent) => void;
}

export class InputController {
  private down: { x: number; y: number; button: number; shift: boolean; moved: boolean; t: number } | null =
    null;
  private last = { x: 0, y: 0 };
  private velocity = { x: 0, y: 0 };
  private keysHeld = new Set<string>();
  private disposers: (() => void)[] = [];
  private lastHoverTile = -1;
  /** The pointer on the map (screen px), null when it is off the map or over the interface. */
  private pointer: { x: number; y: number } | null = null;
  /** The last click of a line being drawn (a second one there, soon after: the double click). */
  private lineClick = { t: 0, x: -99, y: -99 };

  constructor(
    private readonly el: HTMLElement,
    private readonly r: GameRenderer,
    private readonly session: Session,
    private readonly hooks: InputHooks,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(
      t: EventTarget,
      type: K | string,
      fn: (e: never) => void,
      opts?: AddEventListenerOptions,
    ) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(el, 'pointerdown', (e: PointerEvent) => this.pointerDown(e));
    on(window, 'pointermove', (e: PointerEvent) => this.pointerMove(e));
    on(el, 'pointerleave', () => (this.pointer = null));
    on(window, 'pointerup', (e: PointerEvent) => this.pointerUp(e));
    on(el, 'wheel', (e: WheelEvent) => this.wheel(e), { passive: false });
    on(el, 'contextmenu', (e: MouseEvent) => e.preventDefault());
    on(window, 'keydown', (e: KeyboardEvent) => this.keyDown(e));
    on(window, 'keyup', (e: KeyboardEvent) => this.keysHeld.delete(e.code));
    on(window, 'blur', () => this.keysHeld.clear());
    // Safari-style gesture events (pinch) are not fired in Chromium; pinch arrives as ctrl+wheel.
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }

  /** Called every frame: keyboard panning. */
  update(dt: number): void {
    const k = settings.keys;
    const speed = 900 * dt;
    let dx = 0;
    let dy = 0;
    if (this.keysHeld.has(k.panLeft!) || this.keysHeld.has('ArrowLeft')) dx += speed;
    if (this.keysHeld.has(k.panRight!) || this.keysHeld.has('ArrowRight')) dx -= speed;
    if (this.keysHeld.has(k.panUp!) || this.keysHeld.has('ArrowUp')) dy += speed;
    if (this.keysHeld.has(k.panDown!) || this.keysHeld.has('ArrowDown')) dy -= speed;
    if (dx || dy) this.r.camera.panScreen(dx, dy);
    this.updateUnitHover();
    // The line tool put down (Escape, another tool, right click): the drawing goes with it.
    if (this.r.overlay.lineDraft && hud.tool.k !== 'line') this.clearLine();
    // The offensive line's tool or its arrow put down: their drawing goes with them.
    const tl = hud.tool;
    if (this.r.overlay.border && !(tl.k === 'line' && tl.kind === 1)) {
      this.r.overlay.border = null;
      this.borderOf = null;
      if (tl.k !== 'line') hud.lineTip = null;
    }
    if (this.r.overlay.aim && (tl.k !== 'assault' || tl.line !== this.r.overlay.aim.line)) {
      this.r.overlay.aim = null;
      if (tl.k !== 'line') hud.lineTip = null;
    }
  }

  // ------------------------------------------------------------ front lines
  private get draft(): LineDraft | null {
    const tl = hud.tool;
    if (tl.k !== 'line' || tl.kind !== 0) return null;
    let d = this.r.overlay.lineDraft;
    if (!d || d.kind !== tl.kind)
      d = this.r.overlay.lineDraft = {
        kind: tl.kind,
        pts: [],
        cursor: [0, 0],
        stage: 'trace',
        side: 1,
        maxTiles: 0,
      };
    return d;
  }

  private clearLine(): void {
    this.r.overlay.lineDraft = null;
    hud.lineTip = null;
  }

  /** The tile centre under the pointer (screen px), in tiles. */
  private snap(sx: number, sy: number): [number, number] {
    const [wx, wy] = this.r.camera.screenToWorld(sx, sy);
    const s = this.session.state;
    const x = Math.min(s.width - 1, Math.max(0, Math.floor(wx)));
    const y = Math.min(s.height - 1, Math.max(0, Math.floor(wy)));
    return [x + 0.5, y + 0.5];
  }

  /** Pointer moved with the line tool in hand: the preview follows, the side under it is picked. */
  private lineMove(d: LineDraft, sx: number, sy: number): void {
    d.cursor = this.snap(sx, sy);
    if (d.stage === 'side' && d.pts.length >= 4) d.side = sideOf(d.pts, d.cursor[0], d.cursor[1]);
    this.lineTip(d, sx, sy);
  }

  /** The note beside the pointer: what the next click does, the troops it will take. */
  private lineTip(d: LineDraft, sx: number, sy: number): void {
    const L = hud.local;
    const s = this.session.state;
    const army = L?.troops ?? 0;
    const take = army * hud.attackRatio;
    const tiles = s.players.get(this.session.viewer)?.tiles ?? 1;
    d.maxTiles = lineMaxTiles(take, army + (L?.lineTroops ?? 0), tiles);
    // Our tiles along the drawing so far: past the length its troops allow, the tip says so.
    const pts = d.stage === 'trace' && d.pts.length ? [...d.pts, d.cursor[0], d.cursor[1]] : d.pts;
    const w = s.width;
    const own =
      pts.length >= 4
        ? traceTiles(w, s.height, pts).filter((t) => s.owner[t] === this.session.viewer).length
        : 0;
    const troops = short(Math.floor(take));
    const key =
      own > d.maxTiles
        ? 'line.tip.tooLong'
        : d.stage === 'side'
          ? 'line.tip.side'
          : d.pts.length === 0
            ? 'line.tip.start'
            : this.closesAt(d, sx, sy)
              ? 'line.tip.close'
              : d.pts.length >= 6
                ? 'line.tip.nextClose'
                : 'line.tip.next';
    const text = t(key, { troops, pct: Math.round(hud.attackRatio * 100), max: d.maxTiles, n: own });
    hud.lineTip = { text, sx, sy, ok: take >= 1 && own <= d.maxTiles };
  }

  // ---------------------------------------------------------- line hover & assault
  /** One of my lines under the pointer (no tool in hand), lit on the map: a click opens it. */
  private updateLineHover(tile: number): void {
    const reach = Math.max(1.5, 14 / this.r.camera.zoom);
    const l = hud.tool.k === 'none' ? ownLineAt(this.session.state, this.session.viewer, tile, reach) : null;
    const id = l ? l.id : -1;
    if (this.r.overlay.lineHover !== id) {
      this.r.overlay.lineHover = id;
      this.el.style.cursor = id >= 0 ? 'pointer' : '';
    }
  }

  /** The army's share the line tool takes, and the most tiles it can hold (lineMaxTiles). */
  private lineBudget(): { take: number; max: number } {
    const L = hud.local;
    const army = L?.troops ?? 0;
    const take = army * hud.attackRatio;
    const tiles = this.session.state.players.get(this.session.viewer)?.tiles ?? 1;
    return { take, max: lineMaxTiles(take, army + (L?.lineTroops ?? 0), tiles) };
  }

  // ------------------------------------------------- offensive line: the border
  /** An offensive line being laid (hud.tool 'line', kind 1). */
  private get border(): BorderDraft | null {
    const tl = hud.tool;
    if (tl.k !== 'line' || tl.kind !== 1) return null;
    return (this.r.overlay.border ??= { tiles: new Set(), brush: null, preview: [], over: [] });
  }

  /** Our tiles touching `owner`'s land (computed again each second, or for another country). */
  private borderOf: { owner: number; tick: number; tiles: number[] } | null = null;
  private borderWith(owner: number): number[] {
    const s = this.session.state;
    const b = this.borderOf;
    if (b && b.owner === owner && s.tick - b.tick < 10) return b.tiles;
    const me = this.session.viewer;
    const w = s.width;
    const tiles: number[] = [];
    for (let t = 0; t < s.owner.length; t++) {
      if (s.owner[t] !== me || !IS_LAND[s.terrain[t]!]) continue;
      const x = t % w;
      if (
        (x > 0 && s.owner[t - 1] === owner) ||
        (x < w - 1 && s.owner[t + 1] === owner) ||
        (t >= w && s.owner[t - w] === owner) ||
        (t + w < s.owner.length && s.owner[t + w] === owner)
      )
        tiles.push(t);
    }
    this.borderOf = { owner, tick: s.tick, tiles };
    return tiles;
  }

  /** The country swept most along the stretch (the right button held), 0 none. */
  private sweptOwner(bd: BorderDraft): number {
    const s = this.session.state;
    const n = new Map<number, number>();
    for (const t of bd.tiles) n.set(s.owner[t]!, (n.get(s.owner[t]!) ?? 0) + 1);
    let [best, most] = [0, 0];
    for (const [o, k] of n) if (k > most) [best, most] = [o, k];
    return best;
  }

  /**
   * What the line would hold, under the pointer at `tile`: the whole border with that country
   * (or, swept, along the stretch), past what its troops allow the part nearest the pointer.
   */
  private borderPreview(bd: BorderDraft, tile: number, sx: number, sy: number): void {
    const s = this.session.state;
    const w = s.width;
    const me = this.session.viewer;
    const swept = bd.tiles.size > 0;
    const owner = swept ? this.sweptOwner(bd) : tile >= 0 ? (s.owner[tile] ?? 0) : 0;
    let tiles: number[] = [];
    if (owner > 0 && owner !== me) {
      tiles = this.borderWith(owner);
      if (swept)
        tiles = tiles.filter((t) => {
          const x = t % w;
          const on = (v: number) => bd.tiles.has(v) && s.owner[v] === owner;
          return (x > 0 && on(t - 1)) || (x < w - 1 && on(t + 1)) || on(t - w) || on(t + w);
        });
    }
    const { take, max } = this.lineBudget();
    const at = swept ? [...bd.tiles][0]! : tile;
    if (tiles.length > max) {
      const [ax, ay] = [at % w, Math.floor(at / w)];
      const d = (t: number) => ((t % w) - ax) ** 2 + (Math.floor(t / w) - ay) ** 2;
      const sorted = tiles.slice().sort((a, b) => d(a) - d(b) || a - b);
      bd.preview = sorted.slice(0, max);
      bd.over = sorted.slice(max);
    } else [bd.preview, bd.over] = [tiles, []];
    const pv = owner > 0 && owner !== me ? s.players.get(owner) : undefined;
    const name = pv ? pv.name[i18n.lang] || pv.name.en : '';
    const vars = {
      troops: short(Math.floor(take)),
      pct: Math.round(hud.attackRatio * 100),
      n: tiles.length,
      max,
      name,
    };
    const key = !name
      ? 'line.tip.borderStart'
      : bd.over.length
        ? 'line.tip.borderOver'
        : swept
          ? 'line.tip.borderSector'
          : 'line.tip.border';
    hud.lineTip = { text: t(key, vars), sx, sy, ok: !!name && take >= 1 && bd.preview.length >= 3 };
  }

  private brushAt(sx: number, sy: number): [number, number, number] {
    const [wx, wy] = this.r.camera.screenToWorld(sx, sy);
    return [wx, wy, Math.max(1.5, 16 / this.r.camera.zoom)];
  }

  /** Sweeps the border under the brush: tiles of another country touching our land. */
  private sweep(bd: BorderDraft, sx: number, sy: number): void {
    const [wx, wy, r] = (bd.brush = this.brushAt(sx, sy));
    const s = this.session.state;
    const w = s.width;
    const me = this.session.viewer;
    for (let y = Math.floor(wy - r); y <= Math.ceil(wy + r); y++)
      for (let x = Math.floor(wx - r); x <= Math.ceil(wx + r); x++) {
        if (x < 0 || y < 0 || x >= w || y >= s.height) continue;
        if ((x + 0.5 - wx) ** 2 + (y + 0.5 - wy) ** 2 > r * r) continue;
        const t = y * w + x;
        const o = s.owner[t]!;
        if (o === me || o <= 0 || !IS_LAND[s.terrain[t]!]) continue;
        const touches =
          (x > 0 && s.owner[t - 1] === me) ||
          (x < w - 1 && s.owner[t + 1] === me) ||
          (y > 0 && s.owner[t - w] === me) ||
          (y < s.height - 1 && s.owner[t + w] === me);
        if (touches) bd.tiles.add(t);
      }
  }

  /**
   * The offensive line laid: a left click on a country, on all our border with it; the right
   * button released after a sweep, along that stretch; a plain right click puts the tool down.
   */
  private borderRelease(bd: BorderDraft, button: number, sx: number, sy: number, moved: boolean): void {
    const done = () => {
      hud.tool = { k: 'none' };
      this.r.overlay.border = null;
      this.borderOf = null;
      hud.lineTip = null;
    };
    const ratio = hud.attackRatio;
    if (button === 2) {
      const target = this.sweptOwner(bd);
      if (moved && target > 0 && target !== this.session.viewer) {
        this.session.cmd({ t: 'lineBorder', target, at: [...bd.tiles][0]!, tiles: [...bd.tiles], ratio });
        done();
      } else if (!moved) done();
      else {
        // Swept nothing of a country: start again.
        bd.tiles.clear();
        bd.brush = null;
      }
      return;
    }
    const tile = this.r.tileAtScreen(sx, sy);
    const owner = tile >= 0 ? (this.session.state.owner[tile] ?? 0) : 0;
    if (owner <= 0 || owner === this.session.viewer) {
      note(t('line.tip.borderStart'), 'info');
      return;
    }
    this.session.cmd({ t: 'lineBorder', target: owner, at: tile, ratio });
    done();
  }

  // ------------------------------------------------- offensive line: the arrow
  /** An offensive line's arrow being aimed (hud.tool 'assault'). */
  private get aim(): AimDraft | null {
    const tl = hud.tool;
    if (tl.k !== 'assault') return null;
    let a = this.r.overlay.aim;
    if (!a || a.line !== tl.line) a = this.r.overlay.aim = { line: tl.line, to: null };
    return a;
  }

  private aimTip(sx: number, sy: number): void {
    hud.lineTip = { text: t('front.aimTip'), sx, sy, ok: true };
  }

  /**
   * The arrow given: a left click points the assault there (ready, it goes; else when ready);
   * a right click takes the arrow back (and the order it had, if any).
   */
  private aimRelease(a: AimDraft, button: number, sx: number, sy: number): void {
    const line = this.session.state.lines.find((l) => l.id === a.line);
    hud.tool = { k: 'none' };
    this.r.overlay.aim = null;
    hud.lineTip = null;
    if (!line) return;
    if (button === 2) {
      if (line.aim >= 0 && line.attack < 0) this.session.cmd({ t: 'lineLaunch', id: a.line, aim: -1 });
      return;
    }
    const tile = this.r.tileAtScreen(sx, sy);
    if (tile < 0) return;
    if (this.session.state.owner[tile] === this.session.viewer) {
      // On our own land: no direction; the arrow stays in hand.
      hud.tool = { k: 'assault', line: a.line };
      note(t('front.aimOwn'), 'info');
      return;
    }
    this.session.cmd({ t: 'lineLaunch', id: a.line, aim: tile });
  }

  /** A press, then a release (a drag or a click) of the left button with the line tool. */
  private lineRelease(d: LineDraft, sx: number, sy: number, moved: boolean): void {
    const [x, y] = this.snap(sx, sy);
    if (d.stage === 'side') {
      this.commitLine(d);
      return;
    }
    const now = performance.now();
    const dbl = now - this.lineClick.t < 380 && Math.hypot(sx - this.lineClick.x, sy - this.lineClick.y) < 8;
    this.lineClick = { t: now, x: sx, y: sy };
    const [lx, ly] = [d.pts.at(-2), d.pts.at(-1)];
    const fresh = lx !== x || ly !== y;
    // A click back on the first point (three points down at least) closes the position.
    if (!moved && this.closesAt(d, sx, sy)) {
      d.pts.push(d.pts[0]!, d.pts[1]!);
      this.endTrace(d);
      this.lineTip(d, sx, sy);
      return;
    }
    if (moved) {
      // A drag from the first point: a straight line, ended on release.
      if (fresh) d.pts.push(x, y);
      this.endTrace(d);
    } else if (dbl && d.pts.length >= 4) this.endTrace(d);
    else if (fresh && d.pts.length < 2 * LINE_MAX_POINTS) d.pts.push(x, y);
    this.lineTip(d, sx, sy);
  }

  /** Whether the pointer (screen px) is on the drawing's first point, and it can close there. */
  private closesAt(d: LineDraft, sx: number, sy: number): boolean {
    if (d.stage !== 'trace' || d.pts.length < 6) return false;
    const [fx, fy] = this.r.camera.worldToScreen(d.pts[0]!, d.pts[1]!);
    return Math.hypot(fx - sx, fy - sy) <= 12;
  }

  /** Down with the left button: a drag starts the line from here. */
  private linePress(d: LineDraft, sx: number, sy: number): void {
    if (d.stage === 'trace' && d.pts.length === 0) d.pts.push(...this.snap(sx, sy));
  }

  /** The tracing ends (a drag released, a double click, Enter): the side is picked next. */
  private endTrace(d: LineDraft): void {
    if (d.pts.length < 4) return;
    d.stage = 'side';
    d.side = sideOf(d.pts, d.cursor[0], d.cursor[1]);
  }

  private commitLine(d: LineDraft): void {
    this.session.cmd({ t: 'line', kind: d.kind, pts: d.pts.slice(), side: d.side, ratio: hud.attackRatio });
    hud.tool = { k: 'none' };
    this.clearLine();
  }

  /**
   * The ship, plane or train under the pointer, every frame: units move under a still
   * pointer. Not while dragging the map, with the radial menu open or in photo mode.
   */
  private updateUnitHover(): void {
    const p = this.pointer;
    const id = p && !this.down?.moved && !hud.radial && !hud.photo ? this.r.unitAtScreen(p.x, p.y) : -1;
    const cur = hud.hoverUnit;
    if (id < 0) {
      if (cur) hud.hoverUnit = null;
      return;
    }
    if (!cur || cur.id !== id || cur.sx !== p!.x || cur.sy !== p!.y)
      hud.hoverUnit = { id, sx: p!.x, sy: p!.y };
  }

  private local(e: { clientX: number; clientY: number }): [number, number] {
    const rect = this.el.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  private pointerDown(e: PointerEvent): void {
    const [x, y] = this.local(e);
    this.down = { x, y, button: e.button, shift: e.shiftKey, moved: false, t: performance.now() };
    const d = e.button === 0 ? this.draft : null;
    if (d) this.linePress(d, x, y);
    // Laying an offensive line: the right button held sweeps the stretch of border.
    const bd = e.button === 2 ? this.border : null;
    if (bd) {
      bd.tiles.clear();
      this.sweep(bd, x, y);
    }
    this.last = { x, y };
    this.velocity = { x: 0, y: 0 };
    this.r.camera.vx = this.r.camera.vy = 0;
    hud.radial = null;
    if (e.button === 1) e.preventDefault();
  }

  private pointerMove(e: PointerEvent): void {
    const [x, y] = this.local(e);
    // Over the map itself (not a panel, a button or a card above it).
    this.pointer = e.target === this.el || this.el.contains(e.target as Node) ? { x, y } : null;
    // Hover info from the client mirror (no worker round-trip).
    const tile = this.r.tileAtScreen(x, y);
    if (tile !== this.lastHoverTile) {
      this.lastHoverTile = tile;
      this.r.overlay.hoverTile = tile;
      this.updateHover(tile, x, y);
      this.updateLineHover(tile);
    }
    const bd = this.pointer ? this.border : null;
    if (bd) {
      if (this.down?.button === 2) {
        if (Math.hypot(x - this.down.x, y - this.down.y) > 4) this.down.moved = true;
        this.sweep(bd, x, y);
      } else bd.brush = null;
      this.borderPreview(bd, tile, x, y);
    }
    const am = this.pointer ? this.aim : null;
    if (am) {
      am.to = this.r.camera.screenToWorld(x, y);
      this.aimTip(x, y);
    }
    const d = this.pointer ? this.draft : null;
    if (d) this.lineMove(d, x, y);
    if (!this.down) return;
    if (d && this.down.button === 0) {
      // Drawing, not panning: the drag traces the line.
      if (Math.hypot(x - this.down.x, y - this.down.y) > 6) this.down.moved = true;
      return;
    }
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    this.last = { x, y };
    if (!this.down.moved && Math.hypot(x - this.down.x, y - this.down.y) > 6) this.down.moved = true;
    if (!this.down.moved) return;
    if (this.down.button === 0 && this.down.shift) {
      const [wx0, wy0] = this.r.camera.screenToWorld(this.down.x, this.down.y);
      const [wx1, wy1] = this.r.camera.screenToWorld(x, y);
      this.r.overlay.dragRect = [wx0, wy0, wx1, wy1];
      return;
    }
    if (this.down.button === 0 || this.down.button === 1) {
      this.r.camera.panScreen(dx, dy);
      this.velocity = { x: dx * 60, y: dy * 60 };
    }
  }

  private pointerUp(e: PointerEvent): void {
    const d = this.down;
    this.down = null;
    if (!d) return;
    const [x, y] = this.local(e);
    if (this.r.overlay.dragRect) {
      const [x0, y0, x1, y1] = this.r.overlay.dragRect;
      this.r.overlay.dragRect = null;
      const ids = this.r.unitsInRect(x0, y0, x1, y1, this.session.viewer, U.Warship);
      this.setSelection(ids);
      return;
    }
    const line = d.button === 0 ? this.draft : null;
    if (line) {
      this.lineRelease(line, x, y, d.moved);
      return;
    }
    const bd = this.border;
    if (bd && (d.button === 2 || (d.button === 0 && !d.moved))) {
      this.borderRelease(bd, d.button, x, y, d.moved);
      return;
    }
    const am = this.aim;
    if (am && !d.moved && (d.button === 0 || d.button === 2)) {
      this.aimRelease(am, d.button, x, y);
      return;
    }
    if (d.moved) {
      if (d.button === 0 || d.button === 1) this.r.camera.fling(this.velocity.x, this.velocity.y);
      return;
    }
    const tile = this.r.tileAtScreen(x, y);
    if (tile < 0) return;
    if (d.button === 2) {
      // Drawing a line: a right click takes the last point back (the side picked: back to
      // tracing); with nothing left to take back, the drawing is dropped.
      const line = this.draft;
      if (line && (line.stage === 'side' || line.pts.length > 2)) {
        if (line.stage === 'side') line.stage = 'trace';
        else line.pts.length -= 2;
        this.lineTip(line, x, y);
        return;
      }
      // Right click first drops whatever is selected (building, missile, ships…).
      if (hud.tool.k !== 'none' || hud.selection.length) {
        this.hooks.onKey('escape', new KeyboardEvent('keydown', { code: 'Escape' }));
        return;
      }
      this.hooks.onRadial(tile, x, y);
      return;
    }
    if (d.button === 0 && e.altKey) {
      this.hooks.onEmoji(tile, x, y);
      return;
    }
    if (d.button === 0) this.hooks.onAction(tile, e);
  }

  setSelection(ids: number[]): void {
    hud.selection = ids;
    this.r.overlay.selection = new Set(ids);
    if (ids.length) hud.tool = { k: 'shipMove' };
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const [x, y] = this.local(e);
    if (e.shiftKey && !e.ctrlKey) {
      // Attack ratio.
      const delta = (e.deltaY || e.deltaX) > 0 ? -0.05 : 0.05;
      hud.attackRatio = Math.max(0.01, Math.min(1, Math.round((hud.attackRatio + delta) * 100) / 100));
      return;
    }
    if (e.ctrlKey) {
      // Trackpad pinch (Chromium reports it as ctrl+wheel).
      this.r.camera.zoomAt(Math.exp(-e.deltaY * 0.012), x, y);
      return;
    }
    const trackpadLike =
      settings.game.wheel === 'trackpad' &&
      e.deltaMode === 0 &&
      (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) < 40);
    if (trackpadLike) {
      this.r.camera.panScreen(-e.deltaX, -e.deltaY);
      return;
    }
    const lines = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    this.r.camera.zoomAt(Math.exp(-lines * 0.0016), x, y);
  }

  private keyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      // Typing is left alone, but a slider or a switch that kept the focus (in-game
      // settings) used to swallow Escape: the settings could no longer be closed by key.
      const control =
        target.tagName === 'INPUT' &&
        /^(range|checkbox|radio|button|color)$/.test((target as HTMLInputElement).type);
      if (!control || e.code !== 'Escape') return;
    }
    const k = settings.keys;
    this.keysHeld.add(e.code);
    const action = Object.keys(k).find((a) => k[a] === e.code);
    if (e.code === 'Escape') {
      this.hooks.onKey('escape', e);
      return;
    }
    // Drawing a line: Enter ends the tracing (or lays it), Backspace takes the last point back.
    const d = this.draft;
    if (d && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
      e.preventDefault();
      if (d.stage === 'side') this.commitLine(d);
      else this.endTrace(d);
      return;
    }
    if (d && e.code === 'Backspace') {
      e.preventDefault();
      if (d.stage === 'side') d.stage = 'trace';
      else d.pts.length = Math.max(0, d.pts.length - 2);
      return;
    }
    if (!action) return;
    // Space and Tab are the browser's too (a focused button would be pressed, the focus
    // would move): the game takes them. In a modal (the menu, a confirmation), Tab still
    // moves between its buttons.
    if (e.code === 'Tab' && document.querySelector('[aria-modal="true"]')) return;
    if (e.code === 'Space' || e.code === 'Tab' || action.startsWith('pan')) e.preventDefault();
    if (action === 'zoomIn') this.r.camera.zoomAt(1.4, this.r.camera.viewW / 2, this.r.camera.viewH / 2);
    else if (action === 'zoomOut')
      this.r.camera.zoomAt(1 / 1.4, this.r.camera.viewW / 2, this.r.camera.viewH / 2);
    else if (action === 'ratioDown')
      hud.attackRatio = Math.max(0.01, Math.round((hud.attackRatio - 0.05) * 100) / 100);
    else if (action === 'ratioUp')
      hud.attackRatio = Math.min(1, Math.round((hud.attackRatio + 0.05) * 100) / 100);
    else if (action === 'selectWarships') {
      const ids: number[] = [];
      const s = this.session.state;
      for (let i = 0; i < s.unitCount; i++) {
        const o = i * UNIT_STRIDE;
        if (s.units[o + 1] === U.Warship && s.units[o + 2] === this.session.viewer) ids.push(s.units[o]!);
      }
      this.setSelection(ids);
    } else if (!e.repeat || action === 'nukeA') this.hooks.onKey(action, e);
  }

  private updateHover(tile: number, sx: number, sy: number): void {
    if (tile < 0) {
      hud.hover = null;
      return;
    }
    const s = this.session.state;
    const w = s.width;
    const x = tile % w;
    const y = (tile / w) | 0;
    // The badge under the pointer, as drawn (badges cover several tiles when zoomed out);
    // else a building on the hovered tile or right next to it (one whose badge gave way).
    let building: {
      type: number;
      level: number;
      owner: number;
      upgrade: number;
      tubes: number;
      occupied: number;
      id: number;
      demolish: number;
    } | null = null;
    const hit = this.r.buildingAtScreen(sx, sy);
    if (hit)
      building = {
        type: hit.type,
        level: hit.level,
        owner: hit.owner,
        upgrade: hit.upgrade,
        tubes: hit.tubesReady,
        occupied: hit.occupied,
        id: hit.id,
        demolish: hit.demolish,
      };
    else
      for (const b of s.buildings) {
        if (Math.abs(b.x - x) <= 1 && Math.abs(b.y - y) <= 1) {
          building = {
            type: b.type,
            level: b.level,
            owner: b.owner,
            upgrade: b.upgrade,
            tubes: b.tubesReady,
            occupied: b.occupied,
            id: b.id,
            demolish: b.demolish,
          };
          break;
        }
      }
    // A capital marker under the pointer (it covers a few tiles when zoomed out).
    let capital = 0;
    const zoom = Math.max(0.05, this.r.camera.zoom);
    const reach = Math.max(1.2, capitalPx(zoom, this.r.settings.uiScale || 1) / 2 / zoom);
    for (const p of s.playerList)
      if (p.alive && p.capital >= 0 && Math.hypot((p.capital % w) - x, ((p.capital / w) | 0) - y) <= reach) {
        capital = p.id;
        break;
      }
    hud.hover = {
      tile,
      owner: s.owner[tile]!,
      terrain: s.terrain[tile]!,
      x,
      y,
      sx,
      sy,
      building,
      fallout: s.fallout[tile]!,
      resource: s.resource[tile]!,
      capital,
    };
  }

  /** Default left-click semantics depending on the active tool. */
  static defaultAction(session: Session, tile: number, ratio: number): void {
    const s = session.state;
    if (s.phase === 'spawn') {
      session.cmd({ t: 'spawn', tile });
      return;
    }
    const tool = hud.tool;
    switch (tool.k) {
      case 'build':
        session.cmd({ t: 'build', kind: tool.kind, tile });
        return;
      case 'nuke': {
        if (hud.launch?.teammate) return;
        const fire = () =>
          session.cmd({ t: 'nuke', kind: tool.kind, tile, count: tool.count, up: hud.nukeArcUp });
        // Our own land: allowed (a scorched front can be strategic), after a confirmation.
        if (s.owner[tile] === session.viewer && tool.kind !== N.Mirv && settings.game.confirmations)
          confirmModal(
            t('confirm.selfNukeTitle'),
            t('confirm.selfNukeBody'),
            fire,
            t('confirm.selfNukeYes'),
            t('common.cancel'),
          );
        else guardBetrayal(session, tile, fire);
        return;
      }
      case 'warship':
        session.cmd({ t: 'warship', tile });
        return;
      case 'air':
        // A bomber over an ally betrays it; fighters and reconnaissance do not. A teammate's
        // land is never bombed (the aircraft panel already says so).
        if (tool.kind === 1 && hud.airAim?.problem === 'teammate') return;
        if (tool.kind === 1) guardBetrayal(session, tile, () => session.cmd({ t: 'air', kind: 1, tile }));
        else session.cmd({ t: 'air', kind: tool.kind, tile });
        return;
      case 'general':
        session.cmd({ t: 'general', tile });
        return;
      case 'ping':
        session.cmd({ t: 'ping', tile, kind: 0 });
        return;
      case 'capital':
        session.cmd({ t: 'moveCapital', tile });
        return;
      case 'shipMove':
        // Warships sail the sea and the navigable rivers (the sim checks the route).
        if (!IS_LAND[s.terrain[tile]!] || s.terrain[tile] === T.River) {
          session.cmd({ t: 'shipMove', ids: [...hud.selection], tile, patrol: true });
          return;
        }
        break;
    }
    if (!IS_LAND[s.terrain[tile]!]) return;
    const owner = s.owner[tile]!;
    if (owner === session.viewer) return;
    // A teammate is an ally for good: a click on its land never attacks it.
    if (isTeammate(s.players, session.viewer, owner)) {
      note(t('hud.teammateClick'), 'info');
      return;
    }
    guardBetrayal(session, tile, () => session.cmd({ t: 'attack', tile, ratio }));
  }
}

/**
 * Runs `fn` at once, or — when it would strike an ally (betrayal: traitor mark,
 * embargo) and confirmations are on — after the same confirmation as the radial menu.
 */
export function guardBetrayal(session: Session, tile: number, fn: () => void): void {
  const owner = session.state.owner[tile] ?? 0;
  const allied = owner > 0 && !!hud.local?.allies.some((a) => a.id === owner);
  if (allied && settings.game.confirmations)
    confirmModal(
      t('confirm.betrayTitle'),
      t('confirm.betrayBody'),
      fn,
      t('confirm.betrayYes'),
      t('common.cancel'),
    );
  else fn();
}

export const BUILD_KEYS: Record<string, number> = {
  buildCity: B.City,
  buildPort: B.Port,
  buildFactory: B.Factory,
  buildSilo: B.Silo,
  buildSam: B.Sam,
  buildRadar: B.Radar,
  buildAirfield: B.Airfield,
  buildLab: B.Lab,
};

/** The front-line tools (core/rules/lines.ts): 0 defensive, 1 offensive. */
export const LINE_KEYS: Record<string, number> = { lineDefense: 0, lineOffense: 1 };

export const NUKE_KEYS: Record<string, number> = { nukeA: N.Atom, nukeH: N.Hydrogen, nukeMirv: N.Mirv };
