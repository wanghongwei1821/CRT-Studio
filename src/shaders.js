export const vertex = `#version 300 es
out vec2 vUv;
void main() {
  vec2 vertex = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vertex;
  gl_Position = vec4(vertex * 2.0 - 1.0, 0.0, 1.0);
}`;

export const brightPass = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
void main() {
  vec3 rgb = pow(texture(uSource, vUv).rgb, vec3(2.2));
  float level = max(max(rgb.r, rgb.g), rgb.b);
  outColor = vec4(rgb * smoothstep(0.12, 0.65, level), 1.0);
}`;

export const blurPass = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
uniform vec2 uStep;
void main() {
  vec3 rgb = texture(uSource, vUv).rgb * 0.227027;
  rgb += (texture(uSource, vUv + uStep * 1.384615).rgb
       +  texture(uSource, vUv - uStep * 1.384615).rgb) * 0.316216;
  rgb += (texture(uSource, vUv + uStep * 3.230769).rgb
       +  texture(uSource, vUv - uStep * 3.230769).rgb) * 0.070270;
  outColor = vec4(rgb, 1.0);
}`;

export const crtPass = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource, uPrevious, uNarrow, uWide;
uniform vec2 uSize, uFit;
uniform vec3 uPattern, uTintColor;
uniform float uTime, uCurve, uScan, uPhosphor, uBloom, uChroma, uNoise, uEcho, uCssWidth, uTint;
uniform float uGlowFlicker, uGlowRate, uVignette;
uniform int uMode;
uniform bool uOriginal;

vec3 signalAt(sampler2D signal, vec2 uv) {
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec3(0.0);
  return texture(signal, uv).rgb;
}

float hash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.11369));
  p += dot(p, p.yx + 19.19);
  return fract(p.x * p.y);
}

