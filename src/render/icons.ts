// Cartographic-legend glyphs for buildings and units, generated as textures.
import { Graphics, type Renderer, type Texture } from 'pixi.js';
import { B } from '../core/game/constants';

const S = 32; // design size
const LINE = 2.6;

function glyph(kind: B, g: Graphics): void {
  const c = S / 2;
  const white = 0xffffff;
  switch (kind) {
    case B.City: // walled town: circle + inner rhombus
      g.circle(c, c, 11).stroke({ width: LINE, color: white });
      g.poly([c, c - 6, c + 5, c, c, c + 6, c - 5, c]).fill({ color: white });
      break;
    case B.Port: // anchor
      g.moveTo(c, c - 10)
        .lineTo(c, c + 10)
        .stroke({ width: LINE, color: white });
      g.moveTo(c - 6, c - 5)
        .lineTo(c + 6, c - 5)
        .stroke({ width: LINE, color: white });
      g.circle(c, c - 11, 2.4).stroke({ width: 2, color: white });
      g.arc(c, c + 1, 9, 0.2, Math.PI - 0.2).stroke({ width: LINE, color: white });
      break;
    case B.Factory: // saw-tooth roof + chimney
      g.poly([
        c - 11,
        c + 9,
        c - 11,
        c - 1,
        c - 5,
        c - 6,
        c - 5,
        c - 1,
        c + 1,
        c - 6,
        c + 1,
        c - 1,
        c + 11,
        c - 1,
        c + 11,
        c + 9,
      ]).stroke({
        width: LINE,
        color: white,
        join: 'round',
      });
      g.rect(c + 5, c - 11, 4, 10).fill({ color: white });
      break;
    case B.DefensePost: // shield
      g.poly([c - 9, c - 9, c + 9, c - 9, c + 9, c + 1, c, c + 11, c - 9, c + 1]).stroke({
        width: LINE,
        color: white,
        join: 'round',
      });
      g.moveTo(c, c - 5)
        .lineTo(c, c + 5)
        .stroke({ width: LINE, color: white });
      break;
    case B.Silo: // trefoil-ish: triangle in circle
      g.circle(c, c, 11).stroke({ width: LINE, color: white });
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
        g.moveTo(c, c)
          .arc(c, c, 8, a - 0.45, a + 0.45)
          .lineTo(c, c)
          .fill({ color: white });
      }
      g.circle(c, c, 2).fill({ color: 0x000000 });
      break;
    case B.Sam: // upward chevrons
      g.moveTo(c - 10, c + 4)
        .lineTo(c, c - 6)
        .lineTo(c + 10, c + 4)
        .stroke({ width: LINE + 0.4, color: white, join: 'round' });
      g.moveTo(c - 10, c + 11)
        .lineTo(c, c + 1)
        .lineTo(c + 10, c + 11)
        .stroke({ width: LINE, color: white, join: 'round' });
      break;
    case B.Radar: // dish arcs
      g.circle(c - 6, c + 6, 2.6).fill({ color: white });
      for (const r of [7, 12, 17]) g.arc(c - 6, c + 6, r, -Math.PI / 2, 0).stroke({ width: 2, color: white });
      break;
    case B.Airfield: // runway cross
      g.rect(c - 2.5, c - 12, 5, 24).fill({ color: white });
      g.rect(c - 11, c - 2.5, 22, 5).fill({ color: white });
      g.poly([c, c - 8, c + 4, c - 2, c - 4, c - 2]).fill({ color: 0x000000 });
      break;
  }
}

export interface IconSet {
  buildings: Texture[];
  backdrop: Texture;
  ring: Texture;
  ship: Texture;
  warship: Texture;
  merchant: Texture;
  train: Texture;
  plane: Texture;
  dot: Texture;
  glow: Texture;
  spark: Texture;
  smoke: Texture;
  deposit: Texture[];
}

function gen(renderer: Renderer, draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  draw(g);
  const t = renderer.generateTexture({ target: g, resolution: 3, antialias: true });
  g.destroy();
  return t;
}

