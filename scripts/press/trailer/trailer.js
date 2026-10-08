// Isoline — the presentation film, drawn frame by frame on a canvas (1920×1080, 30 fps).
// Pure function of time: renderFrame(f) paints frame f; render.mjs steps through the frames,
// screenshots each one and encodes the film. The footage comes from footage.mjs (real game
// shots, a JPEG sequence per shot); the logo's contour lines are the brand symbol's paths.

const W = 1920;
const H = 1080;
const FPS = 30;

const C = {
  paper: '#f1ece2',
  paper2: '#e6dfd1',
  ink: '#172a3c',
  ink2: '#46535f',
  rule: '#bdb4a2',
  brass: '#b8862a',
  brassLight: '#d1a64a',
};

// ------------------------------------------------------------------ easing
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOut = (u) => 1 - (1 - clamp(u)) ** 3;
const easeIn = (u) => clamp(u) ** 3;
const easeInOut = (u) => {
  u = clamp(u);
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
};
/** 0 → 1 over [a, b] (seconds), eased. */
const ramp = (t, a, b, ease = easeOut) => ease((t - a) / (b - a));

// ------------------------------------------------------------------ timeline (seconds)
/** Footage shots: their folder, frame count, where they sit in the film, and the first frame used. */
const SHOTS = [
  { name: 'world', at: 4.6, end: 11.2, from: 0 },
  { name: 'expand', at: 11.0, end: 16.8, from: 20 },
  { name: 'economy', at: 16.6, end: 22.4, from: 10 },
  { name: 'ring', at: 22.2, end: 24.9, from: 30 },
  { name: 'lines', at: 24.6, end: 32.1, from: 0 },
  { name: 'nuke', at: 31.8, end: 38.4, from: 8 },
];
/** Captions: kicker, title, on screen from `at` to `end`. */
const CAPTIONS = [
  { at: 5.8, end: 10.6, kicker: 'Stratégie en temps réel', title: ['Cent nations.', 'Une seule carte.'] },
  {
    at: 11.6,
    end: 16.3,
    kicker: '01 — S’étendre',
    title: ['Partez d’un point,', 'repoussez vos frontières.'],
  },
  { at: 17.2, end: 21.9, kicker: '02 — Bâtir', title: ['Villes, rail et ports', 'font la richesse.'] },
  { at: 22.6, end: 24.6, kicker: '03 — Tenir', title: ['Retranchez-vous', 'derrière vos lignes.'] },
  { at: 25.0, end: 31.5, kicker: '03 — Percer', title: ['Puis tracez', 'la percée.'] },
  { at: 32.4, end: 37.6, kicker: '04 — Dissuader', title: ['Et s’il le faut,', 'l’arme ultime.'] },
];
const INTRO_END = 5.4;
const OUTRO_AT = 37.8;
export const DURATION = 45;
export const FRAMES = DURATION * FPS;

// ------------------------------------------------------------------ assets
let cfg = null;
const cache = new Map();
function image(src) {
  let p = cache.get(src);
  if (!p) {
    p = new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
    cache.set(src, p);
    // Keep the cache small: footage frames are only needed once.
    if (cache.size > 24) cache.delete(cache.keys().next().value);
  }
  return p;
}

/** The brand symbol: three contour lines and the brass diamond, measured for drawing on. */
let logo = null;
function buildLogo(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = document.body.appendChild(document.importNode(doc.documentElement, true));
  svg.style.position = 'absolute';
  svg.style.visibility = 'hidden';
  const paths = [...svg.querySelectorAll('path')];
  const lines = paths
    .filter((p) => p.getAttribute('fill') === 'none')
    .map((p) => ({ path: new Path2D(p.getAttribute('d')), len: p.getTotalLength() }));
  const diamond = new Path2D(paths.find((p) => p.getAttribute('fill') !== 'none').getAttribute('d'));
  svg.remove();
  // The symbol's own frame: viewBox 150 150 724 724, content scaled 0.95 about the origin + 25.6.
  logo = { lines, diamond, box: [150, 150, 724, 724], inner: [25.6, 0.95], centre: [512, 512] };
}

// ------------------------------------------------------------------ drawing helpers
let ctx = null;

function text(str, x, y, { font, color, spacing = 0, align = 'left', alpha = 1 }) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = font;
  ctx.letterSpacing = `${spacing}px`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x, y);
  ctx.restore();
}

