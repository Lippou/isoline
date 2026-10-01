// Deterministic seeded 2D gradient noise (Perlin-style) + fractal helpers.
import { Rng } from './rng';

export class Noise2D {
  private readonly perm: Uint8Array;
  private readonly gx: Float32Array;
  private readonly gy: Float32Array;

  constructor(seed: number) {
    const rng = new Rng(seed ^ 0x5bd1e995);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
    this.gx = new Float32Array(256);
    this.gy = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const a = (i / 256) * Math.PI * 2;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
    }
  }

  /** Noise in roughly [-1, 1]. */
  get(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const p = this.perm;
    const aa = p[p[X]! + Y]!;
    const ab = p[p[X]! + Y + 1]!;
    const ba = p[p[X + 1]! + Y]!;
    const bb = p[p[X + 1]! + Y + 1]!;
    const u = fade(xf);
    const v = fade(yf);
    const n00 = this.gx[aa]! * xf + this.gy[aa]! * yf;
    const n10 = this.gx[ba]! * (xf - 1) + this.gy[ba]! * yf;
    const n01 = this.gx[ab]! * xf + this.gy[ab]! * (yf - 1);
    const n11 = this.gx[bb]! * (xf - 1) + this.gy[bb]! * (yf - 1);
    const x1 = n00 + u * (n10 - n00);
    const x2 = n01 + u * (n11 - n01);
    return (x1 + v * (x2 - x1)) * 1.41421356;
  }

  /** Fractal Brownian motion, normalised to roughly [-1, 1]. */
  fbm(x: number, y: number, octaves = 5, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.get(x * freq + o * 17.31, y * freq - o * 9.17);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal in [0, 1]: sharp crests, good for mountain chains. */
  ridged(x: number, y: number, octaves = 5): number {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    let weight = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(this.get(x * freq + o * 31.7, y * freq + o * 12.3));
      n *= n * weight;
      weight = Math.min(1, Math.max(0, n * 2));
      sum += n * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum / norm;
  }
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
