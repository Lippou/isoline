// GLSL (ES 3.0) sources for the map surface — realistic relief map with a political overlay.
// Textures:
//   uTerrain  RGBA8 nearest : r terrain id, g altitude, b coast distance, a deposit
//   uRelief   RGBA8 linear  : r altitude, g coast distance, b land mask (hillshade, depth, smooth coasts)
//   uOwner    RGBA8 nearest : rg owner id (16-bit), ba previous owner id
//   uState    RGBA8 nearest : r fallout, g flags (bit0 dead zone), b tick of last change (mod 256)
//   uPalette  RGBA8 nearest : 256×256 ink colour per owner id
//   uFog      R8    linear  : 0 unknown, 110 remembered, 255 visible (low resolution)

export const MAP_VERTEX = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

export const MAP_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uTerrain;
uniform sampler2D uRelief;
uniform sampler2D uOwner;
uniform sampler2D uState;
uniform sampler2D uPalette;
uniform sampler2D uFog;

uniform vec2 uSize;          // map size in tiles
uniform float uTime;         // seconds
uniform float uTick;         // interpolated simulation tick
uniform float uZoom;         // screen pixels per tile
uniform float uNight;        // 0 day … 1 deep night
uniform float uHighlight;    // owner id to highlight (-1 none)
uniform float uViewer;       // local player id
uniform float uFogOn;        // 1 = fog of war active
uniform float uTerrainView;  // 1 = cost heat-map
uniform float uQuality;      // 0 performance … 1 full effects
uniform float uPattern;      // 1 = colour-blind hatch patterns
uniform float uContrast;     // 1 = high contrast
uniform float uLoyaltyView;  // 1 = loyalty overlay on the viewer's land
uniform vec4 uWeather[8];    // x, y, radius, kind (0 storm, 1 fog, -1 none)
uniform vec4 uRing;          // battle royale: cx, cy, r, active

const float PI = 3.14159265;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

float ownerAt(ivec2 t) {
  t = clamp(t, ivec2(0), ivec2(uSize) - 1);
  vec4 o = texelFetch(uOwner, t, 0);
  return floor(o.r * 255.0 + 0.5) + floor(o.g * 255.0 + 0.5) * 256.0;
}

vec4 inkOf(float id) {
  return texelFetch(uPalette, ivec2(int(mod(id, 256.0)), int(floor(id / 256.0))), 0);
}

bool isWaterId(float t) { return t < 2.5; }

bool waterAt(ivec2 t) {
  t = clamp(t, ivec2(0), ivec2(uSize) - 1);
  return texelFetch(uTerrain, t, 0).r * 255.0 < 2.5;
}