/** Faint topographic contours on the paper, drifting slowly (deterministic harmonics). */
function contours(t, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = C.rule;
  ctx.lineWidth = 1.4;
  const centres = [
    [360, 820, 0.0],
    [1580, 260, 1.7],
    [1720, 940, 3.1],
  ];
  for (const [cx, cy, ph] of centres) {
    for (let k = 1; k <= 9; k++) {
      const r0 = 70 * k;
      ctx.beginPath();
      for (let i = 0; i <= 180; i++) {
        const a = (i / 180) * Math.PI * 2;
        const r =
          r0 *
          (1 +
            0.09 * Math.sin(3 * a + ph + k * 0.35 + t * 0.12) +
            0.05 * Math.sin(5 * a - ph * 1.3 + k * 0.2) +
            0.03 * Math.cos(2 * a + k * 0.5 - t * 0.08));
        const x = cx + Math.cos(a) * r * 1.15;
        const y = cy + Math.sin(a) * r;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Paper with a soft light falloff. */
function paper(t, contourAlpha) {
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H * 0.42, 200, W / 2, H / 2, 1250);
  g.addColorStop(0, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(120,100,70,0.16)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  contours(t, contourAlpha);
}

/**
 * The logo lock-up centred at (x, y): the symbol (contours drawn on by `draw` 0–1, the
 * diamond by `pop` 0–1), the wordmark (letters by `word` 0–1) and the slogan (`slogan` 0–1).
 */
function lockup(x, y, size, { draw, pop, word, slogan }) {
  const s = size / logo.box[2];
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(s, s);
  ctx.translate(-logo.box[0], -logo.box[1]);
  ctx.translate(logo.inner[0], logo.inner[0]);
  ctx.scale(logo.inner[1], logo.inner[1]);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  logo.lines.forEach((l, k) => {
    const u = easeInOut(clamp(draw * 1.25 - k * 0.12));
    if (u <= 0) return;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 44;
    ctx.setLineDash([l.len * u, l.len]);
    ctx.stroke(l.path);
  });
  ctx.setLineDash([]);
  if (pop > 0) {
    // The diamond: scaled from its centre with a slight overshoot.
    const k = pop < 1 ? easeOut(pop) * (1 + 0.18 * Math.sin(pop * Math.PI)) : 1;
    ctx.save();
    ctx.translate(470.8, 474);
    ctx.scale(k, k);
    ctx.translate(-470.8, -474);
    ctx.fillStyle = C.brass;
    ctx.fill(logo.diamond);
    ctx.restore();
  }
  ctx.restore();
  // Wordmark: Fraunces SemiBold capitals, wide tracking, letters rising one by one.
  if (word > 0) {
    const letters = 'ISOLINE'.split('');
    const fs = size * 0.36;
    ctx.save();
    ctx.font = `600 ${fs}px Fraunces`;
    const sp = fs * 0.16;
    const widths = letters.map((ch) => ctx.measureText(ch).width + sp);
    const total = widths.reduce((a, b) => a + b, 0) - sp;
    let cx = x - total / 2;
    const by = y + size * 0.5 + fs * 1.05;
    letters.forEach((ch, k) => {
      const u = easeOut(clamp(word * 1.6 - k * 0.09));
      text(ch, cx, by + (1 - u) * fs * 0.35, { font: `600 ${fs}px Fraunces`, color: C.ink, alpha: u });
      cx += widths[k];
    });
    ctx.restore();
    if (slogan > 0) {
      const u = easeOut(slogan);
      text('Trace ta ligne. Tiens le monde.', x, by + fs * 0.78 + (1 - u) * 12, {
        font: `italic 400 ${fs * 0.3}px Fraunces`,
        color: C.ink2,
        align: 'center',
        alpha: u,
      });
    }
  }
}

/** A footage frame drawn full-bleed (with a gentle push-in over the shot). */
async function footage(shot, t, alpha) {
  if (alpha <= 0) return;
  const n = cfg.frames[shot.name];
  const f = Math.min(n, shot.from + 1 + Math.floor((t - shot.at) * FPS));
  const im = await image(`${cfg.footage}/${shot.name}/${String(Math.max(1, f)).padStart(4, '0')}.jpg`);
  const u = clamp((t - shot.at) / (shot.end - shot.at));
  // (A touch of zoom also keeps the map's edge out of the first world frames.)
  const z = (shot.name === 'world' ? 1.03 : 1) + 0.025 * u;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(W / 2, H / 2);
  ctx.scale(z, z);
  ctx.drawImage(im, -W / 2, -H / 2, W, H);
  ctx.restore();
}

/** Ink vignette and the caption band at the bottom. */
function grade(alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const v = ctx.createRadialGradient(W / 2, H / 2, 520, W / 2, H / 2, 1180);
  v.addColorStop(0, 'rgba(10,20,32,0)');
  v.addColorStop(1, 'rgba(10,20,32,0.38)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  const b = ctx.createLinearGradient(0, H - 430, 0, H);
  b.addColorStop(0, 'rgba(13,24,36,0)');
  b.addColorStop(1, 'rgba(13,24,36,0.78)');
  ctx.fillStyle = b;
  ctx.fillRect(0, H - 430, W, 430);
  ctx.restore();
}

/** A caption: brass rule and kicker, then the title lines rising out of a mask. */
function caption(c, t) {
  const inU = (t - c.at) / 0.9;
  const outU = (t - (c.end - 0.4)) / 0.4;
  if (inU <= 0 || outU >= 1) return;
  const fade = 1 - easeIn(clamp(outU));
  const x = 120;
  const base = H - 128;
  const lineH = 84;
  const titleTop = base - (c.title.length - 1) * lineH;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(0, -12 * easeIn(clamp(outU)));
  // Brass rule growing, then the kicker sliding in.
  const r = ramp(t, c.at, c.at + 0.5);
  ctx.fillStyle = C.brassLight;
  ctx.fillRect(x, titleTop - 92, 56 * r, 3);
  text(c.kicker.toUpperCase(), x + 76 - 14 * (1 - ramp(t, c.at + 0.1, c.at + 0.6)), titleTop - 81, {
    font: '500 22px "IBM Plex Mono"',
    color: C.brassLight,
    spacing: 4,
    alpha: ramp(t, c.at + 0.1, c.at + 0.6),
  });
  c.title.forEach((line, k) => {
    const u = ramp(t, c.at + 0.18 + k * 0.12, c.at + 0.88 + k * 0.12);
    const y = titleTop + k * lineH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 10, y - lineH + 10, W, lineH + 8);
    ctx.clip();
    ctx.shadowColor = 'rgba(8,14,22,0.55)';
    ctx.shadowBlur = 24;
    text(line, x, y + (1 - u) * lineH, { font: '600 74px Fraunces', color: C.paper });
    ctx.restore();
  });
  ctx.restore();
}

/** The symbol, small, in a corner over the footage. */
function watermark(alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha * 0.85;
  const size = 46;
  const s = size / logo.box[2];
  ctx.translate(96, 72);
  ctx.scale(s, s);
  ctx.translate(-logo.box[0] + logo.inner[0], -logo.box[1] + logo.inner[0]);
  ctx.scale(logo.inner[1], logo.inner[1]);
  ctx.strokeStyle = C.paper;
  ctx.lineWidth = 46;
  ctx.lineJoin = 'round';
  logo.lines.forEach((l) => ctx.stroke(l.path));
  ctx.fillStyle = C.brassLight;
  ctx.fill(logo.diamond);
  ctx.restore();
  text('ISOLINE', 156, 104, {
    font: '600 26px Fraunces',
    color: C.paper,
    spacing: 4,
    alpha: alpha * 0.85,
  });
}

/** Where the lock-up's brass diamond sits on screen (the iris opens from it). */
function diamondAt(x, y, size) {
  const s = size / logo.box[2];
  const map = (p, k) => x - size / 2 + (p * logo.inner[1] + logo.inner[0] - logo.box[k]) * s;
  return [map(470.8, 0), map(474, 1) - x + y];
}

// ------------------------------------------------------------------ the film
const LOGO_Y = 400;
const LOGO_SIZE = 300;

export async function renderFrame(f) {
  const t = f / FPS;
  // 1. Intro: paper, the symbol drawn, the wordmark and the slogan.
  if (t < INTRO_END + 0.1) {
    paper(t, 0.55 * ramp(t, 0, 1.2));
    lockup(W / 2, LOGO_Y, LOGO_SIZE, {
      draw: ramp(t, 0.25, 2.5, (u) => u),
      pop: ramp(t, 2.0, 2.6, (u) => clamp(u)),
      word: ramp(t, 2.3, 3.4, (u) => clamp(u)),
      slogan: ramp(t, 3.1, 3.9),
    });
  }
  // 2. Footage: each shot cross-fades into the next.
  const live = SHOTS.filter((s) => t >= s.at && t < s.end);
  if (live.length) {
    // The first shot opens through an iris from the diamond; the others dissolve.
    const first = SHOTS[0];
    const iris = ramp(t, first.at, first.at + 0.9, easeInOut);
    if (t < first.at + 0.9) {
      const [dx, dy] = diamondAt(W / 2, LOGO_Y, LOGO_SIZE);
      ctx.save();
      ctx.beginPath();
      ctx.arc(dx, dy, 1 + iris * 1400, 0, Math.PI * 2);
      ctx.clip();
      await footage(first, t, 1);
      grade(1);
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = C.brassLight;
      ctx.globalAlpha = 1 - iris;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(dx, dy, 1 + iris * 1400, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else {
      for (const s of live) {
        const a = s === live[0] ? 1 : ramp(t, s.at, s.at + 0.35, (u) => clamp(u));
        await footage(s, t, a);
      }
      // The last shot hands over to paper.
      const toPaper = ramp(t, OUTRO_AT - 0.3, OUTRO_AT + 0.5, easeInOut);
      grade(1 - toPaper);
      if (toPaper > 0) {
        ctx.save();
        ctx.globalAlpha = toPaper;
        paper(t, 0);
        ctx.restore();
      }
    }
    watermark(ramp(t, 5.4, 6.0) * (1 - ramp(t, OUTRO_AT - 0.6, OUTRO_AT)));
    for (const c of CAPTIONS) caption(c, t);
  }
  // 3. Outro: the lock-up again, what the game is and where to get it.
  if (t >= OUTRO_AT + 0.2) {
    const u = t - OUTRO_AT;
    paper(t, 0.55 * ramp(u, 0, 1.2));
    lockup(W / 2, LOGO_Y - 30, 230, {
      draw: ramp(u, 0.1, 1.5, (x) => x),
      pop: ramp(u, 1.1, 1.6, (x) => clamp(x)),
      word: ramp(u, 1.3, 2.2, (x) => clamp(x)),
      slogan: ramp(u, 1.9, 2.6),
    });
    const a = ramp(u, 2.6, 3.4);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = C.rule;
    ctx.fillRect(W / 2 - 160, 812, 320, 1.5);
    ctx.restore();
    text('Gratuit · macOS et Windows · Solo, campagne et réseau local', W / 2, 870, {
      font: '400 26px "IBM Plex Sans"',
      color: C.ink2,
      align: 'center',
      alpha: a,
    });
    text('github.com/Lippou/isoline', W / 2, 924, {
      font: '500 26px "IBM Plex Mono"',
      color: C.brass,
      spacing: 1,
      align: 'center',
      alpha: ramp(u, 3.0, 3.8),
    });
    // Fade to paper at the very end.
    const end = ramp(t, DURATION - 0.8, DURATION, (x) => clamp(x));
    if (end > 0) {
      ctx.save();
      ctx.globalAlpha = end;
      ctx.fillStyle = C.paper;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }
}

export async function init(config) {
  cfg = config;
  const canvas = document.querySelector('canvas');
  canvas.width = W;
  canvas.height = H;
  ctx = canvas.getContext('2d');
  buildLogo(config.symbolSvg);
  const fonts = [
    ['Fraunces', 'fraunces-latin-600-normal.woff2', { weight: '600' }],
    ['Fraunces', 'fraunces-latin-400-italic.woff2', { weight: '400', style: 'italic' }],
    ['IBM Plex Sans', 'ibm-plex-sans-latin-400-normal.woff2', { weight: '400' }],
    ['IBM Plex Mono', 'ibm-plex-mono-latin-500-normal.woff2', { weight: '500' }],
  ];
  for (const [family, file, desc] of fonts) {
    const dir =
      family === 'Fraunces' ? 'fraunces' : family === 'IBM Plex Sans' ? 'ibm-plex-sans' : 'ibm-plex-mono';
    const face = new FontFace(family, `url(${config.fonts}/${dir}/files/${file})`, desc);
    document.fonts.add(await face.load());
  }
  return { frames: FRAMES, fps: FPS, duration: DURATION };
}

window.trailer = { init, renderFrame };
