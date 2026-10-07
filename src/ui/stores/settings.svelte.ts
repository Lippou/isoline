// Persistent user settings (versioned JSON with migrations).
import { readJson, writeJson } from '../bridge';
import { i18n, type Lang } from '../i18n/i18n.svelte';
import type { ColorVision } from '../../render/colors';
import { migrateSpacePause } from './keyMigrations';

export const SETTINGS_VERSION = 5;

export const DEFAULT_KEYS: Record<string, string> = {
  attackHover: 'KeyG',
  boatHover: 'KeyB',
  ratioDown: 'KeyT',
  ratioUp: 'KeyY',
  buildCity: 'Digit1',
  buildPort: 'Digit2',
  buildFactory: 'Digit3',
  /** Front lines (1.17): the defensive line took the defence post's key; the offensive one is new. */
  lineDefense: 'Digit4',
  lineOffense: 'KeyQ',
  buildSilo: 'Digit5',
  buildSam: 'Digit6',
  warship: 'Digit7',
  nukeA: 'Digit8',
  nukeH: 'Digit9',
  nukeMirv: 'Digit0',
  allyAccept: 'KeyK',
  allyRefuse: 'KeyL',
  selectWarships: 'KeyF',
  /** Tab (1.14.0): Space pauses now; Tab prints the same on every layout (AZERTY Macs too). */
  terrainView: 'Tab',
  fogView: 'KeyV',
  resourcesView: 'KeyR',
  loyaltyView: 'KeyN',
  tradeRoutes: 'KeyC',
  home: 'KeyH',
  chat: 'Enter',
  /** Solo and replays: Space (1.14.0, before: the terrain view), and P as well (pauseAlt). */
  pause: 'Space',
  pauseAlt: 'KeyP',
  screenshot: 'F12',
  photoMode: 'F2',
  fps: 'F3',
  /** The bug journal (1.23, closed beta). */
  bugReport: 'F9',
  panUp: 'KeyW',
  panDown: 'KeyS',
  panLeft: 'KeyA',
  panRight: 'KeyD',
  zoomIn: 'Equal',
  zoomOut: 'Minus',
  buildRadar: 'KeyO',
  buildAirfield: 'KeyI',
  buildLab: 'KeyJ',
  flipArc: 'KeyU',
  speedDown: 'BracketLeft',
  speedUp: 'BracketRight',
  /** Fold or unfold every panel over the map (folds.svelte.ts). */
  hudFold: 'KeyX',
};

export interface Settings {
  version: number;
  lang: Lang;
  playerName: string;
  graphics: {
    quality: 'performance' | 'balanced' | 'high';
    particles: number;
    shaders: boolean;
    vsync: boolean;
    maxFps: number;
    /** Interface scale (page zoom); 0: automatic, from the window's size (stores/uiScale.ts). */
    uiScale: number;
    fullscreen: boolean;
    autoPerformance: boolean;
  };
  audio: {
    master: number;
    music: number;
    sfx: number;
    ui: number;
    voice: number;
    voiceOn: boolean;
    muteUnfocused: boolean;
  };
  game: {
    confirmations: boolean;
    fontSize: number;
    wheel: 'zoom' | 'trackpad';
    edgePan: boolean;
    /** Check the game's GitHub releases at launch (only once access is configured). */
    autoUpdate: boolean;
    /** Map view: trade lanes between ports and busy railways. */
    tradeRoutes: boolean;
    /** Tech tree: when the research queue runs dry, study the cheapest available technology. */
    autoResearch: boolean;
    /** Map: the reach of our own defences (posts, SAM, radar) always drawn, hatched. */
    defenceZones: boolean;
  };
  keys: Record<string, string>;
  access: { vision: ColorVision; highContrast: boolean; reducedMotion: boolean; subtitles: boolean };
}

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    lang: navigator.language?.startsWith('fr') ? 'fr' : 'en',
    playerName: '',
    graphics: {
      quality: 'high',
      particles: 1,
      shaders: true,
      vsync: true,
      maxFps: 0,
      uiScale: 0,
      fullscreen: false,
      autoPerformance: true,
    },
    audio: { master: 0.8, music: 0.6, sfx: 0.8, ui: 0.6, voice: 0.9, voiceOn: true, muteUnfocused: true },
    game: {
      confirmations: true,
      fontSize: 1,
      wheel: navigator.platform.toLowerCase().includes('mac') ? 'trackpad' : 'zoom',
      edgePan: false,
      autoUpdate: true,
      tradeRoutes: true,
      autoResearch: false,
      defenceZones: true,
    },
    keys: { ...DEFAULT_KEYS },
    access: { vision: 'none', highContrast: false, reducedMotion: false, subtitles: true },
  };
}

