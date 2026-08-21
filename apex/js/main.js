/* ============================================================
   main.js — the sequence
   ------------------------------------------------------------
   One continuous shot, scrubbed by the page scroll:
   establish ▸ left entry ▸ high-speed pass ▸ sweeping arc ▸
   front reveal ▸ launch ▸ impact ▸ hand-off to the next section.
   ============================================================ */
import * as THREE from 'three';
import { clamp, lerp, range, damp, detectQuality, smootherstep } from './util.js';
import { DriveLine } from './path.js';
import { buildCar } from './car.js';
import { makeEnvironment, buildWorld, FOG_COLOR } from './world.js';
import { AmbientDust, TireDust } from './particles.js';
import { CinematicCamera } from './camera.js';
import { buildPost } from './postfx.js';
import { ScrollTimeline, Overlay } from './overlay.js';

const quality = detectQuality();
const canvas = document.getElementById('gl');
const loaderEl = document.getElementById('loader');
const loaderFill = document.getElementById('loaderFill');
const loaderPct = document.getElementById('loaderPct');

let progress = 0;
const step = (p) => {
  progress = Math.max(progress, p);
  loaderFill.style.width = `${Math.round(progress * 100)}%`;
  loaderPct.textContent = String(Math.round(progress * 100)).padStart(2, '0');
};

/* ── renderer ───────────────────────────────────────────────── */
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: false, powerPreference: 'high-performance', stencil: false,
});
renderer.setPixelRatio(quality.dpr);
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
if (quality.shadows) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}
step(0.1);

/* ── scene ──────────────────────────────────────────────────── */
const scene = new THREE.Scene();
const env = makeEnvironment(renderer);
scene.environment = env;
step(0.3);

const world = buildWorld(scene, env, quality);
step(0.5);

const car = buildCar(env, quality);
scene.add(car.group, car.contact);
step(0.68);

/* ── road reflection: a mirrored, additively-blended twin ───── */
let mirror = null;
if (quality.reflection) {
  const cache = new Map();
  mirror = car.group.clone(true);
  mirror.traverse((o) => {
    o.castShadow = false; o.receiveShadow = false;
    if (o.isMesh || o.isSprite) {
      const src = o.material;
      if (!cache.has(src)) {
        const m = src.clone();
        m.side = THREE.DoubleSide;
        m.transparent = true;
        m.opacity = 0.42;
        m.depthWrite = false;
        m.depthTest = true;
        m.blending = THREE.AdditiveBlending;
        m.fog = false;
        if (m.emissiveIntensity !== undefined) m.emissiveIntensity *= 0.55;
        cache.set(src, m);
      }
      o.material = cache.get(src);
      o.renderOrder = 3;
    }
  });
  mirror.matrixAutoUpdate = false;
  scene.add(mirror);
  car.mirrorMats = [...cache.values()];
}
const MIRROR_M = new THREE.Matrix4().makeScale(1, -1, 1);

/* ── particles ──────────────────────────────────────────────── */
const dust = new AmbientDust(quality.dust);
scene.add(dust.points);
const tireDust = new TireDust(quality.tireParticles);
scene.add(tireDust.points);
step(0.78);

/* ── camera + post ──────────────────────────────────────────── */
const rig = new CinematicCamera(innerWidth / innerHeight, quality);
const post = buildPost(renderer, scene, rig.cam, quality);
step(0.9);

/* ── timeline + ui ──────────────────────────────────────────── */
const drive = new DriveLine();
const timeline = new ScrollTimeline(document.getElementById('track'));
const overlay = new Overlay(document);

/* ── input ──────────────────────────────────────────────────── */
addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  rig.pointer.x = (e.clientX / innerWidth) * 2 - 1;
  rig.pointer.y = -((e.clientY / innerHeight) * 2 - 1);
}, { passive: true });

addEventListener('resize', () => {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  rig.cam.aspect = w / h;
  rig.cam.updateProjectionMatrix();
  post.setSize(w, h, quality.dpr);
}, { passive: true });

