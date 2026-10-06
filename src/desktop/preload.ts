// Preload bridge: exposes a minimal, typed API to the sandboxed renderer.
import { contextBridge, ipcRenderer, webFrame } from 'electron';

const api = {
  info: () => ipcRenderer.invoke('app:info'),
  smokeReady: () => ipcRenderer.send('app:smoke-ready'),
  quit: () => ipcRenderer.send('app:quit'),
  update: {
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    setToken: (token: string) => ipcRenderer.invoke('update:setToken', token),
    clearToken: () => ipcRenderer.invoke('update:clearToken'),
    onStatus: (cb: (s: unknown) => void) => {
      const h = (_e: unknown, s: unknown) => cb(s);
      ipcRenderer.on('update:status', h);
      return () => ipcRenderer.removeListener('update:status', h);
    },
  },
  openExternal: (url: string) => ipcRenderer.send('app:openExternal', url),
  setFullscreen: (on: boolean) => ipcRenderer.send('app:fullscreen', on),
  screenshot: () => ipcRenderer.invoke('app:screenshot'),
  /** Page zoom: the interface scale (stores/viewport.svelte.ts), the whole page at once. */
  zoom: {
    get: (): number => webFrame.getZoomFactor(),
    set: (factor: number) => webFrame.setZoomFactor(factor),
  },
  storage: {
    read: (category: string, name: string) => ipcRenderer.invoke('storage:read', category, name),
    write: (category: string, name: string, data: string | Uint8Array) =>
      ipcRenderer.invoke('storage:write', category, name, data),
    list: (category: string) => ipcRenderer.invoke('storage:list', category),
    remove: (category: string, name: string) => ipcRenderer.invoke('storage:delete', category, name),
    log: (line: string) => ipcRenderer.invoke('storage:log', line),
    exportFile: (suggested: string, data: string | Uint8Array, filterName: string, ext: string) =>
      ipcRenderer.invoke('storage:exportFile', suggested, data, filterName, ext),
    importFile: (filterName: string, exts: string[]) =>
      ipcRenderer.invoke('storage:importFile', filterName, exts),
  },
  bug: {
    capture: () => ipcRenderer.invoke('bug:capture'),
    errors: (n: number) => ipcRenderer.invoke('bug:errors', n),
    save: (note: string, meta: unknown, save: string) => ipcRenderer.invoke('bug:save', note, meta, save),
    list: () => ipcRenderer.invoke('bug:list'),
    reveal: () => ipcRenderer.invoke('bug:reveal'),
  },
  lan: {
    host: (opts: unknown) => ipcRenderer.invoke('lan:host', opts),
    stop: () => ipcRenderer.invoke('lan:stop'),
    discover: () => ipcRenderer.invoke('lan:discover'),
    localAddresses: () => ipcRenderer.invoke('lan:addresses'),
  },
};

contextBridge.exposeInMainWorld('isoline', api);
export type IsolineBridge = typeof api;
