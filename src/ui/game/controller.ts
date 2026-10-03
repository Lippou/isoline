// Glue between a Session, the renderer, the HUD store, audio and persistence.
import { Session, loadMapSource } from '../../engine/session';
import { GameRenderer } from '../../render/renderer';
import { InputController, BUILD_KEYS, NUKE_KEYS, guardBetrayal } from './input';
import { hud, resetHud, toast, subtitle, reportFall, showPact, openPanel } from '../stores/game.svelte';
import { closeTopWindow } from '../stores/windows.svelte';
import { settings, saveSettings } from '../stores/settings.svelte';
import { WeatherNews } from './weatherNews';
import { t, i18n, clock } from '../i18n/i18n.svelte';
import { mapsBase, bridge, writeJson } from '../bridge';
import { app, setSession, go, confirmModal, type LaunchRequest } from '../stores/app.svelte';
import type { GameEvent } from '../../core/game/events';
import { portRange, B, N, RAIL_CONNECT_RANGE, FIGHTER_RANGE } from '../../core/game/constants';
import { launchInfo, type LaunchInfo } from './nukePreview';
import { audio } from '../../audio/audio';
import { noteLaunch, profile, recordGameEnd, recordMission, score } from '../stores/profile.svelte';
import { takeSnapshotSave } from './saves';
import { CampaignDirector } from '../campaign/director';
import { MISSIONS } from '../campaign/missions';
import { type LanClient, currentLan } from '../../engine/lanClient';
import { UNIT_STRIDE } from '../../engine/protocol';
import { CapitalWatch, clientSpotError } from './capitalWatch';
import { Chronicle, keepEdition, keptEdition, type Edition } from './chronicle';
import type { ReplayFile } from '../../engine/replay';
import type { Snapshot } from '../../core/net/snapshot';
import { takeOverSnapshot } from '../../core/net/takeover';
import { photo } from '../stores/photo.svelte';
import { tick as uiTick } from 'svelte';
import { startTakeover } from '../screens/launch';
import { worthPrinting } from '../hud/frontPage';
import { newAwards } from '../hud/results';
import { IS_LAND } from '../../core/map/terrain';
import { UI } from '../../render/colors';
import type { MissionResult } from './missionResult';
import { WORLD_EVENT_TICKS, type WorldEventId } from '../../core/rules/features';

const PLAYER_PARAMS = new Set(['player', 'by', 'from', 'with', 'traitor', 'victim', 'target']);

export class GameController {
  session!: Session;
  renderer!: GameRenderer;
  input!: InputController;
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;
  private hudTimer = 0;
  private director: CampaignDirector | null = null;
  /** Our capital (card, sounds) and the threatened-border news. */
  private capitals!: CapitalWatch;
  lan: LanClient | null = null;
  /** What the final edition of the Courier is written from, the edition, and its replay. */
  private chronicle: Chronicle | null = null;
  edition: Edition | null = null;
  replayFile: ReplayFile | null = null;
  private lastIntensity = 0;
  private disposed = false;
  /** QA (?automation): a world event printed without waiting for the draw. */
  private qaEvent: { id: string; until: number } | null = null;

  constructor(private readonly req: LaunchRequest) {}

