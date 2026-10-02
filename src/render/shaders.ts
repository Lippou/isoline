// GLSL (ES 3.0) sources for the map surface — realistic relief map with a political overlay.
// Textures:
//   uTerrain  RGBA8 nearest : r terrain id, g altitude, b coast distance, a deposit
//   uRelief   RGBA8 linear  : r altitude, g coast distance, b land mask (hillshade, depth, smooth coasts),
//                             a navigable-river mask (ribbons drawn over the political fill)
//   uOwner    RGBA8 nearest : rg owner id (16-bit), ba previous owner id
//   uState    RGBA8 nearest : r fallout, g flags (bit0 dead zone), b tick of last change (mod 256)
//   uPalette  RGBA8 nearest : 256×256 ink colour per owner id (a: relation to the viewer, see setPalette)
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
uniform vec4 uWeather[8];    // x, y, radius, code: -1 none, 0…1 storm (intensity), 2…3 fog bank (2 + intensity)
uniform float uMotion;       // 1 = animated weather (lightning); 0 with reduced motion
uniform vec4 uRing;          // battle royale: cx, cy, r, active
uniform float uClouds;       // 0…1 drifting cloud cover (zoomed far out)
uniform float uWorld;        // ground & sea palette: 0 Earth, 1 Mars, 2 Moon, 3 Titan, 4 8-bit (map meta "palette")

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

// Ground of the non-Earth palettes (planets, 8-bit world): same terrain ids, other colours.
vec3 worldBiome(float t, vec2 p, float elev) {
  float n = fbm(p * 0.06);
  float m = vnoise(p * 0.45);
  float fine = vnoise(p * 2.3);
  float dune = sin(p.x * 0.7 + p.y * 0.25 + n * 6.0) * 0.5 + 0.5;
  vec3 c;
  if (uWorld < 1.5) {          // Mars: rust plains, ochre dunes, dark basalt heights, CO2 frost
    if (t < 3.5) c = vec3(0.42, 0.24, 0.17);
    else if (t < 4.5) c = mix(vec3(0.64, 0.35, 0.21), vec3(0.74, 0.45, 0.28), n) * (0.94 + 0.08 * fine);
    else if (t < 5.5) c = mix(vec3(0.53, 0.30, 0.20), vec3(0.62, 0.38, 0.25), n);
    else if (t < 6.5) {
      c = mix(vec3(0.42, 0.25, 0.19), vec3(0.56, 0.35, 0.27), n * 0.7 + fine * 0.3);
      c = mix(c, vec3(0.72, 0.55, 0.46), smoothstep(0.85, 0.97, elev) * 0.5);
    } else if (t < 7.5) c = mix(vec3(0.77, 0.51, 0.31), vec3(0.86, 0.61, 0.39), dune * 0.5 + m * 0.5);
    else if (t < 8.5) c = vec3(0.50, 0.29, 0.19);
    else if (t < 9.5) c = mix(vec3(0.78, 0.65, 0.58), vec3(0.93, 0.89, 0.86), smoothstep(0.3, 0.8, m));
    else c = mix(vec3(0.95, 0.94, 0.93), vec3(0.86, 0.84, 0.84), smoothstep(0.5, 0.9, fine));
  } else if (uWorld < 2.5) {   // Moon: regolith greys, bright crater rims and ejecta
    float g;
    if (t < 4.5) g = mix(0.60, 0.68, n);
    else if (t < 5.5) g = mix(0.55, 0.64, n);
    else if (t < 6.5) g = mix(0.66, 0.80, n * 0.6 + fine * 0.4);
    else if (t < 9.5) g = mix(0.70, 0.79, m * 0.6 + n * 0.4);
    else g = 0.86;
    c = vec3(g, g * 0.985, g * 0.95) * (0.95 + 0.07 * fine);
  } else if (uWorld < 3.5) {   // Titan: orange plains, dark dune seas, bright icy highlands
    if (t < 3.5) c = vec3(0.20, 0.15, 0.11);
    else if (t < 4.5) c = mix(vec3(0.60, 0.43, 0.24), vec3(0.69, 0.51, 0.29), n) * (0.95 + 0.07 * fine);
    else if (t < 5.5) c = mix(vec3(0.72, 0.60, 0.42), vec3(0.80, 0.69, 0.51), n);
    else if (t < 6.5) c = mix(vec3(0.76, 0.68, 0.55), vec3(0.86, 0.79, 0.66), n * 0.7 + fine * 0.3);
    else if (t < 7.5) c = mix(vec3(0.33, 0.23, 0.14), vec3(0.43, 0.30, 0.18), dune * 0.6 + m * 0.4);
    else if (t < 8.5) c = vec3(0.52, 0.38, 0.22);
    else if (t < 9.5) c = mix(vec3(0.52, 0.43, 0.31), vec3(0.62, 0.52, 0.38), m);
    else c = vec3(0.86, 0.79, 0.66);
  } else {                     // 8-bit: flat console colours, a faint one-tile dither
    if (t < 3.5) c = vec3(0.20, 0.45, 0.95);
    else if (t < 4.5) c = vec3(0.38, 0.76, 0.27);
    else if (t < 5.5) c = vec3(0.74, 0.62, 0.30);
    else if (t < 6.5) c = elev > 0.95 ? vec3(0.95, 0.96, 0.98) : vec3(0.56, 0.52, 0.50);
    else if (t < 7.5) c = vec3(0.94, 0.83, 0.46);
    else if (t < 8.5) c = vec3(0.10, 0.50, 0.20);
    else if (t < 9.5) c = vec3(0.90, 0.93, 0.98);
    else c = vec3(0.32, 0.30, 0.34);
    c *= 0.97 + 0.03 * mod(floor(p.x) + floor(p.y), 2.0);
  }
  return c;
}

