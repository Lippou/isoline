// GLSL (ES 3.0) sources for the map surface — the "night atlas / luminous ink" look.
// Textures:
//   uTerrain  RGBA8 nearest : r terrain id, g altitude, b coast distance, a deposit
//   uRelief   RG8   linear  : r altitude, g coast distance (smooth isolines, hillshade, bathymetry)
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

vec3 biome(float t, vec2 p, float elev) {
  // Muted night-atlas tones; procedural texture per biome.
  float n = vnoise(p * 0.35);
  float fine = vnoise(p * 2.7);
  vec3 c;
  if (t < 3.5) {               // river
    c = vec3(0.15, 0.30, 0.36);
  } else if (t < 4.5) {        // plains
    c = mix(vec3(0.20, 0.29, 0.22), vec3(0.25, 0.33, 0.24), n);
  } else if (t < 5.5) {        // hills
    c = mix(vec3(0.29, 0.29, 0.21), vec3(0.34, 0.32, 0.23), n);
  } else if (t < 6.5) {        // mountain
    c = mix(vec3(0.33, 0.31, 0.29), vec3(0.45, 0.43, 0.41), smoothstep(0.65, 0.95, elev));
  } else if (t < 7.5) {        // desert: dune stripes
    float dune = sin(p.x * 0.9 + p.y * 0.35 + n * 5.0) * 0.5 + 0.5;
    c = mix(vec3(0.40, 0.35, 0.24), vec3(0.47, 0.41, 0.28), dune * 0.6 + n * 0.4);
  } else if (t < 8.5) {        // forest: stippled canopy
    float trees = smoothstep(0.55, 0.85, fine);
    c = mix(vec3(0.14, 0.24, 0.18), vec3(0.11, 0.19, 0.15), trees);
  } else if (t < 9.5) {        // tundra / ice
    c = mix(vec3(0.55, 0.60, 0.63), vec3(0.66, 0.71, 0.74), n);
  } else {                     // impassable cliffs / glaciers
    float hatch = step(0.5, fract((p.x - p.y) * 0.7));
    c = mix(vec3(0.14, 0.13, 0.16), vec3(0.20, 0.19, 0.23), hatch);
  }
  return c;
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
  float coast = rel.g * 255.0;
  float pxPerTile = max(uZoom, 0.0001);
  bool water = isWaterId(tId);
  vec3 col;

  if (water) {
    // Depth gradient + bathymetric isolines rippling away from the coasts.
    float depth = clamp(coast / 40.0, 0.0, 1.0);
    vec3 shallow = tId > 1.5 ? vec3(0.10, 0.22, 0.30) : vec3(0.08, 0.17, 0.27);
    col = mix(shallow, vec3(0.035, 0.065, 0.12), pow(depth, 0.6));
    if (uQuality > 0.5) {
      float band = (coast - uTime * 0.35) / 3.2;
      float d = abs(fract(band) - 0.5) * 3.2;
      float w = max(fwidth(coast) * 0.9, 0.05);
      float line = 1.0 - smoothstep(0.0, w, d - 0.05);
      col += vec3(0.18, 0.45, 0.42) * line * 0.22 * exp(-coast / 14.0);
      // Glints / waves.
      float wave = vnoise(tp * 0.18 + vec2(uTime * 0.05, uTime * 0.03));
      col += vec3(0.03, 0.05, 0.065) * smoothstep(0.7, 0.95, wave) * (1.0 - depth * 0.6);
    }
    // Coastal foam.
    float foam = (1.0 - smoothstep(0.0, 1.4, coast)) * (0.6 + 0.4 * sin(uTime * 1.7 + tp.x * 0.9 + tp.y * 0.7));
    col = mix(col, vec3(0.62, 0.78, 0.76), foam * 0.35);
  } else {
    col = biome(tId, tp, elev);
    if (uQuality > 0.5) {
      // Hillshade from the smooth relief (light from the north-west).
      vec2 px = 1.0 / uSize;
      float ex = texture(uRelief, vUV + vec2(px.x, 0.0)).r - texture(uRelief, vUV - vec2(px.x, 0.0)).r;
      float ey = texture(uRelief, vUV + vec2(0.0, px.y)).r - texture(uRelief, vUV - vec2(0.0, px.y)).r;
      vec3 nrm = normalize(vec3(-ex * 18.0, -ey * 18.0, 1.0));
      float shade = dot(nrm, normalize(vec3(-0.6, -0.7, 0.75)));
      col *= 0.72 + 0.42 * shade;
      // Contour lines (the isolines): every 16 altitude steps, a master line every 64.
      float e = elev * 255.0;
      float w = fwidth(e);
      float fine = abs(fract(e / 16.0 + 0.5) - 0.5) * 16.0;
      float master = abs(fract(e / 64.0 + 0.5) - 0.5) * 64.0;
      float lf = (1.0 - smoothstep(0.0, w * 1.1, fine)) * smoothstep(1.6, 4.0, pxPerTile);
      float lm = (1.0 - smoothstep(0.0, w * 1.6, master)) * (0.35 + 0.65 * smoothstep(0.6, 2.0, pxPerTile));
      col = mix(col, col + vec3(0.20, 0.32, 0.27), clamp(lf * 0.45 + lm * 0.7, 0.0, 1.0) * (e > 12.0 ? 1.0 : 0.0));
    }
    if (tId > 2.5 && tId < 3.5) col = mix(col, vec3(0.18, 0.40, 0.48), 0.6); // rivers
  }

  if (uTerrainView > 0.5) col = mix(col, heat(tId), 0.55);

  // ---------------------------------------------------------------- territory
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
    float wash = uContrast > 0.5 ? 0.62 : 0.46;
    if (own == uHighlight) wash += 0.12;
    vec3 tinted = mix(col, inkNow * (0.55 + 0.9 * dot(col, vec3(0.333))), wash);
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
    float l = ownerAt(ti + ivec2(-1, 0));
    float r = ownerAt(ti + ivec2(1, 0));
    float u = ownerAt(ti + ivec2(0, -1));
    float d = ownerAt(ti + ivec2(0, 1));
    float dist = 9.0;
    float other = own;
    if (l != own) { dist = min(dist, f.x); other = l; }
    if (r != own) { dist = min(dist, 1.0 - f.x); other = r; }
    if (u != own) { dist = min(dist, f.y); other = u; }
    if (d != own) { dist = min(dist, 1.0 - f.y); other = d; }
    float side = own > 0.5 ? own : other;
    if (dist < 9.0 && side > 0.5 && !water) {
      float dpx = dist * pxPerTile;
      vec3 ink = inkOf(side).rgb;
      float flow = 0.82 + 0.18 * sin((tp.x + tp.y) * 0.55 - uTime * 2.2);
      float core = exp(-dpx / (uContrast > 0.5 ? 1.6 : 1.05));
      float glow = exp(-dpx / 5.0) * 0.35;
      // Small zoom: a whole tile is the border.
      if (pxPerTile < 1.5) { core = 0.85; glow = 0.0; }
      float wild = (own < 0.5 || other < 0.5) ? 0.55 : 1.0;
      col = mix(col, ink * 1.25 + 0.08, clamp(core * wild * flow, 0.0, 1.0));
      col += ink * glow * wild;
    }
  }

  // Fallout: sickly luminous haze with crackle.
  if (fallout > 0.0) {
    float crack = fbm(tp * 0.25 + vec2(uTime * 0.07, 0.0));
    vec3 rad = vec3(0.70, 0.86, 0.22);
    col = mix(col, rad * (0.35 + 0.5 * crack), clamp(fallout * 0.75, 0.0, 0.8));
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

  // Fog of war.
  if (uFogOn > 0.5) {
    float v = texture(uFog, vUV).r;
    float paper = 0.5 + 0.5 * vnoise(tp * 0.08);
    vec3 unknown = mix(vec3(0.05, 0.07, 0.11), vec3(0.08, 0.10, 0.15), paper);
    vec3 remembered = mix(vec3(dot(col, vec3(0.3, 0.5, 0.2))), col, 0.25) * 0.55;
    col = v < 0.43 ? mix(unknown, remembered, smoothstep(0.0, 0.43, v)) : mix(remembered, col, smoothstep(0.43, 1.0, v));
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
  col = mix(col, col * vec3(0.48, 0.56, 0.80), uNight * 0.75);
  finalColor = vec4(col, 1.0);
}
`;
