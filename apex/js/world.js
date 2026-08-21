/* ============================================================
   world.js — sky, ground, road, ridges, light rig, env map
   ------------------------------------------------------------
   The environment map is rendered procedurally from a tiny scene
   (a gradient dome + three emissive "softboxes"), then PMREM'd.
   That is what gives the paint its long, controlled highlights
   instead of a flat sheen.
   ============================================================ */
import * as THREE from 'three';

export const FOG_COLOR = new THREE.Color(0x0a0f1a);

/* ── studio-style environment ───────────────────────────────── */
export function makeEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const s = new THREE.Scene();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(60, 32, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {},
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `
        varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 top    = vec3(0.010, 0.020, 0.045);
          vec3 mid    = vec3(0.050, 0.085, 0.150);
          vec3 horiz  = vec3(0.230, 0.240, 0.290);
          vec3 warm   = vec3(0.360, 0.230, 0.130);
          vec3 ground = vec3(0.012, 0.013, 0.016);
          vec3 c = mix(mid, top, smoothstep(0.05, 0.85, h));
          c = mix(horiz, c, smoothstep(-0.02, 0.32, h));
          c = mix(c, warm, exp(-abs(h + 0.01) * 26.0) * 0.75);
          c = mix(ground, c, smoothstep(-0.16, 0.0, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  s.add(dome);

  const box = (w, h, color, pos, rot) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false })
    );
    m.position.set(...pos);
    m.rotation.set(...rot);
    return m;
  };
  // key softbox — high, left, cool. This is the long streak on the flanks.
  const key = box(46, 9, new THREE.Color(6.2, 6.8, 7.6), [-26, 26, -14], [Math.PI * 0.42, 0.5, 0.2]);
  // rim strip — behind, cooler and narrower
  const rim = box(60, 3.4, new THREE.Color(2.4, 3.4, 6.0), [18, 12, 30], [Math.PI * 0.5, -0.35, 0]);
  // warm horizon kicker
  const warm = box(70, 2.0, new THREE.Color(2.6, 1.35, 0.55), [10, 1.2, -46], [Math.PI * 0.5, 0, 0]);
  s.add(key, rim, warm);

  const rt = pmrem.fromScene(s, 0.045);

  dome.geometry.dispose(); dome.material.dispose();
  [key, rim, warm].forEach((m) => { m.geometry.dispose(); m.material.dispose(); });
  pmrem.dispose();

  return rt.texture;
}

/* ── visible sky dome ───────────────────────────────────────── */
function makeSky() {
  const geo = new THREE.SphereGeometry(900, 48, 32);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uFog: { value: FOG_COLOR } },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: /* glsl */`
      varying vec3 vP; uniform float uTime; uniform vec3 uFog;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
                   mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for(int i=0;i<5;i++){ v += a*noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }

      void main(){
        vec3 d = normalize(vP);
        float h = d.y;

        vec3 top   = vec3(0.007, 0.012, 0.028);
        vec3 mid   = vec3(0.022, 0.041, 0.080);
        vec3 horiz = vec3(0.105, 0.125, 0.175);
        vec3 c = mix(mid, top, smoothstep(0.06, 0.7, h));
        c = mix(horiz, c, smoothstep(-0.01, 0.28, h));

        // dramatic cloud banding, drifting very slowly
        vec2 uv = vec2(atan(d.z, d.x) * 1.35, h * 3.1);
        float cl = fbm(uv * 1.5 + vec2(uTime * 0.006, uTime * 0.002));
        cl = smoothstep(0.42, 0.92, cl) * smoothstep(-0.02, 0.35, h) * (1.0 - smoothstep(0.45, 0.95, h));
        c += vec3(0.055, 0.062, 0.078) * cl;

        // warm break on the horizon, off to one side
        float sun = pow(max(0.0, 1.0 - abs(h - 0.010) * 17.0), 2.6);
        float az  = pow(max(0.0, dot(d, normalize(vec3(-0.55, 0.0, -1.0)))), 6.0);
        c += vec3(0.30, 0.155, 0.070) * sun * az * 1.15;
        c += vec3(0.045, 0.065, 0.115) * pow(max(0.0, 1.0 - abs(h) * 6.5), 3.0);

        // stars, only high up
        float st = pow(hash(floor(d.xz * 420.0 + d.y * 90.0)), 62.0);
        c += vec3(st) * smoothstep(0.22, 0.72, h) * 0.85;

        // melt into the fog at the horizon line
        c = mix(uFog, c, smoothstep(-0.055, 0.045, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  return sky;
}

/* ── road + ground textures ─────────────────────────────────── */
function asphaltTexture(size = 512, light = 20) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${light},${light + 1},${light + 3})`;
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (Math.random() - 0.5) * 26;
    img.data[i * 4] = Math.max(0, img.data[i * 4] + n);
    img.data[i * 4 + 1] = Math.max(0, img.data[i * 4 + 1] + n);
    img.data[i * 4 + 2] = Math.max(0, img.data[i * 4 + 2] + n * 1.1);
  }
  ctx.putImageData(img, 0, 0);
  // long streaks — wear + wet patches
  for (let i = 0; i < 60; i++) {
    ctx.globalAlpha = 0.05 + Math.random() * 0.09;
    ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#3c4048';
    const w = 2 + Math.random() * 26;
    ctx.fillRect(Math.random() * size, 0, w, size);
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function roadMarkTexture() {
  const w = 256, h = 1024;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#cfc9ba';
  // dashed centre line
  for (let i = 0; i < 4; i++) ctx.fillRect(w / 2 - 4, i * (h / 4) + 40, 8, h / 4 - 150);
  // edge lines
  ctx.globalAlpha = 0.75;
  ctx.fillRect(12, 0, 5, h);
  ctx.fillRect(w - 17, 0, 5, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/* ── low-poly ridge line ────────────────────────────────────── */
function makeRidge(width, depthZ, height, seed, color, segments = 130) {
  const pos = [], idx = [];
  const rnd = (i) => {
    const s = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let i = 0; i <= segments; i++) {
    const x = (i / segments - 0.5) * width;
    let hgt = 0, amp = 1, f = 1;
    for (let o = 0; o < 4; o++) {
      const a = i * 0.06 * f;
      const i0 = Math.floor(a), fr = a - i0;
      const u = fr * fr * (3 - 2 * fr);
      hgt += (rnd(i0 + o * 31) * (1 - u) + rnd(i0 + 1 + o * 31) * u) * amp;
      amp *= 0.45; f *= 2.1;
    }
    const y = Math.pow(hgt / 1.6, 1.5) * height;
    pos.push(x, y, 0, x, -height * 2.2, 0);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, fog: true }));
  m.position.z = depthZ;
  return m;
}

/* ── the world ──────────────────────────────────────────────── */
export function buildWorld(scene, env, quality) {
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0092);
  scene.background = FOG_COLOR.clone();

  const sky = makeSky();
  scene.add(sky);

  /* ground plain — dry lake bed / airfield */
  const groundTex = asphaltTexture(512, 13);
  groundTex.repeat.set(60, 60);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshStandardMaterial({
      color: 0x1b1d22, map: groundTex, roughness: 0.82, metalness: 0.22,
      envMap: env, envMapIntensity: 0.5,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.012;
  ground.receiveShadow = quality.shadows;
  scene.add(ground);

  /* the road itself — wetter, more reflective than the plain */
  const roadTex = asphaltTexture(512, 24);
  roadTex.repeat.set(3, 90);
  const markTex = roadMarkTexture();
  markTex.repeat.set(1, 26);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 1100, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x2a2e36, map: roadTex, roughness: 0.34, metalness: 0.62,
      envMap: env, envMapIntensity: 1.15,
      emissiveMap: markTex, emissive: 0x8e8878, emissiveIntensity: 0.22,
      transparent: true, opacity: 0.93,
    })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.002, -420);
  road.receiveShadow = quality.shadows;
  road.renderOrder = 2;
  scene.add(road);

  /* ridge lines for parallax depth */
  const ridges = [
    makeRidge(1500, -640, 96, 3.1, 0x0b1018),
    makeRidge(1200, -430, 62, 8.7, 0x0d131d),
    makeRidge(900, -290, 34, 15.3, 0x0f1622),
  ];
  ridges.forEach((r) => scene.add(r));

  /* roadside markers — rhythm + speed cues + parallax */
  const N = quality.posts;
  const postGeo = new THREE.CylinderGeometry(0.045, 0.055, 1.15, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.7, metalness: 0.3, envMap: env });
  const posts = new THREE.InstancedMesh(postGeo, postMat, N * 2);
  const capGeo = new THREE.BoxGeometry(0.12, 0.1, 0.03);
  const capMat = new THREE.MeshStandardMaterial({
    color: 0x120a06, emissive: 0xff7a2a, emissiveIntensity: 2.4, roughness: 0.4,
  });
  const caps = new THREE.InstancedMesh(capGeo, capMat, N * 2);
  const dummy = new THREE.Object3D();
  let k = 0;
  for (let i = 0; i < N; i++) {
    const z = 30 - i * 24;
    for (const sgn of [-1, 1]) {
      dummy.position.set(sgn * 8.7, 0.57, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      posts.setMatrixAt(k, dummy.matrix);
      dummy.position.y = 1.02;
      dummy.position.x = sgn * 8.62;
      dummy.updateMatrix();
      caps.setMatrixAt(k, dummy.matrix);
      k++;
    }
  }
  posts.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  scene.add(posts, caps);

  /* ── night speedway: banner wall, grandstand, floodlight towers ── */
  const stadium = new THREE.Group();

  const bannerTex = (() => {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 128;
    const x = c.getContext('2d');
    const panels = ['#c8140b', '#1b3f8f', '#e8b30c', '#0e1116'];
    for (let i = 0; i < 8; i++) {
      x.fillStyle = panels[i % panels.length];
      x.fillRect(i * 128, 0, 128, 128);
      x.save();
      x.translate(i * 128 + 64, 64);
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = i % 4 === 2 ? '#20160a' : '#f6f2e8';
      x.font = 'italic 900 46px "Arial Black", Impact, sans-serif';
      x.fillText(i % 2 ? '95' : 'APEX', 0, 2);
      x.restore();
      x.fillStyle = 'rgba(0,0,0,0.35)';
      x.fillRect(i * 128, 108, 128, 20);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(14, 1);
    t.anisotropy = 8;
    return t;
  })();

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 2.6),
    new THREE.MeshStandardMaterial({
      map: bannerTex, roughness: 0.75, metalness: 0.05,
      emissiveMap: bannerTex, emissive: 0xffffff, emissiveIntensity: 0.14,
    })
  );
  wall.position.set(0, 1.3, -82);
  stadium.add(wall);

  const crowdTex = (() => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#070a11'; x.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 2600; i++) {
      const px = Math.random() * 512, py = Math.pow(Math.random(), 0.7) * 256;
      x.fillStyle = `rgba(${180 + Math.random() * 70},${150 + Math.random() * 80},${110 + Math.random() * 90},${0.10 + Math.random() * 0.5})`;
      x.fillRect(px, py, 1.6, 1.6);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(8, 1);
    return t;
  })();
  const stands = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 13),
    new THREE.MeshBasicMaterial({ map: crowdTex, fog: true })
  );
  stands.position.set(0, 7.4, -90);
  stadium.add(stands);

  /* floodlight towers — the brightest things in the frame, so they
     carry the bloom and rim-light the car from behind */
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x0a0d14, roughness: 0.9, metalness: 0.2 });
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(7.5, 7.2, 6.2), fog: false });
  const flareTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,252,240,1)');
    g.addColorStop(0.25, 'rgba(255,240,205,0.5)');
    g.addColorStop(1, 'rgba(255,230,180,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const lampGeo = new THREE.BoxGeometry(0.95, 0.7, 0.22);
  for (let i = 0; i < 8; i++) {
    const tower = new THREE.Group();
    const h = 23 + (i % 3) * 4;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.62, h, 6), mastMat);
    mast.position.y = h / 2;
    tower.add(mast);
    const rig = new THREE.Group();
    rig.position.y = h + 0.6;
    for (let r = 0; r < 2; r++) {
      for (let cix = -2; cix <= 2; cix++) {
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.position.set(cix * 1.05, r * 0.85, 0);
        rig.add(lamp);
      }
    }
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flareTex, color: 0xfff2d6, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    flare.scale.set(13, 13, 1);
    flare.position.y = 0.45;
    rig.add(flare);
    tower.add(rig);
    const side = i % 2 ? 1 : -1;
    tower.position.set(side * (26 + Math.floor(i / 2) * 38), 0, -86 - (i % 3) * 7);
    stadium.add(tower);
  }
  scene.add(stadium);

  /* distant pylons for scale on the right-hand plain */
  const pylonMat = new THREE.MeshStandardMaterial({ color: 0x0c1119, roughness: 0.9 });
  const pylons = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const p = new THREE.Group();
    const h = 14 + (i % 3) * 5;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, h, 6), pylonMat);
    m.position.y = h / 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.28, 0.28), pylonMat);
    arm.position.y = h - 1.6;
    p.add(m, arm);
    p.position.set(58 + (i % 2) * 16, 0, -60 - i * 62);
    pylons.add(p);
  }
  scene.add(pylons);

  /* ground haze slabs — soft volumetric floor */
  const hazeTex = (() => {
    const s = 256, c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(150,180,220,0)');
    g.addColorStop(0.55, 'rgba(130,160,205,0.5)');
    g.addColorStop(1, 'rgba(90,120,170,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    ctx.globalCompositeOperation = 'destination-in';
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.25 + Math.random() * 0.6})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * s, Math.random() * s, 20 + Math.random() * 70, 8 + Math.random() * 26, 0, 0, 7);
      ctx.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  })();

  const haze = new THREE.Group();
  const hazeMats = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.MeshBasicMaterial({
      map: hazeTex.clone(), transparent: true, depthWrite: false,
      opacity: 0.1 - i * 0.02, blending: THREE.AdditiveBlending, fog: false,
      color: new THREE.Color(0.35, 0.45, 0.66),
    });
    m.map.needsUpdate = true;
    m.map.repeat.set(3 + i, 1);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(420, 14 + i * 8), m);
    p.position.set(0, 2.4 + i * 3.5, -70 - i * 90);
    p.renderOrder = 3;
    haze.add(p);
    hazeMats.push(m);
  }
  scene.add(haze);

  /* ── light rig ─────────────────────────────────────────────── */
  const key = new THREE.DirectionalLight(0xdce8ff, 2.35);
  key.position.set(-26, 22, -14);
  if (quality.shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 90;
    const d = 11;
    key.shadow.camera.left = -d; key.shadow.camera.right = d;
    key.shadow.camera.top = d; key.shadow.camera.bottom = -d;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.03;
    key.shadow.radius = 2.2;
  }
  scene.add(key, key.target);

  const rim = new THREE.DirectionalLight(0x7fa6ff, 3.1);
  rim.position.set(16, 7, 34);
  scene.add(rim, rim.target);

  const warm = new THREE.DirectionalLight(0xff9d52, 0.85);
  warm.position.set(9, 2.4, -60);
  scene.add(warm, warm.target);

  const fill = new THREE.HemisphereLight(0x27354f, 0x07080b, 0.42);
  scene.add(fill);

  return {
    sky, ground, road, ridges, posts, caps, haze, hazeMats,
    lights: { key, rim, warm, fill },
    update(time, carPos, t) {
      sky.material.uniforms.uTime.value = time;
      // keep the shadow frustum tight around the car
      key.target.position.copy(carPos);
      key.position.set(carPos.x - 22, 20, carPos.z - 12);
      rim.target.position.copy(carPos);
      rim.position.set(carPos.x + 14, 6.5, carPos.z + 26);
      warm.target.position.copy(carPos);
      warm.position.set(carPos.x + 6, 2.2, carPos.z - 48);
      haze.children.forEach((p, i) => {
        p.material.map.offset.x = time * (0.004 + i * 0.0022);
      });
    },
    dispose() {
      [groundTex, roadTex, markTex, hazeTex].forEach((t) => t.dispose());
      scene.traverse((o) => {
        if (o.isMesh || o.isInstancedMesh) { o.geometry?.dispose?.(); }
      });
    },
  };
}
