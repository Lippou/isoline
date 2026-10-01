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
import type { ClientState } from '../engine/clientState';

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
  weather: Float32Array;
  ring: [number, number, number, number];
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
  private dirtyAny = false;
  private readonly bandRows: number;
  private readonly shader: Shader;
  private glPartial = true;

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
    for (let i = 0; i < n; i++) {
      terrain[i * 4] = state.terrain[i]!;
      terrain[i * 4 + 1] = state.elevation[i]!;
      terrain[i * 4 + 2] = state.coastDist[i]!;
      terrain[i * 4 + 3] = state.resource[i]!;
      relief[i * 4] = state.elevation[i]!;
      relief[i * 4 + 1] = Math.min(255, state.coastDist[i]!);
      relief[i * 4 + 3] = 255;
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
          uWeather: { value: new Float32Array(32).fill(-1), type: 'vec4<f32>', size: 8 },
          uRing: { value: new Float32Array(4), type: 'vec4<f32>' },
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
    if (s.pendingTiles.length === 0 && s.pendingState.length === 0) return;
    const tick = s.tick & 255;
    const w = this.w;
    for (const t of s.pendingTiles) {
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
      for (const [src, data] of [
        [this.ownerSrc, this.ownerData],
        [this.stateSrc, this.stateData],
      ] as const) {
        r.texture.bindSource(src, 0);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
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
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      }
    } catch (e) {
      console.warn('[map] partial upload failed, falling back to full uploads', e);
      this.glPartial = false;
      this.ownerSrc.update();
      this.stateSrc.update();
    }
    this.dirtyBands.fill(0);
  }

  setPalette(colors: Map<number, [number, number, number]>): void {
    this.paletteData.fill(0);
    for (const [id, [r, g, b]] of colors) {
      if (id < 0 || id >= 65536) continue;
      const k = id * 4;
      this.paletteData[k] = r;
      this.paletteData[k + 1] = g;
      this.paletteData[k + 2] = b;
      this.paletteData[k + 3] = 255;
    }
    this.paletteSrc.update();
  }

  setFog(fog: { w: number; h: number; data: Uint8Array } | null): void {
    if (!fog) return;
    const n = fog.w * fog.h;
    const resize = n * 4 !== this.fogData.length || this.fogSrc.width !== fog.w;
    if (resize) this.fogData = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const v = fog.data[i]!;
      this.fogData[i * 4] = v;
      this.fogData[i * 4 + 3] = 255;
    }
    if (resize) {
      const old = this.fogSrc;
      this.fogSrc = makeSource(this.fogData, fog.w, fog.h, 'rgba8unorm', true);
      this.shader.resources.uFog = this.fogSrc;
      old.destroy();
      return;
    }
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
    (g.uWeather as Float32Array).set(u.weather);
    (g.uRing as Float32Array).set(u.ring);
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