vec3 phosphorAt(vec2 pixel, bool dots) {
  float columnWidth = uPattern.x / 3.0;
  float rowAspect = dots ? 2.5 : 3.0;
  vec2 cell = pixel / vec2(columnWidth, columnWidth * rowAspect);
  float column = floor(cell.x);
  if (dots) cell.y += mod(floor(column / 3.0), 2.0) * 0.5;
  float channel = mod(column, 3.0);
  vec3 primary = vec3(channel == 0.0, channel == 1.0, channel == 2.0);
  vec2 distanceFromCenter = abs(fract(cell) - 0.5);
  vec2 radius = uPattern.yz * 0.5;
  float aa = 0.55 / (columnWidth * uSize.x / uCssWidth);
  float across = 1.0 - smoothstep(radius.x - aa, radius.x + aa, distanceFromCenter.x);
  float along = 1.0 - smoothstep(radius.y - aa / rowAspect, radius.y + aa / rowAspect, distanceFromCenter.y);
  if (!dots) along = mix(along, 1.0, smoothstep(0.93, 1.0, uPattern.z));
  return primary * across * along;
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  if (uOriginal) {
    outColor = vec4(signalAt(uSource, p * 0.5 / uFit + 0.5), 1.0);
    return;
  }

  // Inverse lens mapping, followed by the rounded edge of the glass.
  vec2 bent = p * (1.0 + uCurve * p.yx * p.yx);
  vec2 edge = abs(bent) - vec2(0.944, 0.912);
  float distanceToGlass = length(max(edge, 0.0)) + min(max(edge.x, edge.y), 0.0) - 0.045;
  float rim = 1.0 - smoothstep(-0.008, 0.004, distanceToGlass);
  if (rim <= 0.0) { outColor = vec4(0.024, 0.026, 0.024, 1.0); return; }

  // Separate the red and blue samples and mix a little of the previous video frame.
  vec2 screenUv = bent * 0.5 + 0.5;
  vec2 uv = (screenUv - 0.5) / uFit + 0.5;
  float frame = floor(uTime * 30.0);
  uv.x += (hash(vec2(floor(screenUv.y * 125.0), frame)) - 0.5) * uNoise * 0.009 / uFit.x;
  vec2 shift = vec2(uChroma * (0.005 + 0.005 * dot(p, p)) / uFit.x, 0.0);
  vec3 rgb = vec3(signalAt(uSource, uv + shift).r, signalAt(uSource, uv).g,
                 signalAt(uSource, uv - shift).b);
  if (uEcho > 0.0) rgb = mix(rgb, signalAt(uPrevious, uv - vec2(0.003 / uFit.x, 0.0)), uEcho);
  rgb = pow(rgb, vec3(2.2));

  float glowMask = 1.0;
  if (uMode != 2 && uPhosphor > 0.0) {
    // Use CSS pixel coordinates so the editable pitch stays stable across pixel densities.
    bool dots = uMode == 1;
    vec3 phosphor = phosphorAt(vUv * uSize * (uCssWidth / uSize.x), dots);
    if (dots) {
      float spot = smoothstep(0.09, 0.62, max(phosphor.r, max(phosphor.g, phosphor.b)));
      float strength = 1.0 - pow(1.0 - min(1.0, uPhosphor), 2.2);
      vec3 dotColor = vec3(0.095 + 0.18 * spot) + 1.25 * phosphor;
      rgb *= mix(vec3(1.0), dotColor, strength);
      glowMask = mix(1.0, 0.42 + 0.46 * spot, strength);
    } else {
      rgb *= mix(vec3(1.0), vec3(0.58) + 1.18 * phosphor, min(1.0, uPhosphor));
    }
    if (uPhosphor > 1.0) {
      vec3 maskContrast = mix(vec3(0.32), vec3(1.12), phosphor);
      rgb *= pow(maskContrast, vec3(uPhosphor - 1.0));
      glowMask *= pow(0.46 + 0.54 * max(phosphor.r, max(phosphor.g, phosphor.b)), uPhosphor - 1.0);
    }
  }

  // Add two radii of thresholded glow, in linear light.
  if (uBloom > 0.0) {
    vec3 narrow = signalAt(uNarrow, uv);
    vec3 wide = signalAt(uWide, uv);
    float glow = uBloom;
    if (uGlowFlicker > 0.0) {
      float burst;
      if (uGlowRate > 6.0) {
        // Place each strike on a 60 Hz frame and reserve half the period for darkness.
        float frame60 = round(uTime * 60.0);
        float rateTenths = round(uGlowRate * 10.0);
        float pulseIndex = floor(frame60 * rateTenths / 600.0);
        float firstFrame = ceil(pulseIndex * 600.0 / rateTenths);
        float age = (frame60 - firstFrame) / 60.0;
        float duration = min(0.083, 0.5 / uGlowRate);
        burst = 1.0 - smoothstep(duration * 0.25, duration, age);
      } else {
        float cycle = uTime * uGlowRate;
        float delay = 0.12 * hash(vec2(floor(cycle), 8.0));
        float age = (fract(cycle) - delay) / uGlowRate;
        burst = step(0.0, age) * (1.0 - smoothstep(0.021, 0.083, age));
      }
      float pulse = mix(0.32, 1.95, burst);
      glow *= mix(1.0, pulse, uGlowFlicker);
    }
    rgb += (0.45 * narrow + 0.50 * wide) * glow * glowMask;
  }
  float vignette = 1.0 - uVignette * dot(p * p, p * p);
  float flicker = sin(uTime * 35.0) * 0.035 + sin(uTime * 6.0 - screenUv.y * 22.0) * 0.10;
  float grain = hash(floor(gl_FragCoord.xy) + vec2(frame * 17.0, frame * 41.0)) - 0.5;
  rgb = rgb * vignette * (1.0 + uNoise * flicker) + max(0.0, grain + 0.10) * uNoise * 0.022;
  if (uTint > 0.0) {
    float luminance = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 tint = pow(uTintColor, vec3(2.2 * max(1.0, uTint)));
    rgb = mix(rgb, luminance * tint, min(1.0, uTint));
  }
  rgb = pow(max(rgb, vec3(0.0)), vec3(1.0 / 2.2));
  if (uScan > 0.0) {
    // Keep the raster readable at high DPI and in highlights with strong bloom.
    float cssHeight = uSize.y * uCssWidth / uSize.x;
    float phase = screenUv.y * cssHeight / 4.0;
    float beam = 0.5 + 0.5 * cos(phase * 6.2831853);
    float beamTone = 0.34 + 0.66 * pow(beam, 0.65);
    float scan = mix(1.0, beamTone, min(1.0, uScan));
    rgb = min(rgb, vec3(1.0)) * scan * pow(beamTone, max(0.0, uScan - 1.0));
  }
  outColor = vec4(mix(vec3(0.024, 0.026, 0.024), rgb, rim), 1.0);
}`;
