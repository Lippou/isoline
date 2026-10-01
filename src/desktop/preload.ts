// Preload bridge: exposes a minimal, typed API to the sandboxed renderer.
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  info: () => ipcRenderer.invoke('app:info'),
  smokeReady: () => ipcRenderer.send('app:smoke-ready'),
  quit: () => ipcRenderer.send('app:quit'),
  setFullscreen: (on: boolean) => ipcRenderer.send('app:fullscreen', on),
  screenshot: () => ipcRenderer.invoke('app:screenshot'),
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
  lan: {
    host: (opts: unknown) => ipcRenderer.invoke('lan:host', opts),
    stop: () => ipcRenderer.invoke('lan:stop'),
    discover: () => ipcRenderer.invoke('lan:discover'),
    localAddresses: () => ipcRenderer.invoke('lan:addresses'),
  },
};

contextBridge.exposeInMainWorld('isoline', api);
export type IsolineBridge = typeof api;