  async start(host: HTMLElement): Promise<void> {
    resetHud();
    hud.loadingText = t('loading.map');
    if (this.req.kind === 'lan') this.lan = currentLan();
    this.session = new Session({
      kind: this.req.kind,
      config: this.req.config,
      viewer: this.req.viewer,
      ...(this.req.snapshot ? { snapshot: this.req.snapshot } : {}),
      ...(this.req.replay ? { replay: this.req.replay } : {}),
      ...(this.req.priorTurns ? { priorTurns: this.req.priorTurns } : {}),
      ...(this.req.replayStart ? { replayStart: this.req.replayStart } : {}),
      ...(this.req.customMap ? { customMap: this.req.customMap } : {}),
      ...(this.lan ? { source: this.lan.source(this.req.viewer) } : {}),
    });
    setSession(this.session);
    this.capitals = new CapitalWatch(this.session);
    this.session.sim.onError = (m) => {
      void bridge.storage.log(`[sim] ${m}`);
      toast(t('error.simulation'), 'danger');
    };
    const ready = await this.session.start(mapsBase());
    if (this.disposed) return;
    this.chronicle = new Chronicle(this.session.state, this.req.viewer);
    // A replay opened from its game's front page finds that front page again.
    this.edition = keptEdition(this.req.replay?.date);
    hud.viewer = this.req.viewer;
    hud.spectating = this.req.viewer <= 0;
    this.renderer = new GameRenderer(this.session.state, {
      quality: settings.graphics.quality,
      particles: settings.graphics.particles,
      vision: settings.access.vision,
      highContrast: settings.access.highContrast,
      reducedMotion: settings.access.reducedMotion,
      showFps: false,
      maxFps: settings.graphics.maxFps,
      lang: i18n.lang,
      // The interface scale is the page zoom (stores/viewport.svelte.ts): the map's labels
      // and badges, in CSS pixels, already follow it.
      uiScale: 1,
    });
    await this.renderer.init(host);
    this.input = new InputController(this.renderer.app.canvas, this.renderer, this.session, {
      onAction: (tile) => this.action(tile),
      // (Photo mode: the map only moves, nothing opens.)
      onRadial: (tile, sx, sy) => {
        if (!hud.photo) hud.radial = { x: sx, y: sy, tile };
      },
      onEmoji: (tile, sx, sy) => {
        if (!hud.photo) hud.radial = { x: sx, y: sy, tile: -tile - 2 };
      },
      onKey: (a, e) => this.key(a, e),
    });
    this.renderer.onFrame = (dt) => {
      this.input.update(dt);
      this.frame(dt);
    };
    this.session.onTick((u, events) => this.onTick(u.tick, events));
    if (this.lan) {
      const lan = this.lan;
      this.session.onHash((tick, hash) => lan.send({ t: 'hash', tick, hash }));
      lan.onSnapshot = (snap) => void this.resyncFrom(snap);
      lan.onDesync = () => (hud.desync = true);
      lan.onPause = (on) => (hud.paused = on);
      lan.onChat = (m) =>
        (hud.chat = [
          ...hud.chat.slice(-99),
          { from: m.from, text: m.text, channel: m.channel, t: hud.tick },
        ]);
      lan.onStatus = (connected) => {
        if (!connected) toast(t('lan.connectionLost'), 'warn');
      };
    }
    if (this.req.viewer > 0 && ready.phase === 'spawn') this.renderer.camera.fit();
    // A loaded save or a game taken over from a replay: the camera finds our country.
    if (this.req.snapshot && this.req.viewer > 0 && ready.phase !== 'spawn') {
      const off = this.session.onTick(() => {
        if (!this.session.state.players.get(this.req.viewer)) return;
        off();
        this.home();
      });
    }
    hud.loading = false;
    hud.ready = true;
    if (this.req.kind === 'solo' && !this.req.missionId) {
      this.autosaveTimer = setInterval(() => void this.autosave(), 120_000);
    }
    if (this.req.missionId) {
      this.director = CampaignDirector.for(this, this.req.missionId);
      this.director?.start();
    }
    if (this.session.replay)
      hud.replay = { tick: 0, end: this.session.replay.file.endTick, speed: 1, paused: false };
    const at = this.req.replayAt;
    if (this.session.replay && at)
      void this.seekReplay(
        at.tick,
        at.x !== undefined && at.y !== undefined ? [at.x, at.y] : undefined,
        !!at.takeover,
      );
    audio.setScene('game');
    console.info(`[isoline] map loaded in ${this.session.loadMs.toFixed(0)} ms`);
    // Automation hooks (screenshots / media): ?speed=&zoom=&x=&y=&perf
    if (this.session.kind === 'solo' && this.req.config.gameSpeed !== 1)
      this.setSpeed(this.req.config.gameSpeed);
    const q = new URLSearchParams(location.search);
    if (q.get('speed')) this.setSpeed(Number(q.get('speed')));
    if (q.get('zoom')) {
      const x = Number(q.get('x') ?? 0.5) * this.session.state.width;
      const y = Number(q.get('y') ?? 0.5) * this.session.state.height;
      this.renderer.camera.goTo(x, y, Number(q.get('zoom')));
    }
    if (q.has('perf')) hud.showPerf = true;
    // Automation hook (media capture, scripted QA) — only with ?automation.
    if (q.has('automation')) {
      (window as unknown as { __iso: unknown }).__iso = {
        cmd: (c: Parameters<Session['cmd']>[0]) => this.session.cmd(c),
        camera: this.renderer.camera,
        state: () => {
          const st = this.session.state;
          return {
            tick: st.tick,
            phase: st.phase,
            width: st.width,
            height: st.height,
            local: st.local,
            players: st.playerList.map((p) => ({
              id: p.id,
              name: p.name.en,
              tiles: p.tiles,
              label: p.label,
              kind: p.kind,
              capital: p.capital,
            })),
          };
        },
        ownTiles: (n: number) => {
          const st = this.session.state;
          const out: number[] = [];
          const step = Math.max(1, Math.floor(st.owner.length / 200000));
          for (let i = 0; i < st.owner.length && out.length < n; i += step)
            if (st.owner[i] === this.session.viewer) out.push(i);
          return out;
        },
        tilesOf: (id: number, n: number) => {
          const st = this.session.state;
          const out: number[] = [];
          for (let i = 0; i < st.owner.length && out.length < n; i += 97) if (st.owner[i] === id) out.push(i);
          return out;
        },
        coast: (n: number) => {
          const st = this.session.state;
          const out: number[] = [];
          const w = st.width;
          for (let i = w; i < st.owner.length - w && out.length < n; i += 7) {
            if (st.owner[i] !== this.session.viewer) continue;
            const t = st.terrain;
            if (t[i - 1]! <= 2 || t[i + 1]! <= 2 || t[i - w]! <= 2 || t[i + w]! <= 2) out.push(i);
          }
          return out;
        },
        hud: () => ({ tick: hud.tick, end: !!hud.end, paper: hud.paper, page: hud.paperPage }),
        /** QA: a nuke from `by`'s silo at (sx, sy) heading for our land (alert, sender medallion). */
        nukeAlert: (by: number, sx: number, sy: number, kind = 1, secs = 20) => {
          const me = this.session.state.players.get(this.session.viewer);
          const [tx, ty] = me ? [me.label[0], me.label[1]] : [0, 0];
          hud.nukeAlerts = [
            ...hud.nukeAlerts,
            { id: -hud.nukeAlerts.length - 1, by, kind, impact: hud.tick + secs * 10, tx, ty, sx, sy },
          ];
        },
        /** QA: print a world event (the Flash info card, the journal's article) right away. */
        worldEvent: (id: string) => {
          this.qaEvent = { id, until: hud.tick + (WORLD_EVENT_TICKS[id as WorldEventId] ?? 1200) };
          const key = `worldEvent.${id}`;
          const level = id === 'boom' ? 'good' : 'warn';
          hud.log = [...hud.log, { tick: hud.tick, text: t(key), level, key, params: {} }];
        },
        /** QA: show the dispatch of a fall while the game goes on (LAN only in play). */
        fallNotice: (by = 0) => (hud.fallen = { tick: hud.tick, by, cause: 'conquered' }),
        /** QA: end the game as a campaign mission would. */
        endMission: (r: MissionResult | string, stars?: number) => this.endMission(r, stars),
        buildings: () => this.session.state.buildings.map((b) => ({ ...b })),
        units: () => {
          const st = this.session.state;
          const out: {
            id: number;
            type: number;
            owner: number;
            x: number;
            y: number;
            hp: number;
            kind: number;
            level: number;
          }[] = [];
          for (let k = 0; k < st.unitCount; k++) {
            const o = k * UNIT_STRIDE;
            out.push({
              id: st.units[o]!,
              type: st.units[o + 1]!,
              owner: st.units[o + 2]!,
              x: st.units[o + 3]!,
              y: st.units[o + 4]!,
              hp: st.units[o + 5]!,
              kind: st.units[o + 6]!,
              level: st.units[o + 7]!,
            });
          }
          return out;
        },
        ownerOf: (t: number) => this.session.state.owner[t] ?? 0,
        freeLand: (t: number) => {
          const st = this.session.state;
          return st.terrain[t]! > 2 && st.terrain[t]! < 10 && st.owner[t] === 0;
        },
        setTool: (k: string) => (hud.tool = { k: 'none' } as never) && k,
        weather: () => this.session.state.world?.weather ?? [],
        routes: () => this.session.state.routes,
        /** QA: back to the menus with a confirmation open (the dialog in the menus' theme). */
        /** QA: a notification (the dispatches tray). */
        toast: (text: string, level: 'info' | 'good' | 'warn' | 'danger' = 'info', tile?: number) =>
          toast(text, level, tile),
        /** QA: fields laid over the worker's view every tick (offers, a nuclear ban…); null clears. */
        patch: (p: { local?: Record<string, unknown>; world?: Record<string, unknown> } | null) =>
          (this.qaPatch = p),
        /** QA: the pact banner with a country (`kind`: signed, renewed, refused, silent, betrayed). */
        pact: (id: number, kind = 'signed') =>
          showPact({
            with: id,
            renewed: kind === 'renewed',
            refused: kind === 'refused' || kind === 'silent',
            silent: kind === 'silent',
            betrayed: kind === 'betrayed',
          }),
        menuConfirm: () => {
          go('title');
          confirmModal(t('menu.quitTitle'), t('menu.quitBody'), () => {}, t('menu.quit'), t('common.cancel'));
        },
      };
    }
  }