// Seas of the non-Earth palettes: Martian ocean, basalt maria, methane seas, flat 8-bit water.
vec3 worldSea(float depth, bool lake, vec2 p) {
  float wv = uQuality > 0.5 ? fbm(p * 0.22 + vec2(uTime * 0.04, uTime * 0.025)) : 0.5;
  if (uWorld < 1.5) return mix(vec3(0.27, 0.47, 0.53), vec3(0.10, 0.22, 0.34), smoothstep(0.0, 0.6, depth)) * (0.95 + 0.1 * wv);
  if (uWorld < 2.5) return mix(vec3(0.33, 0.34, 0.38), vec3(0.20, 0.21, 0.26), smoothstep(0.0, 0.5, depth)) * (0.97 + 0.06 * fbm(p * 0.05));
  if (uWorld < 3.5) {
    vec3 c = mix(vec3(0.24, 0.19, 0.14), vec3(0.09, 0.08, 0.08), smoothstep(0.0, 0.4, depth));
    return c + vec3(0.10, 0.06, 0.02) * pow(smoothstep(0.6, 0.9, wv), 3.0);
  }
  // 8-bit: depth read at the centre of 8×8-tile blocks, in three flat steps.
  float blockDepth = clamp(texture(uRelief, (floor(p / 8.0) * 8.0 + 4.0) / uSize).g * 255.0 / 200.0, 0.0, 1.0);
  float d = floor(blockDepth * 3.0 + (lake ? 0.0 : 0.6)) / 3.0;
  return mix(vec3(0.27, 0.53, 0.97), vec3(0.11, 0.26, 0.72), clamp(d, 0.0, 1.0));
}

