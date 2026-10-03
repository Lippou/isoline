// Mouse / trackpad / keyboard → camera moves and game commands.
import type { GameRenderer } from '../../render/renderer';
import type { Session } from '../../engine/session';
import { hud } from '../stores/game.svelte';
import { confirmModal } from '../stores/app.svelte';
import { t } from '../i18n/i18n.svelte';
import { settings } from '../stores/settings.svelte';
import { B, N } from '../../core/game/constants';
import { U } from '../../core/units/unit';
import { IS_LAND, T } from '../../core/map/terrain';
import { UNIT_STRIDE } from '../../engine/protocol';
import { capitalPx } from '../../render/badgeSize';

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
    let building: { type: number; level: number; owner: number; upgrade: number } | null = null;
    const hit = this.r.buildingAtScreen(sx, sy);
    if (hit) building = { type: hit.type, level: hit.level, owner: hit.owner, upgrade: hit.upgrade };
    else
      for (const b of s.buildings) {
        if (Math.abs(b.x - x) <= 1 && Math.abs(b.y - y) <= 1) {
          building = { type: b.type, level: b.level, owner: b.owner, upgrade: b.upgrade };
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
        // A bomber over an ally betrays it; fighters and reconnaissance do not.
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
          session.cmd({ t: 'shipMove', ids: hud.selection, tile, patrol: true });
          return;
        }
        break;
    }
    if (!IS_LAND[s.terrain[tile]!]) return;
    const owner = s.owner[tile]!;
    if (owner === session.viewer) return;
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
  buildDefense: B.DefensePost,
  buildSilo: B.Silo,
  buildSam: B.Sam,
  buildRadar: B.Radar,
  buildAirfield: B.Airfield,
  buildLab: B.Lab,
};

export const NUKE_KEYS: Record<string, number> = { nukeA: N.Atom, nukeH: N.Hydrogen, nukeMirv: N.Mirv };
