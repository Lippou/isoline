// Reactive HUD state, refreshed from simulation updates (≤ 10 Hz).
import type { LocalView, PlayerView, WorldView, FinalStats } from '../../engine/protocol';

export type Tool =
  | { k: 'none' }
  | { k: 'build'; kind: number }
  | { k: 'nuke'; kind: number; count: number }
  | { k: 'warship' }
  | { k: 'air'; kind: number }
  | { k: 'general' }
  | { k: 'ping' }
  | { k: 'shipMove' };

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
}

export interface NukeAlert {
  id: number;
  by: number;
  kind: number;
  impact: number;
  tx: number;
  ty: number;
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
  fps: 0,
  tickMs: 0,
  showPerf: false,
  attackRatio: 0.2,
  tool: { k: 'none' } as Tool,
  toasts: [] as Toast[],
  log: [] as LogEntry[],
  nukeAlerts: [] as NukeAlert[],
  panels: { diplomacy: false, tech: false, stats: false, log: false, chat: false, menu: false, help: false },
  radial: null as null | { x: number; y: number; tile: number },
  hover: null as null | {
    tile: number;
    owner: number;
    terrain: number;
    x: number;
    y: number;
    sx: number;
    sy: number;
    building: { type: number; level: number; owner: number } | null;
    fallout: number;
    resource: number;
  },
  selection: [] as number[],
  chat: [] as { from: number; text: string; channel: string; t: number }[],
  end: null as null | { stats: FinalStats; won: boolean; replaySaved: boolean },
  spectating: false,
  councilOpen: false,
  subtitles: [] as { id: number; text: string; t: number }[],
  replay: null as null | { tick: number; end: number; speed: number; paused: boolean },
  objectives: [] as { text: string; done: boolean }[],
  dialogue: null as null | { speaker: string; text: string },
  desync: false,
  lan: null as null | { ping: number; players: { name: string; connected: boolean }[]; code: string },
  views: { terrain: false, fog: true, resources: false, loyalty: false },
  betrayals: [] as { tick: number; traitor: number; victim: number }[],
  history: [] as { tick: number; tiles: number; gold: number; troops: number }[],
  mutedPlayers: [] as number[],
});

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
  hud.tool = { k: 'none' };
  hud.toasts = [];
  hud.log = [];
  hud.nukeAlerts = [];
  hud.radial = null;
  hud.hover = null;
  hud.selection = [];
  hud.chat = [];
  hud.end = null;
  hud.spectating = false;
  hud.replay = null;
  hud.objectives = [];
  hud.dialogue = null;
  hud.desync = false;
  hud.lan = null;
  hud.views = { terrain: false, fog: true, resources: false, loyalty: false };
  hud.betrayals = [];
  hud.history = [];
  hud.mutedPlayers = [];
  for (const k of Object.keys(hud.panels) as (keyof typeof hud.panels)[]) hud.panels[k] = false;
}
