/* ============================================================
   car.js — "APEX 95", a character race car
   ------------------------------------------------------------
   An original, Cars-style stock racer built entirely in code:
   rounded lofted body, big expressive eyes set into the wind-
   screen, a grinning front bumper, number 95 + bolt livery, and
   fat slicks on red rims. No external assets, no real-world
   sponsor marks.

   The model is authored nose-toward local -Z (station 0 of the
   loft is the front bumper). The rig adds PI to the heading, so
   from the outside the car's forward is the drive line's forward.
   ============================================================ */
import * as THREE from 'three';
import { clamp, lerp, catmull, damp } from './util.js';

/* ── parametric shell ───────────────────────────────────────── */
const CH = ['z', 'hw', 'y0', 'y1', 'nTop', 'nBot', 'tumble'];

function channels(keys) {
  const a = {};
  CH.forEach((k) => (a[k] = keys.map((s) => (s[k] !== undefined ? s[k] : 3))));
  return a;
}
function sectionAt(arrs, x) {
  const sec = {};
  CH.forEach((k) => (sec[k] = catmull(arrs[k], x)));
  sec.hw = Math.max(0.004, sec.hw);
  return sec;
}
function ringPoint(sec, a, out = [0, 0, 0]) {
  const c = Math.cos(a), s = Math.sin(a);
  const n = s >= 0 ? sec.nTop : sec.nBot;
  const e = 2 / n;
  let x = Math.sign(c) * Math.pow(Math.abs(c), e) * sec.hw;
  const yu = Math.sign(s) * Math.pow(Math.abs(s), e);
  const up = Math.max(0, yu);
  x *= lerp(1, sec.tumble, up * up);
  const yc = (sec.y0 + sec.y1) * 0.5, yh = (sec.y1 - sec.y0) * 0.5;
  out[0] = x; out[1] = yc + yh * yu; out[2] = sec.z;
  return out;
}

function loft(keys, stations = 46, radial = 40) {
  const arrs = channels(keys);
  const secs = [];
  for (let i = 0; i < stations; i++) secs.push(sectionAt(arrs, (i / (stations - 1)) * (keys.length - 1)));

  const pos = [], idx = [], p = [0, 0, 0];
  for (let i = 0; i < stations; i++) {
    for (let j = 0; j < radial; j++) {
      ringPoint(secs[i], (j / radial) * Math.PI * 2, p);
      pos.push(p[0], p[1], p[2]);
    }
  }
  for (let i = 0; i < stations - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + ((j + 1) % radial), d = (i + 1) * radial + j;
      idx.push(a, b, d, b, c, d);
    }
  }
  const c0 = pos.length / 3;
  pos.push(0, (secs[0].y0 + secs[0].y1) * 0.5, secs[0].z);
  for (let j = 0; j < radial; j++) idx.push(c0, (j + 1) % radial, j);
  const c1 = pos.length / 3, last = secs[stations - 1], off = (stations - 1) * radial;
  pos.push(0, (last.y0 + last.y1) * 0.5, last.z);
  for (let j = 0; j < radial; j++) idx.push(c1, off + j, off + ((j + 1) % radial));

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* a decal that hugs the shell: sampled from the same surface,
   pushed out along its normal, with clean 0..1 UVs */
