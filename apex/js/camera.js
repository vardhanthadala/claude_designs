/* ============================================================
   camera.js — the cinematic camera rig
   ------------------------------------------------------------
   Six authored states, blended with smootherstep so the rig
   never jumps. Each key can also "track" the car: the final aim
   point is a blend between the authored look-at and the live
   vehicle position, which is how a real tracking rig behaves.
   ============================================================ */
import * as THREE from 'three';
import { clamp, lerp, inv, smootherstep, damp, fbm1, track as trk } from './util.js';

/* t, position, look-at, fov, tracking weight, shake scale */
const KEYS = [
  { t: 0.00, p: [-3.4, 0.52, 5.0], l: [-4.5, 1.10, -60], fov: 40, k: 0.00, sh: 0.20 },
  { t: 0.12, p: [-3.2, 0.53, 4.8], l: [-6.0, 1.00, -50], fov: 38, k: 0.06, sh: 0.25 },
  { t: 0.19, p: [-2.9, 0.56, 4.5], l: [-9.0, 0.85, -30], fov: 34, k: 0.28, sh: 0.45 },
  { t: 0.30, p: [-2.2, 0.60, 4.0], l: [-6.0, 0.85, -20], fov: 30, k: 0.46, sh: 0.75 },
  { t: 0.38, p: [-1.2, 0.64, 3.6], l: [0.0, 0.85, -16], fov: 27, k: 0.54, sh: 1.00 },
  { t: 0.45, p: [0.2, 0.70, 3.2], l: [6.0, 0.85, -15], fov: 26, k: 0.64, sh: 0.85 },
  { t: 0.52, p: [2.2, 1.05, 2.6], l: [12.0, 0.85, -17], fov: 24, k: 0.76, sh: 0.60 },
  { t: 0.58, p: [4.4, 1.90, 1.4], l: [16.0, 0.85, -21], fov: 22, k: 0.86, sh: 0.45 },
  { t: 0.64, p: [6.0, 2.60, -0.6], l: [15.0, 0.85, -25], fov: 21, k: 0.90, sh: 0.40 },
  { t: 0.69, p: [5.4, 2.40, -1.6], l: [9.0, 0.85, -27], fov: 22, k: 0.88, sh: 0.40 },
  { t: 0.74, p: [2.4, 1.40, 0.4], l: [1.0, 0.85, -18], fov: 24, k: 0.76, sh: 0.30 },
  { t: 0.80, p: [0.0, 0.70, 0.6], l: [0.0, 0.78, -11], fov: 20, k: 0.42, sh: 0.10 },
  { t: 0.86, p: [0.0, 0.67, 0.9], l: [0.0, 0.76, -10], fov: 21, k: 0.28, sh: 0.35 },
  { t: 0.92, p: [0.0, 0.64, 1.3], l: [0.0, 0.74, -7], fov: 25, k: 0.16, sh: 0.80 },
  { t: 0.96, p: [0.0, 0.61, 1.6], l: [0.0, 0.72, -4], fov: 31, k: 0.09, sh: 1.30 },
  { t: 1.00, p: [0.0, 0.58, 1.9], l: [0.0, 0.70, -1], fov: 40, k: 0.03, sh: 1.80 },
];

const CH = { px: 0, py: 1, pz: 2, lx: 3, ly: 4, lz: 5, fov: 6, k: 7, sh: 8 };
const TABLE = KEYS.map((kf) => [kf.t, [...kf.p, ...kf.l, kf.fov, kf.k, kf.sh]]);

export class CinematicCamera {
  constructor(aspect, quality) {
    this.quality = quality;
    this.cam = new THREE.PerspectiveCamera(38, aspect, 0.12, 1800);
    this.cam.position.set(-3.4, 0.52, 5);

    this.pos = new THREE.Vector3(-3.4, 0.52, 5);
    this.target = new THREE.Vector3(-4.5, 1.1, -60);
    this.smoothPos = this.pos.clone();
    this.smoothTarget = this.target.clone();
    this.fov = 40;

    this.pointer = new THREE.Vector2();
    this.pointerSmooth = new THREE.Vector2();
    this.shake = 0;
    this.roll = 0;
    this._v = new THREE.Vector3();
    this._aim = new THREE.Vector3();
    this._prevProj = new THREE.Vector2(0.5, 0.5);
    this.screenVel = new THREE.Vector2();
    this.baseAspect = 16 / 9;
  }

