// Persistent user settings (versioned JSON with migrations).
import { readJson, writeJson } from '../bridge';
import { i18n, type Lang } from '../i18n/i18n.svelte';
import type { ColorVision } from '../../render/colors';

export const SETTINGS_VERSION = 2;

export const DEFAULT_KEYS: Record<string, string> = {
  attackHover: 'KeyG',
  boatHover: 'KeyB',
  ratioDown: 'KeyT',
  ratioUp: 'KeyY',
  buildCity: 'Digit1',
  buildPort: 'Digit2',
  buildFactory: 'Digit3',
  buildDefense: 'Digit4',
  buildSilo: 'Digit5',
  buildSam: 'Digit6',
  warship: 'Digit7',
  nukeA: 'Digit8',
  nukeH: 'Digit9',
  nukeMirv: 'Digit0',
  allyAccept: 'KeyK',
  allyRefuse: 'KeyL',
  selectWarships: 'KeyF',
  terrainView: 'Space',
  fogView: 'KeyV',
  resourcesView: 'KeyR',
  loyaltyView: 'KeyN',
  home: 'KeyH',
  chat: 'Enter',
  pause: 'KeyP',
  general: 'KeyE',
  screenshot: 'F12',
  fps: 'F3',
  panUp: 'KeyW',
  panDown: 'KeyS',
  panLeft: 'KeyA',
  panRight: 'KeyD',
  zoomIn: 'Equal',
  zoomOut: 'Minus',
  buildRadar: 'KeyU',
  buildAirfield: 'KeyI',
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
    uiScale: number;
    fullscreen: boolean;
    autoPerformance: boolean;
  };
  audio: { master: number; music: number; sfx: number; ui: number; muteUnfocused: boolean };
  game: {
    confirmations: boolean;
    simpleMode: boolean;
    fontSize: number;
    wheel: 'zoom' | 'trackpad';
    edgePan: boolean;
    tutorialDone: boolean;
    checkUpdates: boolean;
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
      uiScale: 1,
      fullscreen: false,
      autoPerformance: true,
    },
    audio: { master: 0.8, music: 0.6, sfx: 0.8, ui: 0.6, muteUnfocused: true },
    game: {
      confirmations: true,
      simpleMode: false,
      fontSize: 1,
      wheel: navigator.platform.toLowerCase().includes('mac') ? 'trackpad' : 'zoom',
      edgePan: false,
      tutorialDone: false,
      checkUpdates: false,
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
  root.style.setProperty('--ui-scale', String(settings.graphics.uiScale));
  root.style.setProperty('--font-scale', String(settings.game.fontSize));
  root.classList.toggle('high-contrast', settings.access.highContrast);
  root.classList.toggle('reduced-motion', settings.access.reducedMotion);
  root.lang = settings.lang;
}

export function keyLabel(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = { Space: '␣', Equal: '+', Minus: '−', Enter: '↵', Escape: 'Esc' };
  return map[code] ?? code;
}
