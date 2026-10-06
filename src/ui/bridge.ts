// Access to the Electron preload bridge, with a localStorage fallback so the UI
// also runs in a plain browser (dev server, tests).
import type { UpdateStatus } from '../desktop/updater';
export type { UpdateStatus };

const WEB_UPDATE: UpdateStatus = { state: 'idle', current: '', access: 'none', installable: false };
export interface Bridge {
  info(): Promise<{
    version: string;
    platform: string;
    arch: string;
    electron: string;
    smoke: boolean;
    userData: string;
  }>;
  smokeReady(): void;
  quit(): void;
  /** In-app updates from the game's GitHub releases (desktop only). */
  update: {
    status(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    download(): Promise<UpdateStatus>;
    install(): Promise<UpdateStatus>;
    setToken(token: string): Promise<UpdateStatus>;
    clearToken(): Promise<UpdateStatus>;
    onStatus(cb: (s: UpdateStatus) => void): () => void;
  };
  openExternal(url: string): void;
  setFullscreen(on: boolean): void;
  screenshot(): Promise<string | null>;
  /** Page zoom factor (the interface scale): every CSS pixel of the page at once. */
  zoom?: { get(): number; set(factor: number): void };
  storage: {
    read(category: string, name: string): Promise<Uint8Array | null>;
    write(category: string, name: string, data: string | Uint8Array): Promise<boolean>;
    list(category: string): Promise<{ name: string; size: number; mtime: number }[]>;
    remove(category: string, name: string): Promise<boolean>;
    log(line: string): Promise<boolean>;
    exportFile(
      suggested: string,
      data: string | Uint8Array,
      filterName: string,
      ext: string,
    ): Promise<string | null>;
    importFile(filterName: string, exts: string[]): Promise<{ name: string; data: Uint8Array } | null>;
  };
  /** The bug journal (desktop/bugs.ts): reports saved under the app-data folder's bugs/. */
  bug: {
    capture(): Promise<boolean>;
    errors(n: number): Promise<string[]>;
    save(note: string, meta: unknown, save: string): Promise<string | null>;
    list(): Promise<string[]>;
    reveal(): Promise<boolean>;
  };
  lan: {
    host(opts: unknown): Promise<{ port: number; code: string; addresses: string[] } | { error: string }>;
    stop(): Promise<boolean>;
    discover(): Promise<
      {
        name: string;
        host: string;
        port: number;
        code: string;
        players: number;
        map: string;
        started: boolean;
      }[]
    >;
    localAddresses(): Promise<string[]>;
  };
}

declare global {
  interface Window {
    isoline?: Bridge;
  }
}

const LS = 'isoline:';
const enc = new TextEncoder();
const dec = new TextDecoder();

const fallback: Bridge = {
  info: async () => ({
    version: __APP_VERSION__,
    platform: 'web',
    arch: '',
    electron: '',
    smoke: false,
    userData: 'localStorage',
  }),
  smokeReady: () => {},
  quit: () => window.close(),
  update: {
    status: async () => WEB_UPDATE,
    check: async () => WEB_UPDATE,
    download: async () => WEB_UPDATE,
    install: async () => WEB_UPDATE,
    setToken: async () => WEB_UPDATE,
    clearToken: async () => WEB_UPDATE,
    onStatus: () => () => {},
  },
  openExternal: (url) => void window.open(url, '_blank', 'noopener'),
  setFullscreen: (on) => {
    if (on) void document.documentElement.requestFullscreen?.();
    else void document.exitFullscreen?.();
  },
  screenshot: async () => null,
  storage: {
    read: async (c, n) => {
      const v = localStorage.getItem(`${LS}${c}/${n}`);
      return v === null ? null : enc.encode(v);
    },
    write: async (c, n, d) => {
      localStorage.setItem(`${LS}${c}/${n}`, typeof d === 'string' ? d : dec.decode(d));
      return true;
    },
    list: async (c) => {
      const out: { name: string; size: number; mtime: number }[] = [];
      for (let k = 0; k < localStorage.length; k++) {
        const key = localStorage.key(k)!;
        if (key.startsWith(`${LS}${c}/`))
          out.push({
            name: key.slice(LS.length + c.length + 1),
            size: localStorage.getItem(key)!.length,
            mtime: 0,
          });
      }
      return out;
    },
    remove: async (c, n) => {
      localStorage.removeItem(`${LS}${c}/${n}`);
      return true;
    },
    log: async (l) => {
      console.warn(l);
      return true;
    },
    exportFile: async (suggested, data) => {
      const blob = new Blob([typeof data === 'string' ? data : (data.slice() as Uint8Array<ArrayBuffer>)]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = suggested;
      a.click();
      return suggested;
    },
    importFile: async (_f, exts) =>
      new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = exts.map((e) => `.${e}`).join(',');
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) return resolve(null);
          resolve({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
        };
        input.click();
      }),
  },
  bug: {
    capture: async () => false,
    errors: async () => [],
    save: async (note, meta) => {
      console.warn('[bug report]', note, meta);
      return null;
    },
    list: async () => [],
    reveal: async () => false,
  },
  lan: {
    host: async () => ({ error: 'LAN hosting requires the desktop app' }),
    stop: async () => true,
    discover: async () => [],
    localAddresses: async () => [],
  },
};

export const bridge: Bridge = window.isoline ?? fallback;
export const isDesktop = !!window.isoline;

export async function readText(category: string, name: string): Promise<string | null> {
  const d = await bridge.storage.read(category, name);
  return d ? dec.decode(d) : null;
}

export async function readJson<T>(category: string, name: string): Promise<T | null> {
  const t = await readText(category, name);
  if (!t) return null;
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

export function writeJson(category: string, name: string, value: unknown): Promise<boolean> {
  return bridge.storage.write(category, name, JSON.stringify(value));
}

/** Base URL of the shipped maps (custom protocol in the app, dev server otherwise). */
export function mapsBase(): string {
  return location.protocol === 'isoline:' ? 'isoline://maps/' : `${location.origin}/assets/maps/`;
}
