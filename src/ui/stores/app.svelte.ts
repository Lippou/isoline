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
  /** State the recorded turns start from (a game taken over from a replay moment). */
  replayStart?: Snapshot;
  customMap?: string;
  missionId?: string;
  lanUrl?: string;
  /** Replays: start at this tick (fast-forward), the camera on (x, y). */
  replayAt?: { tick: number; x?: number; y?: number; takeover?: boolean };
  /** Where leaving the game goes instead of the title page (a play-test from the editor). */
  returnTo?: Screen;
}

export const app = $state({
  screen: 'splash' as Screen,
  previous: 'title' as Screen,
  /**
   * `randomMap`: the map is drawn among the shipped ones when the game starts.
   * `nationsAuto`: the nation count follows each map's default until the player moves it.
   */
  lobby: {
    config: defaultConfig(Date.now() >>> 0),
    lan: false,
    host: false,
    randomMap: false,
    nationsAuto: true,
  },
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
  // A game launched from the editor (a play-test) hands back to the editor, not the title.
  if (screen === 'title' && app.screen === 'game' && app.launch?.returnTo) screen = app.launch.returnTo;
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