/* ── frame ──────────────────────────────────────────────────── */
const clock = new THREE.Clock();
let time = 0;
let bloomBase = quality.mobile ? 0.34 : 0.46;
const tmp = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);

  const dt = Math.min(clock.getDelta(), 1 / 24);
  time += dt;

  const t = timeline.update(dt);
  const scrubbing = clamp(Math.abs(timeline.velocity) * 2.6);

  /* ── vehicle ─────────────────────────────────────────────── */
  const s = drive.update(t, dt, timeline.velocity);
  car.setDynamics(s, t);
  car.contact.position.set(s.pos.x, 0.012, s.pos.z);
  car.contact.rotation.z = -s.yaw;
  car.contact.material.opacity = 0.58 - Math.abs(s.roll) * 0.6;

  /* headlights: sidelights early, ignition on the hero beat, blinding at the end */
  const hl = clamp(
    range(t, 0.16, 0.30) * 0.36 +
    range(t, 0.735, 0.802) * 0.62 +
    range(t, 0.870, 0.985) * 0.45, 0, 1.45
  );
  car.setHeadlights(hl);

  /* ── world ───────────────────────────────────────────────── */
  world.update(time, s.pos, t);

  /* ── camera ──────────────────────────────────────────────── */
  const approach = range(t, 0.845, 1.0);
  const impact = range(t, 0.945, 1.0);
  const extraShake = clamp(s.speedNorm * 0.30 + approach * 0.35 + impact * 0.85 + scrubbing * 0.15);
  const cam = rig.update(t, dt, time, s.pos, extraShake, innerWidth / innerHeight);

  /* the eyes find the lens once the car comes round to face it */
  car.setFace(cam, dt, time, s, t);

  /* ── particles ───────────────────────────────────────────── */
  const offroad = smootherstep((Math.abs(s.pos.x) - 6.5) / 6);
  const px = innerHeight * quality.dpr * 0.0016;
  dust.update(time, cam, rig.pointerSmooth, Math.pow(approach, 2.2) * 0.55 + impact * 0.5, quality.dpr, innerHeight);
  dust.material.uniforms.uOpacity.value = lerp(0.55, 1.0, range(t, 0.3, 1.0));
  tireDust.update(dt, s, offroad, px, 1 + approach * 0.8);
  tireDust.material.uniforms.uOpacity.value = lerp(0.42, 0.62, offroad);

  /* ── road reflection ─────────────────────────────────────── */
  if (mirror) {
    syncLocal(car.group, mirror);
    car.group.updateMatrixWorld(true);
    mirror.matrix.multiplyMatrices(MIRROR_M, car.group.matrixWorld);
    mirror.matrixWorldNeedsUpdate = true;
  }

  /* ── post ────────────────────────────────────────────────── */
  const cu = post.cinematic.uniforms;
  const focusDist = cam.position.distanceTo(s.pos);
  cu.uFocus.value = damp(cu.uFocus.value, lerp(58, focusDist, range(t, 0.10, 0.24)), 5, dt);
  cu.uRange.value = damp(
    cu.uRange.value,
    lerp(46, 7, Math.max(range(t, 0.2, 0.78), approach * 0.9)),
    4, dt
  );
  cu.uBokeh.value = quality.dof ? lerp(0.007, 0.016, range(t, 0.4, 0.9)) : 0;

  // directional smear follows the car's screen-space velocity
  tmp.set(rig.screenVel.x, rig.screenVel.y, 0);
  const smear = clamp(tmp.length() * 0.05, 0, 0.075);
  const dirX = damp(cu.uDir.value.x, (tmp.x === 0 ? 0 : (tmp.x / Math.max(tmp.length(), 1e-4)) * smear), 10, dt);
  const dirY = damp(cu.uDir.value.y, (tmp.y === 0 ? 0 : (tmp.y / Math.max(tmp.length(), 1e-4)) * smear), 10, dt);
  cu.uDir.value.set(dirX, dirY);

  cu.uRadial.value = damp(cu.uRadial.value, Math.pow(approach, 1.8) * 0.16 + impact * 0.30, 8, dt);
  cu.uGlobal.value = damp(cu.uGlobal.value, range(t, 0.972, 1.0) * 0.9, 8, dt);
  cu.uChroma.value = damp(cu.uChroma.value, 0.10 + impact * 0.85 + s.speedNorm * 0.06, 8, dt);

  post.bloom.strength = damp(
    post.bloom.strength,
    bloomBase + range(t, 0.72, 0.82) * 0.30 + Math.pow(impact, 1.4) * 2.1 + hl * 0.12,
    6, dt
  );

  const gu = post.grade.uniforms;
  gu.uTime.value = time;
  gu.uFlash.value = damp(gu.uFlash.value, Math.pow(range(t, 0.958, 0.998), 1.5) * 1.25, 10, dt);
  gu.uVignette.value = lerp(1.15, 0.55, approach);

  /* ── ui ──────────────────────────────────────────────────── */
  overlay.update(t, s, dt);

  /* ── render (skip once the next section has taken over) ──── */
  if (window.scrollY < timeline.max + innerHeight * 0.75 && document.visibilityState === 'visible') {
    if (DEBUG.bypass) renderer.render(scene, cam);
    else post.composer.render();
  }
}

const DEBUG = { bypass: false };
window.__apex = { DEBUG, renderer, scene, rig, post, car, world, drive, quality, timeline,
  seek(t) { window.scrollTo(0, timeline.max * t); } };

/* keep the mirrored twin's inner transforms in step with the real car */
function syncLocal(a, b) {
  b.position.copy(a.position);
  b.quaternion.copy(a.quaternion);
  b.scale.copy(a.scale);
  const ca = a.children, cb = b.children;
  for (let i = 0; i < ca.length && i < cb.length; i++) syncLocal(ca[i], cb[i]);
}

/* ── warm up, then reveal ───────────────────────────────────── */
function boot() {
  rig.update(0, 0.016, 0, drive.pointAt(0, tmp), 0, innerWidth / innerHeight);
  renderer.compile(scene, rig.cam);
  post.setSize(innerWidth, innerHeight, quality.dpr);
  post.composer.render();
  step(1);
  setTimeout(() => {
    loaderEl.classList.add('is-done');
    setTimeout(() => loaderEl.remove(), 1300);
  }, 420);
  frame();
}

document.fonts?.ready.then(boot).catch(boot) ?? boot();

addEventListener('beforeunload', () => {
  car.dispose(); world.dispose(); dust.dispose(); tireDust.dispose();
  post.dispose(); renderer.dispose();
});
