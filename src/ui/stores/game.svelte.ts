// Reactive HUD state, refreshed from simulation updates (≤ 10 Hz).
import type { LocalView, PlayerView, WorldView, FinalStats } from '../../engine/protocol';
import type { EliminationCause } from '../../core/game/events';
import { focusWindow } from './windows.svelte';
import type { MissionResult } from '../game/missionResult';

/** The pages of the final edition: the front page, the mission communiqué, the results. */
export type PaperPage = 'front' | 'mission' | 'results';

export interface GameEnd {
  stats: FinalStats;
  won: boolean;
  replaySaved: boolean;
  /** Achievements this game unlocked (ids). */
  awards?: string[];
  /** Score entered in the profile's leaderboard (solo and LAN games). */
  score?: number;
  /** Campaign: the mission's result (the paper opens on its communiqué). */
  mission?: MissionResult;
}

export type Tool =
  | { k: 'none' }
  | { k: 'build'; kind: number }
  | { k: 'nuke'; kind: number; count: number }
  | { k: 'warship' }
  | { k: 'air'; kind: number }
  | { k: 'general' }
  | { k: 'ping' }
  | { k: 'shipMove' }
  /** Choosing the tile of a new capital (rules/capital.ts). */
  | { k: 'capital' };

export interface Toast {
  id: number;
  text: string;
  level: 'info' | 'good' | 'warn' | 'danger';
  tile?: number;
  t: number;
}

export interface LogEntry {
  tick: number;
  text: string;
  level: Toast['level'];
  tile?: number;
  /** The notification it reports (i18n key) and its raw parameters (player ids…): the news. */
  key?: string;
  params?: Record<string, string | number>;
}

/** A country has fallen: the special edition of the news. */
export interface Fall {
  id: number;
  player: number;
  /** Conqueror or author of the fatal blast (0: nobody, unknown). */
  by: number;
  cause: EliminationCause;
  /** Game time of the fall (ticks since the start) and how many nations have fallen so far. */
  at: number;
  nth: number;
}

export interface NukeAlert {
  id: number;
  by: number;
  kind: number;
  impact: number;
  tx: number;
  ty: number;
  /** Launch site (the silo), for NukeSender.svelte's marker on the screen's edge. */
  sx: number;
  sy: number;
}

export const hud = $state({
  ready: false,
  loading: true,
  loadingText: '',
  tick: 0,
  phase: 'spawn' as 'spawn' | 'playing' | 'ended',
  viewer: 0,
  local: null as LocalView | null,
  players: [] as PlayerView[],
  world: null as WorldView | null,
  paused: false,
  /** Game speed multiplier (solo): 0.5, 1, 2 or 4. */
  speed: 1,
  fps: 0,
  tickMs: 0,
  showPerf: false,
  attackRatio: 0.2,
  tool: { k: 'none' } as Tool,
  /** Missile arc: bowed towards the top of the map (default) or the bottom — flipped with U. */
  nukeArcUp: true,
  /** Build-bar button under the pointer ('b<type>', 'n<kind>', 'ws', 'a<kind>'): filters the map. */
  barHover: null as string | null,
  /**
   * An alliance was just signed (or renewed) with this country: the pact banner. With
   * `refused`, our offer was turned down instead (`silent`: left unanswered); with
   * `betrayed`, that ally just broke our pact.
   */
  pact: null as null | {
    id: number;
    with: number;
    renewed: boolean;
    refused?: boolean;
    silent?: boolean;
    betrayed?: boolean;
  },
  /** Launch panel: what a missile fired at the hovered tile would do. */
  launch: null as null | {
    silo: 'ready' | 'reloading' | 'none';
    intercepted: boolean;
    betrays: number[];
    victim: number;
    teammate: boolean;
  },
  toasts: [] as Toast[],
  log: [] as LogEntry[],
  nukeAlerts: [] as NukeAlert[],
  /**
   * Last wave of troops sent at us (InvasionFlash.svelte): `n` restarts the flash; `ex`, `ey`
   * place the glow on the screen edge facing the attack (fractions of the screen).
   */
  invasion: null as null | { n: number; ex: number; ey: number; strength: number },
  panels: {
    diplomacy: false,
    tech: false,
    stats: false,
    log: false,
    trade: false,
    chat: false,
    menu: false,
    help: false,
  },
  /** Technology shown when the tech panel opens (a locked tool was clicked), -1 none. */
  techFocus: -1,
  /** Special edition on screen: a fallen country, and those that fell while it was shown. */
  breaking: null as null | { fall: Fall; more: Fall[]; t: number },
  /** Last time the journal was read (tick): newer news light its dock button. */
  journalSeen: 0,
  radial: null as null | { x: number; y: number; tile: number },
  hover: null as null | {
    tile: number;
    owner: number;
    terrain: number;
    x: number;
    y: number;
    sx: number;
    sy: number;
    /** `upgrade`: next level under construction, 0..1 (−1: none). */
    building: { type: number; level: number; owner: number; upgrade: number } | null;
    fallout: number;
    resource: number;
    /** Owner of the capital marker under the pointer (0: none). */
    capital: number;
  },
  selection: [] as number[],
  chat: [] as { from: number; text: string; channel: string; t: number }[],
  end: null as null | GameEnd,
  /**
   * The final edition of the Courier is open (the end-of-game paper: front page, mission
   * communiqué, results). Folded at the end of a game, the map is watched and a button
   * opens it again.
   */
  paper: false,
  /** The page of the paper on show (falls back to the first page the paper has). */
  paperPage: 'front' as PaperPage,
  /** We fell while the game goes on (LAN): the dispatch that says so, until dismissed. */
  fallen: null as null | { tick: number; by: number; cause: EliminationCause },
  /** Replay: tick being fast-forwarded to (-1: none). */
  replaySeek: -1,
  /** Replay: the « Reprendre d'ici » chooser is open (which country to play from this moment). */
  takeover: false,
  /** Photo mode: the HUD is hidden, a small bar sets up the shot (see PhotoBar.svelte). */
  photo: false,
  spectating: false,
  councilOpen: false,
  subtitles: [] as { id: number; text: string; t: number }[],
  replay: null as null | { tick: number; end: number; speed: number; paused: boolean },
  objectives: [] as {
    text: string;
    done: boolean;
    bonus: boolean;
    progress?: { value: number; max: number; format: 'pct' | 'count' | 'gold' | 'time' };
  }[],
  /**
   * Campaign: the current guide step (stays until accomplished), or a one-off hint;
   * `need`: the gold the step asks for is not there yet (cost, gold held, seconds to wait).
   */
  guide: null as null | {
    index: number;
    total: number;
    text: string;
    speaker: string;
    hint?: boolean;
    need?: { cost: number; gold: number; eta: number };
  },
  /** Mission briefing shown before the game starts (the game waits). */
  briefing: null as null | {
    title: string;
    text: string;
    objectives: string[];
    bonus: string;
    tips: string[];
  },
  desync: false,
  lan: null as null | { ping: number; players: { name: string; connected: boolean }[]; code: string },
  views: { terrain: false, fog: true, resources: false, loyalty: false },
  betrayals: [] as { tick: number; traitor: number; victim: number }[],
  history: [] as { tick: number; tiles: number; gold: number; troops: number }[],
  mutedPlayers: [] as number[],
});

