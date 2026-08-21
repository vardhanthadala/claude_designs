/* ============================================================
   postfx.js — the "camera" half of the look
   ------------------------------------------------------------
   Render ▸ Cinematic (depth-aware DOF + directional / radial
   motion blur + chromatic aberration) ▸ Bloom ▸ Output ▸ Grade
   (vignette, grain, exposure flash).

   The motion blur is depth-weighted: when the rig pans to hold
   the car, the far environment streaks and the subject stays
   sharp — which is what actually happens on a tracking shot.
   ============================================================ */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* The scene is rendered into a target we own, never into one of the
   composer's ping-pong buffers. The composer swaps an odd number of
   times per frame, so a depth attachment parked on a swapped buffer
   ends up bound for read and write in the same draw — a feedback loop
   that renders black. Owning the target sidesteps the whole issue. */
class ScenePass extends Pass {
  constructor(scene, camera, target) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.target = target;
    this.needsSwap = false;
    this.clearColor = new THREE.Color(0x000000);
  }
  render(renderer) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(this.scene.background || this.clearColor, 1);
    renderer.clear(true, true, true);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
  }
}

const cinematicFrag = (TAPS) => /* glsl */`
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform float uNear, uFar;
  uniform float uFocus;      // focus distance in metres
  uniform float uRange;      // depth of field, metres
  uniform float uBokeh;      // max blur radius (uv units)
  uniform vec2  uDir;        // directional blur vector (uv units)
  uniform float uRadial;     // radial / perspective blur amount
  uniform float uGlobal;     // blur everything (impact)
  uniform float uChroma;
  uniform vec2  uRes;
  varying vec2 vUv;

  float linearDepth(vec2 uv){
    float d = texture2D(tDepth, uv).x;
    float z = d * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  }

  const int TAPS = ${TAPS};

  void main(){
    vec2 uv = vUv;
    float dist = linearDepth(uv);

    // circle of confusion — near blur is gentler than far blur
    float coc;
    if (dist < uFocus) coc = smoothstep(0.0, 1.0, (uFocus - dist) / max(uRange * 1.9, 0.001));
    else               coc = smoothstep(0.0, 1.0, (dist - uFocus) / max(uRange, 0.001));
    coc = clamp(coc, 0.0, 1.0);

    // far geometry streaks more than the subject on a tracking pan
    float depthW = clamp((dist - 4.0) / 55.0, 0.0, 1.0);
    depthW = mix(depthW, 1.0, uGlobal);

    vec2 fromCentre = uv - 0.5;
    vec2 streak = uDir * depthW + fromCentre * uRadial * (0.35 + depthW * 1.3);
    float radius = uBokeh * coc;

    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    float golden = 2.39996;

    for (int i = 0; i < TAPS; i++){
      float fi = float(i) / float(TAPS - 1);
      // motion smear along the velocity vector
      vec2 o = streak * (fi - 0.5);
      // + a spiral bokeh disc for the depth of field
      float a = float(i) * golden;
      float r = sqrt(fi) * radius;
      o += vec2(cos(a), sin(a)) * r;
      vec2 suv = clamp(uv + o, vec2(0.0005), vec2(0.9995));
      float w = 1.0 - fi * 0.35;
      sum += texture2D(tDiffuse, suv).rgb * w;
      wsum += w;
    }
    vec3 col = sum / max(wsum, 0.0001);

    // chromatic aberration, strongest toward the corners
    float ca = uChroma * (0.35 + length(fromCentre) * 1.7);
    if (ca > 0.0005){
      vec2 off = fromCentre * ca * 0.045;
      col.r = texture2D(tDiffuse, clamp(uv + off + streak * 0.15, vec2(0.001), vec2(0.999))).r * 0.55 + col.r * 0.45;
      col.b = texture2D(tDiffuse, clamp(uv - off - streak * 0.15, vec2(0.001), vec2(0.999))).b * 0.55 + col.b * 0.45;
    }

    gl_FragColor = vec4(col, 1.0);
  }`;

