// Flag textures for the map labels: one per distinct flag, rasterised once (real
// flags and custom designs are SVG, loaded asynchronously; generated flags are drawn
// directly), with a thin dark edge so light flags stay readable on light land.
import { Texture } from 'pixi.js';
import { drawFlag, flagAspect, flagUrl, ownerFlagKey, type FlagOwner } from './flags';

/** Texture height in pixels (labels show flags at ~8–34 px; mipmaps smooth the rest). */
const TEX_H = 64;

export class FlagTextures {
  private readonly cache = new Map<string, Texture | null>();
  private destroyed = false;

  /** Texture for an owner's flag by its key (see ownerFlagKey); null while it loads. */
  get(key: string, owner: FlagOwner): Texture | null {
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    this.cache.set(key, null);
    void this.load(key, owner);
    return null;
  }

  /** Cache key of an owner (call once per label, not per frame). */
  key(owner: FlagOwner): string {
    return ownerFlagKey(owner);
  }

  private async load(key: string, owner: FlagOwner): Promise<void> {
    const aspect = flagAspect(owner);
    const w = Math.round(TEX_H * aspect);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = TEX_H;
    const ctx = canvas.getContext('2d')!;
    try {
      if (key.startsWith('seed:')) {
        ctx.drawImage(drawFlag(owner.flagSeed, w), 0, 0, w, TEX_H);
      } else {
        const img = new Image();
        img.src = flagUrl(owner, w);
        await img.decode();
        ctx.drawImage(img, 0, 0, w, TEX_H);
      }
    } catch {
      ctx.drawImage(drawFlag(owner.flagSeed, w), 0, 0, w, TEX_H);
    }
    // Dark hairline edge (reads on paper-light and ink-dark land alike).
    ctx.strokeStyle = 'rgba(11, 14, 18, 0.85)';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, w, TEX_H);
    if (this.destroyed) return;
    this.cache.set(key, Texture.from({ resource: canvas, autoGenerateMipmaps: true, scaleMode: 'linear' }));
  }

  /** Stop loading (the textures go with the renderer, which destroys its sprites' textures). */
  destroy(): void {
    this.destroyed = true;
    this.cache.clear();
  }
}