function loftPatch(keys, x0, x1, a0, a1, offset = 0.006, nx = 18, na = 18, flipU = false) {
  const arrs = channels(keys);
  const pos = [], uv = [], idx = [];
  const p = [0, 0, 0], pu = [0, 0, 0], pv = [0, 0, 0];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();

  for (let i = 0; i <= nx; i++) {
    const fx = i / nx;
    const x = lerp(x0, x1, fx);
    const sec = sectionAt(arrs, x);
    const secU = sectionAt(arrs, Math.min(x + 0.02, keys.length - 1.001));
    for (let j = 0; j <= na; j++) {
      const fa = j / na;
      const a = lerp(a0, a1, fa);
      ringPoint(sec, a, p);
      ringPoint(sec, a + 0.02, pv);
      ringPoint(secU, a, pu);
      A.set(p[0], p[1], p[2]);
      B.set(pu[0], pu[1], pu[2]).sub(A);
      C.set(pv[0], pv[1], pv[2]).sub(A);
      N.crossVectors(C, B).normalize();
      if (N.dot(A.clone().setZ(0)) < 0) N.negate();
      pos.push(A.x + N.x * offset, A.y + N.y * offset, A.z + N.z * offset);
      uv.push(flipU ? 1 - fa : fa, fx);
    }
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < na; j++) {
      const a = i * (na + 1) + j, b = a + 1, c = a + na + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* a strip that arcs across the front of the nose — the face plate */
function faceStrip(halfWidth, yTop, yBottom, zFront, sweep, smile, seg = 26) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const f = i / seg;
    const u = f * 2 - 1;
    const x = u * halfWidth;
    const z = zFront + Math.abs(u) * sweep + u * u * sweep * 0.55;
    const rise = u * u * smile;
    pos.push(x, yTop + rise, z, x, yBottom + rise, z);
    uv.push(f, 1, f, 0);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ── proportions ────────────────────────────────────────────── */
const BODY = [
  { z: -2.26, hw: 0.58, y0: 0.26, y1: 0.60, nTop: 2.5, nBot: 2.3, tumble: 0.84 },
  { z: -2.08, hw: 0.84, y0: 0.17, y1: 0.70, nTop: 2.7, nBot: 2.5, tumble: 0.84 },
  { z: -1.78, hw: 0.97, y0: 0.14, y1: 0.79, nTop: 2.9, nBot: 2.7, tumble: 0.86 },
  { z: -1.34, hw: 1.06, y0: 0.13, y1: 0.86, nTop: 3.2, nBot: 3.0, tumble: 0.87 },
  { z: -0.86, hw: 1.01, y0: 0.14, y1: 0.84, nTop: 3.2, nBot: 3.0, tumble: 0.89 },
  { z: -0.42, hw: 1.02, y0: 0.14, y1: 0.88, nTop: 3.2, nBot: 3.0, tumble: 0.89 },
  { z: 0.12, hw: 1.05, y0: 0.14, y1: 0.92, nTop: 3.4, nBot: 3.0, tumble: 0.89 },
  { z: 0.72, hw: 1.07, y0: 0.14, y1: 0.94, nTop: 3.4, nBot: 3.0, tumble: 0.89 },
  { z: 1.34, hw: 1.07, y0: 0.15, y1: 0.93, nTop: 3.4, nBot: 3.0, tumble: 0.89 },
  { z: 1.86, hw: 1.03, y0: 0.17, y1: 0.90, nTop: 3.2, nBot: 2.8, tumble: 0.90 },
  { z: 2.22, hw: 0.90, y0: 0.24, y1: 0.84, nTop: 2.8, nBot: 2.6, tumble: 0.90 },
];

const CAB = [
  { z: -0.62, hw: 0.34, y0: 0.80, y1: 0.90, nTop: 2.4, nBot: 2.2, tumble: 0.82 },
  { z: -0.40, hw: 0.62, y0: 0.82, y1: 1.10, nTop: 2.6, nBot: 2.3, tumble: 0.78 },
  { z: 0.06, hw: 0.79, y0: 0.84, y1: 1.32, nTop: 2.9, nBot: 2.4, tumble: 0.76 },
  { z: 0.66, hw: 0.81, y0: 0.84, y1: 1.34, nTop: 3.0, nBot: 2.4, tumble: 0.76 },
  { z: 1.18, hw: 0.74, y0: 0.85, y1: 1.16, nTop: 2.8, nBot: 2.4, tumble: 0.80 },
  { z: 1.54, hw: 0.52, y0: 0.86, y1: 0.96, nTop: 2.5, nBot: 2.2, tumble: 0.86 },
];

/* ── canvas art ─────────────────────────────────────────────── */
const C2D = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
};
const tex = (c, aniso = 8) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
};
const FONT = (px, w = 900, it = 'italic') => `${it} ${w} ${px}px "Arial Black", Impact, Inter, sans-serif`;

function boltPath(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x - 1.55 * s, y - 0.10 * s);
  ctx.lineTo(x - 0.28 * s, y - 0.60 * s);
  ctx.lineTo(x - 0.42 * s, y - 0.10 * s);
  ctx.lineTo(x + 0.55 * s, y - 0.34 * s);
  ctx.lineTo(x - 0.10 * s, y + 0.22 * s);
  ctx.lineTo(x + 0.30 * s, y + 0.20 * s);
  ctx.lineTo(x - 1.35 * s, y + 0.66 * s);
  ctx.lineTo(x - 0.62 * s, y + 0.14 * s);
  ctx.closePath();
}