export function buildIcons(renderer: Renderer): IconSet {
  const buildings: Texture[] = [];
  for (let k = 0; k < 8; k++) {
    buildings.push(
      gen(renderer, (g) => {
        g.rect(0, 0, S, S).fill({ color: 0x000000, alpha: 0 });
        glyph(k as B, g);
      }),
    );
  }
  const soft = (r: number, steps = 10) =>
    gen(renderer, (g) => {
      for (let k = steps; k >= 1; k--) g.circle(r, r, (r * k) / steps).fill({ color: 0xffffff, alpha: 0.11 });
    });
  return {
    buildings,
    backdrop: gen(renderer, (g) =>
      g
        .circle(S / 2, S / 2, 15)
        .fill({ color: 0x0b1220, alpha: 0.82 })
        .stroke({ width: 2, color: 0xffffff, alpha: 0.9 }),
    ),
    ring: gen(renderer, (g) => g.circle(64, 64, 62).stroke({ width: 3, color: 0xffffff })),
    ship: gen(renderer, (g) => {
      g.poly([0, 4, 14, 0, 22, 5, 14, 10, 0, 6]).fill({ color: 0xffffff });
      g.rect(5, 3, 6, 4).fill({ color: 0x0b1220, alpha: 0.6 });
    }),
    warship: gen(renderer, (g) => {
      g.poly([0, 5, 6, 1, 26, 1, 32, 5, 26, 9, 6, 9]).fill({ color: 0xffffff });
      g.circle(12, 5, 2.6).fill({ color: 0x0b1220, alpha: 0.7 });
      g.circle(21, 5, 2.6).fill({ color: 0x0b1220, alpha: 0.7 });
      g.rect(12, 4, 9, 2).fill({ color: 0x0b1220, alpha: 0.7 });
    }),
    merchant: gen(renderer, (g) => {
      g.roundRect(0, 0, 22, 10, 5).fill({ color: 0xffffff });
      g.rect(6, 2, 4, 6).fill({ color: 0xf2b84b });
      g.rect(12, 2, 4, 6).fill({ color: 0xf2b84b });
    }),
    train: gen(renderer, (g) => {
      g.roundRect(0, 0, 18, 7, 2).fill({ color: 0xffffff });
      g.rect(13, 1.5, 3, 4).fill({ color: 0x0b1220, alpha: 0.6 });
    }),
    plane: gen(renderer, (g) => {
      g.poly([20, 6, 2, 0, 6, 6, 2, 12]).fill({ color: 0xffffff });
    }),
    dot: gen(renderer, (g) => g.circle(8, 8, 8).fill({ color: 0xffffff })),
    glow: soft(64, 14),
    spark: gen(renderer, (g) => {
      g.circle(6, 6, 6).fill({ color: 0xffffff, alpha: 0.35 });
      g.circle(6, 6, 2.5).fill({ color: 0xffffff });
    }),
    smoke: soft(32, 8),
    deposit: [0, 1, 2, 3, 4].map((k) =>
      gen(renderer, (g) => {
        g.circle(12, 12, 10)
          .fill({ color: 0x0b1220, alpha: 0.8 })
          .stroke({ width: 2, color: [0, 0x111111, 0x9be564, 0xf2d06b, 0x9ad0f5][k] ?? 0xffffff });
        if (k === 1) g.poly([12, 4, 17, 13, 12, 19, 7, 13]).fill({ color: 0xffffff }); // oil drop
        if (k === 2) {
          for (let a = 0; a < 3; a++) {
            const ang = -Math.PI / 2 + (a * Math.PI * 2) / 3;
            g.moveTo(12, 12)
              .arc(12, 12, 7, ang - 0.4, ang + 0.4)
              .lineTo(12, 12)
              .fill({ color: 0x9be564 });
          }
        }
        if (k === 3)
          g.poly([12, 4, 14, 10, 20, 12, 14, 14, 12, 20, 10, 14, 4, 12, 10, 10]).fill({ color: 0xf2d06b }); // wheat star
        if (k === 4) g.poly([12, 4, 19, 11, 12, 20, 5, 11]).fill({ color: 0x9ad0f5 }); // gem
      }),
    ),
  };
}
