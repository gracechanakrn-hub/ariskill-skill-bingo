// Aurora band for the Galaxy sky (art direction v2: teal -> lime ribbon across the upper third, additive, slow
// drift). The parameters and the contrast cap are pure (Node-testable); the GLSL is consumed by three.js only.
// The static / reduced tiers draw one still frame of the same band with a CSS gradient (app.css, non-three
// renderers), so every tier shows the ribbon.
//
// Cap: the ribbon is additive light over the sky. Its peak (AURORA.intensityCap x the lime colour, linear light)
// is bounded, and the nebula shader that hosts it clamps the SUM (nebula + aurora) to AURORA.skyLumCap luminance,
// so the panel body text colour keeps >= 4.5:1 against the brightest sky pixel wherever it lands; the panel itself
// is opaque and outside the canvas, so the cap protects the Galaxy-side captions (title caption, cluster labels)
// that sit inside the band. `auroraContrast()` / `skyCapContrast()` are what the unit test measures.

export const AURORA = Object.freeze({
  teal: '#4FE3C1', lime: '#B6FF5C',
  sky: '#0D0822',                 // nebula base (three.js uBase) - the darkest pixel the band is added to
  band: { top: 0.0, bottom: 0.42, centre: 0.19, halfWidth: 0.07 }, // fractions of the region height (upper third)
  driftRadPerSec: 0.01,           // motion notes: aurora drifts 0.01 rad/s
  intensityCap: 0.16,             // additive peak, linear light, fraction of the lime colour
  skyLumCap: 0.14,                // nebula + aurora luminance ceiling (linear): 5.0:1 against #F2F4FF
  rightFade: 0.10,                // fades out over the last 10 % before the panel edge
  bloomSafe: true,                // peak luminance stays under every bloom threshold (three-quality.js)
  tiers: Object.freeze({ high: 1, medium: 1, low: 0.8 }),
});

export function hexToRgb01(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
export function linearToSrgb(c) { const v = Math.max(0, Math.min(1, c)); return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
/** WCAG relative luminance of a linear-light RGB triple. */
export function luminanceLinear([r, g, b]) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
export function luminanceHex(hex) { return luminanceLinear(hexToRgb01(hex).map(srgbToLinear)); }
export function contrastRatio(l1, l2) { const [a, b] = l1 >= l2 ? [l1, l2] : [l2, l1]; return (a + 0.05) / (b + 0.05); }

/** Brightest possible sky pixel under the band (sky + cap x lime, linear light) as linear RGB and sRGB hex. */
export function auroraPeak(params = AURORA) {
  const sky = hexToRgb01(params.sky).map(srgbToLinear);
  const lime = hexToRgb01(params.lime).map(srgbToLinear);
  const teal = hexToRgb01(params.teal).map(srgbToLinear);
  const rgb = sky.map((s, i) => s + params.intensityCap * Math.max(lime[i], teal[i]));
  const hex = '#' + rgb.map(c => Math.round(linearToSrgb(c) * 255).toString(16).padStart(2, '0')).join('');
  return { rgb, hex, luminance: luminanceLinear(rgb) };
}

/** Contrast of a text colour against the brightest aurora pixel (>= 4.5 is the acceptance rule). */
export function auroraContrast(textHex = '#F2F4FF', params = AURORA) {
  return contrastRatio(luminanceHex(textHex), auroraPeak(params).luminance);
}

/** Contrast of a text colour against the sky luminance ceiling enforced by the nebula shader. */
export function skyCapContrast(textHex = '#F2F4FF', params = AURORA) {
  return contrastRatio(luminanceHex(textHex), params.skyLumCap);
}

/** Drift phase in radians at `tSec`; still (0) under reduced motion. */
export function auroraPhase(tSec, reducedMotion = false, params = AURORA) {
  return reducedMotion ? 0 : (Number(tSec) || 0) * params.driftRadPerSec;
}

/** Per-tier intensity multiplier (never above 1: the cap is the ceiling on every tier). */
export function auroraTierGain(quality, params = AURORA) {
  const g = params.tiers[quality];
  return Math.min(1, Number.isFinite(g) ? g : 1);
}

// GLSL hosted by the nebula fragment shader (needs its fbm(vec2)). `uv` is the region uv (y = 1 at the top),
// `centre` / `halfWidth` fractions of the region height. Returns premultiplied additive light clamped to `cap`.
export const AURORA_GLSL = /* glsl */`
vec3 auroraLight(vec2 uv, float aspect, float phase, vec3 teal, vec3 lime, float cap, float rightFade, float centre, float halfWidth){
  float x = uv.x * aspect;
  float y = 1.0 - uv.y;                                            // 0 at the top of the region
  // ribbon centreline wanders slowly with the drift phase (radians); width breathes with it
  float c = centre + 0.045 * sin(x * 1.9 + phase * 3.0) + 0.02 * sin(x * 4.3 - phase * 2.0 + 1.3);
  float w = halfWidth * (1.0 + 0.35 * sin(x * 2.7 + phase));
  float d = (y - c) / w;
  float ribbon = exp(-d * d * 1.1);
  // vertical curtain streaks sliding sideways
  float curtain = fbm(vec2(x * 5.5 - phase * 9.0, y * 5.0 + phase * 0.7));
  float streak = 0.55 + 0.45 * smoothstep(0.28, 0.80, curtain);
  // aurora is brighter along its lower edge
  float lowerEdge = 0.6 + 0.4 * smoothstep(c - w * 0.9, c + w * 0.6, y);
  float i = ribbon * streak * lowerEdge;
  vec3 col = mix(teal, lime, smoothstep(0.25, 0.95, 0.35 * curtain + 0.65 * uv.x));
  float edge = smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 1.0 - rightFade, uv.x);
  float a = min(cap, i * cap) * edge;
  return col * a;
}`;
