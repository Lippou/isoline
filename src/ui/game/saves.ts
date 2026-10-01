// Solo save slots (0 = autosave, 1..10 manual): snapshot + command log, versioned JSON.
import type { Session } from '../../engine/session';
import type { Snapshot } from '../../core/net/snapshot';
import type { ReplayFile } from '../../engine/replay';
import { bridge, readJson } from '../bridge';

export const SAVE_VERSION = 1;
export const SAVE_SLOTS = 10;

export interface SaveFile {
  format: 'isoline-save';
  version: number;
  date: string;
  slot: number;
  mapName: { fr: string; en: string };
  tick: number;
  viewer: number;
  snapshot: Snapshot;
  turns: ReplayFile['turns'];
  customMap?: string;
}

export interface SaveInfo {
  slot: number;
  date: string;
  mapName: { fr: string; en: string };
  tick: number;
}

export const slotName = (slot: number) => (slot === 0 ? 'autosave.json' : `slot-${slot}.json`);

export async function takeSnapshotSave(session: Session, slot: number): Promise<boolean> {
  if (session.kind !== 'solo') return false;
  const snapshot = await session.snapshot();
  const file: SaveFile = {
    format: 'isoline-save',
    version: SAVE_VERSION,
    date: new Date().toISOString(),
    slot,
    mapName: session.state.meta.name,
    tick: session.state.tick,
    viewer: session.viewer,
    snapshot,
    turns: session.recorder.allTurns,
  };
  if (session.customMap) file.customMap = session.customMap;
  return bridge.storage.write('saves', slotName(slot), JSON.stringify(file));
}

export function migrateSave(raw: SaveFile): SaveFile {
  // v1 is current; future migrations go here.
  return { ...raw, version: SAVE_VERSION };
}

export async function loadSave(slot: number): Promise<SaveFile | null> {
  const raw = await readJson<SaveFile>('saves', slotName(slot));
  if (!raw || raw.format !== 'isoline-save') return null;
  return migrateSave(raw);
}

export async function listSaves(): Promise<SaveInfo[]> {
  const out: SaveInfo[] = [];
  for (let slot = 0; slot <= SAVE_SLOTS; slot++) {
    const s = await readJson<SaveFile>('saves', slotName(slot));
    if (s && s.format === 'isoline-save') out.push({ slot, date: s.date, mapName: s.mapName, tick: s.tick });
  }
  return out;
}

export async function deleteSave(slot: number): Promise<void> {
  await bridge.storage.remove('saves', slotName(slot));
}