/* flank livery: bolt + 95 + wordmarks (drawn nose-left → tail-right) */
function flankTexture() {
  const [c, ctx] = C2D(1024, 512);
  ctx.clearRect(0, 0, 1024, 512);

  // bolt
  ctx.save();
  ctx.translate(430, 250);
  ctx.rotate(-0.06);
  boltPath(ctx, 0, 0, 210);
  const g = ctx.createLinearGradient(-330, -120, 180, 160);
  g.addColorStop(0, '#ffd83a');
  g.addColorStop(0.55, '#ffb01c');
  g.addColorStop(1, '#ff8a12');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 16; ctx.strokeStyle = '#8f1006'; ctx.stroke();
  ctx.restore();

  // number
  ctx.save();
  ctx.translate(560, 300);
  ctx.rotate(-0.05);
  ctx.font = FONT(250);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 34; ctx.strokeStyle = '#ffe14a'; ctx.strokeText('95', 0, 0);
  ctx.lineWidth = 14; ctx.strokeStyle = '#7c0d05'; ctx.strokeText('95', 0, 0);
  ctx.fillStyle = '#e8321c'; ctx.fillText('95', 0, 0);
  ctx.restore();

  // small sponsor marks
  ctx.font = FONT(44, 800, 'normal');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillText('A P E X', 830, 150);
  ctx.font = FONT(30, 700, 'normal');
  ctx.fillStyle = 'rgba(255,232,150,0.9)';
  ctx.fillText('VELOCITY SERIES', 830, 196);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = FONT(26, 700, 'normal');
  ctx.fillText('RACE  SPEC  V8', 190, 400);
  return tex(c);
}

function roofTexture() {
  const [c, ctx] = C2D(512, 512);
  ctx.clearRect(0, 0, 512, 512);
  ctx.save();
  ctx.translate(256, 250);
  ctx.font = FONT(300);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 40; ctx.strokeStyle = '#ffe14a'; ctx.strokeText('95', 0, 0);
  ctx.lineWidth = 16; ctx.strokeStyle = '#7c0d05'; ctx.strokeText('95', 0, 0);
  ctx.fillStyle = '#e8321c'; ctx.fillText('95', 0, 0);
  ctx.restore();
  return tex(c);
}

/* side glass band */
function windowTexture() {
  const [c, ctx] = C2D(512, 256);
  ctx.clearRect(0, 0, 512, 256);
  ctx.fillStyle = '#000';
  const r = 46;
  ctx.beginPath();
  ctx.moveTo(60 + r, 30);
  ctx.lineTo(452 - r, 46);
  ctx.quadraticCurveTo(470, 52, 466, 96);
  ctx.lineTo(452, 206);
  ctx.quadraticCurveTo(446, 226, 410, 226);
  ctx.lineTo(96, 214);
  ctx.quadraticCurveTo(58, 210, 56, 176);
  ctx.lineTo(52, 78);
  ctx.quadraticCurveTo(50, 36, 60 + r, 30);
  ctx.closePath();
  ctx.fill();
  return tex(c);
}

/* the grin: dark cavity + a row of teeth */
function mouthTexture() {
  const [c, ctx] = C2D(1024, 256);
  ctx.clearRect(0, 0, 1024, 256);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(70, 96);
  ctx.quadraticCurveTo(512, 22, 954, 96);
  ctx.quadraticCurveTo(512, 268, 70, 96);
  ctx.closePath();
  ctx.fillStyle = '#2a0603';
  ctx.fill();
  ctx.clip();
  // teeth
  ctx.fillStyle = '#fbf7ef';
  ctx.beginPath();
  ctx.moveTo(60, 92);
  ctx.quadraticCurveTo(512, 18, 964, 92);
  ctx.lineTo(964, 150);
  ctx.quadraticCurveTo(512, 78, 60, 150);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,110,100,0.55)';
  ctx.lineWidth = 5;
  for (let i = 1; i < 9; i++) {
    const x = 60 + (i / 9) * 904;
    const y = 92 - Math.sin((i / 9) * Math.PI) * 66;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 66); ctx.stroke();
  }
  ctx.restore();
  // lip
  ctx.strokeStyle = 'rgba(60,8,4,0.85)';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(70, 96);
  ctx.quadraticCurveTo(512, 22, 954, 96);
  ctx.stroke();
  return tex(c);
}

