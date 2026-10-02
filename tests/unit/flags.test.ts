import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  FLAG_EMBLEMS,
  FLAG_LAYOUTS,
  FLAG_PALETTE,
  EMBLEM_POSITIONS,
  LAYOUT_COLORS,
  contrast,
  defaultFlagSpec,
  emblemGround,
  flagKey,
  normalizeColor,
  parseFlag,
  randomFlagSpec,
  sanitizeFlag,
  sanitizeFlagSpec,
  serializeFlag,
  type FlagSpec,
} from '../../src/core/data/flagSpec';
import { emblemBox, emblemMarkup, fieldMarkup, flagSvg, flagSvgUrl } from '../../src/render/flagSvg';
import { Rng } from '../../src/core/rng';
import { LanServer } from '../../src/server/server';
import { NET_VERSION, type ServerMsg } from '../../src/server/protocol';
import { defaultConfig } from '../../src/core/game/config';
import { Game } from '../../src/core/game/state';
import { hashGame } from '../../src/core/net/hash';
import { mapFromDisk } from '../helpers';

const spec = (o: Partial<FlagSpec> = {}): FlagSpec => ({ ...defaultFlagSpec(), ...o });

/** Every tag opened in an SVG string is closed (or self-closed), in order. */
function wellFormed(svg: string): boolean {
  const stack: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, close, tag, , self] = m;
    if (self) continue;
    if (close) {
      if (stack.pop() !== tag) return false;
    } else stack.push(tag!);
  }
  return stack.length === 0;
}