// Realistic, satellite-like ground colours per terrain (with natural variation).
vec3 biome(float t, vec2 p, float elev) {
  float n = fbm(p * 0.06);
  float m = vnoise(p * 0.45);
  float fine = vnoise(p * 2.3);
  vec3 c;
  if (t < 3.5) {               // river
    c = vec3(0.16, 0.33, 0.47);
  } else if (t < 4.5) {        // plains: farmland and grassland
    c = mix(vec3(0.36, 0.47, 0.23), vec3(0.52, 0.55, 0.30), n);
    c = mix(c, vec3(0.30, 0.42, 0.20), smoothstep(0.55, 0.9, m) * 0.5);
    c *= 0.94 + 0.08 * fine;
  } else if (t < 5.5) {        // hills
    c = mix(vec3(0.43, 0.46, 0.27), vec3(0.52, 0.48, 0.32), n);
  } else if (t < 6.5) {        // mountains: rock, then snow on the high ground
    c = mix(vec3(0.42, 0.39, 0.34), vec3(0.56, 0.53, 0.48), n * 0.7 + fine * 0.3);
    float snow = smoothstep(0.7, 0.86, elev + (m - 0.5) * 0.1);
    c = mix(c, vec3(0.84, 0.86, 0.89), snow * 0.85);
  } else if (t < 7.5) {        // desert: sand seas and darker regs
    float dune = sin(p.x * 0.7 + p.y * 0.25 + n * 6.0) * 0.5 + 0.5;
    c = mix(vec3(0.79, 0.67, 0.46), vec3(0.86, 0.75, 0.54), dune * 0.5 + m * 0.5);
    c = mix(c, vec3(0.70, 0.58, 0.42), smoothstep(0.55, 0.9, vnoise(p * 0.12)) * 0.3);
  } else if (t < 8.5) {        // forest: dense canopy
    float canopy = smoothstep(0.35, 0.8, fine);
    c = mix(vec3(0.17, 0.30, 0.14), vec3(0.12, 0.23, 0.11), canopy);
    c = mix(c, vec3(0.22, 0.33, 0.17), n * 0.5);
  } else if (t < 9.5) {        // tundra and ice fields
    c = mix(vec3(0.55, 0.56, 0.48), vec3(0.72, 0.73, 0.68), n);
    c = mix(c, vec3(0.90, 0.92, 0.95), smoothstep(0.6, 0.85, m) * 0.6);
  } else {                     // glaciers and impassable walls
    c = mix(vec3(0.86, 0.90, 0.95), vec3(0.74, 0.80, 0.88), smoothstep(0.5, 0.9, fine));
  }
  return c;
}

// Terrain colour bilinearly blended between the four nearest tile centres
// (soft biome transitions instead of square pixels).
vec3 landColour(vec2 tp, float elev) {
  // Domain warp: irregular, natural-looking biome boundaries (visual only).
  vec2 warp = vec2(fbm(tp * 0.07), fbm(tp * 0.07 + vec2(5.2, 1.3))) - 0.5;
  vec2 q = tp + warp * 7.0 - 0.5;
  ivec2 i0 = ivec2(floor(q));
  vec2 fq = fract(q);
  fq = fq * fq * (3.0 - 2.0 * fq);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    ivec2 tc = clamp(i0 + o, ivec2(0), ivec2(uSize) - 1);
    float id = floor(texelFetch(uTerrain, tc, 0).r * 255.0 + 0.5);
    if (id < 2.5) continue;
    float w = (o.x == 1 ? fq.x : 1.0 - fq.x) * (o.y == 1 ? fq.y : 1.0 - fq.y);
    acc += biome(id, tp, elev) * w;
    wsum += w;
  }
  return wsum > 0.0 ? acc / wsum : biome(4.0, tp, elev);
}

vec3 heat(float t) {
  // Terrain view: attack cost (mag) heat-map.
  if (t < 2.5) return vec3(0.05, 0.10, 0.18);
  if (t < 3.5) return vec3(0.85, 0.70, 0.25);
  if (t < 4.5 || (t > 6.5 && t < 7.5)) return vec3(0.35, 0.75, 0.45);
  if (t < 5.5) return vec3(0.90, 0.75, 0.30);
  if (t < 6.5) return vec3(0.95, 0.35, 0.30);
  if (t < 8.5) return vec3(0.65, 0.80, 0.35);
  if (t < 9.5) return vec3(0.85, 0.60, 0.30);
  return vec3(0.15, 0.12, 0.15);
}

