// Navigation + lobby state. Heavy objects (Session) live outside $state.
import { defaultConfig, type GameConfig } from '../../core/game/config';
import type { Session } from '../../engine/session';
import type { ReplayFile } from '../../engine/replay';
import type { Snapshot } from '../../core/net/snapshot';

export type Screen =
  | 'splash'
  | 'title'
  | 'play'
  | 'lobby'
  | 'lan'
  | 'game'
  | 'editor'
  | 'replays'
  | 'profile'
  | 'settings'
  | 'about'
  | 'campaign'
  | 'load';

export interface LaunchRequest {
  kind: 'solo' | 'lan' | 'replay';
  config: GameConfig;
  viewer: number;
  snapshot?: Snapshot;
  replay?: ReplayFile;
  priorTurns?: ReplayFile['turns'];
  customMap?: string;
  missionId?: string;
  lanUrl?: string;
  /** Replays: start at this tick (fast-forward), the camera on (x, y). */
  replayAt?: { tick: number; x?: number; y?: number };
}

export const app = $state({
  screen: 'splash' as Screen,
  previous: 'title' as Screen,
  lobby: { config: defaultConfig(Date.now() >>> 0), lan: false, host: false },
  launch: null as LaunchRequest | null,
  modal: null as null | {
    title: string;
    body: string;
    actions: { label: string; kind?: string; run: () => void }[];
  },
  version: '0.0.0',
  platform: '',
});

let session: Session | null = null;
export function currentSession(): Session | null {
  return session;
}
export function setSession(s: Session | null): void {
  session = s;
}

export function go(screen: Screen): void {
  app.previous = app.screen;
  app.screen = screen;
}

export function confirmModal(
  title: string,
  body: string,
  onYes: () => void,
  yes = 'OK',
  no = 'Annuler',
): void {
  app.modal = {
    title,
    body,
    actions: [
      { label: no, run: () => (app.modal = null) },
      {
        label: yes,
        kind: 'primary',
        run: () => {
          app.modal = null;
          onYes();
        },
      },
    ],
  };
}
