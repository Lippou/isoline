// Glue between a Session, the renderer, the HUD store, audio and persistence.
import { Session, loadMapSource } from '../../engine/session';
import { GameRenderer } from '../../render/renderer';
import { InputController, BUILD_KEYS, NUKE_KEYS } from './input';
import { hud, resetHud, toast, subtitle } from '../stores/game.svelte';
import { settings } from '../stores/settings.svelte';
import { t, i18n } from '../i18n/i18n.svelte';
import { mapsBase, bridge, writeJson } from '../bridge';
import { app, setSession, type LaunchRequest } from '../stores/app.svelte';
import type { GameEvent } from '../../core/game/events';
import { B, N } from '../../core/game/constants';
import { audio } from '../../audio/audio';
import { recordGameEnd } from '../stores/profile.svelte';
import { takeSnapshotSave } from './saves';
import { CampaignDirector } from '../campaign/director';
import { type LanClient, currentLan } from '../../engine/lanClient';

const PLAYER_PARAMS = new Set(['player', 'by', 'from', 'with', 'traitor', 'victim', 'target']);

export class GameController {
  session!: Session;
  renderer!: GameRenderer;
  input!: InputController;
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;
  private hudTimer = 0;
  private director: CampaignDirector | null = null;
  lan: LanClient | null = null;
  private lastIntensity = 0;
  private disposed = false;

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
      ...(this.req.customMap ? { customMap: this.req.customMap } : {}),
      ...(this.lan ? { source: this.lan.source(this.req.viewer) } : {}),
    });
    setSession(this.session);
    this.session.sim.onError = (m) => {
      void bridge.storage.log(`[sim] ${m}`);
      toast(t('error.simulation'), 'danger');
    };
    const ready = await this.session.start(mapsBase());
    if (this.disposed) return;
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
      uiScale: settings.graphics.uiScale,
    });
    await this.renderer.init(host);
    this.input = new InputController(this.renderer.app.canvas, this.renderer, this.session, {
      onAction: (tile) => this.action(tile),
      onRadial: (tile, sx, sy) => (hud.radial = { x: sx, y: sy, tile }),
      onEmoji: (tile, sx, sy) => (hud.radial = { x: sx, y: sy, tile: -tile - 2 }),
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
    hud.loading = false;
    hud.ready = true;
    if (this.req.kind === 'solo' && !this.req.missionId && !this.req.tutorial) {
      this.autosaveTimer = setInterval(() => void this.autosave(), 120_000);
    }
    if (this.req.missionId || this.req.tutorial) {
      this.director = new CampaignDirector(this, this.req.missionId ?? 'tutorial');
      this.director.start();
    }
    if (this.session.replay)
      hud.replay = { tick: 0, end: this.session.replay.file.endTick, speed: 1, paused: false };
    audio.setScene('game');
    console.info(`[isoline] map loaded in ${this.session.loadMs.toFixed(0)} ms`);
    // Automation hooks (screenshots / media): ?speed=&zoom=&x=&y=&perf
    const q = new URLSearchParams(location.search);
    if (q.get('speed')) this.session.source.setSpeed(Number(q.get('speed')));
    if (q.get('zoom')) {
      const x = Number(q.get('x') ?? 0.5) * this.session.state.width;
      const y = Number(q.get('y') ?? 0.5) * this.session.state.height;
      this.renderer.camera.goTo(x, y, Number(q.get('zoom')));
    }
    if (q.has('perf')) hud.showPerf = true;
  }

  // ------------------------------------------------------------- actions
  action(tile: number): void {
    if (this.session.kind === 'replay') return;
    InputController.defaultAction(this.session, tile, hud.attackRatio);
    if (
      hud.tool.k === 'build' ||
      hud.tool.k === 'nuke' ||
      hud.tool.k === 'air' ||
      hud.tool.k === 'warship' ||
      hud.tool.k === 'general' ||
      hud.tool.k === 'ping'
    ) {
      audio.ui('confirm');
      hud.tool = { k: 'none' };
      this.renderer.overlay.ghost = null;
      this.renderer.overlay.nukeTarget = null;
    } else audio.ui('click');
  }

  private key(action: string, e: KeyboardEvent): void {
    const s = this.session;
    const hover = hud.hover?.tile ?? -1;
    if (action === 'escape') {
      if (hud.tool.k !== 'none' || hud.radial || hud.selection.length) {
        hud.tool = { k: 'none' };
        hud.radial = null;
        this.input.setSelection([]);
        this.renderer.overlay.ghost = null;
        this.renderer.overlay.nukeTarget = null;
      } else hud.panels.menu = !hud.panels.menu;
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
      case 'attackHover':
        if (hover >= 0) s.cmd({ t: 'attack', tile: hover, ratio: hud.attackRatio });
        break;
      case 'boatHover':
        if (hover >= 0) s.cmd({ t: 'boat', tile: hover, ratio: hud.attackRatio });
        break;
      case 'warship':
        hud.tool = { k: 'warship' };
        break;
      case 'allyAccept':
      case 'allyRefuse': {
        const req = hud.local?.allyRequests[0];
        if (req !== undefined) s.cmd({ t: 'allyAnswer', target: req, accept: action === 'allyAccept' });
        break;
      }
      case 'terrainView':
        hud.views.terrain = !hud.views.terrain;
        break;
      case 'fogView':
        hud.views.fog = !hud.views.fog;
        break;
      case 'resourcesView':
        hud.views.resources = !hud.views.resources;
        break;
      case 'loyaltyView':
        hud.views.loyalty = !hud.views.loyalty;
        toast(t('hud.loyaltyHint'), 'info');
        break;
      case 'home':
        this.home();
        break;
      case 'chat':
        hud.panels.chat = true;
        break;
      case 'pause':
        if (this.session.kind === 'solo' || this.session.kind === 'replay') this.togglePause();
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

  togglePause(): void {
    this.session.setPaused(!this.session.paused);
    hud.paused = this.session.paused;
  }

  home(): void {
    const me = this.session.state.players.get(this.session.viewer);
    if (me && me.tiles > 0)
      this.renderer.camera.goTo(me.label[0], me.label[1], Math.max(this.renderer.camera.zoom, 2.5));
  }

  async screenshot(): Promise<void> {
    const file = await bridge.screenshot();
    toast(file ? t('hud.screenshotSaved', { file }) : t('hud.screenshotFailed'), file ? 'good' : 'warn');
  }

  // ---------------------------------------------------------------- ticks
  private onTick(tick: number, events: GameEvent[]): void {
    const st = this.session.state;
    this.renderer.onEvents(events);
    for (const e of events) this.event(e);
    this.director?.tick(tick, events);
    // HUD refresh (reactive store) — local every tick, the rest when provided.
    hud.tick = tick;
    hud.phase = st.phase;
    hud.local = st.local;
    if (st.world) hud.world = st.world;
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
    if (st.phase === 'ended' && !hud.end) void this.finish();
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

  private frame(dt: number): void {
    this.hudTimer += dt;
    if (this.hudTimer > 0.25) {
      this.hudTimer = 0;
      hud.fps = Math.round(this.renderer.fps);
    }
    // Tool previews + layer toggles.
    const ov = this.renderer.overlay;
    ov.terrainView = hud.views.terrain;
    ov.fogView = hud.views.fog;
    ov.resourcesView = hud.views.resources;
    ov.loyaltyView = hud.views.loyalty;
    const tool = hud.tool;
    const hover = hud.hover?.tile ?? -1;
    ov.ghost = null;
    ov.nukeTarget = null;
    ov.ranges = [];
    if (hover >= 0 && tool.k === 'build') {
      const s = this.session.state;
      const ok =
        s.owner[hover] === this.session.viewer &&
        (hud.local?.gold ?? 0) >= (hud.local?.buildCosts[tool.kind] ?? Infinity);
      ov.ghost = { kind: tool.kind, tile: hover, ok };
    } else if (hover >= 0 && tool.k === 'nuke') {
      ov.nukeTarget = { tile: hover, kind: tool.kind };
    }
    if (
      hud.hover?.building &&
      (hud.hover.building.type === B.Sam ||
        hud.hover.building.type === B.DefensePost ||
        hud.hover.building.type === B.Radar)
    ) {
      const b = hud.hover.building;
      const r = b.type === B.Sam ? 150 - 480 / (b.level + 5) : b.type === B.DefensePost ? 30 : 60;
      ov.ranges.push({
        x: hud.hover.x + 0.5,
        y: hud.hover.y + 0.5,
        r,
        color: b.type === B.Sam ? 0x4fe3c1 : 0xf2b84b,
      });
    }
    ov.highlightPlayer =
      hud.hover && hud.hover.owner > 0 && this.renderer.camera.zoom < 6 ? hud.hover.owner : -1;
    // Expire nuke alerts.
    if (hud.nukeAlerts.length && hud.nukeAlerts.some((a) => a.impact <= hud.tick))
      hud.nukeAlerts = hud.nukeAlerts.filter((a) => a.impact > hud.tick);
  }

  private fmt(e: Extract<GameEvent, { k: 'notify' }>): string {
    const params: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(e.params ?? {})) {
      if (PLAYER_PARAMS.has(k) && typeof v === 'number') params[k] = this.session.state.name(v, i18n.lang);
      else if (k === 'tech' && typeof v === 'string') params[k] = t(v);
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
        const text = this.fmt(e);
        hud.log = [
          ...hud.log.slice(-199),
          { tick: hud.tick, text, level: e.level, ...(e.tile !== undefined ? { tile: e.tile } : {}) },
        ];
        if (
          e.to === me ||
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
      case 'nukeLaunch':
        audio.sfx('launch', 0.7);
        if (e.threatened.includes(me)) {
          hud.nukeAlerts = [
            ...hud.nukeAlerts,
            { id: e.id, by: e.owner, kind: e.kind, impact: e.impact, tx: e.tx, ty: e.ty },
          ];
          audio.sfx('siren', 1);
          if (settings.access.subtitles) subtitle(t('subtitle.siren'));
        }
        break;
      case 'explosion':
        if (e.kind <= 3) {
          audio.sfx(
            e.kind === N.Hydrogen ? 'explosionH' : e.kind === N.MirvWarhead ? 'explosionMirv' : 'explosionA',
            1,
          );
          if (settings.access.subtitles) subtitle(t('subtitle.explosion'));
        } else audio.sfx('blast', 0.5);
        break;
      case 'intercept':
        audio.sfx('intercept', 0.8);
        break;
      case 'shipSunk':
        audio.sfx('sunk', 0.6);
        break;
      case 'built':
        if (e.owner === me) audio.sfx('build', 0.6);
        break;
      case 'alliance':
        if (e.a === me || e.b === me) audio.sfx(e.on ? 'alliance' : 'betrayal', 0.8);
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
        audio.sfx('betrayal', 0.8);
        if (settings.access.subtitles) subtitle(t('subtitle.betrayal'));
        break;
      case 'worldEvent':
        audio.sfx('event', 0.9);
        break;
      case 'council':
        hud.councilOpen = e.phase === 'open';
        break;
      case 'trainPay':
        if (e.owner === me) audio.sfx('train', 0.25);
        break;
      case 'quick':
        if (e.to === me || e.to === -1)
          hud.chat = [
            ...hud.chat.slice(-99),
            { from: e.from, text: t(`quick.${e.msg}`), channel: 'all', t: hud.tick },
          ];
        break;
      case 'eliminated':
        if (e.player === me) {
          toast(t('notify.youDied'), 'danger');
          audio.sfx('defeat', 0.9);
        }
        break;
      case 'gameOver':
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
      await recordGameEnd(stats, me, won, this.session.config, this.req.missionId);
    }
    hud.end = { stats, won, replaySaved };
    audio.setScene(won ? 'victory' : 'defeat');
  }

  /** Replay rewind: re-simulate from tick 0 up to `target`. */
  async restartReplayAt(target: number): Promise<void> {
    const rp = this.session.replay;
    if (!rp) return;
    const wasPaused = rp.paused;
    rp.setPaused(true);
    const { src } = await loadMapSource(this.session.config, mapsBase(), this.session.customMap);
    const ready = await this.session.sim.init(this.session.config, src, this.session.viewer);
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
