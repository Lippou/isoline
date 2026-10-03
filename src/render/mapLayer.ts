// The map surface: one full-map quad rendered by the atlas shader, fed by data
// textures. Ownership/state textures are updated in dirty horizontal bands.
import {
  Geometry,
  Mesh,
  Shader,
  Texture,
  BufferImageSource,
  type Renderer,
  type WebGLRenderer,
} from 'pixi.js';
import { MAP_FRAGMENT, MAP_VERTEX } from './shaders';
import { navigableRivers } from '../core/map/rivers';
import type { ClientState } from '../engine/clientState';
import { worldCode } from './worldPalette';

const BANDS = 32;

export interface MapUniforms {
  time: number;
  tick: number;
  zoom: number;
  night: number;
  highlight: number;
  viewer: number;
  fogOn: boolean;
  terrainView: boolean;
  quality: number;
  pattern: boolean;
  contrast: boolean;
  loyaltyView: boolean;
  /** 8 cells × (x, y, radius, code): -1 none, 0…1 storm intensity, 2…3 fog bank (2 + intensity). */
  weather: Float32Array;
  /** Country borders drawn (the photo mode can leave them out). */
  borders: boolean;
  /** 1: animated weather (lightning flashes); 0 with reduced motion. */
  motion: number;
  ring: [number, number, number, number];
  /** 0…1: drifting cloud cover, shown when zoomed far out. */
  clouds: number;
}

function makeSource(
  data: Uint8Array,
  w: number,
  h: number,
  format: 'rgba8unorm',
  linear: boolean,
): BufferImageSource {
  return new BufferImageSource({
    resource: data,
    width: w,
    height: h,
    format,
    scaleMode: linear ? 'linear' : 'nearest',
    addressMode: 'clamp-to-edge',
    autoGenerateMipmaps: false,
    // Data textures: never premultiply (alpha carries data, often 0).
    alphaMode: 'no-premultiply-alpha',
  });
}

export class MapLayer {
  readonly mesh: Mesh<Geometry, Shader>;
  private readonly w: number;
  private readonly h: number;
  private readonly ownerData: Uint8Array;
  private readonly stateData: Uint8Array;
  private readonly paletteData = new Uint8Array(256 * 256 * 4);
  private fogData: Uint8Array;
  private readonly ownerSrc: BufferImageSource;
  private readonly stateSrc: BufferImageSource;
  private readonly paletteSrc: BufferImageSource;
  private fogSrc: BufferImageSource;
  private readonly terrainSrc: BufferImageSource;
  private readonly reliefSrc: BufferImageSource;
  private dirtyBands = new Uint8Array(BANDS);
  /**
   * Tiles whose conquest ink is still diffusing, with the tick they changed. The
   * texture only keeps that tick modulo 256: once the fade is over the previous owner
   * is overwritten by the current one, otherwise the fade would replay every 256 ticks
   * (25.6 s) as waves sweeping across old conquests.
   */
  private settleTiles: number[] = [];
  private settleTicks: number[] = [];
  private settleHead = 0;
  private dirtyAny = false;
  private readonly bandRows: number;
  private readonly shader: Shader;
  private glPartial = true;
  private loggedError = false;