  // ------------------------------------------------------------- actions
  action(tile: number): void {
    if (this.session.kind === 'replay' || hud.photo) return;
    InputController.defaultAction(this.session, tile, hud.attackRatio);
    if (
      hud.tool.k === 'build' ||
      hud.tool.k === 'nuke' ||
      hud.tool.k === 'air' ||
      hud.tool.k === 'warship' ||
      hud.tool.k === 'general' ||
      hud.tool.k === 'ping' ||
      hud.tool.k === 'capital'
    ) {
      audio.ui('confirm');
      hud.tool = { k: 'none' };
      this.renderer.overlay.ghost = null;
      this.renderer.overlay.nukePreview = null;
    } else audio.ui('click');
  }

  toggleLoyaltyView(): void {
    hud.views.loyalty = !hud.views.loyalty;
    this.session.sim.setLayers(hud.views.loyalty);
    if (hud.views.loyalty) toast(t('hud.loyaltyHint'), 'info');
  }

  /** Trade-route view (sea lanes, busy railways): a remembered setting, on by default. */
  toggleTradeRoutes(): void {
    settings.game.tradeRoutes = !settings.game.tradeRoutes;
    saveSettings();
  }

  private key(action: string, e: KeyboardEvent): void {
    const s = this.session;
    const hover = hud.hover?.tile ?? -1;
    // Photo mode: only the camera, the shot and the way out.
    if (hud.photo) {
      if (action === 'escape' || action === 'photoMode') this.exitPhoto();
      else if (action === 'screenshot') void this.photoShot();
      else if (action === 'pause' && this.canFreeze()) this.setFreeze(!photo.freeze);
      return;
    }
    if (action === 'photoMode') {
      void this.enterPhoto();
      return;
    }
    if (action === 'escape') {
      if (hud.tool.k !== 'none' || hud.radial || hud.selection.length) {
        hud.tool = { k: 'none' };
        hud.radial = null;
        this.input.setSelection([]);
        this.renderer.overlay.ghost = null;
        this.renderer.overlay.nukePreview = null;
      } else if (hud.panels.menu) hud.panels.menu = false;
      // A window open: Escape closes the one in front (then the next…), the menu comes after.
      else if (!closeTopWindow()) hud.panels.menu = true;
      return;
    }
    if (action in BUILD_KEYS) {
      hud.tool = { k: 'build', kind: BUILD_KEYS[action]! };
      return;
    }
    if (action in NUKE_KEYS) {
      const kind = NUKE_KEYS[action]!;
      // Pressing A-bomb twice switches to ×5.
      if (hud.tool.k === 'nuke' && hud.tool.kind === kind && kind === N.Atom)
        hud.tool = { k: 'nuke', kind, count: hud.tool.count === 1 ? 5 : 1 };
      else hud.tool = { k: 'nuke', kind, count: 1 };
      return;
    }
    switch (action) {
      case 'flipArc':
        this.flipArc();
        break;
      case 'attackHover':
        if (hover >= 0)
          guardBetrayal(s, hover, () => s.cmd({ t: 'attack', tile: hover, ratio: hud.attackRatio }));
        break;
      case 'boatHover':
        if (hover >= 0)
          guardBetrayal(s, hover, () => s.cmd({ t: 'boat', tile: hover, ratio: hud.attackRatio }));
        break;
      case 'warship':
        hud.tool = { k: 'warship' };
        break;
      case 'allyAccept':
      case 'allyRefuse': {
        const req = hud.local?.allyRequests[0];
        if (req !== undefined) {
          audio.ui(action === 'allyAccept' ? 'confirm' : 'click');
          s.cmd({ t: 'allyAnswer', target: req, accept: action === 'allyAccept' });
        }
        break;
      }
      case 'terrainView':
        hud.views.terrain = !hud.views.terrain;
        break;
      case 'fogView':
        // Lifting the fog is a spectator/replay tool, not a way to peek in a live game.
        if (this.session.kind !== 'replay' && this.session.viewer > 0) {
          toast(t('hud.fogLocked'), 'info');
          break;
        }
        hud.views.fog = !hud.views.fog;
        break;
      case 'resourcesView':
        hud.views.resources = !hud.views.resources;
        break;
      case 'loyaltyView':
        this.toggleLoyaltyView();
        break;
      case 'tradeRoutes':
        this.toggleTradeRoutes();
        break;
      case 'home':
        this.home();
        break;
      case 'chat':
        openPanel('chat');
        break;
      case 'pause':
        if (this.session.kind === 'solo' || this.session.kind === 'replay') this.togglePause();
        break;
      case 'speedUp':
      case 'speedDown':
        if (this.session.kind === 'solo') this.stepSpeed(action === 'speedUp' ? 1 : -1);
        break;
      case 'general':
        hud.tool = { k: 'general' };
        break;
      case 'screenshot':
        void this.screenshot();
        break;
      case 'fps':
        hud.showPerf = !hud.showPerf;
        break;
    }
    void e;
  }

  /** Mirror the missile arc (towards the top or the bottom of the map) to fly around SAMs. */
  flipArc(): void {
    hud.nukeArcUp = !hud.nukeArcUp;
    audio.ui('click');
    if (hud.tool.k !== 'nuke') toast(t(hud.nukeArcUp ? 'launch.arcUpToast' : 'launch.arcDownToast'), 'info');
  }

  /** After the victory: keep playing the same world (victory checks stay off from now on). */
  continuePlaying(): void {
    this.session.cmd({ t: 'continue' });
    hud.end = null;
    hud.paper = false;
    audio.setScene('game');
  }

  /** Campaign: the player closed the briefing. */
  beginMission(): void {
    this.director?.begin();
  }

  togglePause(): void {
    this.session.setPaused(!this.session.paused);
    hud.paused = this.session.paused;
  }

  /** Solo: slow the clock down or speed it up (0.5× to 4×). */
  setSpeed(mult: number): void {
    this.session.source.setSpeed(mult);
    hud.speed = mult;
  }

  stepSpeed(dir: 1 | -1): void {
    const steps = [0.5, 1, 2, 4];
    const k = steps.findIndex((v) => v >= hud.speed);
    this.setSpeed(steps[Math.max(0, Math.min(steps.length - 1, (k < 0 ? 1 : k) + dir))]!);
  }