// Realistic, satellite-like ground colours per terrain (with natural variation).
vec3 biome(float t, vec2 p, float elev) {
  if (uWorld > 0.5) return worldBiome(t, p, elev);
  float n = fbm(p * 0.06);
  float m = vnoise(p * 0.45);
  float fine = vnoise(p * 2.3);
  vec3 c;
  if (t < 3.5) {               // river
    c = vec3(0.22, 0.49, 0.6);
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
  if (pxPerTile < 2.0 || uWorld > 3.5) landA = water ? 0.0 : 1.0; // (8-bit: staircase coasts)

  // Ocean: depth gradient, sun glint, coastal shallows and surf.
  float depth = clamp(coast / 50.0, 0.0, 1.0);
  float shelf = fbm(tp * 0.04) * 0.18;
  // Daylight chart waters: luminous shallows, clear blue deeps (BRAND.md §4).
  vec3 sea = mix(vec3(0.24, 0.56, 0.64), vec3(0.13, 0.38, 0.55), smoothstep(0.0, 0.16 + shelf, depth));
  sea = mix(sea, vec3(0.09, 0.29, 0.47), smoothstep(0.25, 1.0, depth));
  if (tId > 1.5 && tId < 2.5) sea = mix(vec3(0.22, 0.52, 0.60), vec3(0.15, 0.42, 0.54), depth);
  if (uQuality > 0.5) {
    float wv = fbm(tp * 0.22 + vec2(uTime * 0.04, uTime * 0.025));
    sea *= 0.94 + 0.12 * wv;
    sea += vec3(0.10, 0.12, 0.12) * pow(smoothstep(0.62, 0.9, wv), 3.0) * (1.0 - depth * 0.5);
  }
  float surf = (1.0 - smoothstep(0.0, 1.6, coast)) * (0.75 + 0.25 * sin(uTime * 1.3 + tp.x * 0.8 + tp.y * 0.6));
  sea = mix(sea, vec3(0.72, 0.84, 0.86), surf * 0.22);
  if (uWorld > 0.5) sea = worldSea(depth, tId > 1.5 && tId < 2.5, tp);

  vec3 ground = pxPerTile < 2.0 || uWorld > 3.5 ? biome(water ? 4.0 : tId, tp, elev) : landColour(tp, elev);
  if (uQuality > 0.5) {
    // Hillshade (sun from the north-west) — the relief carries the realism.
    vec2 px = 1.0 / uSize;
    float ex = texture(uRelief, vUV + vec2(px.x, 0.0)).r - texture(uRelief, vUV - vec2(px.x, 0.0)).r;
    float ey = texture(uRelief, vUV + vec2(0.0, px.y)).r - texture(uRelief, vUV - vec2(0.0, px.y)).r;
    vec3 nrm = normalize(vec3(-ex * 26.0, -ey * 26.0, 1.0));
    float shade = dot(nrm, normalize(vec3(-0.55, -0.65, 0.8)));
    ground *= 0.84 + 0.3 * shade;
    // Light atmospheric haze on low plains, crisper highlands.
    ground = mix(ground, ground * vec3(1.03, 1.02, 0.98), smoothstep(0.5, 0.9, elev));
  }
  if (!water && tId > 2.5 && tId < 3.5) ground = mix(ground, vec3(0.22, 0.49, 0.6), 0.75); // rivers
  // Beaches: a thin sand fringe on the land side of the coast.
  float beach = landA * (1.0 - smoothstep(0.5, 0.75, landMask)) * step(0.5, 1.0 - float(tId > 5.5 && tId < 6.5));
  ground = mix(ground, vec3(0.80, 0.74, 0.58), beach * (uWorld > 0.5 ? 0.0 : 0.45));
  col = mix(sea, ground, landA);
  water = landA < 0.5;

  if (uTerrainView > 0.5) col = mix(col, heat(tId), 0.55);

  // ---------------------------------------------------------------- territory
  vec3 atlas = col; // terrain only: what the fog of war still shows
  float ownT = ownerAt(ti);
  float own = ownT;
  // Smooth political edges (zoomed in): ownership is blended over the four nearest
  // tile centres, so borders and fronts follow rounded curves instead of the tile
  // staircase. Visual only: the simulation still owns whole tiles.
  float otherS = own; // strongest other owner around
  float coverS = 1.0; // the displayed owner's share of the neighbourhood (0.5 on the edge)
  bool smoothEdges = pxPerTile >= 1.5;
  if (smoothEdges) {
    vec2 q = tp - 0.5;
    ivec2 c0 = ivec2(floor(q));
    vec2 fq = fract(q);
    vec4 oo = vec4(ownerAt(c0), ownerAt(c0 + ivec2(1, 0)), ownerAt(c0 + ivec2(0, 1)), ownerAt(c0 + ivec2(1, 1)));
    vec4 wq = vec4((1.0 - fq.x) * (1.0 - fq.y), fq.x * (1.0 - fq.y), (1.0 - fq.x) * fq.y, fq.x * fq.y);
    // Water takes no part (coasts are smoothed by the land mask).
    if (waterAt(c0)) wq.x = 0.0;
    if (waterAt(c0 + ivec2(1, 0))) wq.y = 0.0;
    if (waterAt(c0 + ivec2(0, 1))) wq.z = 0.0;
    if (waterAt(c0 + ivec2(1, 1))) wq.w = 0.0;
    float total = wq.x + wq.y + wq.z + wq.w;
    if (total > 0.0) {
      vec4 sh = vec4(
        dot(wq, vec4(equal(oo, vec4(oo.x)))),
        dot(wq, vec4(equal(oo, vec4(oo.y)))),
        dot(wq, vec4(equal(oo, vec4(oo.z)))),
        dot(wq, vec4(equal(oo, vec4(oo.w))))
      );
      float bo = oo.x; float bs = sh.x;
      if (sh.y > bs) { bo = oo.y; bs = sh.y; }
      if (sh.z > bs) { bo = oo.z; bs = sh.z; }
      if (sh.w > bs) { bo = oo.w; bs = sh.w; }
      float so = bo; float ss = 0.0;
      if (oo.x != bo && sh.x > ss) { so = oo.x; ss = sh.x; }
      if (oo.y != bo && sh.y > ss) { so = oo.y; ss = sh.y; }
      if (oo.z != bo && sh.z > ss) { so = oo.z; ss = sh.z; }
      if (oo.w != bo && sh.w > ss) { so = oo.w; ss = sh.w; }
      own = bo;
      otherS = so;
      coverS = bs / total;
    }
  }
  vec4 st = texelFetch(uState, ti, 0);
  float fallout = st.r;
  float flags = floor(st.g * 255.0 + 0.5);
  if (own > 0.5 && !water) {
    vec4 o = texelFetch(uOwner, ti, 0);
    float prev = floor(o.b * 255.0 + 0.5) + floor(o.a * 255.0 + 0.5) * 256.0;
    vec3 ink = inkOf(own).rgb;
    // (The diffusion follows the tile under the pixel; smoothed edge pixels show the new ink.)
    vec3 inkPrev = own != ownT ? ink : prev > 0.5 ? inkOf(prev).rgb : col;
    // Ink diffusion after a conquest: noisy threshold sweeping over ~0.7 s.
    float changed = floor(st.b * 255.0 + 0.5);
    float age = mod(uTick - changed + 256.0, 256.0);
    float k = clamp(age / 7.0, 0.0, 1.0);
    float n = vnoise(tp * 0.45);
    float spread = smoothstep(n - 0.25, n + 0.25, k * 1.5 - 0.25);
    vec3 inkNow = mix(inkPrev, ink, spread);
    // Political-map fill: an even country colour. Under a country the terrain is
    // flattened (biome patches would otherwise read as waves across the territory);
    // only a soft trace of the relief light remains.
    // Only a whisper of the relief light is kept (±3 %), and no biome colour at all.
    float lumT = dot(col, vec3(0.3, 0.5, 0.2));
    float relief = 0.97 + 0.06 * smoothstep(0.2, 0.8, lumT);
    vec3 calm = vec3(0.47) * relief;
    float fill = uContrast > 0.5 ? 0.72 : 0.62;
    if (own == uHighlight) fill += 0.08;
    vec3 tinted = mix(calm, inkNow * 1.03 * relief, fill);
    if (uPattern > 0.5) {
      float ang = mod(own, 4.0) * PI * 0.25;
      float s = sin((tp.x * cos(ang) + tp.y * sin(ang)) * 1.6);
      tinted *= 0.86 + 0.14 * step(0.0, s);
    }
    col = tinted;
  } else if (own > 0.5 && water) {
    // (never happens: water is not owned)
  }

  // Navigable rivers: a smooth blue ribbon over land and countries alike (ships sail them).
  // The bilinear mask is 1 on the river's centre line, falling to 0 one tile away.
  float riv = texture(uRelief, vUV).a;
  float rivAA = max(fwidth(riv), 0.02); // (derivatives outside any branch)
  if (!water) {
    if (riv > 0.02) {
      float hw = clamp(1.3 / pxPerTile, 0.34, 0.5); // half-width in tiles, ≥ ~1.3 px on screen
      float aa = rivAA;
      float ribbon = smoothstep(1.0 - hw - aa, 1.0 - hw + aa, riv);
      float banks = smoothstep(1.0 - hw - 0.18 - aa, 1.0 - hw - 0.18 + aa, riv) * (1.0 - ribbon);
      float fade = smoothstep(0.45, 1.1, pxPerTile);
      vec3 flow = vec3(0.30, 0.62, 0.78);
      if (uQuality > 0.5) flow *= 0.95 + 0.08 * vnoise(tp * 0.9 + vec2(uTime * 0.35, 0.0));
      col = mix(col, col * 0.62, banks * 0.5 * fade);
      col = mix(col, flow, ribbon * 0.9 * fade);
    }
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
    if (smoothEdges) {
      // Distance to the blended edge, in screen pixels.
      if (otherS != own) {
        dist = (coverS - 0.5) / max(fwidth(coverS), 1e-4) / pxPerTile;
        other = otherS;
      }
    } else {
      if (l != own) { dist = min(dist, f.x); other = l; }
      if (r != own) { dist = min(dist, 1.0 - f.x); other = r; }
      if (u != own) { dist = min(dist, f.y); other = u; }
      if (d != own) { dist = min(dist, 1.0 - f.y); other = d; }
    }
    float side = own > 0.5 ? own : other;
    if (dist < 9.0 && side > 0.5 && !water) {
      // Crisp double-stroked border: a solid line in the owner's colour, edged in dark.
      float dpx = dist * pxPerTile;
      vec4 pal = inkOf(side);
      vec3 ink = pal.rgb;
      // Relation tint (as in OpenFront): allies green, wars red (pulsing), embargoes red.
      float rel = floor((1.0 - pal.a) * 255.0 / 50.0 + 0.5);
      if (rel > 0.5 && rel < 1.5) ink = mix(ink, vec3(0.30, 0.95, 0.50), 0.5);
      else if (rel > 1.5 && rel < 2.5) ink = mix(ink, vec3(1.0, 0.22, 0.22), 0.55 + 0.15 * sin(uTime * 4.0));
      else if (rel > 2.5 && rel < 3.5) ink = mix(ink, vec3(0.95, 0.30, 0.30), 0.35);
      // Threatened border (4): a neighbour massing a much bigger army. Only the stretch it
      // shares with the viewer, on both sides, breathing slowly in amber.
      float relO = (own > 0.5 && other > 0.5) ? floor((1.0 - inkOf(other).a) * 255.0 / 50.0 + 0.5) : 0.0;
      float threat = ((rel > 3.5 && other == uViewer) || (own == uViewer && relO > 3.5)) ? 1.0 : 0.0;
      ink = mix(ink, vec3(0.98, 0.68, 0.20), threat * (0.68 + 0.2 * sin(uTime * 1.6)));
      float width = (uContrast > 0.5 ? 2.4 : 2.0) + 0.6 * threat;
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

  // High clouds drifting over the world when zoomed far out (life on the map), with a
  // faint shadow cast slightly south-east.
  if (uClouds > 0.01) {
    // Kept out of the weather cells, so the decorative clouds never pass for a storm or a fog bank.
    float clear = 1.0;
    for (int k = 0; k < 8; k++) {
      vec4 wc = uWeather[k];
      if (wc.w < -0.5) continue;
      clear = min(clear, smoothstep(0.85, 1.35, length(tp - wc.xy) / max(wc.z, 1.0)));
    }
    float amount = uClouds * clear;
    vec2 cp = tp * 0.0065 + vec2(uTime * 0.0035, uTime * 0.0012);
    float cl = smoothstep(0.5, 0.8, fbm(cp * 3.0 + fbm(cp * 1.7) * 0.6));
    float sh = smoothstep(0.5, 0.8, fbm((cp - vec2(0.012, 0.008)) * 3.0 + fbm((cp - vec2(0.012, 0.008)) * 1.7) * 0.6));
    col = mix(col, col * 0.86, sh * 0.5 * amount);
    col = mix(col, vec3(0.97, 0.98, 1.0), cl * 0.32 * amount);
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

  // Weather cells: public, so drawn over the fog of war, at every quality (cheaper noise in
  // performance mode). Storms: dark rain bands curling around the eye, falling rain streaks
  // and lightning; fog banks: pale veils stretched along the wind.
  for (int k = 0; k < 8; k++) {
    vec4 wc = uWeather[k];
    if (wc.w < -0.5) continue;
    vec2 rel = tp - wc.xy;
    float rad = max(wc.z, 1.0);
    float dd = length(rel) / rad;
    if (dd > 1.2) continue;
    bool fogBank = wc.w > 1.5;
    float inten = clamp(fogBank ? wc.w - 2.0 : wc.w, 0.0, 1.0);
    // Ragged, slowly breathing edge.
    float rim = vnoise(rel * (3.0 / rad) + wc.xy * 0.01 + uTime * 0.05) - 0.5;
    float body = (1.0 - smoothstep(0.72, 1.06, dd + rim * 0.2)) * inten;
    if (body < 0.002) continue;
    if (!fogBank) {
      float ang = atan(rel.y, rel.x);
      float swirl = sin(ang * 3.0 - dd * 7.0 + uTime * 0.25 + wc.x * 0.1) * 0.5 + 0.5;
      float cloud = uQuality > 0.5
        ? fbm(rel * (2.2 / rad) + vec2(uTime * 0.02, -uTime * 0.015) + wc.xy * 0.02)
        : vnoise(rel * (2.6 / rad) + wc.xy * 0.02 + vec2(uTime * 0.02, 0.0));
      float band = smoothstep(0.42, 0.78, swirl * 0.5 + cloud * 0.7);
      col = mix(col, vec3(0.11, 0.13, 0.18), body * (0.32 + 0.30 * band));
      // Rain: thin slanted streaks falling across the screen (screen-sized at every zoom).
      vec2 sp = tp * pxPerTile;
      vec2 rp = vec2(sp.x - sp.y * 0.28, sp.y);
      float lane = floor(rp.x / 9.0);
      float h = hash(vec2(lane, 3.7));
      float fx = abs(fract(rp.x / 9.0) - 0.5) * 9.0;
      float fy = fract(rp.y / (34.0 + h * 18.0) - uTime * (1.3 + h) - h * 7.0);
      float streak = (1.0 - smoothstep(0.4, 1.2, fx)) * smoothstep(0.0, 0.2, fy) * (1.0 - smoothstep(0.38, 0.5, fy));
      streak *= step(0.35, h) * (0.55 + 0.45 * band);
      col = mix(col, vec3(0.80, 0.86, 0.94), streak * body * 0.4);
      // Lightning, now and then, lighting the cloud from within (never with reduced motion).
      if (uMotion > 0.5) {
        float clock = uTime * 2.5 + wc.x * 0.173;
        float slot = floor(clock);
        float strike = step(0.9, hash(vec2(slot, wc.y * 0.37 + float(k))));
        float decay = pow(1.0 - fract(clock), 3.0);
        vec2 at = vec2(hash(vec2(slot, 1.3)), hash(vec2(slot, 2.9))) - 0.5;
        float glow = exp(-length(rel / rad - at) * 4.0);
        col += vec3(0.62, 0.68, 0.88) * strike * decay * glow * body * 0.75;
      }
    } else {
      // Fog bank: a low, even haze combed into long horizontal wisps drifting with the wind
      // (flat and streaked, unlike the puffy high clouds); it mutes the colours underneath
      // but leaves borders and countries readable.
      vec2 q = rel / rad;
      float drift = uTime * 0.03;
      float bend = vnoise(vec2(q.x * 2.0 - drift, q.y * 2.5) + wc.xy * 0.02);
      float wisp = uQuality > 0.5
        ? fbm(vec2(q.x * 1.3 - drift, q.y * 10.0) + wc.xy * 0.02)
        : 0.5 + 0.5 * sin(q.y * 22.0 + bend * 7.0) * (0.3 + 0.7 * bend);
      float comb = smoothstep(0.3, 0.8, wisp);
      float lumW = dot(col, vec3(0.3, 0.5, 0.2));
      col = mix(col, mix(col, vec3(lumW), 0.4), body);
      vec3 haze = mix(vec3(0.76, 0.80, 0.84), vec3(0.92, 0.94, 0.95), comb);
      col = mix(col, haze, body * (0.3 + 0.18 * comb));
    }
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

  // Evening: a light, cool dusk rather than night (the map must stay readable).
  float lumN = dot(col, vec3(0.3, 0.5, 0.2));
  vec3 nightCol = mix(vec3(lumN), col, 0.6) * vec3(0.62, 0.68, 0.86);
  col = mix(col, nightCol, uNight * 0.45);
  finalColor = vec4(col, 1.0);
}
`;