  constructor(
    private readonly state: ClientState,
    private readonly renderer: Renderer,
  ) {
    const { width: w, height: h } = state;
    this.w = w;
    this.h = h;
    this.bandRows = Math.ceil(h / BANDS);
    const n = w * h;
    const terrain = new Uint8Array(n * 4);
    const relief = new Uint8Array(n * 4);
    const smoothCoast = chamferCoast(state.coastDist, w, h);
    // Navigable rivers (they reach a sea or a lake): drawn as blue ribbons, even across countries.
    const navRiver = navigableRivers(state.terrain, w, h);
    for (let i = 0; i < n; i++) {
      terrain[i * 4] = state.terrain[i]!;
      terrain[i * 4 + 1] = state.elevation[i]!;
      terrain[i * 4 + 2] = state.coastDist[i]!;
      terrain[i * 4 + 3] = state.resource[i]!;
      relief[i * 4] = state.elevation[i]!;
      relief[i * 4 + 1] = smoothCoast[i]!;
      // Land mask (bilinear-filtered in the shader → smooth coastlines).
      relief[i * 4 + 2] = state.terrain[i]! > 2 ? 255 : 0;
      relief[i * 4 + 3] = navRiver[i] ? 255 : 0;
    }
    this.ownerData = new Uint8Array(n * 4);
    this.stateData = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const o = state.owner[i]!;
      this.ownerData[i * 4] = o & 255;
      this.ownerData[i * 4 + 1] = o >> 8;
      this.ownerData[i * 4 + 2] = o & 255;
      this.ownerData[i * 4 + 3] = o >> 8;
      this.stateData[i * 4] = state.fallout[i]!;
      this.stateData[i * 4 + 1] = state.flags[i]!;
      this.stateData[i * 4 + 2] = 200; // "long ago" — no fade on start
    }
    this.fogData = new Uint8Array(16).fill(255);
    this.terrainSrc = makeSource(terrain, w, h, 'rgba8unorm', false);
    this.reliefSrc = makeSource(relief, w, h, 'rgba8unorm', true);
    this.ownerSrc = makeSource(this.ownerData, w, h, 'rgba8unorm', false);
    this.stateSrc = makeSource(this.stateData, w, h, 'rgba8unorm', false);
    this.paletteSrc = makeSource(this.paletteData, 256, 256, 'rgba8unorm', false);
    this.fogSrc = makeSource(this.fogData, 2, 2, 'rgba8unorm', true);