  home(): void {
    const me = this.session.state.players.get(this.session.viewer);
    if (me && me.tiles > 0 && me.label[2] > 0)
      this.renderer.camera.goTo(me.label[0], me.label[1], Math.max(this.renderer.camera.zoom, 2.5));
  }

  private lastWave = -Infinity;

  /**
   * A wave of troops was sent at us: the screen's edges flash red (InvasionFlash.svelte),
   * brightest on the side facing the attack, stronger for a bigger wave. Waves closer than
   * 2 s apart (a landing and a land push together) make one flash.
   */
  private invasionFlash(troops: number, tile: number): void {
    const now = performance.now();
    if (hud.photo || hud.end || now - this.lastWave < 2000) return;
    this.lastWave = now;
    const me = this.session.state.players.get(this.session.viewer);
    const strength = Math.max(0.8, Math.min(1, 0.7 + troops / Math.max(1, me?.troops ?? 1)));
    // Direction from the screen's centre to the attack, carried out to the screen's edge.
    let ex = 0.5;
    let ey = 0;
    const cam = this.renderer.camera;
    if (tile >= 0 && cam.viewW > 1) {
      const w = this.session.state.width;
      const [sx, sy] = cam.worldToScreen((tile % w) + 0.5, ((tile / w) | 0) + 0.5);
      const dx = sx / cam.viewW - 0.5;
      const dy = sy / cam.viewH - 0.5;
      const k = 0.5 / Math.max(Math.abs(dx), Math.abs(dy), 1e-6);
      ex = 0.5 + dx * k;
      ey = 0.5 + dy * k;
    }
    hud.invasion = { n: (hud.invasion?.n ?? 0) + 1, ex, ey, strength };
  }

  /** Country lit up on the map while the pointer rests on a panel about it (−1: none). */
  spotlight = -1;

  /** Centres the camera on a country, zoomed so that it fills the view (tiny ones included). */
  focusPlayer(id: number): void {
    const p = this.session.state.players.get(id);
    // A country without an anchor yet (label [0, 0, 0]) would send the camera to the map's corner.
    if (!p || p.tiles === 0 || p.label[2] <= 0) return;
    const fit = 400 / Math.max(10, p.label[2] * 4);
    this.renderer.camera.goTo(p.label[0], p.label[1], Math.max(1.2, Math.min(6, fit)));
  }

  // ------------------------------------------------------------ photo mode
  private photoWasPaused = false;

  /** Can the world be held still for the shot (solo and replays; not a LAN game)? */
  canFreeze(): boolean {
    return this.session.kind === 'solo' || this.session.kind === 'replay';
  }

  /** May the fog be lifted for the shot (spectators and replays, as with the fog view)? */
  canLiftFog(): boolean {
    return this.session.kind === 'replay' || this.session.viewer <= 0;
  }

  /** Photo mode: the HUD goes, the map stays (free camera), a small bar sets up the shot. */
  async enterPhoto(): Promise<void> {
    if (hud.photo || !hud.ready) return;
    // Close the pause menu first: it resumes the game it paused when it goes.
    hud.panels.menu = false;
    hud.radial = null;
    hud.tool = { k: 'none' };
    this.input.setSelection([]);
    await uiTick();
    this.photoWasPaused = this.session.paused;
    photo.saved = '';
    photo.failed = false;
    photo.fog = this.canLiftFog() ? hud.views.fog : true;
    photo.routes = settings.game.tradeRoutes;
    hud.photo = true;
    if (this.canFreeze()) this.setFreeze(photo.freeze);
    audio.ui('click');
  }

  exitPhoto(): void {
    if (!hud.photo) return;
    hud.photo = false;
    photo.capturing = false;
    if (this.canFreeze() && this.session.paused !== this.photoWasPaused) {
      this.session.setPaused(this.photoWasPaused);
      hud.paused = this.photoWasPaused;
    }
    audio.ui('click');
  }

  setFreeze(on: boolean): void {
    photo.freeze = on;
    if (!this.canFreeze()) return;
    const paused = on || this.photoWasPaused;
    this.session.setPaused(paused);
    hud.paused = paused;
  }

  /** The picture: the bar steps aside, the window is captured, the bar says where it went. */
  async photoShot(): Promise<void> {
    if (photo.capturing) return;
    photo.capturing = true;
    await uiTick();
    // Two frames: the bar is gone from the page and the map has drawn without it.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const file = await bridge.screenshot();
    photo.capturing = false;
    photo.saved = file ?? '';
    photo.failed = !file;
    if (file) audio.ui('confirm');
    else audio.ui('error');
  }

  async screenshot(): Promise<void> {
    const file = await bridge.screenshot();
    toast(file ? t('hud.screenshotSaved', { file }) : t('hud.screenshotFailed'), file ? 'good' : 'warn');
  }

  // ---------------------------------------------------------------- ticks
  private onTick(tick: number, events: GameEvent[]): void {
    const st = this.session.state;
    this.renderer.onEvents(events);
    this.chronicle?.tick(st, events);
    for (const e of events) this.event(e);
    this.capitals.tick(tick);
    this.director?.tick(tick, events);
    this.weatherNews.check(st, this.session.viewer);
    // HUD refresh (reactive store) — local every tick, the rest when provided.
    hud.tick = tick;
    hud.phase = st.phase;
    hud.local = st.local;
    if (st.world) hud.world = this.qaEvent ? { ...st.world, event: this.qaEvent } : st.world;
    if (this.qaPatch) {
      if (hud.local && this.qaPatch.local) hud.local = { ...hud.local, ...this.qaPatch.local };
      if (hud.world && this.qaPatch.world) hud.world = { ...hud.world, ...this.qaPatch.world };
    }
    hud.players = st.playerList;
    hud.tickMs = st.tickMs;
    if (st.local && tick % 50 === 0) {
      hud.history = [
        ...hud.history.slice(-299),
        {
          tick,
          tiles: st.players.get(this.session.viewer)?.tiles ?? 0,
          gold: st.local.gold,
          troops: st.local.troops,
        },
      ];
    }
    if (this.session.replay)
      hud.replay = {
        tick,
        end: this.session.replay.file.endTick,
        speed: this.session.replay.speed,
        paused: this.session.replay.paused,
      };
    if (st.phase === 'ended' && !this.finished && !hud.end) {
      this.finished = true;
      // A mission ends as a mission (doomsday mode can end the game by itself).
      if (this.director) this.director.gameOver();
      else void this.finish();
    }
    // Music intensity from active fronts and alerts.
    const intensity = Math.min(
      1,
      (st.pendingTiles.length / 400) * 0.6 +
        (hud.nukeAlerts.length ? 0.6 : 0) +
        ((st.local?.attacks.length ?? 0) > 0 ? 0.3 : 0),
    );
    this.lastIntensity = this.lastIntensity * 0.9 + intensity * 0.1;
    audio.setIntensity(this.lastIntensity);
  }

