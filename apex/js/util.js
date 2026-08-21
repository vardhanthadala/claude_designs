/* ============================================================
   util.js — small math / interpolation helpers
   ============================================================ */

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, v) => (b - a === 0 ? 0 : (v - a) / (b - a));
export const map = (v, a, b, c, d) => lerp(c, d, clamp(inv(a, b, v)));

export const smoothstep = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const smootherstep = (t) => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };

/* map + smooth in one go — the workhorse of the whole timeline */
export const range = (v, a, b, c = 0, d = 1) => lerp(c, d, smoothstep(inv(a, b, v)));

/* 0 at the edges, 1 in the middle of [a,b] — for one-shot beats */
export const pulse = (v, a, b) => {
  const t = clamp(inv(a, b, v));
  return Math.sin(t * Math.PI);
};

export const easeInCubic = (t) => t * t * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInExpo = (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10));

/* frame-rate independent damping (exponential approach) */
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/* Catmull–Rom through a list of scalars, x in [0, keys.length-1] */
export function catmull(keys, x) {
  const n = keys.length;
  const i = Math.floor(clamp(x, 0, n - 1.0001));
  const f = clamp(x, 0, n - 1.0001) - i;
  const p0 = keys[Math.max(0, i - 1)];
  const p1 = keys[i];
  const p2 = keys[Math.min(n - 1, i + 1)];
  const p3 = keys[Math.min(n - 1, i + 2)];
  const f2 = f * f, f3 = f2 * f;
  return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
}

/* piecewise keyframe track: [[t, v], ...] with smooth (smootherstep) blending */
export function track(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    if (t >= t0 && t <= t1) return lerp(v0, v1, smootherstep(inv(t0, t1, t)));
  }
  return last[1];
}

/* cheap deterministic value noise (1D) — used for handheld camera drift */
const _h = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(_h(i), _h(i + 1), u) * 2 - 1;
}
export const fbm1 = (x) => noise1(x) * 0.6 + noise1(x * 2.13 + 11.7) * 0.28 + noise1(x * 4.31 + 3.1) * 0.12;

export const rand = (a, b) => a + Math.random() * (b - a);

/* device / quality detection ------------------------------------------------ */
export function detectQuality() {
  const w = window.innerWidth;
  const mobile = w < 760 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const tablet = !mobile && w < 1180;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const weak = mobile || cores <= 4;

  return {
    mobile, tablet, reduced, weak,
    tier: mobile ? 'mobile' : tablet ? 'tablet' : 'desktop',
    dpr: Math.min(window.devicePixelRatio || 1, mobile ? 2 : weak ? 1.5 : 1.85),
    shadows: !mobile,
    shadowSize: weak ? 1024 : 2048,
    reflection: !mobile && !weak,
    bloom: true,
    dof: !mobile,
    dust: mobile ? 260 : tablet ? 700 : 1400,
    tireParticles: mobile ? 90 : tablet ? 180 : 320,
    posts: mobile ? 26 : 48,
    shake: reduced ? 0.15 : mobile ? 0.5 : 1,
  };
}
