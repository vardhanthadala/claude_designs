/* ============================================================
   path.js — the drive line + vehicle dynamics
   ------------------------------------------------------------
   The car never "rotates in place". It is placed on an arc-length
   parameterised spline; heading always follows the tangent, steering
   angle comes from the curvature of the line ahead, and body roll /
   pitch come from lateral & longitudinal acceleration.
   ============================================================ */
import * as THREE from 'three';
import { clamp, lerp, inv, smootherstep, damp } from './util.js';

/* ── the drive line (x, z) in metres. y is always 0 (flat road) ──
   left entry ▸ high speed pass ▸ sweeping 180° arc ▸ centred approach */
const PTS = [
  [-58, -24.0], [-44, -22.6], [-32, -20.8], [-21, -18.4], [-11, -16.0],
  [-1, -14.4], [8, -13.8], [14.5, -14.6], [19, -17.6], [20.5, -22.0],
  [18.5, -26.0], [14, -28.0], [8.5, -27.4], [4, -24.2], [1.2, -19.4],
  [0, -14.2], [0, -8.6], [0, -3.2], [0, 2.2], [0, 8.0],
];

/* timeline (scroll t) ▸ normalised distance along the line.
   The gaps between keys ARE the speed profile of the car:
   accelerate in, flat out across the frame, lift for the arc,
   power out, hold for the hero beat, then launch. */
const SPEED_MAP = [
  [0.000, 0.000],
  [0.120, 0.191],  // still off-screen left, closing fast
  [0.190, 0.253],  // nose enters the frame
  [0.300, 0.348],  // accelerating across
  [0.380, 0.422],  // flat out through the centre
  [0.450, 0.488],
  [0.520, 0.536],  // turn-in — a lift, the car settles on its nose
  [0.580, 0.596],  // apex, rear three-quarter
  [0.640, 0.672],  // side three-quarter, powering out
  [0.690, 0.756],  // front three-quarter
  [0.740, 0.838],  // straightened, facing the lens
  [0.800, 0.862],  // the hero beat — almost stationary
  [0.860, 0.889],  // launch
  [0.920, 0.926],
  [0.960, 0.956],
  [0.990, 0.986],  // nose reaches the lens
  [1.000, 1.000],
];

export class DriveLine {
  constructor() {
    this.curve = new THREE.CatmullRomCurve3(
      PTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', 0.5
    );
    this.curve.arcLengthDivisions = 2000;
    this.length = this.curve.getLength();

    // scratch
    this._p = new THREE.Vector3();
    this._pa = new THREE.Vector3();
    this._pb = new THREE.Vector3();
    this._t0 = new THREE.Vector3();
    this._t1 = new THREE.Vector3();

    this.state = {
      pos: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, 1),
      yaw: 0,
      steer: 0,
      roll: 0,
      pitch: 0,
      curvature: 0,
      speed: 0,       // m per unit-of-timeline (design speed)
      speedNorm: 0,   // 0..1 normalised for effects
      distance: 0,    // metres travelled along the line
      wheelSpin: 0,   // radians
      accel: 0,
    };

    this._prevDist = 0;
    this._prevSpeed = 0;
    this._smoothSpeed = 0;
  }

  /* timeline position (0..1) ▸ normalised arc length (0..1) */
  u(t) {
    t = clamp(t);
    for (let i = 0; i < SPEED_MAP.length - 1; i++) {
      const [t0, u0] = SPEED_MAP[i], [t1, u1] = SPEED_MAP[i + 1];
      if (t >= t0 && t <= t1) {
        const k = inv(t0, t1, t);
        // smootherstep inside each span keeps velocity continuous at the keys
        return lerp(u0, u1, smootherstep(k));
      }
    }
    return 1;
  }

  pointAt(t, out = new THREE.Vector3()) {
    return this.curve.getPointAt(clamp(this.u(t), 0, 1), out);
  }

  /* full vehicle update. dt in seconds, dtl = timeline delta this frame */
  update(t, dt, velScroll) {
    const s = this.state;
    const u = clamp(this.u(t), 0, 1);

    this.curve.getPointAt(u, s.pos);
    this.curve.getTangentAt(u, s.dir).normalize();

    s.distance = u * this.length;
    s.yaw = Math.atan2(s.dir.x, s.dir.z);

    /* curvature: angle between tangents a short distance apart, per metre */
    const du = 3.0 / this.length;
    const ua = clamp(u - du, 0, 1), ub = clamp(u + du, 0, 1);
    this.curve.getTangentAt(ua, this._t0).normalize();
    this.curve.getTangentAt(ub, this._t1).normalize();
    const cross = this._t0.x * this._t1.z - this._t0.z * this._t1.x;
    const dot = clamp(this._t0.x * this._t1.x + this._t0.z * this._t1.z, -1, 1);
    const dAng = Math.atan2(-cross, dot);
    const ds = Math.max(0.001, (ub - ua) * this.length);
    s.curvature = dAng / ds;                       // 1/m, signed

    /* speed — derived from how fast the timeline is being scrubbed */
    const rawSpeed = Math.abs(s.distance - this._prevDist) / Math.max(dt, 1 / 240);
    this._prevDist = s.distance;
    this._smoothSpeed = damp(this._smoothSpeed, Math.min(rawSpeed, 420), 9, dt);
    s.speed = this._smoothSpeed;
    s.speedNorm = clamp(this._smoothSpeed / 130);

    s.accel = damp(s.accel, (s.speed - this._prevSpeed) / Math.max(dt, 1 / 240), 6, dt);
    this._prevSpeed = s.speed;

    /* wheels: rotation is a pure function of distance, so scrubbing back works */
    s.wheelSpin = s.distance / 0.37;

    /* steering: bicycle model, wheelbase 2.9 m, with a little counter-lag */
    const targetSteer = clamp(Math.atan(2.9 * s.curvature) * 1.35, -0.62, 0.62);
    s.steer = damp(s.steer, targetSteer, 12, dt);

    /* body roll from lateral acceleration (v²·κ) — heavy, then settles */
    const latAcc = clamp(s.curvature * s.speed * s.speed * 0.0016, -1.6, 1.6);
    s.roll = damp(s.roll, latAcc * 0.055, 6, dt);

    /* squat / dive from longitudinal acceleration */
    s.pitch = damp(s.pitch, clamp(-s.accel * 0.00042, -0.05, 0.05), 5, dt);

    return s;
  }
}

export { SPEED_MAP };
