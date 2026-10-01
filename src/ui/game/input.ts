// Mouse / trackpad / keyboard → camera moves and game commands.
import type { GameRenderer } from '../../render/renderer';
import type { Session } from '../../engine/session';
import { hud } from '../stores/game.svelte';
import { settings } from '../stores/settings.svelte';
import { B, N } from '../../core/game/constants';
import { U } from '../../core/units/unit';
import { IS_LAND } from '../../core/map/terrain';

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
  }

  private local(e: { clientX: number; clientY: number }): [number, number] {
    const rect = this.el.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  private pointerDown(e: PointerEvent): void {
    const [x, y] = this.local(e);
    this.down = { x, y, button: e.button, shift: e.shiftKey, moved: false, t: performance.now() };
    this.last = { x, y };
    this.velocity = { x: 0, y: 0 };
    this.r.camera.vx = this.r.camera.vy = 0;
    hud.radial = null;
    if (e.button === 1) e.preventDefault();
  }

  private pointerMove(e: PointerEvent): void {
    const [x, y] = this.local(e);
    // Hover info from the client mirror (no worker round-trip).
    const tile = this.r.tileAtScreen(x, y);
    if (tile !== this.lastHoverTile) {
      this.lastHoverTile = tile;
      this.r.overlay.hoverTile = tile;
      this.updateHover(tile, x, y);
    }
    if (!this.down) return;
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
    if (d.moved) {
      if (d.button === 0 || d.button === 1) this.r.camera.fling(this.velocity.x, this.velocity.y);
      return;
    }
    const tile = this.r.tileAtScreen(x, y);
    if (tile < 0) return;
    if (d.button === 2) {
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
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
      return;
    const k = settings.keys;
    this.keysHeld.add(e.code);
    const action = Object.keys(k).find((a) => k[a] === e.code);
    if (e.code === 'Escape') {
      this.hooks.onKey('escape', e);
      return;
    }
    if (!action) return;
    if (action === 'terrainView' || action.startsWith('pan')) e.preventDefault();
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
        const o = i * 15;
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
    let building: { type: number; level: number; owner: number } | null = null;
    for (const b of s.buildings) {
      if (Math.abs(b.x - x) <= 1 && Math.abs(b.y - y) <= 1) {
        building = { type: b.type, level: b.level, owner: b.owner };
        break;
      }
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
      case 'nuke':
        session.cmd({ t: 'nuke', kind: tool.kind, tile, count: tool.count });
        return;
      case 'warship':
        session.cmd({ t: 'warship', tile });
        return;
      case 'air':
        session.cmd({ t: 'air', kind: tool.kind, tile });
        return;
      case 'general':
        session.cmd({ t: 'general', tile });
        return;
      case 'ping':
        session.cmd({ t: 'ping', tile, kind: 0 });
        return;
      case 'shipMove':
        if (!IS_LAND[s.terrain[tile]!]) {
          session.cmd({ t: 'shipMove', ids: hud.selection, tile, patrol: true });
          return;
        }
        break;
    }
    if (!IS_LAND[s.terrain[tile]!]) return;
    const owner = s.owner[tile]!;
    if (owner === session.viewer) return;
    session.cmd({ t: 'attack', tile, ratio });
  }
}

export const BUILD_KEYS: Record<string, number> = {
  buildCity: B.City,
  buildPort: B.Port,
  buildFactory: B.Factory,
  buildDefense: B.DefensePost,
  buildSilo: B.Silo,
  buildSam: B.Sam,
  buildRadar: B.Radar,
  buildAirfield: B.Airfield,
};

export const NUKE_KEYS: Record<string, number> = { nukeA: N.Atom, nukeH: N.Hydrogen, nukeMirv: N.Mirv };