void main() {
  vec2 tp = vUV * uSize;
  ivec2 ti = ivec2(floor(tp));
  vec2 f = fract(tp);
  vec4 ter = texelFetch(uTerrain, ti, 0);
  float tId = floor(ter.r * 255.0 + 0.5);
  vec2 rel = texture(uRelief, vUV).rg;
  float elev = rel.r;
  float coast = rel.g * 255.0 / 4.0; // render-only chamfer distance, quarter-tile precision
  float pxPerTile = max(uZoom, 0.0001);
  bool water = isWaterId(tId);
  vec3 col;

  // Smooth coastline from the filtered land mask (gameplay still uses whole tiles).
  float landMask = texture(uRelief, vUV).b;
  float coastNoise = (vnoise(tp * 1.7) - 0.5) * 0.25;
  float landA = smoothstep(0.42, 0.58, landMask + coastNoise);
  if (pxPerTile < 2.0) landA = water ? 0.0 : 1.0;

  // Ocean: depth gradient, sun glint, coastal shallows and surf.
  float depth = clamp(coast / 50.0, 0.0, 1.0);
  float shelf = fbm(tp * 0.04) * 0.18;
  vec3 sea = mix(vec3(0.10, 0.33, 0.42), vec3(0.04, 0.17, 0.32), smoothstep(0.0, 0.16 + shelf, depth));
  sea = mix(sea, vec3(0.02, 0.08, 0.20), smoothstep(0.25, 1.0, depth));
  if (tId > 1.5 && tId < 2.5) sea = mix(vec3(0.10, 0.30, 0.40), vec3(0.06, 0.22, 0.34), depth);
  if (uQuality > 0.5) {
    float wv = fbm(tp * 0.22 + vec2(uTime * 0.04, uTime * 0.025));
    sea *= 0.94 + 0.12 * wv;
    sea += vec3(0.10, 0.12, 0.12) * pow(smoothstep(0.62, 0.9, wv), 3.0) * (1.0 - depth * 0.5);
  }
  float surf = (1.0 - smoothstep(0.0, 1.6, coast)) * (0.75 + 0.25 * sin(uTime * 1.3 + tp.x * 0.8 + tp.y * 0.6));
  sea = mix(sea, vec3(0.72, 0.84, 0.86), surf * 0.22);

  vec3 ground = pxPerTile < 2.0 ? biome(water ? 4.0 : tId, tp, elev) : landColour(tp, elev);
  if (uQuality > 0.5) {
    // Hillshade (sun from the north-west) — the relief carries the realism.
    vec2 px = 1.0 / uSize;
    float ex = texture(uRelief, vUV + vec2(px.x, 0.0)).r - texture(uRelief, vUV - vec2(px.x, 0.0)).r;
    float ey = texture(uRelief, vUV + vec2(0.0, px.y)).r - texture(uRelief, vUV - vec2(0.0, px.y)).r;
    vec3 nrm = normalize(vec3(-ex * 26.0, -ey * 26.0, 1.0));
    float shade = dot(nrm, normalize(vec3(-0.55, -0.65, 0.8)));
    ground *= 0.62 + 0.5 * shade;
    // Light atmospheric haze on low plains, crisper highlands.
    ground = mix(ground, ground * vec3(1.03, 1.02, 0.98), smoothstep(0.5, 0.9, elev));
  }
  if (!water && tId > 2.5 && tId < 3.5) ground = mix(ground, vec3(0.16, 0.33, 0.47), 0.75); // rivers
  // Beaches: a thin sand fringe on the land side of the coast.
  float beach = landA * (1.0 - smoothstep(0.5, 0.75, landMask)) * step(0.5, 1.0 - float(tId > 5.5 && tId < 6.5));
  ground = mix(ground, vec3(0.80, 0.74, 0.58), beach * 0.45);
  col = mix(sea, ground, landA);
  water = landA < 0.5;

  if (uTerrainView > 0.5) col = mix(col, heat(tId), 0.55);

  // ---------------------------------------------------------------- territory
  vec3 atlas = col; // terrain only: what the fog of war still shows
  float own = ownerAt(ti);
  vec4 st = texelFetch(uState, ti, 0);
  float fallout = st.r;
  float flags = floor(st.g * 255.0 + 0.5);
  if (own > 0.5 && !water) {
    vec4 o = texelFetch(uOwner, ti, 0);
    float prev = floor(o.b * 255.0 + 0.5) + floor(o.a * 255.0 + 0.5) * 256.0;
    vec3 ink = inkOf(own).rgb;
    vec3 inkPrev = prev > 0.5 ? inkOf(prev).rgb : col;
    // Ink diffusion after a conquest: noisy threshold sweeping over ~0.7 s.
    float changed = floor(st.b * 255.0 + 0.5);
    float age = mod(uTick - changed + 256.0, 256.0);
    float k = clamp(age / 7.0, 0.0, 1.0);
    float n = vnoise(tp * 0.45);
    float spread = smoothstep(n - 0.25, n + 0.25, k * 1.5 - 0.25);
    vec3 inkNow = mix(inkPrev, ink, spread);
    // Political-map fill: translucent, the terrain stays fully readable.
    float fill = uContrast > 0.5 ? 0.55 : 0.42;
    if (own == uHighlight) fill += 0.1;
    vec3 tinted = mix(col, inkNow * (0.6 + 0.6 * dot(col, vec3(0.333))) + inkNow * 0.25, fill);
    if (uPattern > 0.5) {
      float ang = mod(own, 4.0) * PI * 0.25;
      float s = sin((tp.x * cos(ang) + tp.y * sin(ang)) * 1.6);
      tinted *= 0.86 + 0.14 * step(0.0, s);
    }
    col = tinted;
  } else if (own > 0.5 && water) {
    // (never happens: water is not owned)
  }

  // Borders: screen-space glowing ink lines with a slow flowing pulse.
  {
    // Water neighbours do not make a border (coasts stay clean): treat them as "same owner".
    float l = waterAt(ti + ivec2(-1, 0)) ? own : ownerAt(ti + ivec2(-1, 0));
    float r = waterAt(ti + ivec2(1, 0)) ? own : ownerAt(ti + ivec2(1, 0));
    float u = waterAt(ti + ivec2(0, -1)) ? own : ownerAt(ti + ivec2(0, -1));
    float d = waterAt(ti + ivec2(0, 1)) ? own : ownerAt(ti + ivec2(0, 1));
    float dist = 9.0;
    float other = own;
    if (l != own) { dist = min(dist, f.x); other = l; }
    if (r != own) { dist = min(dist, 1.0 - f.x); other = r; }
    if (u != own) { dist = min(dist, f.y); other = u; }
    if (d != own) { dist = min(dist, 1.0 - f.y); other = d; }
    float side = own > 0.5 ? own : other;
    if (dist < 9.0 && side > 0.5 && !water) {
      // Crisp double-stroked border: a solid line in the owner's colour, edged in dark.
      float dpx = dist * pxPerTile;
      vec3 ink = inkOf(side).rgb;
      float width = uContrast > 0.5 ? 2.2 : 1.6;
      float line = 1.0 - smoothstep(width - 0.6, width + 0.4, dpx);
      float edge = (1.0 - smoothstep(width + 0.3, width + 1.4, dpx)) * (1.0 - line);
      float inner = exp(-dpx / 6.0) * 0.18; // colour deepens towards the frontier
      if (pxPerTile < 1.5) { line = 0.9; edge = 0.0; inner = 0.0; }
      float wild = (own < 0.5 || other < 0.5) ? 0.7 : 1.0;
      if (own > 0.5) col = mix(col, ink, inner);
      col = mix(col, col * 0.35, edge * 0.6 * wild);
      col = mix(col, ink * 1.1 + 0.04, line * wild);
    }
  }

  // Fallout: charred ash veined with thin glowing cracks (brighter when fresh).
  if (fallout > 0.0) {
    float lumF = dot(atlas, vec3(0.3, 0.5, 0.2));
    float grain = fbm(tp * 0.3);
    vec3 ash = mix(vec3(0.07, 0.065, 0.06), vec3(0.20, 0.18, 0.15), lumF * 0.8 + grain * 0.35);
    float ridge = 1.0 - abs(2.0 * fbm(tp * 0.11 + vec2(3.1, 7.7)) - 1.0);
    float vein = smoothstep(0.9, 0.985, ridge);
    float pulse = 0.75 + 0.25 * sin(uTime * 1.7 + grain * 6.0);
    vec3 glow = mix(vec3(0.95, 0.62, 0.18), vec3(0.72, 0.95, 0.30), grain);
    vec3 burnt = ash + glow * vein * pulse * (0.35 + 0.65 * fallout);
    col = mix(col, burnt, clamp(0.25 + fallout * 0.75, 0.0, 0.92));
  }
  // Dead zone (battle royale).
  if (mod(flags, 2.0) > 0.5) {
    float hatch = step(0.5, fract((tp.x + tp.y) * 0.25));
    col = mix(vec3(0.07, 0.03, 0.05), vec3(0.16, 0.05, 0.07), hatch);
  }
  if (uRing.w > 0.5) {
    float dr = abs(length(tp - uRing.xy) - uRing.z) * pxPerTile;
    col += vec3(0.95, 0.25, 0.3) * exp(-dr / 2.5) * (0.6 + 0.4 * sin(uTime * 3.0));
  }

  // Weather: storms darken and swirl, fog banks veil.
  if (uQuality > 0.5) {
    for (int k = 0; k < 8; k++) {
      vec4 wc = uWeather[k];
      if (wc.w < -0.5) continue;
      float dd = length(tp - wc.xy) / max(wc.z, 1.0);
      if (dd > 1.25) continue;
      float edge = 1.0 - smoothstep(0.65, 1.2, dd);
      float swirl = fbm(tp * 0.03 + vec2(uTime * 0.04, -uTime * 0.03) + wc.xy * 0.01);
      if (wc.w < 0.5) {
        col = mix(col, vec3(0.06, 0.07, 0.10), edge * (0.35 + 0.35 * swirl));
        float flash = step(0.985, hash(vec2(floor(uTime * 6.0), wc.x))) * edge;
        col += vec3(0.45, 0.5, 0.65) * flash * 0.4;
      } else {
        col = mix(col, vec3(0.55, 0.60, 0.65), edge * (0.28 + 0.3 * swirl));
      }
    }
  }

  // Fog of war: drifting cloud cover over what the player cannot see.
  if (uFogOn > 0.5) {
    float v = texture(uFog, vUV).r;
    float lum = dot(atlas, vec3(0.3, 0.5, 0.2));
    vec3 grey = mix(vec3(lum), atlas, 0.35);
    float cloud = fbm(tp * 0.025 + vec2(uTime * 0.01, uTime * 0.006));
    vec3 veil = mix(vec3(0.60, 0.64, 0.70), vec3(0.85, 0.87, 0.90), cloud);
    vec3 unknown = mix(grey * 0.45, veil, 0.45 + 0.25 * cloud);
    vec3 remembered = mix(grey * 0.65, veil, 0.22);
    col = v < 0.43 ? mix(unknown, remembered, smoothstep(0.0, 0.43, v)) : mix(remembered, col, smoothstep(0.6, 1.0, v));
  }

  // Loyalty overlay (N): red = restless, green = loyal (viewer's tiles only).
  if (uLoyaltyView > 0.5) {
    float lv = texture(uFog, vUV).g;
    if (lv > 0.002) {
      vec3 heatL = mix(vec3(0.95, 0.25, 0.25), vec3(0.35, 0.9, 0.5), smoothstep(0.15, 0.85, lv));
      col = mix(col, heatL, 0.55);
    } else {
      col *= 0.55;
    }
  }

  // Night: cool, darker ink.
  float lumN = dot(col, vec3(0.3, 0.5, 0.2));
  vec3 nightCol = mix(vec3(lumN), col, 0.5) * vec3(0.32, 0.38, 0.58);
  col = mix(col, nightCol, uNight * 0.9);
  finalColor = vec4(col, 1.0);
}
`;
