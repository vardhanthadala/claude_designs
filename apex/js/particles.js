/* ============================================================
   particles.js — atmospheric dust + tire displacement
   ============================================================ */
import * as THREE from 'three';
import { clamp, lerp, rand } from './util.js';

const dustVert = /* glsl */`
  attribute float aSeed;
  attribute float aSize;
  uniform float uTime;
  uniform float uPixel;
  uniform float uRush;
  uniform vec3  uCam;
  uniform vec2  uPointer;
  varying float vFade;
  varying float vSeed;

  void main(){
    vec3 p = position;

    // lazy drift
    p.x += sin(uTime * 0.18 + aSeed * 6.28) * 1.4;
    p.y += sin(uTime * 0.13 + aSeed * 11.0) * 0.7;
    p.z += cos(uTime * 0.11 + aSeed * 8.4) * 1.1;

    // pointer nudge — very light, never fights the choreography
    p.xy += uPointer * (0.6 + aSeed * 1.4);

    // final act: everything rushes past the viewer
    vec3 toCam = uCam - p;
    float d = length(toCam);
    p += normalize(toCam) * uRush * (14.0 + aSeed * 26.0) * (1.0 - clamp(d / 90.0, 0.0, 1.0));

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixel * (1.0 + uRush * 2.6) / max(dist, 1.0);

    float fog = exp(-dist * 0.010);
    vFade = fog * smoothstep(1.0, 6.0, dist) * (0.35 + aSeed * 0.65);
    vSeed = aSeed;
  }`;

const dustFrag = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  varying float vSeed;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.02, d);
    a *= vFade * uOpacity;
    if (a < 0.003) discard;
    vec3 c = mix(uColor, vec3(0.85, 0.88, 0.95), vSeed * 0.4);
    gl_FragColor = vec4(c, a);
  }`;

export class AmbientDust {
  constructor(count, bounds = { x: 90, y: 26, z: 150 }) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 0] = rand(-bounds.x, bounds.x);
      pos[i * 3 + 1] = Math.pow(Math.random(), 1.7) * bounds.y;
      pos[i * 3 + 2] = rand(-bounds.z, bounds.z * 0.25);
      seed[i] = Math.random();
      size[i] = rand(24, 90);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uPixel: { value: 1 }, uRush: { value: 0 },
        uCam: { value: new THREE.Vector3() }, uPointer: { value: new THREE.Vector2() },
        uColor: { value: new THREE.Color(0x8fa6c8) }, uOpacity: { value: 0.85 },
      },
      vertexShader: dustVert, fragmentShader: dustFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }
  update(time, camera, pointer, rush, pixelRatio, h) {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uCam.value.copy(camera.position);
    u.uPointer.value.set(pointer.x * 1.5, pointer.y * 1.0);
    u.uRush.value = rush;
    u.uPixel.value = h * pixelRatio * 0.0016;
  }
  dispose() { this.points.geometry.dispose(); this.material.dispose(); }
}

/* ── tire dust: emitted at the rear contact patches ─────────── */
const smokeVert = /* glsl */`
  attribute float aLife;      // 0 fresh → 1 dead
  attribute float aSeed;
  attribute float aScale;
  uniform float uPixel;
  varying float vA;
  varying float vSeed;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = -mv.z;
    gl_Position = projectionMatrix * mv;
    float grow = 1.0 + aLife * 3.4;
    gl_PointSize = aScale * grow * uPixel / max(dist, 1.0);
    float fade = (1.0 - aLife);
    vA = pow(fade, 1.5) * exp(-dist * 0.011) * step(0.001, 1.0 - aLife);
    vSeed = aSeed;
  }`;
const smokeFrag = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vA;
  varying float vSeed;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d) * vA * uOpacity;
    if (a < 0.004) discard;
    vec3 c = mix(uColor, vec3(0.62, 0.66, 0.76), vSeed * 0.5);
    gl_FragColor = vec4(c, a);
  }`;

export class TireDust {
  constructor(count) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count).fill(1);
    this.seed = new Float32Array(count);
    this.scale = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    for (let i = 0; i < count; i++) {
      this.seed[i] = Math.random();
      this.scale[i] = rand(30, 70);
      this.pos[i * 3 + 1] = -999;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    g.setAttribute('aScale', new THREE.BufferAttribute(this.scale, 1));
    this.geo = g;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPixel: { value: 1 },
        uColor: { value: new THREE.Color(0x6b6f7a) },
        uOpacity: { value: 0.5 },
      },
      vertexShader: smokeVert, fragmentShader: smokeFrag,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;

    this.cursor = 0;
    this._acc = 0;
    this._tmp = new THREE.Vector3();
  }

  emit(x, y, z, vx, vy, vz, life, scale) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = 0;
    this.maxLife[i] = life;
    this.scale[i] = scale;
  }

  /* state = vehicle state; offroad 0..1 scales the amount of dust */
  update(dt, state, offroad, pixel, intensity = 1) {
    const spd = state.speedNorm;
    const rate = spd * (34 + offroad * 90) * intensity;
    this._acc += rate * dt;

    const dir = state.dir;
    const rx = -dir.z, rz = dir.x;               // right vector
    const slip = clamp(Math.abs(state.curvature) * state.speed * 0.035, 0, 1.4);

    while (this._acc >= 1) {
      this._acc -= 1;
      const side = Math.random() > 0.5 ? 1 : -1;
      const px = state.pos.x - dir.x * 1.5 + rx * side * 0.86;
      const pz = state.pos.z - dir.z * 1.5 + rz * side * 0.86;
      const back = 1.6 + spd * 5.5;
      const lat = slip * rand(1.2, 5.5) * Math.sign(state.curvature || 1);
      this.emit(
        px + rand(-0.16, 0.16), rand(0.03, 0.16), pz + rand(-0.16, 0.16),
        -dir.x * back + rx * lat + rand(-0.7, 0.7),
        rand(0.25, 1.5) + spd * 1.4,
        -dir.z * back + rz * lat + rand(-0.7, 0.7),
        rand(0.75, 1.9) * (1 + offroad * 0.5),
        rand(26, 70) * (1 + offroad * 0.55)
      );
    }

    for (let i = 0; i < this.count; i++) {
      if (this.life[i] >= 1) continue;
      const i3 = i * 3;
      this.life[i] = Math.min(1, this.life[i] + dt / this.maxLife[i]);
      const drag = 1 - 2.4 * dt;
      this.vel[i3] *= drag;
      this.vel[i3 + 2] *= drag;
      this.vel[i3 + 1] = this.vel[i3 + 1] * (1 - 0.9 * dt) + 0.35 * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aScale.needsUpdate = true;
    this.material.uniforms.uPixel.value = pixel;
  }

  dispose() { this.geo.dispose(); this.material.dispose(); }
}
