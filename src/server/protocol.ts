// LAN protocol (JSON over WebSocket) shared by the embedded server and clients.
import type { GameConfig } from '../core/game/config';
import type { Command, Turn } from '../core/net/commands';
import type { Snapshot } from '../core/net/snapshot';
import type { PlayerFlag } from '../core/data/flagSpec';

/**
 * Protocol version. 2 (1.26): the hello also carries the game version, and a host only
 * takes players running the very same build (the lockstep simulation must match exactly).
 */
export const NET_VERSION = 2;

export interface LobbyPlayer {
  slot: number;
  name: string;
  ready: boolean;
  connected: boolean;
  spectator: boolean;
  team: number;
  host: boolean;
  playerId: number; // assigned at start (-1 before / spectators)
  ping: number;
  /** Flag chosen in the player's profile (sanitised by the host). */
  flag?: PlayerFlag;
}

export interface LobbyState {
  code: string;
  name: string;
  config: GameConfig;
  players: LobbyPlayer[];
  started: boolean;
  paused: boolean;
}

export type ClientMsg =
  | {
      t: 'hello';
      name: string;
      version: number;
      spectator: boolean;
      code: string;
      token?: string;
      flag?: PlayerFlag;
      /** The client's game version (1.26): it must equal the host's. */
      game?: string;
    }
  | { t: 'ready'; ready: boolean }
  | { t: 'profile'; team: number; flag?: PlayerFlag | null }
  | { t: 'cmd'; c: Command }
  | { t: 'hash'; tick: number; hash: number }
  | { t: 'chat'; channel: 'all' | 'team' | 'allies'; text: string }
  | { t: 'config'; config: GameConfig }
  | { t: 'start' }
  | { t: 'kick'; slot: number }
  | { t: 'pause'; on: boolean }
  | { t: 'ping'; ts: number };

export type ServerMsg =
  | { t: 'welcome'; slot: number; token: string; host: boolean; lobby: LobbyState }
  | { t: 'reject'; reason: RejectReason; /** The host's game version ('game'). */ host?: string }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'start'; config: GameConfig; playerId: number; tick: number; snapshot?: Snapshot }
  | { t: 'turn'; turn: Turn }
  | { t: 'snapshot'; snapshot: Snapshot; reason: 'resync' | 'join' | 'reconnect' }
  | { t: 'chat'; from: number; name: string; channel: string; text: string }
  | { t: 'kicked' }
  | { t: 'pause'; on: boolean }
  | { t: 'pong'; ts: number }
  | { t: 'desync'; tick: number };

export type RejectReason = 'version' | 'game' | 'code' | 'full' | 'started';

export const DISCOVERY_PORTS = [47777, 47778, 47779, 47780, 47781, 47782, 47783, 47784, 47785, 47786];

export interface Beacon {
  isoline: number;
  name: string;
  port: number;
  code: string;
  players: number;
  map: string;
  started: boolean;
  /** The host's game version (1.26; absent from older hosts). */
  game?: string;
}

/** Short invitation codes (no ambiguous characters). */
export function makeCode(rand: () => number): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let k = 0; k < 6; k++) s += A[Math.floor(rand() * A.length)];
  return s;
}