/* headlight stickers, drawn as one strip across the nose */
function headlightTexture() {
  const [c, ctx] = C2D(1024, 256);
  ctx.clearRect(0, 0, 1024, 256);
  const lamp = (cx) => {
    ctx.save();
    ctx.translate(cx, 128);
    ctx.rotate(cx < 512 ? 0.10 : -0.10);
    ctx.beginPath();
    ctx.moveTo(-150, -58); ctx.quadraticCurveTo(0, -86, 150, -46);
    ctx.quadraticCurveTo(168, 0, 140, 58);
    ctx.quadraticCurveTo(0, 90, -150, 52);
    ctx.quadraticCurveTo(-172, 0, -150, -58);
    ctx.closePath();
    const g = ctx.createRadialGradient(-20, -10, 8, 0, 0, 170);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, '#e8f2ff');
    g.addColorStop(1, '#9fbede');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(20,26,36,0.85)'; ctx.stroke();
    ctx.restore();
  };
  lamp(250); lamp(774);
  return tex(c);
}

function tailTexture() {
  const [c, ctx] = C2D(1024, 256);
  ctx.clearRect(0, 0, 1024, 256);
  const lamp = (cx) => {
    ctx.beginPath();
    ctx.roundRect(cx - 190, 74, 380, 108, 40);
    ctx.fillStyle = '#ff2a12'; ctx.fill();
    ctx.lineWidth = 12; ctx.strokeStyle = 'rgba(30,4,2,0.8)'; ctx.stroke();
  };
  lamp(250); lamp(774);
  return tex(c);
}

