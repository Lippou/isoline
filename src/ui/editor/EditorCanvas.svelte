<script lang="ts">
  // The editor's plate: the map being drawn, its markers, and the tool under the pointer.
  // Strokes are continuous: every pointer event (coalesced ones included) is joined to
  // the previous one by brush stamps along the segment, under pointer capture. Only the
  // changed tiles are repainted (EditorModel.takeDirty), so a 3200 × 1612 map stays smooth.
  import { onMount, onDestroy } from 'svelte';
  import { ed, view, viewCtl, touched, TOOLS } from './editorSession.svelte';
  import { paintPixels } from './editorRender';
  import { EDITOR_COLORS, type PaintOp, type MarkerRef } from './editorModel';
  import { inventNationName } from '../../core/names';
  import { Rng } from '../../core/rng';
  import { HABITABLE, T } from '../../core/map/terrain';
  import { i18n, t } from '../i18n/i18n.svelte';
  import { squareCorner } from './raster';

  let { onpicked }: { onpicked?: (terrain: number) => void } = $props();

  let canvas: HTMLCanvasElement;
  let wrap: HTMLDivElement;
  let off: HTMLCanvasElement | null = null;
  let offCtx: CanvasRenderingContext2D | null = null;
  let img: ImageData | null = null;
  let shownModel: unknown = null;
  let shownVersion = -1;
  let shownMotifs = ed.motifs;
  let needs = true;
  let raf = 0;
  let cssW = 0;
  let cssH = 0;

  // Inks of the plate, read from the newsprint tokens.
  const ink = {
    paper: '#e6dfd1',
    ink: '#172a3c',
    card: '#f8f4ec',
    spot: '#b3245f',
    sea: '#2c6e91',
    gold: '#b8862a',
    good: '#276b48',
  };
  function readInks(): void {
    const cs = getComputedStyle(wrap);
    const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
    ink.paper = v('--np-paper-2', ink.paper);
    ink.ink = v('--np-ink', ink.ink);
    ink.card = v('--np-card', ink.card);
    ink.spot = v('--np-spot', ink.spot);
    ink.sea = v('--np-sea', ink.sea);
    ink.gold = v('--np-gold', ink.gold);
    ink.good = v('--np-good', ink.good);
  }

  // ----------------------------------------------------------------- interaction state
  type Drag =
    | { kind: 'pan'; x: number; y: number }
    | { kind: 'paint'; last: [number, number]; op: PaintOp; size: number }
    | { kind: 'line'; from: [number, number] }
    | { kind: 'shape'; from: [number, number]; ellipse: boolean }
    | { kind: 'marker'; ref: MarkerRef; dx: number; dy: number; moved: boolean };
  let drag: Drag | null = null;
  let pointer: { sx: number; sy: number; shift: boolean } | null = null;
  let hoverMarker: MarkerRef | null = null;
  let markerCursor = $state('crosshair');
  let panning = $state(false);

  const tool = $derived(ed.spaceHand ? 'hand' : ed.tool);
  const cursor = $derived(
    panning
      ? 'grabbing'
      : tool === 'hand'
        ? 'grab'
        : tool === 'markers'
          ? markerCursor
          : tool === 'picker'
            ? 'copy'
            : 'none',
  );

  function screenToMap(sx: number, sy: number): [number, number] {
    return [(sx - view.x) / view.z, (sy - view.y) / view.z];
  }
  function tileOf(e: { clientX: number; clientY: number }): [number, number] {
    const r = canvas.getBoundingClientRect();
    const [mx, my] = screenToMap(e.clientX - r.left, e.clientY - r.top);
    return [Math.floor(mx), Math.floor(my)];
  }
  function clampTile([x, y]: [number, number]): [number, number] {
    const m = ed.model!;
    return [Math.max(0, Math.min(m.width - 1, x)), Math.max(0, Math.min(m.height - 1, y))];
  }

  function paintOp(): PaintOp {
    if (ed.tool === 'eraser') return { kind: 'terrain', t: T.DeepOcean };
    if (ed.tool === 'relief') return { kind: ed.relief, strength: ed.strength };
    return { kind: 'terrain', t: ed.terrain };
  }

  function down(e: PointerEvent): void {
    const m = ed.model;
    if (!m) return;
    canvas.focus({ preventScroll: true });
    const r = canvas.getBoundingClientRect();
    if (e.button === 1 || e.button === 2 || tool === 'hand') {
      drag = { kind: 'pan', x: e.clientX, y: e.clientY };
      panning = true;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      needs = true;
      return;
    }
    if (e.button !== 0) return;
    const tile = tileOf(e);
    const inside = tile[0] >= 0 && tile[1] >= 0 && tile[0] < m.width && tile[1] < m.height;
    const pick = tool === 'picker' || (e.altKey && TOOLS.find((d) => d.id === tool)?.paints);
    if (pick) {
      if (!inside) return;
      const tt = m.terrainAt(tile[0], tile[1]);
      ed.terrain = tt;
      onpicked?.(tt);
      if (ed.tool === 'picker') ed.tool = ed.lastPaintTool;
      needs = true;
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    switch (tool) {
      case 'brush':
      case 'eraser':
      case 'relief': {
        const op = paintOp();
        m.begin(tool === 'relief' ? 'relief' : 'paint');
        m.stamp(tile[0], tile[1], ed.size, op);
        drag = { kind: 'paint', last: tile, op, size: ed.size };
        break;
      }
      case 'line':
        drag = { kind: 'line', from: clampTile(tile) };
        break;
      case 'rect':
      case 'ellipse':
        drag = { kind: 'shape', from: clampTile(tile), ellipse: tool === 'ellipse' };
        break;
      case 'fill':
        if (inside) {
          m.floodFill(tile[0], tile[1], ed.terrain, ed.tolerance);
          touched();
        }
        break;
      case 'markers': {
        const hit = m.markerAt(tile[0] + 0.5, tile[1] + 0.5, Math.max(1.5, 9 / view.z));
        m.beginMarkers();
        if (hit) {
          const p = m.markerPos(hit)!;
          ed.selected = hit;
          const [mx, my] = screenToMap(e.clientX - r.left, e.clientY - r.top);
          drag = { kind: 'marker', ref: hit, dx: p[0] - mx, dy: p[1] - my, moved: false };
        } else if (inside) {
          let ref: MarkerRef;
          if (ed.markerKind === 'nation') {
            const name = inventNationName(new Rng((Date.now() ^ (tile[0] * 7919 + tile[1])) >>> 0))[
              i18n.lang
            ];
            ref = m.addNation(tile[0], tile[1], name);
          } else if (ed.markerKind === 'spawn') ref = m.addSpawn(tile[0], tile[1]);
          else ref = m.addDeposit(tile[0], tile[1], ed.depositType);
          ed.selected = ref;
          m.commitMarkers('add');
          touched();
        } else {
          ed.selected = null;
          m.commitMarkers();
        }
        break;
      }
    }
    needs = true;
  }

  function move(e: PointerEvent): void {
    const m = ed.model;
    if (!m) return;
    const r = canvas.getBoundingClientRect();
    pointer = { sx: e.clientX - r.left, sy: e.clientY - r.top, shift: e.shiftKey };
    const tile = tileOf(e);
    if (!ed.hover || ed.hover.x !== tile[0] || ed.hover.y !== tile[1]) ed.hover = { x: tile[0], y: tile[1] };
    needs = true;
    if (!drag) {
      if (tool === 'markers') {
        hoverMarker = m.markerAt(tile[0] + 0.5, tile[1] + 0.5, Math.max(1.5, 9 / view.z));
        markerCursor = hoverMarker ? 'move' : 'crosshair';
      }
      return;
    }
    if (drag.kind === 'pan') {
      view.x += e.clientX - drag.x;
      view.y += e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      return;
    }
    if (drag.kind === 'paint') {
      // Every intermediate position the pointer reported, joined segment by segment.
      const events = e.getCoalescedEvents?.() ?? [];
      for (const ev of events.length ? events : [e]) {
        const p = tileOf(ev);
        if (p[0] === drag.last[0] && p[1] === drag.last[1]) continue;
        m.stroke(drag.last[0], drag.last[1], p[0], p[1], drag.size, drag.op);
        drag.last = p;
      }
      return;
    }
    if (drag.kind === 'marker') {
      const [mx, my] = screenToMap(pointer.sx, pointer.sy);
      m.moveMarker(drag.ref, mx + drag.dx, my + drag.dy);
      drag.moved = true;
    }
  }

  function up(e: PointerEvent): void {
    const m = ed.model;
    const d = drag;
    drag = null;
    panning = false;
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (!m || !d) return;
    const tile = clampTile(tileOf(e));
    if (d.kind === 'paint') m.end();
    else if (d.kind === 'line') m.line(d.from[0], d.from[1], tile[0], tile[1], ed.size, paintOp());
    else if (d.kind === 'shape') {
      const [bx, by] = e.shiftKey ? clampTile(squareCorner(d.from[0], d.from[1], tile[0], tile[1])) : tile;
      if (d.ellipse) m.fillEllipse(d.from[0], d.from[1], bx, by, ed.terrain);
      else m.fillRect(d.from[0], d.from[1], bx, by, ed.terrain);
    } else if (d.kind === 'marker') m.commitMarkers(d.moved ? 'move' : 'select');
    if (d.kind !== 'pan') touched();
    needs = true;
  }

  function leave(): void {
    if (!drag) {
      pointer = null;
      ed.hover = null;
      needs = true;
    }
  }

  /** Cancels a shape or line being dragged (Escape). */
  export function cancel(): void {
    if (drag && (drag.kind === 'line' || drag.kind === 'shape')) drag = null;
    needs = true;
  }

  // ----------------------------------------------------------------- view
  function minZoom(): number {
    const m = ed.model;
    if (!m) return 0.05;
    return Math.min(cssW / m.width, cssH / m.height) * 0.25;
  }
  function zoomAt(sx: number, sy: number, f: number): void {
    const z = Math.max(minZoom(), Math.min(48, view.z * f));
    const k = z / view.z;
    view.x = sx - (sx - view.x) * k;
    view.y = sy - (sy - view.y) * k;
    view.z = z;
    ed.zoom = z;
    needs = true;
  }
  function wheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.altKey) {
      // Alt + wheel: the brush size (a shortcut that is the same on every keyboard).
      ed.size = Math.max(
        1,
        Math.min(80, ed.size + (e.deltaY < 0 ? 1 : -1) * Math.max(1, Math.round(ed.size / 8))),
      );
      needs = true;
      return;
    }
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    if (!e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      // A trackpad's sideways swipe pans.
      view.x -= e.deltaX;
      view.y -= e.deltaY;
      needs = true;
      return;
    }
    // Pinch (ctrlKey on trackpads) and the wheel zoom around the pointer.
    const scale = e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.012 : 0.0018;
    zoomAt(sx, sy, Math.exp(-e.deltaY * scale));
  }

  function fit(): void {
    const m = ed.model;
    if (!m || !cssW) return;
    view.z = Math.min(cssW / m.width, cssH / m.height) * 0.94;
    view.x = (cssW - m.width * view.z) / 2;
    view.y = (cssH - m.height * view.z) / 2;
    ed.zoom = view.z;
    needs = true;
  }
  function focusOn(x: number, y: number): void {
    view.z = Math.max(view.z, 4);
    view.x = cssW / 2 - (x + 0.5) * view.z;
    view.y = cssH / 2 - (y + 0.5) * view.z;
    ed.zoom = view.z;
    needs = true;
  }

  // ----------------------------------------------------------------- drawing
  function repaintAll(): void {
    const m = ed.model!;
    m.takeDirty();
    paintPixels(
      m.terrain,
      m.elevation,
      m.width,
      m.height,
      img!.data,
      { x0: 0, y0: 0, x1: m.width - 1, y1: m.height - 1 },
      ed.motifs,
    );
    offCtx!.putImageData(img!, 0, 0);
    shownMotifs = ed.motifs;
    needs = true;
  }

  function syncImage(): void {
    const m = ed.model!;
    if (shownModel !== m || !off || off.width !== m.width || off.height !== m.height) {
      off = document.createElement('canvas');
      off.width = m.width;
      off.height = m.height;
      offCtx = off.getContext('2d')!;
      img = offCtx.createImageData(m.width, m.height);
      repaintAll();
      shownModel = m;
      shownVersion = m.version;
      // A map seen for the first time is fitted; the one coming back from a play-test keeps its view.
      if (view.modelId !== m.meta.id) {
        view.modelId = m.meta.id;
        fit();
      }
      ed.zoom = view.z;
      return;
    }
    if (shownMotifs !== ed.motifs) repaintAll();
    if (shownVersion !== m.version) {
      shownVersion = m.version;
      needs = true;
    }
    const box = m.takeDirty();
    if (box) {
      // Only the box that changed: a stroke on the giant world costs a few thousand pixels.
      const b = paintPixels(m.terrain, m.elevation, m.width, m.height, img!.data, box, ed.motifs);
      offCtx!.putImageData(img!, 0, 0, b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
      needs = true;
    }
  }

  function frame(): void {
    raf = requestAnimationFrame(frame);
    if (!canvas || !wrap) return;
    const r = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (Math.round(r.width * dpr) !== canvas.width || Math.round(r.height * dpr) !== canvas.height) {
      // A resized window keeps the map's centre where it was.
      if (cssW > 0) {
        view.x += (r.width - cssW) / 2;
        view.y += (r.height - cssH) / 2;
      }
      cssW = r.width;
      cssH = r.height;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      needs = true;
    }
    if (cssW < 2 || cssH < 2) return;
    if (!ed.model) return;
    syncImage();
    if (!needs) return;
    needs = false;
    draw(dpr);
  }

  function draw(dpr: number): void {
    const m = ed.model!;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = ink.paper;
    ctx.fillRect(0, 0, cssW, cssH);
    const z = view.z;
    ctx.imageSmoothingEnabled = z < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off!, view.x, view.y, m.width * z, m.height * z);
    // The sheet's edge.
    ctx.strokeStyle = ink.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(view.x) - 0.5,
      Math.round(view.y) - 0.5,
      Math.round(m.width * z) + 1,
      Math.round(m.height * z) + 1,
    );
    if (ed.grid && z >= 8) drawGrid(ctx, m.width, m.height);
    drawMarkers(ctx);
    drawTool(ctx);
  }

  function visibleTiles(w: number, h: number) {
    const z = view.z;
    return {
      x0: Math.max(0, Math.floor(-view.x / z)),
      y0: Math.max(0, Math.floor(-view.y / z)),
      x1: Math.min(w, Math.ceil((cssW - view.x) / z)),
      y1: Math.min(h, Math.ceil((cssH - view.y) / z)),
    };
  }

  function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const z = view.z;
    const v = visibleTiles(w, h);
    ctx.lineWidth = 1;
    for (const major of [false, true]) {
      ctx.strokeStyle = major ? 'rgba(23, 42, 60, 0.42)' : 'rgba(23, 42, 60, 0.16)';
      ctx.beginPath();
      for (let x = v.x0; x <= v.x1; x++) {
        if ((x % 10 === 0) !== major) continue;
        const sx = Math.round(view.x + x * z) + 0.5;
        ctx.moveTo(sx, view.y + v.y0 * z);
        ctx.lineTo(sx, view.y + v.y1 * z);
      }
      for (let y = v.y0; y <= v.y1; y++) {
        if ((y % 10 === 0) !== major) continue;
        const sy = Math.round(view.y + y * z) + 0.5;
        ctx.moveTo(view.x + v.x0 * z, sy);
        ctx.lineTo(view.x + v.x1 * z, sy);
      }
      ctx.stroke();
    }
  }

  const P = (x: number, y: number): [number, number] => [
    view.x + (x + 0.5) * view.z,
    view.y + (y + 0.5) * view.z,
  ];
  const isSel = (k: MarkerRef['kind'], i: number) => ed.selected?.kind === k && ed.selected.index === i;
  const isHover = (k: MarkerRef['kind'], i: number) => hoverMarker?.kind === k && hoverMarker.index === i;
  const DEPOSIT_LETTER: Record<string, string[]> = {
    fr: ['', 'P', 'U', 'F', 'M'],
    en: ['', 'O', 'U', 'F', 'M'],
  };

  /** A cross through a marker that stands where it cannot (a shape, not only a colour). */
  function badMark(ctx: CanvasRenderingContext2D, sx: number, sy: number, r: number): void {
    ctx.strokeStyle = ink.card;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sx - r, sy - r);
    ctx.lineTo(sx + r, sy + r);
    ctx.moveTo(sx + r, sy - r);
    ctx.lineTo(sx - r, sy + r);
    ctx.stroke();
    ctx.strokeStyle = ink.spot;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function selBrackets(ctx: CanvasRenderingContext2D, sx: number, sy: number, r: number): void {
    ctx.strokeStyle = ink.ink;
    ctx.lineWidth = 2;
    const a = r * 0.6;
    ctx.beginPath();
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      ctx.moveTo(sx + dx * r, sy + dy * (r - a));
      ctx.lineTo(sx + dx * r, sy + dy * r);
      ctx.lineTo(sx + dx * (r - a), sy + dy * r);
    }
    ctx.stroke();
  }

  function drawMarkers(ctx: CanvasRenderingContext2D): void {
    const m = ed.model!;
    const meta = m.meta;
    const onTool = ed.tool === 'markers';
    const tiny = view.z < (onTool ? 0.35 : 0.6);
    // Spawn points: rings.
    meta.spawnPoints.forEach(([x, y], k) => {
      const [sx, sy] = P(x, y);
      if (sx < -10 || sy < -10 || sx > cssW + 10 || sy > cssH + 10) return;
      const r = tiny ? 2 : 4;
      // (Far out and with another tool, the points step back: the map comes first.)
      ctx.globalAlpha = tiny ? 0.6 : 1;
      ctx.lineWidth = tiny ? 2 : 3;
      ctx.strokeStyle = ink.card;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = tiny ? 1 : 1.5;
      ctx.strokeStyle = ink.sea;
      ctx.stroke();
      ctx.globalAlpha = 1;
      const ok = HABITABLE[m.terrainAt(x, y)] === 1;
      if (!ok) badMark(ctx, sx, sy, 5);
      if (isSel('spawn', k) || isHover('spawn', k)) selBrackets(ctx, sx, sy, 9);
    });
    // Deposits: a paper tag with the resource's letter.
    ctx.font = '700 9px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const letters = DEPOSIT_LETTER[i18n.lang] ?? DEPOSIT_LETTER.en!;
    meta.deposits.forEach((d, k) => {
      const [sx, sy] = P(d.x, d.y);
      if (sx < -10 || sy < -10 || sx > cssW + 10 || sy > cssH + 10) return;
      if (tiny) {
        ctx.fillStyle = ink.gold;
        ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
        return;
      }
      ctx.fillStyle = ink.card;
      ctx.strokeStyle = ink.ink;
      ctx.lineWidth = 1;
      ctx.fillRect(sx - 5.5, sy - 5.5, 11, 11);
      ctx.strokeRect(sx - 5.5, sy - 5.5, 11, 11);
      ctx.fillStyle = ink.ink;
      ctx.fillText(letters[d.type] ?? '?', sx, sy + 0.5);
      if (isSel('deposit', k) || isHover('deposit', k)) selBrackets(ctx, sx, sy, 10);
    });
    // Nations: a brass diamond, then the names that fit without overlapping (the
    // selected and the misplaced first, then by importance), as an atlas letters them.
    ctx.font = '600 12px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    const cand: { k: number; sx: number; sy: number; ok: boolean; rank: number }[] = [];
    meta.nations.forEach((n, k) => {
      const [sx, sy] = P(n.x, n.y);
      if (sx < -120 || sy < -20 || sx > cssW + 20 || sy > cssH + 20) return;
      const s = tiny ? 4 : 6;
      ctx.fillStyle = ink.gold;
      ctx.strokeStyle = ink.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy - s);
      ctx.lineTo(sx + s, sy);
      ctx.lineTo(sx, sy + s);
      ctx.lineTo(sx - s, sy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      const ok = m.spawnable(n.x, n.y) === 'ok';
      if (!ok) badMark(ctx, sx, sy, 7);
      const focus = isSel('nation', k) || isHover('nation', k);
      if (focus) selBrackets(ctx, sx, sy, 11);
      cand.push({ k, sx, sy, ok, rank: (focus ? 1e9 : 0) + (ok ? 0 : 1e6) + n.weight });
    });
    cand.sort((a, b) => b.rank - a.rank);
    const placed: [number, number, number, number][] = [];
    for (const c of cand) {
      const n = meta.nations[c.k]!;
      const label = n.name[i18n.lang] || n.name.en;
      const w = ctx.measureText(label).width;
      const box: [number, number, number, number] = [c.sx + 7, c.sy - 8, c.sx + 11 + w, c.sy + 8];
      if (
        c.rank < 1e9 &&
        placed.some((p) => p[0] < box[2] && box[0] < p[2] && p[1] < box[3] && box[1] < p[3])
      )
        continue;
      placed.push(box);
      ctx.lineWidth = 3;
      ctx.strokeStyle = ink.card;
      ctx.strokeText(label, c.sx + 9, c.sy);
      ctx.fillStyle = c.ok ? ink.ink : ink.spot;
      ctx.fillText(label, c.sx + 9, c.sy);
    }
  }

  function terrainFill(): string {
    const c = EDITOR_COLORS[ed.terrain] ?? [0, 0, 0];
    return `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.55)`;
  }

  function dashed(ctx: CanvasRenderingContext2D, path: () => void): void {
    ctx.setLineDash([]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(248, 244, 236, 0.9)';
    ctx.beginPath();
    path();
    ctx.stroke();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ink.ink;
    ctx.beginPath();
    path();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawTool(ctx: CanvasRenderingContext2D): void {
    const m = ed.model!;
    if (!pointer) return;
    const z = view.z;
    const [mx, my] = screenToMap(pointer.sx, pointer.sy);
    const tx = Math.floor(mx);
    const ty = Math.floor(my);
    const d = drag;
    if (d?.kind === 'line') {
      const [ax, ay] = P(d.from[0], d.from[1]);
      const [bx, by] = P(Math.max(0, Math.min(m.width - 1, tx)), Math.max(0, Math.min(m.height - 1, ty)));
      ctx.lineCap = 'round';
      ctx.strokeStyle = terrainFill();
      ctx.lineWidth = Math.max(2, ed.size * z);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      dashed(ctx, () => {
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      });
    }
    if (d?.kind === 'shape') {
      let [ex, ey]: [number, number] = [tx, ty];
      if (pointer.shift) [ex, ey] = squareCorner(d.from[0], d.from[1], tx, ty);
      const x0 = view.x + Math.min(d.from[0], ex) * z;
      const y0 = view.y + Math.min(d.from[1], ey) * z;
      const w = (Math.abs(ex - d.from[0]) + 1) * z;
      const h = (Math.abs(ey - d.from[1]) + 1) * z;
      const path = () => {
        if (d.ellipse) ctx.ellipse(x0 + w / 2, y0 + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        else ctx.rect(x0, y0, w, h);
      };
      ctx.fillStyle = terrainFill();
      ctx.beginPath();
      path();
      ctx.fill();
      dashed(ctx, path);
      // The size, printed beside the shape.
      ctx.font = '500 11px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const txt = `${Math.abs(ex - d.from[0]) + 1} × ${Math.abs(ey - d.from[1]) + 1}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = ink.card;
      ctx.strokeText(txt, x0 + w + 6, y0 + h + 4);
      ctx.fillStyle = ink.ink;
      ctx.fillText(txt, x0 + w + 6, y0 + h + 4);
    }
    const sized = tool === 'brush' || tool === 'eraser' || tool === 'relief' || tool === 'line';
    if (sized && d?.kind !== 'pan') {
      // The brush's footprint, centred on the tile under the pointer.
      const [cx, cy] = P(tx, ty);
      const r = (ed.size / 2) * z;
      if (r >= 3) dashed(ctx, () => ctx.arc(cx, cy, r, 0, Math.PI * 2));
      const c = r >= 3 ? 4 : 7;
      dashed(ctx, () => {
        ctx.moveTo(cx - c, cy);
        ctx.lineTo(cx + c, cy);
        ctx.moveTo(cx, cy - c);
        ctx.lineTo(cx, cy + c);
      });
    } else if ((tool === 'rect' || tool === 'ellipse' || tool === 'fill' || tool === 'line') && !d) {
      const [cx, cy] = [pointer.sx, pointer.sy];
      dashed(ctx, () => {
        ctx.moveTo(cx - 8, cy);
        ctx.lineTo(cx + 8, cy);
        ctx.moveTo(cx, cy - 8);
        ctx.lineTo(cx, cy + 8);
      });
      if (z >= 3 && tx >= 0 && ty >= 0 && tx < m.width && ty < m.height) {
        dashed(ctx, () => ctx.rect(view.x + tx * z, view.y + ty * z, z, z));
      }
    }
  }

  $effect(() => {
    // Anything the overlay shows: redraw.
    void [ed.grid, ed.motifs, ed.tool, ed.size, ed.terrain, ed.selected, ed.rev, ed.spaceHand, i18n.lang];
    needs = true;
  });

  onMount(() => {
    readInks();
    viewCtl.fit = fit;
    viewCtl.zoomBy = (f) => zoomAt(cssW / 2, cssH / 2, f);
    viewCtl.focus = focusOn;
    raf = requestAnimationFrame(frame);
  });
  onDestroy(() => {
    cancelAnimationFrame(raf);
    viewCtl.fit = () => {};
    viewCtl.zoomBy = () => {};
    viewCtl.focus = () => {};
  });
</script>

<div class="plate" bind:this={wrap}>
  <canvas
    bind:this={canvas}
    tabindex="-1"
    aria-label={t('editor.plate')}
    data-testid="editor-canvas"
    style:cursor
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onpointerleave={leave}
    onwheel={wheel}
    oncontextmenu={(e) => e.preventDefault()}
  ></canvas>
</div>

<style>
  .plate {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    outline: none;
  }
</style>
