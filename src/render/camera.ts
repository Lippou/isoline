// Smooth logarithmic-zoom camera with inertia, soft limits and follow mode.

export class Camera {
  cx = 0;
  cy = 0;
  zoom = 1;
  private targetZoom = 1;
  private anchor: { sx: number; sy: number; wx: number; wy: number } | null = null;
  vx = 0;
  vy = 0;
  viewW = 1;
  viewH = 1;
  mapW = 1;
  mapH = 1;
  minZoom = 0.2;
  maxZoom = 48;
  follow: (() => [number, number] | null) | null = null;
  private glide: { x: number; y: number; zoom: number } | null = null;
  reducedMotion = false;

  setMap(w: number, h: number): void {
    this.mapW = w;
    this.mapH = h;
    this.fit();
  }

  resize(w: number, h: number): void {
    this.viewW = Math.max(1, w);
    this.viewH = Math.max(1, h);
    this.minZoom = Math.min(this.viewW / this.mapW, this.viewH / this.mapH) * 0.7;
  }

  fit(): void {
    this.cx = this.mapW / 2;
    this.cy = this.mapH / 2;
    this.zoom = this.targetZoom = Math.max(
      this.minZoom,
      Math.min(this.viewW / this.mapW, this.viewH / this.mapH) * 0.98,
    );
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [this.cx + (sx - this.viewW / 2) / this.zoom, this.cy + (sy - this.viewH / 2) / this.zoom];
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.cx) * this.zoom + this.viewW / 2, (wy - this.cy) * this.zoom + this.viewH / 2];
  }

  /** Zoom by a multiplicative factor keeping the world point under (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetZoom * factor));
    this.anchor = { sx, sy, wx, wy };
    this.glide = null;
    this.follow = null;
  }

  panScreen(dx: number, dy: number): void {
    this.cx -= dx / this.zoom;
    this.cy -= dy / this.zoom;
    this.glide = null;
    this.follow = null;
  }

  fling(vxScreen: number, vyScreen: number): void {
    if (this.reducedMotion) return;
    this.vx = -vxScreen / this.zoom;
    this.vy = -vyScreen / this.zoom;
  }

  /** Smoothly travel to a world point (and optionally a zoom). */
  goTo(x: number, y: number, zoom?: number): void {
    this.glide = { x, y, zoom: zoom ?? Math.max(this.zoom, 3) };
    this.follow = null;
    this.anchor = null;
    if (this.reducedMotion) {
      this.cx = x;
      this.cy = y;
      this.zoom = this.targetZoom = this.glide.zoom;
      this.glide = null;
    }
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 14);
    if (this.glide) {
      const g = this.glide;
      const kg = 1 - Math.exp(-dt * 5);
      this.cx += (g.x - this.cx) * kg;
      this.cy += (g.y - this.cy) * kg;
      this.targetZoom = g.zoom;
      if (
        Math.hypot(g.x - this.cx, g.y - this.cy) * this.zoom < 0.5 &&
        Math.abs(Math.log(this.zoom / g.zoom)) < 0.01
      )
        this.glide = null;
    }
    if (this.follow) {
      const p = this.follow();
      if (p) {
        this.cx += (p[0] - this.cx) * k;
        this.cy += (p[1] - this.cy) * k;
      } else this.follow = null;
    }
    // Logarithmic zoom interpolation.
    const lz = Math.log(this.zoom);
    const lt = Math.log(this.targetZoom);
    this.zoom = Math.exp(lz + (lt - lz) * (this.reducedMotion ? 1 : k));
    if (this.anchor) {
      const a = this.anchor;
      this.cx = a.wx - (a.sx - this.viewW / 2) / this.zoom;
      this.cy = a.wy - (a.sy - this.viewH / 2) / this.zoom;
      if (Math.abs(lt - Math.log(this.zoom)) < 0.002) this.anchor = null;
    }
    // Inertia.
    if (Math.abs(this.vx) + Math.abs(this.vy) > 0.001) {
      this.cx += this.vx * dt;
      this.cy += this.vy * dt;
      const decay = Math.exp(-dt * 5);
      this.vx *= decay;
      this.vy *= decay;
    }
    // Soft limits: spring back when the view centre leaves the map (+ margin).
    const mx = this.viewW / this.zoom / 2;
    const my = this.viewH / this.zoom / 2;
    const minX = Math.min(this.mapW / 2, mx * 0.6);
    const maxX = Math.max(this.mapW / 2, this.mapW - mx * 0.6);
    const minY = Math.min(this.mapH / 2, my * 0.6);
    const maxY = Math.max(this.mapH / 2, this.mapH - my * 0.6);
    const spring = 1 - Math.exp(-dt * 8);
    if (this.cx < minX) this.cx += (minX - this.cx) * spring;
    if (this.cx > maxX) this.cx += (maxX - this.cx) * spring;
    if (this.cy < minY) this.cy += (minY - this.cy) * spring;
    if (this.cy > maxY) this.cy += (maxY - this.cy) * spring;
  }

  /** Visible world rectangle [x0, y0, x1, y1]. */
  bounds(): [number, number, number, number] {
    const [x0, y0] = this.screenToWorld(0, 0);
    const [x1, y1] = this.screenToWorld(this.viewW, this.viewH);
    return [x0, y0, x1, y1];
  }
}