  /** QA (?automation): fields laid over the worker's view every tick. */
  private qaPatch: { local?: Record<string, unknown>; world?: Record<string, unknown> } | null = null;
  private slowSeconds = 0;
  private lastCoin = 0;
  private finished = false;

  private frame(dt: number): void {
    this.hudTimer += dt;
    if (this.hudTimer > 0.25) {
      this.hudTimer = 0;
      hud.fps = Math.round(this.renderer.fps);
    }
    // Automatic performance mode on slow machines (sustained < 40 FPS for 5 s).
    if (settings.graphics.autoPerformance && this.renderer.settings.quality !== 'performance') {
      this.slowSeconds = this.renderer.fps < 40 ? this.slowSeconds + dt : 0;
      if (this.slowSeconds > 5) {
        this.renderer.settings.quality = 'performance';
        this.renderer.settings.particles = Math.min(this.renderer.settings.particles, 0.4);
        toast(t('hud.autoPerformance'), 'info');
      }
    }
    // Tool previews + layer toggles.
    const ov = this.renderer.overlay;
    ov.terrainView = hud.views.terrain;
    ov.resourcesView = hud.views.resources;
    ov.loyaltyView = hud.views.loyalty;
    if (hud.photo) {
      ov.fogView = photo.fog || !this.canLiftFog();
      ov.tradeRoutes = photo.routes;
      ov.photo = { labels: photo.labels, borders: photo.borders, weather: photo.weather };
      ov.night = photo.autoTime ? -1 : photo.night;
    } else {
      ov.fogView = hud.views.fog;
      ov.tradeRoutes = settings.game.tradeRoutes;
      ov.photo = null;
      ov.night = -1;
    }
    const tool = hud.tool;
    const hover = hud.hover?.tile ?? -1;
    ov.ghost = null;
    ov.nukePreview = null;
    ov.ranges = [];
    // Choosing a new capital: the marker and its border clearance, ok or not.
    ov.capitalGhost =
      hover >= 0 && tool.k === 'capital'
        ? { tile: hover, ok: clientSpotError(this.session.state, this.session.viewer, hover) === 'ok' }
        : null;
    // SAM coverage while aiming a missile or placing a silo / SAM.
    // Map cursor: a pointing hand, a sword over an enemy country (a click attacks it), the
    // surveyor's reticle in brass to build or send units, in magenta to aim a missile.
    const st = this.session.state;
    const enemy =
      tool.k === 'none' &&
      st.phase === 'playing' &&
      hover >= 0 &&
      IS_LAND[st.terrain[hover]!] === 1 &&
      st.owner[hover]! > 0 &&
      this.renderer.relation(st.owner[hover]!) === 'foe';
    const cur =
      tool.k === 'nuke'
        ? 'var(--cursor-aim)'
        : enemy
          ? 'var(--cursor-attack)'
          : tool.k === 'none' || tool.k === 'shipMove'
            ? 'var(--cursor-map)'
            : 'var(--cursor-build)';
    const canvas = this.renderer.app.canvas;
    if (canvas.style.cursor !== cur) canvas.style.cursor = cur;
    // Build-bar filter: the hovered button (or the active tool) lights up the matching buildings.
    const bh = hud.barHover;
    const filter =
      bh !== null
        ? bh.startsWith('b')
          ? [Number(bh.slice(1))]
          : bh.startsWith('n')
            ? [B.Silo, B.Sam]
            : bh === 'ws'
              ? [B.Port]
              : bh.startsWith('a')
                ? [B.Airfield]
                : null
        : tool.k === 'build'
          ? [tool.kind]
          : tool.k === 'nuke'
            ? [B.Silo, B.Sam]
            : tool.k === 'warship'
              ? [B.Port]
              : tool.k === 'air'
                ? [B.Airfield]
                : null;
    ov.buildingFilter = filter;
    // SAM coverage while aiming a missile, or with silos / SAMs in the filter.
    ov.samCoverage = tool.k === 'nuke' || !!filter?.some((k) => k === B.Sam || k === B.Silo);
    let launch: LaunchInfo | null = null;
    if (hover >= 0 && tool.k === 'build') {
      const s = this.session.state;
      const ok =
        s.owner[hover] === this.session.viewer &&
        (hud.local?.gold ?? 0) >= (hud.local?.buildCosts[tool.kind] ?? Infinity);
      ov.ghost = { kind: tool.kind, tile: hover, ok };
    } else if (hover >= 0 && tool.k === 'nuke') {
      launch = this.launchPreview(tool.kind, hover);
      ov.nukePreview = launch.overlay;
    }
    this.publishLaunch(launch);
    // Radius of action: hovered building, building being placed, or all own ports for the warship tool.
    const rangeOf = (type: number, level: number, owner: number): number =>
      type === B.Sam
        ? this.session.state.samReach(owner, level)
        : type === B.DefensePost
          ? 30
          : type === B.Radar
            ? 60 + 20 * (level - 1)
            : type === B.Port
              ? portRange(level)
              : type === B.Factory
                ? RAIL_CONNECT_RANGE
                : type === B.Airfield
                  ? FIGHTER_RANGE
                  : 0;
    const colorOf = (type: number) => (type === B.Sam ? 0x7fa9d6 : type === B.Port ? 0x6fb6c9 : 0xd1a64a);
    if (
      hud.hover?.building &&
      hud.hover.building.type !== B.Factory &&
      hud.hover.building.type !== B.Airfield
    ) {
      // (Factory and airfield reaches are long: shown with the build-bar filter only.)
      const b = hud.hover.building;
      const r = rangeOf(b.type, b.level, hud.hover.owner);
      if (r > 0) ov.ranges.push({ x: hud.hover.x + 0.5, y: hud.hover.y + 0.5, r, color: colorOf(b.type) });
    }
    if (hover >= 0 && tool.k === 'build') {
      // Placing a building: its radius of action around the cursor, bold (red where it can't go).
      const w = this.session.state.width;
      const r = rangeOf(tool.kind, 1, this.session.viewer);
      if (r > 0)
        ov.ranges.push({
          x: (hover % w) + 0.5,
          y: Math.floor(hover / w) + 0.5,
          r,
          color: ov.ghost?.ok === false ? UI.signal : colorOf(tool.kind),
          strong: true,
        });
    }
    // Reach of our own buildings of the filtered types (SAMs: the coverage view above).
    if (filter) {
      for (const b of this.session.state.buildings) {
        if (b.owner !== this.session.viewer || !b.ready || b.type === B.Sam || !filter.includes(b.type))
          continue;
        const r = rangeOf(b.type, b.level, b.owner);
        if (r > 0) ov.ranges.push({ x: b.x + 0.5, y: b.y + 0.5, r, color: colorOf(b.type) });
      }
    }
    ov.highlightPlayer =
      hud.hover && hud.hover.owner > 0 && this.renderer.camera.zoom < 6 && !hud.photo ? hud.hover.owner : -1;
    if (this.spotlight > 0) ov.highlightPlayer = this.spotlight;
    // A MIRV's warheads fall all over the target country: show which one.
    if (launch && tool.k === 'nuke' && tool.kind === N.Mirv && launch.victim > 0)
      ov.highlightPlayer = launch.victim;
    // Expire nuke alerts.
    if (hud.nukeAlerts.length && hud.nukeAlerts.some((a) => a.impact <= hud.tick))
      hud.nukeAlerts = hud.nukeAlerts.filter((a) => a.impact > hud.tick);
  }

