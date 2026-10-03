import { describe, expect, it } from 'vitest';
import { makeGame, run } from '../helpers';
import { restoreSnapshot, snapshotFromJson, snapshotToJson, takeSnapshot } from '../../src/core/net/snapshot';
import { takeOverSnapshot } from '../../src/core/net/takeover';
import { hashGame } from '../../src/core/net/hash';
import type { Game } from '../../src/core/game/state';
import { ReplayPlayer, ReplayRecorder } from '../../src/engine/replay';
import type { Turn } from '../../src/core/net/commands';

/** A short game on the Black Sea: one human (spawned by the AI rules at the end of the spawn phase) and nations. */
function game(): Game {
  const g = makeGame('black-sea', {
    nations: 6,
    tribes: 6,
    players: [{ slot: 0, name: 'P1', kind: 'human', team: 0, general: 'blitz' }],
  });
  run(g, 400);
  expect(g.phase).toBe('playing');
  return g;
}

describe('take over from a replay moment', () => {
  it('keeps the seats when the recorded human goes on (the old replay stays valid)', () => {
    const g = game();
    const snap = takeSnapshot(g);
    const t = takeOverSnapshot(snap, 1)!;
    expect(t.changed).toBe(false);
    expect(t.snapshot).toEqual(snap);
  });

  it('hands a nation to the player and the old human seat to the AI', () => {
    const g = game();
    const nation = g.players.find((p) => p && p.kind === 'nation' && p.alive)!;
    const snap = snapshotFromJson(snapshotToJson(takeSnapshot(g)));
    const t = takeOverSnapshot(snap, nation.id)!;
    expect(t.changed).toBe(true);
    const h = restoreSnapshot(g.map, t.snapshot);
    expect(h.tick).toBe(g.tick);
    expect(h.players[nation.id]!.kind).toBe('human');
    expect(h.players[1]!.kind).toBe('nation');
    // The rest of the world is untouched.
    expect(h.owner).toEqual(g.owner);
    expect(h.players[nation.id]!.troops).toBe(nation.troops);
    // The AI now runs the former human seat, and not the country taken over.
    const before = h.ai.mem.get(nation.id)?.nextThink;
    run(h, 300);
    expect(h.ai.mem.has(1)).toBe(true);
    expect(h.ai.mem.get(nation.id)?.nextThink).toBe(before);
    // Deterministic: the same takeover plays out identically.
    const k = restoreSnapshot(g.map, takeOverSnapshot(snap, nation.id)!.snapshot);
    run(k, 300);
    expect(hashGame(k)).toBe(hashGame(h));
  });

  it('refuses fallen countries and tribes', () => {
    const g = game();
    const snap = takeSnapshot(g);
    const tribe = g.players.find((p) => p && p.kind === 'tribe')!;
    expect(takeOverSnapshot(snap, tribe.id)).toBeNull();
    expect(takeOverSnapshot(snap, 999)).toBeNull();
    const raw = snap.players[2] as { alive: boolean };
    raw.alive = false;
    expect(takeOverSnapshot(snap, 2)).toBeNull();
  });

  it('a replay recorded from a taken-over moment starts and rewinds from its snapshot', () => {
    const g = game();
    const nation = g.players.find((p) => p && p.kind === 'nation' && p.alive)!;
    const t = takeOverSnapshot(takeSnapshot(g), nation.id)!;
    // The new game records from the snapshot…
    const rec = new ReplayRecorder();
    rec.start = t.snapshot;
    const h = restoreSnapshot(g.map, t.snapshot);
    for (let k = 0; k < 50; k++) {
      const turn: Turn = { tick: h.tick, cmds: [] };
      rec.record(turn);
      h.step(turn.cmds);
    }
    const file = rec.build(g.config, nation.id, 'test', 'x', 1);
    expect(file.start).toBe(t.snapshot);
    // …and its replay plays on from there, identically.
    const rp = new ReplayPlayer(JSON.parse(JSON.stringify(file)));
    expect(rp.startTick).toBe(g.tick);
    expect(rp.tick).toBe(g.tick);
    const fed: Turn[] = [];
    rp.onTurns = (turns) => fed.push(...turns);
    rp.seekForward(g.tick + 50);
    expect(fed[0]!.tick).toBe(g.tick);
    const k = restoreSnapshot(g.map, JSON.parse(JSON.stringify(file.start)));
    for (const turn of fed) if (turn.tick === k.tick) k.step(turn.cmds);
    expect(hashGame(k)).toBe(hashGame(h));
    rp.reset();
    expect(rp.tick).toBe(g.tick);
  });
});
