// The 1.5 map packs (arcade, planets, myths & legends): shipped files, layout rules,
// exact symmetry of the arcade boards and reproducible generation.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapFromDisk, makeGame, run, invariants } from '../helpers';
import { decodeTerrainPng } from '../../src/core/map/format';
import { T, TERRAIN_COUNT } from '../../src/core/map/terrain';
import { SPAWN_RADIUS } from '../../src/core/game/constants';
import { PACKS } from '../../scripts/maps/packs';
import { buildWorld } from '../../scripts/maps/worlds';
import { worldCode, minimapPalette } from '../../src/render/worldPalette';

const MAPS_DIR = path.resolve(import.meta.dirname, '../../assets/maps');
const INDEX = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, 'index.json'), 'utf8')) as {
  id: string;
  category: string;
  desc?: { fr: string; en: string };
  nations: number;
}[];

describe('map packs (1.5)', () => {
  it('ships at least ten new maps in the legends, planets and arcade categories', () => {
    expect(PACKS.length).toBeGreaterThanOrEqual(10);
    for (const cat of ['legends', 'planets', 'arcade'])
      expect(PACKS.filter((p) => p.category === cat).length, cat).toBeGreaterThanOrEqual(3);
    for (const p of PACKS) {
      const e = INDEX.find((x) => x.id === p.id);
      expect(e, p.id).toBeDefined();
      expect(e!.category).toBe(p.category);
      expect(e!.desc).toEqual(p.desc);
      expect(p.name.fr.length * p.name.en.length * p.desc.fr.length * p.desc.en.length).toBeGreaterThan(0);
    }
  });

  it('every pack map: 1–2.5 M tiles, ≥ 15 named nations on free land, well spaced', () => {
    for (const p of PACKS) {
      const map = mapFromDisk(p.id);
      expect(map.size, p.id).toBeGreaterThan(1_000_000);
      expect(map.size, p.id).toBeLessThanOrEqual(2_500_000);
      expect(map.meta.category).toBe(p.category);
      expect(map.meta.palette).toBe(p.palette);
      const ns = map.meta.nations;
      expect(ns.length, p.id).toBeGreaterThanOrEqual(15);
      expect(new Set(ns.map((n) => n.name.en)).size, p.id).toBe(ns.length);
      for (const [k, a] of ns.entries()) {
        const t = map.idx(a.x, a.y);
        expect(map.isLand(t), `${p.id}: ${a.name.en}`).toBe(true);
        expect(map.terrain[t], `${p.id}: ${a.name.en}`).not.toBe(T.Mountain);
        expect(map.componentSize[map.component[t]!], `${p.id}: ${a.name.en}`).toBeGreaterThanOrEqual(300);
        for (const b of ns.slice(k + 1))
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * SPAWN_RADIUS);
      }
    }
  });

  it('arcade boards are exactly symmetric', () => {
    for (const p of PACKS.filter((d) => d.symmetry)) {
      const map = mapFromDisk(p.id);
      let off = 0;
      for (let y = 0; y < map.height; y += 3)
        for (let x = 0; x < map.width; x += 3) {
          const [sx, sy] = p.symmetry!(x, y);
          if (map.terrain[map.idx(x, y)] !== map.terrain[map.idx(sx, sy)]) off++;
        }
      expect(off, p.id).toBe(0);
    }
  });

  it('non-Earth palettes reach the shader and the minimap', () => {
    expect(worldCode(undefined)).toBe(0);
    expect(minimapPalette(undefined)).toBeNull();
    for (const p of PACKS.filter((d) => d.palette)) {
      expect(worldCode(p.palette)).toBeGreaterThan(0);
      expect(minimapPalette(p.palette)!.length).toBe(TERRAIN_COUNT);
    }
    expect(PACKS.filter((d) => d.category === 'planets' && d.palette).length).toBeGreaterThanOrEqual(3);
  });

  it('generation is reproducible: rebuilding matches the shipped file', () => {
    for (const id of ['pixel-world', 'checkerboard']) {
      const out = buildWorld(PACKS.find((p) => p.id === id)!);
      const shipped = decodeTerrainPng(
        fs.readFileSync(path.join(MAPS_DIR, `${id}.png`)),
        out.meta.width,
        out.meta.height,
      );
      expect(Buffer.compare(Buffer.from(out.terrain), Buffer.from(shipped)), id).toBe(0);
      const meta = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, `${id}.json`), 'utf8'));
      expect(meta.nations).toEqual(out.meta.nations);
    }
  });

  it('games start, spawn every nation and expand on every pack map', () => {
    for (const p of PACKS) {
      const nations = Math.min(20, mapFromDisk(p.id).meta.nations.length);
      const g = makeGame(p.id, { nations, tribes: 10, players: [] });
      run(g, 400);
      expect(g.phase, p.id).toBe('playing');
      expect([...g.alivePlayers()].filter((q) => q.kind === 'nation').length, p.id).toBe(nations);
      expect(invariants(g), p.id).toEqual([]);
    }
  }, 240_000);
});