  sample(t) {
    const out = new Array(9);
    if (t <= TABLE[0][0]) return TABLE[0][1].slice();
    if (t >= TABLE[TABLE.length - 1][0]) return TABLE[TABLE.length - 1][1].slice();
    for (let i = 0; i < TABLE.length - 1; i++) {
      const [t0, a] = TABLE[i], [t1, b] = TABLE[i + 1];
      if (t >= t0 && t <= t1) {
        const f = smootherstep(inv(t0, t1, t));
        for (let c = 0; c < 9; c++) out[c] = lerp(a[c], b[c], f);
        return out;
      }
    }
    return TABLE[TABLE.length - 1][1].slice();
  }

  /* extraShake: impact / velocity driven, 0..1 */
  update(t, dt, time, carPos, extraShake, aspect) {
    const s = this.sample(t);
    const q = this.quality;

    this.pos.set(s[CH.px], s[CH.py], s[CH.pz]);
    this._aim.set(s[CH.lx], s[CH.ly], s[CH.lz]);

    // blend the authored aim toward the live car position
    const k = s[CH.k];
    this._v.copy(carPos);
    this._v.y += 0.62;
    this.target.lerpVectors(this._aim, this._v, k);

    // portrait / narrow viewports: dolly back rather than fish-eye
    let fov = s[CH.fov];
    if (aspect < this.baseAspect) {
      const f = Math.pow(this.baseAspect / Math.max(aspect, 0.42), 0.62);
      this._v.copy(this.pos).sub(this.target);
      const d = this._v.length();
      this._v.normalize().multiplyScalar(d * clamp(f, 1, 2.4));
      this.pos.copy(this.target).add(this._v);
      fov = lerp(fov, fov * 1.08, clamp((this.baseAspect - aspect) / 1.2));
    }

    // mouse parallax — subtle, and it backs off during the final approach
    const parallax = (1 - clamp(inv(0.80, 0.94, t))) * (q.reduced ? 0.25 : 1);
    this.pointerSmooth.x = damp(this.pointerSmooth.x, this.pointer.x, 3.2, dt);
    this.pointerSmooth.y = damp(this.pointerSmooth.y, this.pointer.y, 3.2, dt);
    this.pos.x += this.pointerSmooth.x * 0.42 * parallax;
    this.pos.y += this.pointerSmooth.y * 0.22 * parallax;
    this.target.x += this.pointerSmooth.x * 0.16 * parallax;

    // handheld breathing + velocity shake
    const amp = (s[CH.sh] * 0.5 + extraShake * 1.6) * q.shake;
    const n = time * 3.1;
    this.pos.x += fbm1(n) * 0.016 * amp + fbm1(n * 5.7 + 20) * 0.010 * extraShake * q.shake;
    this.pos.y += fbm1(n + 7.3) * 0.012 * amp + fbm1(n * 6.3 + 40) * 0.009 * extraShake * q.shake;
    this.pos.z += fbm1(n + 13.1) * 0.010 * amp;
    this.roll = damp(this.roll, fbm1(time * 0.7) * 0.006 * (1 + amp * 2), 4, dt);

    // critically damped follow so fast scrubbing never snaps
    const lam = 14;
    this.smoothPos.x = damp(this.smoothPos.x, this.pos.x, lam, dt);
    this.smoothPos.y = damp(this.smoothPos.y, this.pos.y, lam, dt);
    this.smoothPos.z = damp(this.smoothPos.z, this.pos.z, lam, dt);
    this.smoothTarget.x = damp(this.smoothTarget.x, this.target.x, lam, dt);
    this.smoothTarget.y = damp(this.smoothTarget.y, this.target.y, lam, dt);
    this.smoothTarget.z = damp(this.smoothTarget.z, this.target.z, lam, dt);

    this.cam.position.copy(this.smoothPos);
    this.cam.up.set(Math.sin(this.roll), Math.cos(this.roll), 0);
    this.cam.lookAt(this.smoothTarget);

    this.fov = damp(this.fov, fov, 12, dt);
    if (Math.abs(this.cam.fov - this.fov) > 0.001 || this.cam.aspect !== aspect) {
      this.cam.fov = this.fov;
      this.cam.aspect = aspect;
      this.cam.updateProjectionMatrix();
    }

    /* screen-space velocity of the car — drives directional motion blur */
    this._v.copy(carPos).project(this.cam);
    const nx = this._v.x * 0.5 + 0.5, ny = this._v.y * 0.5 + 0.5;
    this.screenVel.set((nx - this._prevProj.x) / Math.max(dt, 1 / 240), (ny - this._prevProj.y) / Math.max(dt, 1 / 240));
    this._prevProj.set(nx, ny);

    return this.cam;
  }
}
