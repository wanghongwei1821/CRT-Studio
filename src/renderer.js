import { vertex, brightPass, blurPass, crtPass } from './shaders.js';

export const CRT_DEFAULTS = Object.freeze({
  pattern: Object.freeze([5, 100, 95]),
  tintColor: Object.freeze([0x9b / 255, 0xef / 255, 0xa4 / 255]),
  effects: Object.freeze({
    phosphor: 2.36,
    curvature: 0.26 * 0.33,
    scanlines: 0.14,
    bloom: 0.84,
    spread: 1,
    flicker: 0.61,
    flickerHz: 30,
    chroma: 0.74,
    noise: 0.07,
    persistence: 0,
    tint: 0.33,
    vignette: 0.19,
  }),
});

const maskModes = { stripes: 0, dots: 1, off: 2 };
const effectUniforms = {
  phosphor: 'Phosphor', curvature: 'Curve', scanlines: 'Scan', bloom: 'Bloom',
  flicker: 'GlowFlicker', flickerHz: 'GlowRate', chroma: 'Chroma', noise: 'Noise',
  persistence: 'Echo', tint: 'Tint', vignette: 'Vignette',
};

export function createCrtRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false });
  if (!gl || gl.isContextLost()) throw new Error('WebGL 2 is unavailable.');

  const programs = [];
  function releasePrograms() {
    for (const program of programs) gl.deleteProgram(program);
  }
  function shader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(log);
    }
    return shader;
  }
  const vertexShader = shader(gl.VERTEX_SHADER, vertex);
  function program(fragment, uniforms) {
    const pixelShader = shader(gl.FRAGMENT_SHADER, fragment);
    const result = gl.createProgram();
    programs.push(result);
    gl.attachShader(result, vertexShader);
    gl.attachShader(result, pixelShader);
    gl.linkProgram(result);
    gl.deleteShader(pixelShader);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result));
    const locations = Object.fromEntries(uniforms.map(name => [name, gl.getUniformLocation(result, 'u' + name)]));
    return { program: result, ...locations };
  }
  let bright, blur, crt;
  try {
    bright = program(brightPass, ['Source']);
    blur = program(blurPass, ['Source', 'Step']);
    crt = program(crtPass, ['Source', 'Previous', 'Narrow', 'Wide', 'Size',
      'Fit', 'Time', 'Original', 'Mode', 'CssWidth', 'Pattern', 'TintColor',
      ...Object.values(effectUniforms)]);
  } catch (error) {
    releasePrograms();
    throw error;
  } finally {
    gl.deleteShader(vertexShader);
  }

  function texture() {
    const result = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, result);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return result;
  }
  function upload(target, source) {
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  const frames = [texture(), texture()];
  let current = 0;
  let sourceAspect = 0;
  let bloomDirty = true;
  let appliedSpread;
  let disposed = false;
  let bloomWidth = 0;
  let bloomHeight = 0;
  const targets = Array.from({ length: 3 }, () => ({
    texture: texture(), framebuffer: gl.createFramebuffer()
  }));
  const staging = canvas.ownerDocument.createElement('canvas');
  const stage = staging.getContext('2d');
  const maxInput = Math.min(1920, gl.getParameter(gl.MAX_TEXTURE_SIZE));

  function bind(location, target, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.uniform1i(location, unit);
  }
  function setFrame(source, { resetHistory = false } = {}) {
    if (disposed || gl.isContextLost()) return;
    const width = source.videoWidth ?? source.naturalWidth ?? source.width;
    const height = source.videoHeight ?? source.naturalHeight ?? source.height;
    if (!(width > 0 && height > 0)) throw new Error('Load a non-empty frame before calling setFrame.');
    const scale = Math.min(1, maxInput / Math.max(width, height));
    let input = source;
    if (scale < 1) {
      const sw = Math.max(1, Math.round(width * scale));
      const sh = Math.max(1, Math.round(height * scale));
      if (staging.width !== sw || staging.height !== sh) {
        staging.width = sw;
        staging.height = sh;
      }
      stage.clearRect(0, 0, sw, sh);
      stage.drawImage(source, 0, 0, sw, sh);
      input = staging;
    }
    gl.activeTexture(gl.TEXTURE0);
    const next = 1 - current;
    upload(frames[next], input);
    if (resetHistory || !sourceAspect) upload(frames[current], input);
    current = next;
    sourceAspect = width / height;
    const bw = Math.max(1, Math.round((scale < 1 ? staging.width : width) / 4));
    const bh = Math.max(1, Math.round((scale < 1 ? staging.height : height) / 4));
    if (bw !== bloomWidth || bh !== bloomHeight) {
      bloomWidth = bw;
      bloomHeight = bh;
      for (const target of targets) {
        gl.bindTexture(gl.TEXTURE_2D, target.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, bw, bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    bloomDirty = true;
  }

  function blurInto(input, target, x, y) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    bind(blur.Source, input.texture, 0);
    gl.uniform2f(blur.Step, x, y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function buildBloom(spread) {
    const [a, b, narrow] = targets;
    gl.viewport(0, 0, bloomWidth, bloomHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer);
    gl.useProgram(bright.program);
    bind(bright.Source, frames[current], 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(blur.program);
    blurInto(a, b, spread / bloomWidth, 0);
    blurInto(b, narrow, 0, spread / bloomHeight);
    blurInto(narrow, b, 3 * spread / bloomWidth, 0);
    blurInto(b, a, 0, 3 * spread / bloomHeight);
  }
  function draw({
    time = 0,
    cssWidth = canvas.clientWidth || canvas.width,
    original = false,
    mask = 'stripes',
    pattern = CRT_DEFAULTS.pattern,
    tintColor = CRT_DEFAULTS.tintColor,
    effects,
  } = {}) {
    if (disposed || gl.isContextLost() || !sourceAspect || !canvas.width || !canvas.height) return;
    const values = { ...CRT_DEFAULTS.effects, ...effects };
    if (!original && values.bloom > 0 && (bloomDirty || appliedSpread !== values.spread)) {
      buildBloom(values.spread);
      appliedSpread = values.spread;
      bloomDirty = false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(crt.program);
    bind(crt.Source, frames[current], 0);
    bind(crt.Previous, frames[1 - current], 1);
    bind(crt.Narrow, targets[2].texture, 2);
    bind(crt.Wide, targets[0].texture, 3);

    const aspect = sourceAspect / (canvas.width / canvas.height);
    const [pitch, width, height] = pattern;
    gl.uniform2f(crt.Size, canvas.width, canvas.height);
    gl.uniform2f(crt.Fit, Math.min(1, aspect), Math.min(1, 1 / aspect));
    gl.uniform1f(crt.Time, time);
    gl.uniform1i(crt.Original, original);
    gl.uniform1i(crt.Mode, maskModes[mask] ?? maskModes.stripes);
    gl.uniform1f(crt.CssWidth, Math.max(1, cssWidth));
    gl.uniform3f(crt.Pattern, pitch, width / 100, height / 100);
    gl.uniform3f(crt.TintColor, ...tintColor);
    for (const [effect, uniform] of Object.entries(effectUniforms)) {
      gl.uniform1f(crt[uniform], values[effect]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function dispose() {
    if (disposed) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(null);
    for (const frame of frames) gl.deleteTexture(frame);
    for (const { texture, framebuffer } of targets) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
    }
    releasePrograms();
    disposed = true;
  }

  return { setFrame, draw, dispose, contextLost: () => gl.isContextLost() };
}
