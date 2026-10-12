// Browser version: the Binotech server's rooms (server/online.ts), reached from the page's
// own origin; the portal's session cookie goes with every request.

/** A room as the server lists it. */
export interface RoomInfo {
  code: string;
  name: string;
  host: string;
  players: number;
  spectators: number;
  map: string;
  procedural: boolean;
  mode: string;
  started: boolean;
  spectate: boolean;
  mine: boolean;
  seat: boolean;
}

/** GET (no body) or POST (a JSON body) one of the server's routes; `{ error }` when it fails. */
export async function onlineApi<T>(route: string, body?: unknown): Promise<T | { error: string }> {
  try {
    const r = await fetch(`/online/api/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!j) return { error: r.status === 403 ? 'account' : 'network' };
    if (!r.ok || j.error) return { error: j.error ?? 'network' };
    return j;
  } catch {
    return { error: 'network' };
  }
}

/** The room's WebSocket address on this page's server. */
export function onlineWs(code: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/online/ws?code=${encodeURIComponent(code.trim().toUpperCase())}`;
}

/**
 * This page's build (its entry script, hashed by the build): the server simulates the very
 * same build and turns away a page loaded before an update (the lockstep must match).
 */
export function webBuild(): string {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="index-"]');
  return s?.src.match(/(index-[\w-]+)\.js/)?.[1] ?? 'dev';
}