describe('flag spec: validation and serialisation', () => {
  it('normalises colours and rejects anything else', () => {
    expect(normalizeColor('#ABCDEF')).toBe('#abcdef');
    expect(normalizeColor(' #fa0 ')).toBe('#ffaa00');
    expect(normalizeColor('red')).toBeNull();
    expect(normalizeColor('#12345')).toBeNull();
    expect(normalizeColor('#1234567')).toBeNull();
    expect(normalizeColor('url(#x)')).toBeNull();
    expect(normalizeColor(0x123456)).toBeNull();
  });

  it('keeps a valid spec as is and round-trips through text', () => {
    const s = spec({ layout: 'nordic', colors: ['#0055a4', '#ffffff', '#c8102e'], emblem: 'star' });
    expect(sanitizeFlagSpec(s)).toEqual(s);
    const f = { spec: s };
    expect(parseFlag(serializeFlag(f))).toEqual(f);
    expect(parseFlag(serializeFlag({ iso: 'fr' }))).toEqual({ iso: 'fr' });
    expect(serializeFlag(f).length).toBeLessThan(200);
  });

  it('repairs or rejects hostile / broken input', () => {
    expect(sanitizeFlag(null)).toBeUndefined();
    expect(sanitizeFlag('fr')).toBeUndefined();
    expect(sanitizeFlag([])).toBeUndefined();
    expect(sanitizeFlag({})).toBeUndefined();
    expect(sanitizeFlag({ iso: '../../etc/passwd' })).toBeUndefined();
    expect(sanitizeFlag({ iso: 'FR' })).toEqual({ iso: 'fr' });
    expect(sanitizeFlag({ iso: 'gb-sct' })).toEqual({ iso: 'gb-sct' });
    expect(sanitizeFlag({ iso: 'x'.repeat(40) })).toBeUndefined();
    expect(sanitizeFlag({ spec: { layout: 'pirate', colors: ['#000000'] } })).toBeUndefined();
    expect(sanitizeFlag({ spec: { layout: 'plain', colors: [] } })).toBeUndefined();
    const evil = sanitizeFlag({
      spec: {
        layout: 'bandsH3',
        colors: ['#ff0000"/><script>alert(1)</script>', '#00ff00', 7, '#0000ff', '#ffffff'],
        emblem: 'skull',
        emblemColor: 'javascript:1',
        emblemAt: 'everywhere',
        extra: 'x'.repeat(10000),
      },
    });
    expect(evil).toBeDefined();
    const s = (evil as { spec: FlagSpec }).spec;
    expect(s.colors).toHaveLength(3);
    for (const c of [...s.colors, s.emblemColor]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(s.emblem).toBe('none');
    expect(s.emblemAt).toBe('center');
    expect(Object.keys(s).sort()).toEqual(['colors', 'emblem', 'emblemAt', 'emblemColor', 'layout']);
    // A short colour list repeats its last colour.
    expect(sanitizeFlagSpec({ layout: 'bandsH2', colors: ['#111111'] })!.colors).toEqual([
      '#111111',
      '#111111',
      '#111111',
    ]);
    expect(parseFlag('{not json')).toBeNull();
    expect(parseFlag('x'.repeat(500))).toBeNull();
  });

  it('gives a stable key that distinguishes designs', () => {
    const a = flagKey({ spec: spec() });
    expect(flagKey({ spec: spec() })).toBe(a);
    expect(flagKey({ spec: spec({ emblemAt: 'hoist' }) })).not.toBe(a);
    expect(flagKey({ spec: spec({ colors: ['#000000', '#f2ead3', '#0f7b74'] }) })).not.toBe(a);
    expect(flagKey({ iso: 'fr' })).toBe('iso:fr');
  });

  it('random designs are valid, varied and keep the emblem readable', () => {
    const rng = new Rng(7);
    const rand = () => rng.next();
    const layouts = new Set<string>();
    for (let k = 0; k < 300; k++) {
      const s = randomFlagSpec(rand);
      expect(sanitizeFlagSpec(s)).toEqual(s);
      layouts.add(s.layout);
      for (let i = 1; i < LAYOUT_COLORS[s.layout]; i++) expect(s.colors[i]).not.toBe(s.colors[i - 1]);
      if (s.emblem !== 'none') expect(contrast(s.emblemColor, emblemGround(s))).toBeGreaterThanOrEqual(3);
    }
    expect(layouts.size).toBe(FLAG_LAYOUTS.length);
  });

  it('palette colours are valid and contrast helper is sane', () => {
    for (const c of FLAG_PALETTE) expect(normalizeColor(c)).toBe(c);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#c8102e', '#c8102e')).toBe(1);
  });
});

describe('flag rendering (SVG)', () => {
  it('draws every layout × emblem × position as a well-formed 3:2 SVG', () => {
    for (const layout of FLAG_LAYOUTS)
      for (const emblem of FLAG_EMBLEMS)
        for (const emblemAt of EMBLEM_POSITIONS) {
          const svg = flagSvg(spec({ layout, emblem, emblemAt }), 90);
          expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="60"')).toBe(true);
          expect(wellFormed(svg)).toBe(true);
          expect(svg).not.toMatch(/NaN|undefined|Infinity/);
        }
  });

  it('uses exactly the colours the layout needs', () => {
    const colors = ['#111111', '#222222', '#333333'];
    for (const layout of FLAG_LAYOUTS) {
      const m = fieldMarkup(layout, colors);
      const used = colors.filter((c) => m.includes(c)).length;
      expect(used, layout).toBe(LAYOUT_COLORS[layout]);
    }
  });

  it('emblems are drawn in their colour inside the 100-box, and placed on the field', () => {
    for (const e of FLAG_EMBLEMS) {
      const m = emblemMarkup(e, '#abcdef');
      if (e === 'none') expect(m).toBe('');
      else expect(m).toContain('#abcdef');
      for (const n of m.match(/-?\d+(\.\d+)?/g) ?? []) {
        expect(Number(n)).toBeGreaterThanOrEqual(-12);
        expect(Number(n)).toBeLessThanOrEqual(100);
      }
    }
    for (const layout of FLAG_LAYOUTS)
      for (const at of EMBLEM_POSITIONS) {
        const b = emblemBox(layout, at);
        expect(b.cx - b.size / 2).toBeGreaterThanOrEqual(0);
        expect(b.cy - b.size / 2).toBeGreaterThanOrEqual(0);
        expect(b.cx + b.size / 2).toBeLessThanOrEqual(60);
        expect(b.cy + b.size / 2).toBeLessThanOrEqual(40);
      }
  });

  it('never lets unsanitised values into the markup', () => {
    const svg = flagSvg({
      layout: 'plain',
      colors: ['"/><script>x</script>', '#000000', '#000000'],
      emblem: 'star',
      emblemColor: 'red" onload="x',
      emblemAt: 'center',
    } as FlagSpec);
    expect(svg).not.toMatch(/script|onload/);
    expect(flagSvgUrl(spec())).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  });
});

describe('flags in games and over LAN', () => {
  it('a chosen flag is cosmetic: the simulation is identical with or without it', () => {
    const base = {
      ...defaultConfig(5),
      mapId: 'black-sea',
      nations: 4,
      tribes: 4,
      spawnSeconds: 1,
    };
    const plain = new Game(mapFromDisk('black-sea'), base);
    const flagged = new Game(mapFromDisk('black-sea'), {
      ...base,
      players: base.players.map((p) => ({ ...p, flag: { spec: spec() } })),
    });
    for (let k = 0; k < 120; k++) {
      plain.step([]);
      flagged.step([]);
    }
    expect(hashGame(flagged)).toBe(hashGame(plain));
  });

  it('the host sanitises joining players’ flags and puts them in the game config', async () => {
    const server = new LanServer({
      name: 'flags',
      config: { ...defaultConfig(3), mapId: 'black-sea', nations: 2, tribes: 2, players: [] },
      loadMap: async (c) => mapFromDisk(c.mapId),
      tickMs: 50,
      discovery: false,
      port: 0,
    });
    const { port, code } = await server.start();
    const inbox: ServerMsg[] = [];
    const join = (name: string, flag: unknown) =>
      new Promise<WebSocket>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.on('open', () => {
          ws.send(JSON.stringify({ t: 'hello', name, version: NET_VERSION, spectator: false, code, flag }));
          resolve(ws);
        });
        ws.on('message', (raw) => inbox.push(JSON.parse(String(raw)) as ServerMsg));
      });
    const custom = spec({ layout: 'saltire', emblem: 'anchor' });
    const a = await join('Ana', { spec: custom });
    const b = await join('Bo', { iso: 'NO' });
    const c = await join('Cy', { spec: { layout: 'plain', colors: ['"><img>'] }, junk: 1 });
    const lobbyOf = () => server.lobby().players;
    for (let k = 0; k < 200 && lobbyOf().length < 3; k++) await new Promise((r) => setTimeout(r, 10));
    const [pa, pb, pc] = lobbyOf();
    expect(pa!.flag).toEqual({ spec: custom });
    expect(pb!.flag).toEqual({ iso: 'no' });
    expect(pc!.flag!).toEqual({
      spec: {
        ...defaultFlagSpec(),
        layout: 'plain',
        colors: ['#16324a', '#16324a', '#16324a'],
        emblem: 'none',
        emblemColor: '#ffffff',
      },
    });
    // Changing one's flag in the lobby; null clears it.
    c.send(JSON.stringify({ t: 'profile', team: 1, general: 'blitz', flag: null }));
    for (let k = 0; k < 200 && server.lobby().players[2]!.flag; k++)
      await new Promise((r) => setTimeout(r, 10));
    expect(server.lobby().players[2]!.flag).toBeUndefined();
    await server.startGame();
    const slots = server.game!.config.players;
    expect(slots.map((s) => s.flag)).toEqual([{ spec: custom }, { iso: 'no' }, undefined]);
    for (let k = 0; k < 200 && !inbox.some((m) => m.t === 'start'); k++)
      await new Promise((r) => setTimeout(r, 10));
    const start = inbox.find((m) => m.t === 'start');
    expect(start && start.t === 'start' && start.config.players[0]!.flag).toEqual({ spec: custom });
    for (const ws of [a, b, c]) ws.close();
    server.stop();
  });
});
