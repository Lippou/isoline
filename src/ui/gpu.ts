// Is the map drawn by the graphics card? (1.26.3: on a gaming PC, a browser with "graphics
// acceleration" turned off drew the game in software — SwiftShader — at 10 FPS instead of 144.)

/** The renderers that are the processor standing in for a graphics card. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

/** The WebGL renderer's name when it is a software one, null when a real card draws (or unknown). */
export function softwareRenderer(): string | null {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return SOFTWARE.test(name) ? name : null;
  } catch {
    return null;
  }
}

/** Where the browser keeps its "graphics acceleration" switch (Chromium's, by its brand). */
export function accelerationPage(): string {
  const ua = navigator.userAgent;
  if ('brave' in navigator) return 'brave://settings/system';
  if (/Edg\//.test(ua)) return 'edge://settings/system';
  if (/OPR\//.test(ua)) return 'opera://settings/system';
  if (/Firefox\//.test(ua)) return 'about:preferences';
  return 'chrome://settings/system';
}