const gradeFrag = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uFlash;
  uniform vec3  uFlashColor;
  uniform float uLift;
  uniform float uContrast;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main(){
    vec2 uv = vUv;
    vec3 c = texture2D(tDiffuse, uv).rgb;

    // gentle filmic contrast + cool shadow lift
    c = (c - 0.5) * uContrast + 0.5;
    c += vec3(0.010, 0.016, 0.030) * uLift;

    // vignette
    vec2 p = (uv - 0.5) * vec2(1.0, 0.92);
    float v = 1.0 - dot(p, p) * uVignette;
    c *= clamp(v, 0.0, 1.2);

    // exposure blow-out for the transition
    if (uFlash > 0.001){
      float centre = 1.0 - smoothstep(0.0, 0.95, length(uv - vec2(0.5, 0.53)) * 1.35);
      c = mix(c, uFlashColor, clamp(uFlash * (0.55 + centre * 0.85), 0.0, 1.0));
      c += uFlashColor * uFlash * 0.35 * centre;
    }

    // 16mm grain
    float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime) * 91.7) - 0.5;
    c += g * uGrain * (1.0 - dot(c, vec3(0.2126, 0.7152, 0.0722)) * 0.55);

    gl_FragColor = vec4(c, 1.0);
  }`;

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

export function buildPost(renderer, scene, camera, quality) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());

  const depthTexture = new THREE.DepthTexture(size.x, size.y);
  depthTexture.type = THREE.UnsignedIntType;

  const sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    depthTexture,
    depthBuffer: true,
    samples: quality.mobile || quality.weak ? 0 : 4,
  });

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(
    size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: false }
  ));

  composer.addPass(new ScenePass(scene, camera, sceneRT));

  /* textureID 'tUnused' keeps ShaderPass from overwriting tDiffuse —
     this pass reads the owned scene target, not the composer buffer */
  const cinematic = new ShaderPass({
    uniforms: {
      tUnused: { value: null },
      tDiffuse: { value: sceneRT.texture },
      tDepth: { value: depthTexture },
      uNear: { value: camera.near }, uFar: { value: camera.far },
      uFocus: { value: 18 }, uRange: { value: 26 },
      uBokeh: { value: quality.dof ? 0.012 : 0.0 },
      uDir: { value: new THREE.Vector2() },
      uRadial: { value: 0 },
      uGlobal: { value: 0 },
      uChroma: { value: 0 },
      uRes: { value: new THREE.Vector2(size.x, size.y) },
    },
    vertexShader: VERT,
    fragmentShader: cinematicFrag(quality.mobile ? 7 : quality.weak ? 9 : 14),
  }, 'tUnused');
  composer.addPass(cinematic);

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    quality.mobile ? 0.34 : 0.46,   // strength
    quality.mobile ? 0.55 : 0.70,   // radius
    1.15                            // threshold — the buffer is linear HDR
  );
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  const grade = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uVignette: { value: 1.05 },
      uGrain: { value: quality.mobile ? 0.03 : 0.045 },
      uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Color(1.0, 0.975, 0.92) },
      uLift: { value: 1 },
      uContrast: { value: 1.06 },
    },
    vertexShader: VERT,
    fragmentShader: gradeFrag,
  });
  grade.renderToScreen = true;
  composer.addPass(grade);

  return {
    composer, cinematic, bloom, grade, depthTexture, sceneRT,
    setSize(w, h, dpr) {
      const bw = Math.max(2, Math.floor(w * dpr)), bh = Math.max(2, Math.floor(h * dpr));
      composer.setSize(w, h);
      sceneRT.setSize(bw, bh);
      bloom.setSize(bw, bh);
      cinematic.uniforms.uRes.value.set(bw, bh);
      cinematic.uniforms.tDiffuse.value = sceneRT.texture;
      cinematic.uniforms.tDepth.value = sceneRT.depthTexture;
    },
    dispose() {
      composer.dispose();
      sceneRT.dispose();
      depthTexture.dispose();
    },
  };
}