function noiseNormal(size = 128, strength = 0.5) {
  const [c, ctx] = C2D(size, size);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (Math.random() - 0.5) * strength;
    img.data[i * 4] = 128 + n * 127;
    img.data[i * 4 + 1] = 128 + n * 127;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function radialAlpha(size = 256, power = 2.2) {
  const [c, ctx] = C2D(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 10; i++) g.addColorStop(i / 10, `rgba(255,255,255,${Math.pow(1 - i / 10, power).toFixed(3)})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

/* ── headlight beam shader ──────────────────────────────────── */
const beamVert = `
  varying vec3 vN; varying vec3 vV; varying float vD;
  void main(){
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position,1.0);
    vV = normalize(-mv.xyz);
    vD = clamp(abs(position.z) / 24.0, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }`;
const beamFrag = `
  uniform vec3 uColor; uniform float uIntensity;
  varying vec3 vN; varying vec3 vV; varying float vD;
  void main(){
    float facing = abs(dot(normalize(vN), normalize(vV)));
    float a = pow(facing, 1.4) * pow(1.0 - vD, 2.0) * uIntensity;
    a *= smoothstep(0.0, 0.05, vD);
    gl_FragColor = vec4(uColor * a, a);
  }`;

/* ── wheel ──────────────────────────────────────────────────── */
function buildWheel(mats, width, radius) {
  const g = new THREE.Group();
  const hw = width * 0.5;

  const tire = new THREE.Mesh(new THREE.LatheGeometry([
    [0.56, -hw * 0.84], [0.72, -hw * 0.97], [0.88, -hw], [0.97, -hw * 0.84],
    [1.00, -hw * 0.42], [1.00, hw * 0.42], [0.97, hw * 0.84], [0.88, hw],
    [0.72, hw * 0.97], [0.56, hw * 0.84],
  ].map(([r, y]) => new THREE.Vector2(r * radius, y)), 40), mats.rubber);
  tire.rotation.z = Math.PI / 2;
  g.add(tire);

  const rim = new THREE.Mesh(new THREE.LatheGeometry([
    [0.10, hw * 0.20], [0.30, hw * 0.34], [0.46, hw * 0.52], [0.56, hw * 0.66],
    [0.60, hw * 0.72], [0.60, hw * 0.86], [0.56, hw * 0.88], [0.30, hw * 0.80], [0.10, hw * 0.62],
  ].map(([r, y]) => new THREE.Vector2(r * radius, y)), 34), mats.rim);
  rim.rotation.z = Math.PI / 2;
  g.add(rim);

  const dish = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, 0.03, 30), mats.rimDark);
  dish.rotation.z = Math.PI / 2;
  dish.position.x = hw * 0.55;
  g.add(dish);

  const boltGeo = new THREE.CylinderGeometry(radius * 0.045, radius * 0.045, 0.05, 8);
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(boltGeo, mats.chrome);
    const a = (i / 5) * Math.PI * 2;
    b.position.set(hw * 0.6, Math.sin(a) * radius * 0.20, Math.cos(a) * radius * 0.20);
    b.rotation.z = Math.PI / 2;
    g.add(b);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.11, radius * 0.11, 0.06, 16), mats.chrome);
  cap.rotation.z = Math.PI / 2;
  cap.position.x = hw * 0.62;
  g.add(cap);

  return { group: g, tire, rim };
}

/* ── builder ────────────────────────────────────────────────── */
export function buildCar(env, quality) {
  const micro = noiseNormal(128, 0.5);
  micro.repeat.set(5, 5);

  const RED = 0xd4200f;
  const mats = {
    paint: new THREE.MeshPhysicalMaterial({
      color: RED, metalness: 0.30, roughness: 0.22,
      clearcoat: 1.0, clearcoatRoughness: 0.05,
      envMap: env, envMapIntensity: 1.15,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x05070c, metalness: 0.4, roughness: 0.06,
      clearcoat: 1, clearcoatRoughness: 0.02, envMap: env, envMapIntensity: 2.2,
      transparent: true, opacity: 0.97, depthWrite: false,
    }),
    livery: new THREE.MeshPhysicalMaterial({
      transparent: true, metalness: 0.15, roughness: 0.28,
      clearcoat: 1, clearcoatRoughness: 0.06, envMap: env, envMapIntensity: 0.85,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0b0c10, metalness: 0.3, roughness: 0.7, envMap: env, envMapIntensity: 0.4 }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x0a0a0c, roughness: 0.95, metalness: 0.0,
      normalMap: micro, normalScale: new THREE.Vector2(0.55, 0.55),
      envMap: env, envMapIntensity: 0.22,
    }),
    rim: new THREE.MeshStandardMaterial({ color: 0x8e1207, metalness: 0.85, roughness: 0.32, envMap: env, envMapIntensity: 1.1 }),
    rimDark: new THREE.MeshStandardMaterial({ color: 0x1c1d21, metalness: 0.7, roughness: 0.5, envMap: env }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xc6ccd6, metalness: 1.0, roughness: 0.16, envMap: env, envMapIntensity: 1.5 }),
    eyeWhite: new THREE.MeshPhysicalMaterial({ color: 0xf7f9fb, roughness: 0.18, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.04, envMap: env, envMapIntensity: 0.9 }),
    iris: new THREE.MeshStandardMaterial({ color: 0x1f6fd0, roughness: 0.25, metalness: 0.1, envMap: env, envMapIntensity: 0.8 }),
    pupil: new THREE.MeshBasicMaterial({ color: 0x05070c }),
    spark: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    head: new THREE.MeshStandardMaterial({
      transparent: true, color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0,
      roughness: 0.15, metalness: 0.1, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }),
    tail: new THREE.MeshStandardMaterial({
      transparent: true, color: 0x400604, emissive: 0xff2410, emissiveIntensity: 0.7,
      roughness: 0.3, metalness: 0.1, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }),
    mouth: new THREE.MeshStandardMaterial({
      transparent: true, roughness: 0.45, metalness: 0.0, side: THREE.DoubleSide,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }),
  };

  const flankTex = flankTexture();
  const roofTex = roofTexture();
  const winTex = windowTexture();
  const mouthTex = mouthTexture();
  const headTex = headlightTexture();
  const tailTex = tailTexture();

  mats.mouth.map = mouthTex; mats.mouth.alphaMap = mouthTex;
  mats.head.map = headTex; mats.head.alphaMap = headTex; mats.head.emissiveMap = headTex;
  mats.tail.alphaMap = tailTex; mats.tail.map = tailTex; mats.tail.emissiveMap = tailTex;

  const car = new THREE.Group();
  const body = new THREE.Group();
  car.add(body);

  /* shell + cabin */
  const shell = new THREE.Mesh(loft(BODY, 54, 44), mats.paint);
  const cabin = new THREE.Mesh(loft(CAB, 30, 34), mats.paint);
  body.add(shell, cabin);

  /* livery patches on both flanks */
  const flankMat = mats.livery.clone();
  flankMat.map = flankTex; flankMat.alphaMap = flankTex;
  for (const side of [0, 1]) {
    const a0 = side ? Math.PI - 0.62 : -0.62;
    const a1 = side ? Math.PI + 0.62 : 0.62;
    const g = loftPatch(BODY, 1.35, 8.6, a0, a1, 0.007, 22, 16, side === 0);
    const m = new THREE.Mesh(g, flankMat);
    m.renderOrder = 2;
    body.add(m);
  }

  /* roof number */
  const roofMat = mats.livery.clone();
  roofMat.map = roofTex; roofMat.alphaMap = roofTex;
  const roofDecal = new THREE.Mesh(loftPatch(CAB, 1.6, 4.0, Math.PI / 2 - 0.55, Math.PI / 2 + 0.55, 0.008, 14, 14), roofMat);
  roofDecal.renderOrder = 2;
  body.add(roofDecal);

  /* side glass */
  const winMat = new THREE.MeshPhysicalMaterial({
    color: 0x04060a, metalness: 0.35, roughness: 0.07, clearcoat: 1,
    envMap: env, envMapIntensity: 2.0, transparent: true,
    alphaMap: winTex, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  for (const side of [0, 1]) {
    const a0 = side ? Math.PI - 0.75 : -0.75;
    const a1 = side ? Math.PI + 0.75 : 0.75;
    const g = loftPatch(CAB, 0.75, 4.5, a0, a1, 0.006, 20, 16, side === 0);
    const m = new THREE.Mesh(g, winMat);
    m.renderOrder = 3;
    body.add(m);
  }
  /* rear window */
  const rearWin = new THREE.Mesh(
    loftPatch(CAB, 3.6, 4.9, Math.PI / 2 - 0.7, Math.PI / 2 + 0.7, 0.006, 10, 12),
    new THREE.MeshPhysicalMaterial({
      color: 0x05070c, metalness: 0.35, roughness: 0.08, clearcoat: 1,
      envMap: env, envMapIntensity: 1.8,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    })
  );
  body.add(rearWin);

  /* ── the face ────────────────────────────────────────────── */
  const face = new THREE.Group();
  body.add(face);

  const mouth = new THREE.Mesh(faceStrip(0.78, 0.60, 0.28, -2.18, 0.10, 0.055), mats.mouth);
  face.add(mouth);

  const headlamps = new THREE.Mesh(faceStrip(0.80, 0.90, 0.60, -2.09, 0.13, 0.045), mats.head);
  face.add(headlamps);

  /* eyes — set into the windscreen, they track the camera */
  const eyes = [];
  const eyeGeo = new THREE.SphereGeometry(0.30, 30, 24);
  const socketGeo = new THREE.SphereGeometry(0.325, 26, 20);
  const irisGeo = new THREE.CircleGeometry(0.135, 26);
  const pupilGeo = new THREE.CircleGeometry(0.072, 22);
  const sparkGeo = new THREE.CircleGeometry(0.032, 14);
  const lidGeo = new THREE.SphereGeometry(0.315, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.42);

  for (const sgn of [-1, 1]) {
    const root = new THREE.Group();
    root.position.set(sgn * 0.315, 1.03, -0.47);

    const socket = new THREE.Mesh(socketGeo, mats.glass);
    socket.position.z = 0.055;
    root.add(socket);

    const ball = new THREE.Group();
    const white = new THREE.Mesh(eyeGeo, mats.eyeWhite);
    ball.add(white);

    const iris = new THREE.Mesh(irisGeo, mats.iris);
    iris.position.z = -0.288;
    iris.rotation.y = Math.PI;
    const pupil = new THREE.Mesh(pupilGeo, mats.pupil);
    pupil.position.z = -0.0025;
    iris.add(pupil);
    const spark = new THREE.Mesh(sparkGeo, mats.spark);
    spark.position.set(sgn * -0.045, 0.05, -0.004);
    iris.add(spark);
    ball.add(iris);
    root.add(ball);

    const lid = new THREE.Mesh(lidGeo, mats.paint);
    lid.rotation.x = -0.55;
    lid.position.z = 0.01;
    root.add(lid);

    face.add(root);
    eyes.push({ root, ball, lid, sgn });
  }

  /* ── body furniture ──────────────────────────────────────── */
  const spoiler = new THREE.Group();
  spoiler.add(new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.06, 0.40), mats.paint));
  for (const sgn of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.24, 0.16), mats.paint);
    post.position.set(sgn * 0.66, -0.14, 0.02);
    spoiler.add(post);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.40), mats.paint);
    plate.position.set(sgn * 0.86, 0.09, 0);
    spoiler.add(plate);
  }
  spoiler.position.set(0, 0.99, 1.76);
  spoiler.rotation.x = -0.10;
  body.add(spoiler);

  const tailPanel = new THREE.Mesh(faceStrip(0.80, 0.80, 0.55, 2.20, -0.10, -0.03), mats.tail);
  tailPanel.rotation.y = Math.PI;
  tailPanel.position.z = 0;
  body.add(tailPanel);

  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.16, 0.10), mats.dark);
  grille.position.set(0, 0.98, 1.02);
  grille.rotation.x = 0.12;
  body.add(grille);
  for (const sgn of [-1, 1]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.07, 0.9, 12), mats.chrome);
    pipe.rotation.set(Math.PI / 2, 0, sgn * 0.06);
    pipe.position.set(sgn * 1.02, 0.30, 0.85);
    body.add(pipe);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.14, 12), mats.chrome);
    tip.rotation.set(Math.PI / 2, 0, 0);
    tip.position.set(sgn * 1.03, 0.30, 1.34);
    body.add(tip);
  }

  const skirtGeo = new THREE.BoxGeometry(0.09, 0.13, 2.1);
  for (const sgn of [-1, 1]) {
    const s = new THREE.Mesh(skirtGeo, mats.dark);
    s.position.set(sgn * 1.00, 0.18, 0.15);
    body.add(s);
  }
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.05, 0.42), mats.dark);
  splitter.position.set(0, 0.135, -2.02);
  body.add(splitter);

  /* ── lighting ────────────────────────────────────────────── */
  const beamGeo = new THREE.ConeGeometry(1.5, 24, 24, 1, true);
  beamGeo.translate(0, -12, 0);
  beamGeo.rotateX(Math.PI / 2);
  const glowTex = radialAlpha(256, 2.4);
  const beams = [], beamMats = [], headGlows = [];

  for (const sgn of [-1, 1]) {
    const bm = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xcfe0ff) }, uIntensity: { value: 0 } },
      vertexShader: beamVert, fragmentShader: beamFrag,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(beamGeo, bm);
    beam.position.set(sgn * 0.52, 0.76, -2.12);
    beam.frustumCulled = false;
    body.add(beam);
    beams.push(beam); beamMats.push(bm);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xdbe8ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.set(1.4, 1.4, 1);
    glow.position.set(sgn * 0.52, 0.76, -2.16);
    body.add(glow);
    headGlows.push(glow);
  }

  const spot = new THREE.SpotLight(0xdce9ff, 0, 70, 0.44, 0.6, 1.3);
  spot.position.set(0, 0.78, -2.05);
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(0, 0.1, -34);
  body.add(spot, spotTarget);
  spot.target = spotTarget;

  /* ── wheels ──────────────────────────────────────────────── */
  const R = 0.42;
  const wheels = [];
  const archGeo = new THREE.TorusGeometry(R * 1.13, 0.085, 8, 24, Math.PI * 1.05);
  [['fl', -1, -1.30, 0.40, true], ['fr', 1, -1.30, 0.40, true],
   ['rl', -1, 1.42, 0.46, false], ['rr', 1, 1.42, 0.46, false]]
    .forEach(([name, sgn, z, width, steerable]) => {
      const hub = new THREE.Group();
      hub.position.set(sgn * 0.90, R, z);
      const steerG = new THREE.Group();
      const spinG = new THREE.Group();
      const w = buildWheel(mats, width, R);
      if (sgn < 0) w.group.rotation.y = Math.PI;
      spinG.add(w.group);
      steerG.add(spinG);
      hub.add(steerG);
      car.add(hub);

      const arch = new THREE.Mesh(archGeo, mats.dark);
      arch.rotation.y = Math.PI / 2;
      arch.rotation.z = Math.PI * 0.06;
      arch.position.set(sgn * 0.90, R, z);
      body.add(arch);

      wheels.push({ name, hub, steerG, spinG, steerable, sgn, z, baseY: R });
    });

  /* ── contact shadow ──────────────────────────────────────── */
  const shadowTex = radialAlpha(256, 1.7);
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 6.6),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.6, color: 0x000000, depthWrite: false })
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.012;
  contact.renderOrder = 1;

  if (quality.shadows) body.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  /* ── runtime ─────────────────────────────────────────────── */
  const _look = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  let blink = 0, nextBlink = 2.2;

  const api = {
    group: car, body, shell, cabin, wheels, contact, mats, eyes, face,
    spot, beams, beamMats, headGlows, spoiler,
    headlightLevel: 0,

    setDynamics(s) {
      car.position.copy(s.pos);
      car.rotation.y = s.yaw + Math.PI;        // model faces local -Z
      body.rotation.z = -s.roll;
      body.rotation.x = -s.pitch;
      body.position.y = -Math.abs(s.roll) * 0.05 - s.pitch * 0.05;

      const load = clamp(Math.abs(s.roll) * 6, 0, 1);
      wheels.forEach((w) => {
        w.spinG.rotation.x = -s.wheelSpin;
        if (w.steerable) w.steerG.rotation.y = -s.steer;
        const outer = Math.sign(s.roll) === w.sgn ? 1 : -1;
        const squat = (w.z < 0 ? 1 : -1) * s.pitch * 0.6;
        w.hub.position.y = w.baseY + outer * load * 0.03 + squat * 0.35;
      });
    },

    /* eyes follow the lens; a squint when the pace picks up */
    setFace(camera, dt, time, state, t) {
      camera.getWorldPosition(_look);
      body.updateMatrixWorld();

      blink -= dt;
      if (blink < -0.14) { blink = 0; nextBlink = 2.0 + Math.random() * 3.4; }
      if (blink <= 0 && blink > -0.14) { /* mid-blink */ }
      nextBlink -= dt;
      if (nextBlink <= 0 && blink <= 0) { blink = 0.14; nextBlink = 2.0 + Math.random() * 3.4; }
      const lidClose = blink > 0 ? Math.sin((1 - blink / 0.14) * Math.PI) : 0;

      const focus = clamp((t - 0.60) / 0.16) * 0.85 + 0.15;
      const squint = clamp(state.speedNorm * 0.5 + Math.abs(state.roll) * 3.0, 0, 0.5);

      eyes.forEach((e) => {
        e.root.updateMatrixWorld();
        const local = e.root.worldToLocal(_look.clone());
        const yaw = clamp(Math.atan2(local.x, -local.z), -0.5, 0.5) * focus;
        const pitch = clamp(Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.34, 0.34) * focus;
        _e.set(-pitch, yaw, 0, 'YXZ');
        _q.setFromEuler(_e);
        e.ball.quaternion.slerp(_q, 1 - Math.exp(-8 * dt));
        e.lid.rotation.x = lerp(e.lid.rotation.x, -0.55 + lidClose * 1.35 + squint * 0.42, 1 - Math.exp(-14 * dt));
      });
    },

    setHeadlights(v) {
      this.headlightLevel = v;
      mats.head.emissiveIntensity = v * 3.6;
      mats.head.opacity = 1;
      spot.intensity = v * 24;
      beamMats.forEach((m) => (m.uniforms.uIntensity.value = v * 0.30));
      headGlows.forEach((g) => {
        g.material.opacity = v * 0.8;
        const s = lerp(1.0, 2.0, v);
        g.scale.set(s, s, 1);
      });
      mats.tail.emissiveIntensity = 0.6 + v * 1.5;
    },

    dispose() {
      car.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      Object.values(mats).forEach((m) => m.dispose?.());
      [flankTex, roofTex, winTex, mouthTex, headTex, tailTex, glowTex, shadowTex, micro].forEach((t) => t.dispose());
      beamGeo.dispose();
    },
  };

  api.setHeadlights(0);
  return api;
}