    const geometry = new Geometry({
      attributes: {
        aPosition: [0, 0, w, 0, w, h, 0, h],
        aUV: [0, 0, 1, 0, 1, 1, 0, 1],
      },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    this.shader = Shader.from({
      gl: { vertex: MAP_VERTEX, fragment: MAP_FRAGMENT, name: 'isoline-map' },
      resources: {
        uTerrain: this.terrainSrc,
        uRelief: this.reliefSrc,
        uOwner: this.ownerSrc,
        uState: this.stateSrc,
        uPalette: this.paletteSrc,
        uFog: this.fogSrc,
        mapUniforms: {
          uSize: { value: new Float32Array([w, h]), type: 'vec2<f32>' },
          uTime: { value: 0, type: 'f32' },
          uTick: { value: 0, type: 'f32' },
          uZoom: { value: 1, type: 'f32' },
          uNight: { value: 0, type: 'f32' },
          uHighlight: { value: -1, type: 'f32' },
          uViewer: { value: 0, type: 'f32' },
          uFogOn: { value: 0, type: 'f32' },
          uTerrainView: { value: 0, type: 'f32' },
          uQuality: { value: 1, type: 'f32' },
          uPattern: { value: 0, type: 'f32' },
          uContrast: { value: 0, type: 'f32' },
          uLoyaltyView: { value: 0, type: 'f32' },
          uWeather: { value: new Float32Array(32).fill(-1), type: 'vec4<f32>', size: 8 },
          uMotion: { value: 1, type: 'f32' },
          uRing: { value: new Float32Array(4), type: 'vec4<f32>' },
          uClouds: { value: 0, type: 'f32' },
          uBorders: { value: 1, type: 'f32' },
          uWorld: { value: worldCode(state.meta?.palette), type: 'f32' },
        },
      },
    });
    this.mesh = new Mesh({ geometry, shader: this.shader });
    // Force the first GPU upload of every data texture.
    for (const src of [
      this.terrainSrc,
      this.reliefSrc,
      this.ownerSrc,
      this.stateSrc,
      this.paletteSrc,
      this.fogSrc,
    ])
      src.update();
  }

  /** Apply ownership/state changes accumulated in the client state. */
  consumeChanges(): void {
    const s = this.state;
    this.settle(s.tick);
    if (s.pendingTiles.length === 0 && s.pendingState.length === 0) return;
    const tick = s.tick & 255;
    const w = this.w;
    for (const t of s.pendingTiles) {
      this.settleTiles.push(t);
      this.settleTicks.push(s.tick);
      const o = s.owner[t]!;
      const k = t * 4;
      // previous owner ← current displayed owner
      this.ownerData[k + 2] = this.ownerData[k]!;
      this.ownerData[k + 3] = this.ownerData[k + 1]!;
      this.ownerData[k] = o & 255;
      this.ownerData[k + 1] = o >> 8;
      this.stateData[k + 2] = tick;
      this.dirtyBands[Math.floor(t / w / this.bandRows)] = 1;
    }
    for (const t of s.pendingState) {
      const k = t * 4;
      this.stateData[k] = s.fallout[t]!;
      this.stateData[k + 1] = s.flags[t]!;
      this.dirtyBands[Math.floor(t / w / this.bandRows)] = 1;
    }
    s.pendingTiles.length = 0;
    s.pendingState.length = 0;
    this.dirtyAny = true;
  }

  /** Ends the conquest fade of tiles changed 12+ ticks ago (or before a replay seek). */
  private settle(now: number): void {
    const tiles = this.settleTiles;
    const ticks = this.settleTicks;
    let i = this.settleHead;
    while (i < tiles.length) {
      const age = now - ticks[i]!;
      if (age >= 0 && age < 12) break;
      const k = tiles[i]! * 4;
      this.ownerData[k + 2] = this.ownerData[k]!;
      this.ownerData[k + 3] = this.ownerData[k + 1]!;
      this.dirtyBands[Math.floor(tiles[i]! / this.w / this.bandRows)] = 1;
      this.dirtyAny = true;
      i++;
    }
    this.settleHead = i;
    if (i > 4096 && i * 2 > tiles.length) {
      this.settleTiles = tiles.slice(i);
      this.settleTicks = ticks.slice(i);
      this.settleHead = 0;
    }
  }

  /** Upload dirty bands of the owner/state textures. */
  upload(): void {
    if (!this.dirtyAny) return;
    this.dirtyAny = false;
    const r = this.renderer as WebGLRenderer;
    const gl = (r as unknown as { gl?: WebGL2RenderingContext }).gl;
    if (!this.glPartial || !gl) {
      this.ownerSrc.update();
      this.stateSrc.update();
      this.dirtyBands.fill(0);
      return;
    }
    try {
      // Bind our GL texture on the currently active unit, upload, then restore the
      // previous binding so Pixi's internal state cache stays valid.
      const prev = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      // Pixi leaves these pixel-store flags set after its own uploads (sprites, text):
      // data textures must never be premultiplied or flipped.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      for (const [src, data] of [
        [this.ownerSrc, this.ownerData],
        [this.stateSrc, this.stateData],
      ] as const) {
        const glTex = r.texture.getGlSource(src);
        gl.bindTexture(gl.TEXTURE_2D, glTex.texture);
        let b = 0;
        while (b < BANDS) {
          if (!this.dirtyBands[b]) {
            b++;
            continue;
          }
          let e = b;
          while (e + 1 < BANDS && this.dirtyBands[e + 1]) e++;
          const y0 = b * this.bandRows;
          const y1 = Math.min(this.h, (e + 1) * this.bandRows);
          if (y1 > y0) {
            gl.texSubImage2D(
              gl.TEXTURE_2D,
              0,
              0,
              y0,
              this.w,
              y1 - y0,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              data.subarray(y0 * this.w * 4, y1 * this.w * 4),
            );
          }
          b = e + 1;
        }
      }
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.bindTexture(gl.TEXTURE_2D, prev);
      const err = gl.getError();
      if (err !== gl.NO_ERROR && !this.loggedError) {
        this.loggedError = true;
        const gt = r.texture.getGlSource(this.ownerSrc);
        console.warn(
          `[map] upload GL error 0x${err.toString(16)} glTex ${gt.width}x${gt.height} map ${this.w}x${this.h} internal 0x${gt.internalFormat.toString(16)} fmt 0x${gt.format.toString(16)} type 0x${gt.type.toString(16)}`,
        );
      }
    } catch (e) {
      console.warn('[map] partial upload failed, falling back to full uploads', e);
      this.glPartial = false;
      this.ownerSrc.update();
      this.stateSrc.update();
    }
    this.dirtyBands.fill(0);
  }

  /**
   * Ink colour per owner; the alpha channel carries the owner's relation to the viewer
   * (0 neutral, 1 ally / teammate, 2 at war, 3 no trade, 4 threatening our border),
   * which tints its borders.
   */
  setPalette(colors: Map<number, [number, number, number]>, relations?: Map<number, number>): void {
    this.paletteData.fill(0);
    for (const [id, [r, g, b]] of colors) {
      if (id < 0 || id >= 65536) continue;
      const k = id * 4;
      this.paletteData[k] = r;
      this.paletteData[k + 1] = g;
      this.paletteData[k + 2] = b;
      this.paletteData[k + 3] = 255 - 50 * (relations?.get(id) ?? 0);
    }
    this.paletteSrc.update();
  }

  /** Low-resolution layers texture: R = fog visibility, G = viewer loyalty. */
  private ensureLayers(w: number, h: number): boolean {
    if (this.fogSrc.width === w && this.fogSrc.height === h && this.fogData.length === w * h * 4)
      return false;
    this.fogData = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      this.fogData[i * 4] = 255;
      this.fogData[i * 4 + 3] = 255;
    }
    const old = this.fogSrc;
    this.fogSrc = makeSource(this.fogData, w, h, 'rgba8unorm', true);
    this.shader.resources.uFog = this.fogSrc;
    old.destroy();
    return true;
  }

  setFog(fog: { w: number; h: number; data: Uint8Array } | null): void {
    if (!fog) return;
    this.ensureLayers(fog.w, fog.h);
    for (let i = 0; i < fog.w * fog.h; i++) this.fogData[i * 4] = fog.data[i]!;
    this.fogSrc.update();
  }

  setLoyalty(l: { w: number; h: number; data: Uint8Array } | null): void {
    if (!l) return;
    this.ensureLayers(l.w, l.h);
    for (let i = 0; i < l.w * l.h; i++) this.fogData[i * 4 + 1] = l.data[i]!;
    this.fogSrc.update();
  }

  setUniforms(u: MapUniforms): void {
    const g = (this.shader.resources.mapUniforms as { uniforms: Record<string, unknown> }).uniforms;
    g.uTime = u.time;
    g.uTick = u.tick;
    g.uZoom = u.zoom;
    g.uNight = u.night;
    g.uHighlight = u.highlight;
    g.uViewer = u.viewer;
    g.uFogOn = u.fogOn ? 1 : 0;
    g.uTerrainView = u.terrainView ? 1 : 0;
    g.uQuality = u.quality;
    g.uPattern = u.pattern ? 1 : 0;
    g.uContrast = u.contrast ? 1 : 0;
    g.uLoyaltyView = u.loyaltyView ? 1 : 0;
    (g.uWeather as Float32Array).set(u.weather);
    g.uMotion = u.motion;
    (g.uRing as Float32Array).set(u.ring);
    g.uClouds = u.clouds;
    g.uBorders = u.borders ? 1 : 0;
  }

  destroy(): void {
    this.mesh.destroy();
    for (const s of [
      this.terrainSrc,
      this.reliefSrc,
      this.ownerSrc,
      this.stateSrc,
      this.paletteSrc,
      this.fogSrc,
    ])
      s.destroy();
  }
}

export function textureFromSource(src: BufferImageSource): Texture {
  return new Texture({ source: src });
}

/**
 * Render-only distance to the coast (tiles × 4, capped 255) using an 8-neighbour
 * chamfer transform: round depth contours instead of the gameplay BFS diamonds.
 */
function chamferCoast(coast: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = coast[i] === 0 ? 0 : 1e9;
  const D = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w]! + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1]! + D);
        if (x < w - 1) v = Math.min(v, d[i - w + 1]! + D);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i]!;
      if (x < w - 1) v = Math.min(v, d[i + 1]! + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w]! + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1]! + D);
        if (x > 0) v = Math.min(v, d[i + w - 1]! + D);
      }
      d[i] = v;
    }
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(255, Math.round(d[i]! * 4));
  return out;
}