/** Upgrade any older settings object to the current schema. */
export function migrateSettings(raw: Partial<Settings> & { version?: number }): Settings {
  const d = defaultSettings();
  const s: Settings = {
    ...d,
    ...raw,
    graphics: { ...d.graphics, ...(raw.graphics ?? {}) },
    audio: { ...d.audio, ...(raw.audio ?? {}) },
    game: { ...d.game, ...(raw.game ?? {}) },
    keys: { ...d.keys, ...(raw.keys ?? {}) },
    access: { ...d.access, ...(raw.access ?? {}) },
    version: SETTINGS_VERSION,
  };
  // v1 → v2: "colorblind: boolean" became access.vision.
  const legacy = raw as unknown as { colorblind?: boolean };
  if ((raw.version ?? 1) < 2 && legacy.colorblind) s.access.vision = 'deuteranopia';
  // v2 → v3: U flips the missile arc (as in OpenFront); the radar tower moves to O.
  if ((raw.version ?? 1) < 3 && s.keys.buildRadar === 'KeyU') {
    s.keys.buildRadar = 'KeyO';
    s.keys.flipArc = 'KeyU';
  }
  // v3 → v4: the interface scale became automatic by default; the former default (100 %)
  // was rarely a choice, so it follows the window now. Another value stays the player's.
  if ((raw.version ?? 1) < 4 && s.graphics.uiScale === 1) s.graphics.uiScale = 0;
  // v4 → v5: Space pauses (the players asked for it); the terrain view moves to Tab. A key
  // the player chose for either stays theirs.
  if ((raw.version ?? 1) < 5) migrateSpacePause(s.keys, raw.keys ?? {});
  // 1.17: the defence post gave way to the defensive line, which keeps the key chosen for it.
  const oldKeys = s.keys as Record<string, string>;
  if (oldKeys.buildDefense !== undefined) {
    if (raw.keys?.buildDefense) oldKeys.lineDefense = raw.keys.buildDefense;
    delete oldKeys.buildDefense;
  }
  // 1.23: the generals are gone, and with them the key of their order.
  delete oldKeys.general;
  // The separate tutorial is gone (the campaign teaches the game): its flag goes too.
  delete (s.game as Partial<Record<string, unknown>>).tutorialDone;
  return s;
}

export const settings = $state<Settings>(defaultSettings());

export async function loadSettings(): Promise<void> {
  const raw = await readJson<Partial<Settings>>('settings', 'settings.json');
  const s = raw ? migrateSettings(raw) : defaultSettings();
  Object.assign(settings, s);
  i18n.lang = settings.lang;
  applyCss();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function saveSettings(): void {
  i18n.lang = settings.lang;
  applyCss();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void writeJson('settings', 'settings.json', $state.snapshot(settings)), 300);
}

export function applyCss(): void {
  const root = document.documentElement;
  root.style.setProperty('--font-scale', String(settings.game.fontSize));
  root.classList.toggle('high-contrast', settings.access.highContrast);
  root.classList.toggle('reduced-motion', settings.access.reducedMotion);
  root.lang = settings.lang;
}

/**
 * What each physical key prints on this keyboard (KeyQ is "a" on AZERTY), from Chromium's
 * keyboard layout map; empty until it answers, or where the API is missing.
 */
const layout = $state<{ map: Map<string, string> }>({ map: new Map() });
const keyboard = (
  navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }
).keyboard;
keyboard
  ?.getLayoutMap?.()
  .then((m) => (layout.map = new Map(m)))
  .catch(() => {});

export function keyLabel(code: string): string {
  if (!code) return '—';
  // Digits print as digits (the AZERTY row's "&", "é"… are their shifted twins).
  if (code.startsWith('Digit')) return code.slice(5);
  const fr = i18n.lang === 'fr';
  const map: Record<string, string> = {
    Space: fr ? 'Espace' : 'Space',
    Tab: fr ? 'Tab ⇥' : 'Tab ⇥',
    Equal: '+',
    Minus: '−',
    Enter: fr ? 'Entrée' : 'Enter',
    Escape: fr ? 'Échap' : 'Esc',
  };
  if (map[code]) return map[code]!;
  const printed = layout.map.get(code);
  if (printed && printed.trim()) return printed.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  const fallback: Record<string, string> = {
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Backquote: '`',
    Backslash: '\\',
    Comma: ',',
    Period: '.',
    Slash: '/',
  };
  return fallback[code] ?? code;
}