/** Open the final edition (on `page` if given, else where the reader left it). */
export function openPaper(page?: PaperPage): void {
  if (page) hud.paperPage = page;
  hud.paper = true;
}

let toastId = 1;
export function toast(text: string, level: Toast['level'] = 'info', tile?: number): void {
  const t: Toast = { id: toastId++, text, level, t: performance.now() };
  if (tile !== undefined) t.tile = tile;
  hud.toasts = [...hud.toasts.slice(-4), t];
  setTimeout(() => (hud.toasts = hud.toasts.filter((x) => x.id !== t.id)), level === 'danger' ? 7000 : 4500);
}

export function subtitle(text: string): void {
  const s = { id: toastId++, text, t: performance.now() };
  hud.subtitles = [...hud.subtitles.slice(-2), s];
  setTimeout(() => (hud.subtitles = hud.subtitles.filter((x) => x.id !== s.id)), 3500);
}

export function resetHud(): void {
  hud.ready = false;
  hud.loading = true;
  hud.tick = 0;
  hud.phase = 'spawn';
  hud.local = null;
  hud.players = [];
  hud.world = null;
  hud.paused = false;
  hud.speed = 1;
  hud.tool = { k: 'none' };
  hud.nukeArcUp = true;
  hud.barHover = null;
  hud.pact = null;
  pactQueue.length = 0;
  hud.launch = null;
  hud.toasts = [];
  hud.log = [];
  hud.breaking = null;
  hud.journalSeen = 0;
  hud.nukeAlerts = [];
  hud.invasion = null;
  hud.radial = null;
  hud.hover = null;
  hud.selection = [];
  hud.chat = [];
  hud.end = null;
  hud.paper = false;
  hud.paperPage = 'front';
  hud.fallen = null;
  hud.replaySeek = -1;
  hud.takeover = false;
  hud.photo = false;
  hud.spectating = false;
  hud.replay = null;
  hud.objectives = [];
  hud.guide = null;
  hud.briefing = null;
  hud.desync = false;
  hud.lan = null;
  hud.views = { terrain: false, fog: true, resources: false, loyalty: false };
  hud.betrayals = [];
  hud.history = [];
  hud.mutedPlayers = [];
  for (const k of Object.keys(hud.panels) as (keyof typeof hud.panels)[]) hud.panels[k] = false;
}

type Pact = NonNullable<typeof hud.pact>;
/** Banners waiting for the one on screen (several answers can land in the same second). */
const pactQueue: Pact[] = [];
let pactSeq = 0;

/** Shows a pact banner (signed, renewed, refused or betrayed) now, or after the ones already queued. */
export function showPact(p: Omit<Pact, 'id'>): void {
  const next = { ...p, id: ++pactSeq };
  if (!hud.pact) hud.pact = next;
  else {
    pactQueue.push(next);
    if (pactQueue.length > 3) pactQueue.shift();
  }
}

/** The banner on screen is done: the next one in line, if any. */
export function nextPact(): void {
  hud.pact = pactQueue.shift() ?? null;
}

/** Opens a HUD window (the others stay open) and brings it to the front. */
export function openPanel(id: 'diplomacy' | 'tech' | 'stats' | 'log' | 'trade' | 'chat'): void {
  if (hud.panels[id]) focusWindow(id);
  else hud.panels[id] = true;
}

/**
 * A country fell: it makes the special edition, or joins the one on screen as a
 * stop-press line (one clipping at a time).
 */
export function reportFall(f: Fall): void {
  if (hud.breaking) hud.breaking = { ...hud.breaking, more: [...hud.breaking.more, f] };
  else hud.breaking = { fall: f, more: [], t: performance.now() };
}