  private launchKey = '';
  private launchCache: LaunchInfo | null = null;

  /** Launch preview for the hovered tile (recomputed when the target, arc or buildings change). */
  private launchPreview(kind: number, tile: number): LaunchInfo {
    const st = this.session.state;
    const key = `${kind}|${tile}|${hud.nukeArcUp}|${st.buildingsVersion}|${Math.floor(st.tick / 10)}`;
    if (key !== this.launchKey || !this.launchCache) {
      this.launchKey = key;
      this.launchCache = launchInfo(st, this.session.viewer, kind, tile, hud.nukeArcUp, (o, x, y) =>
        this.renderer.revealed(o, x, y),
      );
    }
    return this.launchCache;
  }

  /** Feed the launch panel, touching the reactive store only when something changed. */
  private publishLaunch(l: LaunchInfo | null): void {
    const cur = hud.launch;
    if (!l) {
      if (cur) hud.launch = null;
      return;
    }
    if (
      cur &&
      cur.silo === l.silo &&
      cur.intercepted === l.intercepted &&
      cur.victim === l.victim &&
      cur.teammate === l.teammate &&
      cur.betrays.join() === l.betrays.join()
    )
      return;
    hud.launch = {
      silo: l.silo,
      intercepted: l.intercepted,
      betrays: l.betrays,
      victim: l.victim,
      teammate: l.teammate,
    };
  }

  /** Is a world point inside the current view (with a margin)? */
  private onScreen(x: number, y: number): boolean {
    const [x0, y0, x1, y1] = this.renderer.camera.bounds();
    const m = (x1 - x0) * 0.1;
    return x >= x0 - m && x <= x1 + m && y >= y0 - m && y <= y1 + m;
  }

  private lastSiren = 0;
  private weatherNews = new WeatherNews();
  private lastPactSubtitle = 0;
  /** Recent missile launches: the news names who razed a country's last lands. */
  private launches: { owner: number; impact: number; threatened: number[] }[] = [];
  /** Who brought each fallen country down (the elimination notice is patched with it). */
  private fallBy = new Map<number, number>();
  private fallen = -1;

  /** Author of the blast that just razed `player`'s last lands (0 if unknown). */
  private nuker(player: number): number {
    const now = hud.tick;
    const near = this.launches.filter((l) => l.impact <= now + 30 && l.impact >= now - 60);
    const hit = near.filter((l) => l.threatened.includes(player));
    return (hit.at(-1) ?? near.at(-1))?.owner ?? 0;
  }

  private fmt(e: Extract<GameEvent, { k: 'notify' }>): string {
    const params: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(e.params ?? {})) {
      if (PLAYER_PARAMS.has(k) && typeof v === 'number') params[k] = this.session.state.name(v, i18n.lang);
      else if (k === 'tech' && typeof v === 'string') params[k] = t(`${v}.name`);
      else if (typeof v === 'number' && (k === 'troops' || k === 'gold'))
        params[k] = v.toLocaleString(i18n.lang);
      else if (k === 'eta' && typeof v === 'number') params[k] = (v / 10).toFixed(0);
      else params[k] = v;
    }
    return t(e.key, params);
  }

  private event(e: GameEvent): void {
    // Spectators (viewer ≤ 0) only receive broadcast messages.
    const me = this.session.viewer > 0 ? this.session.viewer : -2;
    switch (e.k) {
      case 'notify': {
        if (e.to !== -1 && e.to !== me) return;
        if (this.capitals.skip(e, me)) return;
        const text = this.fmt(e);
        const params = { ...e.params };
        if (e.key === 'event.eliminated' && typeof params.player === 'number')
          params.by = this.fallBy.get(params.player) ?? params.by ?? 0;
        hud.log = [
          ...hud.log.slice(-199),
          {
            tick: hud.tick,
            text,
            level: e.level,
            key: e.key,
            params,
            ...(e.tile !== undefined ? { tile: e.tile } : {}),
          },
        ];
        // Alliance offers have their own card (AllyRequests.svelte): no toast on top of it.
        const offer = e.key === 'notify.allianceRequest' || e.key === 'notify.renewRequest';
        if (
          (e.to === me && !offer) ||
          e.level === 'danger' ||
          e.key.startsWith('worldEvent') ||
          e.key.startsWith('council') ||
          e.key === 'event.gameStart'
        ) {
          toast(text, e.level, e.tile);
        }
        if (e.key.startsWith('error.')) audio.ui('error');
        break;
      }
      case 'nukeLaunch': {
        // The alarm is only for the countries the blast will hit; launches elsewhere
        // are heard when they are ours or on screen.
        const targeted = e.threatened.includes(me);
        this.launches = [
          ...this.launches.filter((l) => l.impact > hud.tick - 100),
          { owner: e.owner, impact: e.impact, threatened: e.threatened },
        ];
        // The H-bomb and MIRV achievements (nothing reported these launches before).
        if (e.owner === me && this.session.kind !== 'replay') noteLaunch(e.kind);
        if (e.owner === me || targeted) audio.sfx('launch', 0.7);
        else if (this.onScreen(e.sx, e.sy) || this.onScreen(e.tx, e.ty)) audio.sfx('launch', 0.35);
        if (targeted) {
          hud.nukeAlerts = [
            ...hud.nukeAlerts,
            { id: e.id, by: e.owner, kind: e.kind, impact: e.impact, tx: e.tx, ty: e.ty, sx: e.sx, sy: e.sy },
          ];
          if (performance.now() - this.lastSiren > 4000) {
            this.lastSiren = performance.now();
            audio.sfx('siren', 1);
            if (settings.access.subtitles) subtitle(t('subtitle.siren'));
          }
        }
        break;
      }
      case 'explosion':
        if (e.kind <= 3) {
          const near = e.owner === me || this.onScreen(e.x, e.y);
          audio.sfx(
            e.kind === N.Hydrogen ? 'explosionH' : e.kind === N.MirvWarhead ? 'explosionMirv' : 'explosionA',
            near ? 1 : 0.35,
          );
          if (near && settings.access.subtitles) subtitle(t('subtitle.explosion'));
        } else if (e.owner === me || this.onScreen(e.x, e.y)) audio.sfx('blast', 0.5);
        break;
      // Battles elsewhere stay silent: only what concerns us or what we are looking at.
      case 'attackWave':
        if (e.target === me) this.invasionFlash(e.troops, e.tile);
        break;
      case 'intercept':
        if (e.owner === me || this.onScreen(e.x, e.y)) audio.sfx('intercept', 0.8);
        break;
      case 'shipSunk':
        if (e.owner === me || e.by === me || this.onScreen(e.x, e.y)) audio.sfx('sunk', 0.6);
        break;
      case 'built':
        if (e.owner === me) audio.sfx('build', 0.6);
        break;
      case 'alliance':
        if (e.a === me || e.b === me) {
          // (A signed pact sounds when its banner shows: banners queue up.)
          if (!e.on) audio.sfx('allianceEnd', 0.8);
          if (e.on) {
            // The pact is signed: banner, and an ink link between the two capitals.
            const other = e.a === me ? e.b : e.a;
            const renewed = !!hud.local?.allies.some((a) => a.id === other);
            showPact({ with: other, renewed });
            if (settings.access.subtitles && performance.now() - this.lastPactSubtitle > 1500) {
              this.lastPactSubtitle = performance.now();
              subtitle(t('subtitle.pact'));
            }
            const st = this.session.state;
            const A = st.players.get(me);
            const Bp = st.players.get(other);
            if (A && Bp) this.renderer.pactLink(A.label[0], A.label[1], Bp.label[0], Bp.label[1]);
          }
        }
        break;
      case 'allyRefused':
        // Our offer was turned down: the same banner as a signed pact, torn instead of signed.
        if (e.from === me) {
          showPact({ with: e.by, renewed: false, refused: true, silent: e.silent });
          if (settings.access.subtitles) subtitle(t('subtitle.refused'));
        }
        break;
      case 'betrayal':
        hud.betrayals = [
          ...hud.betrayals,
          {
            tick: hud.world ? hud.tick - hud.world.startTick : hud.tick,
            traitor: e.traitor,
            victim: e.victim,
          },
        ];
        // The orchestral hit is for the two countries involved; others just read the news.
        // The victim also sees its pact torn up, where pacts are signed and refused.
        if (e.victim === me) showPact({ with: e.traitor, renewed: false, betrayed: true });
        if (e.traitor === me || e.victim === me) {
          audio.sfx('betrayal', e.victim === me ? 0.5 : 0.8);
          if (settings.access.subtitles) subtitle(t('subtitle.betrayal'));
        }
        break;
      case 'worldEvent':
        audio.sfx('event', 0.9);
        break;
      case 'council':
        hud.councilOpen = e.phase === 'open';
        break;
      case 'trainPay':
        if (e.owner === me) audio.sfx('train', 0.35);
        break;
      case 'loot':
        // Plundering a tribe pays out tile by tile: a coin now and then, not a rattle.
        if (e.owner === me && performance.now() - this.lastCoin > 4000) {
          this.lastCoin = performance.now();
          audio.sfx('coinSmall', 0.55);
        }
        break;
      case 'quick':
        if (e.to === me || e.to === -1)
          hud.chat = [
            ...hud.chat.slice(-99),
            { from: e.from, text: t(`quick.${e.msg}`), channel: 'all', t: hud.tick },
          ];
        break;
      case 'eliminated': {
        const fallen = this.session.state.players.get(e.player);
        const by = e.cause === 'nuked' ? this.nuker(e.player) : e.by;
        if (e.player === me) {
          toast(t('notify.youDied'), 'danger');
          audio.sfx('defeat', 0.9);
          // The game goes on without us (other humans in a LAN game): a dispatch says so.
          // In solo the game ends at once and the paper says it instead.
          const fall = { tick: hud.tick, by, cause: e.cause };
          setTimeout(() => {
            if (!this.disposed && !hud.end && this.session.state.phase === 'playing') hud.fallen = fall;
          }, 1500);
        } else if (by === me) {
          // A tribe wiped out is a skirmish (a drum); a nation is history (horns).
          if (fallen?.kind === 'tribe') audio.sfx('tribeFall', 0.7);
          else audio.sfx('eliminated', 0.8);
        }
        if (!fallen || fallen.kind === 'tribe') break;
        // Special edition: every nation that falls (but ours: the defeat screen says it).
        if (this.fallen < 0)
          this.fallen = hud.players.filter(
            (p) => p.spawned && !p.alive && p.kind !== 'tribe' && p.id !== e.player,
          ).length;
        this.fallen++;
        this.fallBy.set(e.player, by);
        if (e.player !== me)
          reportFall({
            id: e.player,
            player: e.player,
            by,
            cause: e.cause,
            at: Math.max(0, hud.tick - (hud.world?.startTick ?? 0)),
            nth: this.fallen,
          });
        break;
      }
      case 'capitalLost':
      case 'capitalMoved':
        this.capitals.event(e, me);
        break;
      case 'gameOver':
        break;
      case 'gameContinued':
        hud.end = null;
        hud.paper = false;
        toast(t('end.continued', { player: this.session.state.name(e.by, i18n.lang) }), 'info');
        audio.setScene('game');
        break;
    }
  }

  // ----------------------------------------------------------- end flow
  private async finish(): Promise<void> {
    const stats = await this.session.finalStats();
    const me = this.session.viewer;
    const myTeam = this.session.state.players.get(me)?.team ?? 0;
    const won = stats.winner === me || (myTeam > 0 && stats.winnerTeam === myTeam);
    let replaySaved = false;
    let awards: string[] = [];
    let points: number | undefined;
    if (this.session.kind !== 'replay') {
      const winner = this.session.state.name(stats.winner, i18n.lang);
      const file = this.session.recorder.build(
        this.session.config,
        me,
        app.version,
        winner,
        stats.players.length,
        this.session.customMap,
      );
      const name = `isoline-${new Date().toISOString().replace(/[:.]/g, '-')}.rpl`;
      replaySaved = await bridge.storage.write('replays', name, JSON.stringify(file));
      const had = Object.keys(profile.achievements);
      await recordGameEnd(stats, me, won, this.session.config, this.req.missionId);
      awards = newAwards(had, Object.keys(profile.achievements));
      if (!this.req.missionId && stats.players.some((p) => p.id === me)) points = score(stats, me, won);
      this.replayFile = file;
    }
    // The final edition of the Courier (not for campaign missions: they have their communiqué).
    if (!this.req.missionId) {
      this.edition ??=
        this.chronicle?.close(this.session.state, stats, this.session.config.mode, Date.now()) ?? null;
      if (this.edition && this.replayFile) keepEdition(this.replayFile.date, this.edition);
    }
    hud.end = { stats, won, replaySaved, awards, ...(points !== undefined ? { score: points } : {}) };
    hud.fallen = null;
    // The final edition: a game worth telling opens on its front page, the results are
    // page 2; a short one opens straight on the results.
    hud.paperPage = worthPrinting(this.edition) ? 'front' : 'results';
    hud.paper = true;
    audio.setScene(won ? 'victory' : 'defeat');
  }

  /**
   * Campaign: the mission is over (see `missionResult.ts`). The paper opens on the
   * mission communiqué, the results on page 2. Either the full result, or the mission's
   * id and stars (0: failed): the objectives are then read from the HUD's list.
   */
  async endMission(result: MissionResult | string, stars = 0): Promise<void> {
    if (hud.end) return;
    this.finished = true;
    const had = Object.keys(profile.achievements);
    if (typeof result === 'string') result = this.missionResult(result, stars);
    await recordMission(result.id, result.stars);
    const awards = newAwards(had, Object.keys(profile.achievements));
    const stats = await this.session.finalStats();
    if (this.disposed) return;
    hud.end = {
      stats: { ...stats, reason: result.success ? `mission:${result.stars}` : 'mission:0' },
      won: result.success,
      replaySaved: false,
      awards,
      mission: result,
    };
    hud.fallen = null;
    hud.paperPage = 'mission';
    hud.paper = true;
    audio.setScene(result.success ? 'victory' : 'defeat');
  }

  /** A mission's result from its id and stars, the objectives as the HUD lists them. */
  private missionResult(id: string, stars: number): MissionResult {
    const k = MISSIONS.findIndex((m) => m.id === id);
    const m = MISSIONS[k];
    const success = stars > 0;
    // What the HUD's list says now (the texts are written again in the reader's language).
    const required = hud.objectives.filter((o) => !o.bonus);
    const reqDone = required.map((o) => success || o.done);
    const reqText = required.map((o) => o.text);
    const bonus = hud.objectives.find((o) => o.bonus);
    const bonusDone = !!bonus?.done;
    // One star for the success, one under the reference time, one for the bonus.
    const par = success && stars - 1 - (bonusDone ? 1 : 0) > 0;
    const next = success ? MISSIONS[k + 1] : undefined;
    const build = (): MissionResult => ({
      id,
      title: t(`campaign.${id}.title`),
      success,
      stars,
      best: Math.max(profile.campaign[id] ?? 0, stars),
      objectives: [
        ...reqDone.map((done, i) => ({
          text: m?.objectives[i] ? t(m.objectives[i].key) : reqText[i]!,
          done,
          star: reqDone.length === 1,
        })),
        ...(m ? [{ text: t('end.mission.par', { time: clock(m.parTicks) }), done: par, star: true }] : []),
        ...(bonus
          ? [{ text: m ? t(m.bonus.key) : bonus.text, done: bonusDone, star: true, bonus: true }]
          : []),
      ],
      ...(m ? { debrief: t(success ? m.outro : 'campaign.failed'), speaker: t('campaign.advisor') } : {}),
      ...(k >= 0 ? { index: k + 1, total: MISSIONS.length } : {}),
      next: next ? { id: next.id, title: t(`campaign.${next.id}.title`) } : null,
      localize: build,
    });
    return build();
  }

  /**
   * Replays: go to `tick` (fast-forward, or re-simulate when it is behind) and look at `at`.
   * With `takeover`, the replay stays paused there and asks which country to play from it.
   */
  async seekReplay(tick: number, at?: [number, number], takeover = false): Promise<void> {
    const rp = this.session.replay;
    if (!rp) return;
    const target = Math.max(rp.startTick, Math.min(tick, rp.file.endTick));
    hud.replaySeek = target;
    if (target >= rp.tick) rp.seekForward(target);
    else await this.restartReplayAt(target);
    rp.setPaused(takeover);
    hud.paused = takeover;
    if (takeover) hud.takeover = true;
    if (at) this.renderer.camera.goTo(at[0], at[1], Math.max(this.renderer.camera.zoom, 2.4));
  }

  /**
   * « Reprendre d'ici »: a new solo game from the replay's current moment, as `player`
   * (the others are left to the AI). Returns false when that country cannot be played.
   */
  async takeOver(player: number): Promise<boolean> {
    const rp = this.session.replay;
    if (!rp) return false;
    rp.setPaused(true);
    hud.paused = true;
    // (Queued after the turns already sent: the state of the moment on screen.)
    const t = takeOverSnapshot(await this.session.snapshot(), player);
    if (!t || t.snapshot.core.phase !== 'playing') return false;
    startTakeover(rp.file, t.snapshot, player, t.changed);
    return true;
  }

  /** Replay rewind: re-simulate from its start (tick 0, or its start snapshot) up to `target`. */
  async restartReplayAt(target: number): Promise<void> {
    const rp = this.session.replay;
    if (!rp) return;
    const wasPaused = rp.paused;
    rp.setPaused(true);
    const { src } = await loadMapSource(this.session.config, mapsBase(), this.session.customMap);
    const start = rp.file.start ? (JSON.parse(JSON.stringify(rp.file.start)) as Snapshot) : undefined;
    const ready = await this.session.sim.init(this.session.config, src, this.session.viewer, start);
    this.session.state.init(ready);
    this.renderer.rebuildMap();
    rp.reset();
    rp.seekForward(target);
    rp.setPaused(wasPaused);
  }

  /** LAN resync / reconnection: restart the worker from a server snapshot. */
  async resyncFrom(snapshot: import('../../core/net/snapshot').Snapshot): Promise<void> {
    hud.desync = true;
    const { src } = await loadMapSource(this.session.config, mapsBase(), this.session.customMap);
    const ready = await this.session.sim.init(this.session.config, src, this.session.viewer, snapshot);
    this.session.state.init(ready);
    this.renderer.rebuildMap();
    hud.desync = false;
  }

  async saveGame(slot: number): Promise<boolean> {
    return takeSnapshotSave(this.session, slot);
  }

  private async autosave(): Promise<void> {
    if (this.session.ended || this.session.paused) return;
    await takeSnapshotSave(this.session, 0);
  }

  dispose(): void {
    this.disposed = true;
    if (this.autosaveTimer) clearInterval(this.autosaveTimer);
    this.director?.stop();
    this.input?.dispose();
    this.renderer?.destroy();
    this.session?.stop();
    this.lan?.close();
    setSession(null);
    audio.setScene('menu');
    void writeJson;
  }
}
