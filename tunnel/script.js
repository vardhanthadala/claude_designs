import gsap from "gsap";

/* ── Knobs ───────────────────────────────────────────────────────── */
const CONFIG = {
  totalImages: 12,
  scrollSpeed: 2,
  layerGap: 2500,
  lerp: 0.07,
  speedStretch: 0.3,
};

/* ── Speed-smear tuning (module constants, not knobs) ────────────── */
const VELOCITY_LERP     = 0.12; // damped read of the velocity
const VELOCITY_REF      = 35;   // px/frame of lerped scroll that counts as "full speed"
const VELOCITY_DEADZONE = 0.4;  // px/frame below which the flight counts as stopped
const SQUASH_RATIO      = 0.45; // perpendicular pinch, as a fraction of the elongation
const MAX_DEFORM        = 0.6;  // hard ceiling on the elongation, whatever the config says

const IMAGE_BASE = "https://motionprompts.dev/c/3d-scroll-tunnel";

/* ── Build the tunnel, return the teardown ───────────────────────── */
function mount(config = CONFIG) {
  const stage = document.querySelector(".spotlight");
  if (!stage) return () => {};

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // the smear is decoration; the flight itself is the user's own wheel and stays
  const stretchBudget = prefersReducedMotion
    ? 0
    : Math.max(0, Math.min(MAX_DEFORM, config.speedStretch));

  /* derived counts */
  const contentLayerCount = Math.ceil(config.totalImages / 4); // 3 unique rings of 4
  const totalLayerCount   = Math.max(contentLayerCount, 6);    // 6 rings rendered
  const tunnelDepth       = totalLayerCount * config.layerGap; // 15000 — the wrap length
  const visibleDepth      = 3 * config.layerGap;               // 7500  — fade-in distance
  const exitPoint         = 1500;                              // where a ring passes the lens
  const initialScroll     = 750;                               // starting virtual scroll

  const RADIUS_X = 400;
  const RADIUS_Y = 280;

  /* ── DOM construction ──────────────────────────────────────────── */
  const tunnelEl = document.createElement("div");
  tunnelEl.className = "tunnel";

  const layerData = [];

  for (let i = 0; i < totalLayerCount; i++) {
    const layerEl = document.createElement("div");
    layerEl.className = "layer";

    // 0→0, 1→4, 2→8, 3→0, 4→4, 5→8 : the three unique rings repeat
    const imageStartIndex = (i % contentLayerCount) * 4;

    for (let j = 0; j < 4; j++) {
      const imageNumber = imageStartIndex + j + 1;
      if (imageNumber > config.totalImages) break;

      // top → right → bottom → left
      const angle = (j / 4) * Math.PI * 2 - Math.PI / 2;
      const itemX = Math.cos(angle) * RADIUS_X - 90;  // -90  = half the 180px width
      const itemY = Math.sin(angle) * RADIUS_Y - 110; // -110 = half the 220px height

      const itemEl = document.createElement("div");
      itemEl.className = "item";
      itemEl.style.left = `${itemX}px`;
      itemEl.style.top = `${itemY}px`;
      // static smear axis: CSS rotations are clockwise-positive in a Y-down space,
      // the same convention that placed the plate — so degrees convert with no sign flip
      itemEl.style.setProperty("--tilt", `${(angle * 180) / Math.PI}deg`);

      const imgEl = document.createElement("img");
      imgEl.src = `${IMAGE_BASE}/img${imageNumber}.jpg`;
      imgEl.alt = "";
      imgEl.draggable = false;
      imgEl.loading = "eager";
      imgEl.decoding = "async";

      const overlayEl = document.createElement("div");
      overlayEl.className = "item-overlay";

      itemEl.appendChild(imgEl);
      itemEl.appendChild(overlayEl);
      layerEl.appendChild(itemEl);
    }

    tunnelEl.appendChild(layerEl);
    layerData.push({ el: layerEl, baseZ: -i * config.layerGap });
  }

  stage.appendChild(tunnelEl);

  /* ── Depth-driven overlay ──────────────────────────────────────── */
  function calculateOverlay(z) {
    if (z > exitPoint) return 1;                    // past the lens → black
    if (z > 0) return z / exitPoint;                // darkening as it exits
    if (z > -visibleDepth) {                        // fading in from the depths
      const progress = Math.abs(z) / visibleDepth;  // 1 (far) → 0 (camera plane)
      return progress * progress;                   // quadratic ease-in of the veil
    }
    return 1;                                       // too far → black
  }

  /* ── Virtual scroll accumulator ────────────────────────────────── */
  let targetScroll = initialScroll;
  let currentScroll = initialScroll;
  let smoothedVelocity = 0;
  let lastTouchY = 0;

  const onWheel = (e) => {
    targetScroll += e.deltaY * config.scrollSpeed;
  };
  const onTouchStart = (e) => {
    lastTouchY = e.touches[0].clientY;
  };
  const onTouchMove = (e) => {
    const y = e.touches[0].clientY;
    targetScroll += (lastTouchY - y) * config.scrollSpeed;
    lastTouchY = y;
  };

  /* ── The ticker: one absolute state write per ring per frame ───── */
  const tick = () => {
    // (a) lerp the virtual scroll, then take a damped read of ITS velocity
    const previousScroll = currentScroll;
    currentScroll += (targetScroll - currentScroll) * config.lerp;

    smoothedVelocity += (currentScroll - previousScroll - smoothedVelocity) * VELOCITY_LERP;
    if (Math.abs(smoothedVelocity) < VELOCITY_DEADZONE) smoothedVelocity = 0;
    const speed = Math.min(1, Math.abs(smoothedVelocity) / VELOCITY_REF);

    // (b) reposition every ring in depth and hand it its share of the smear
    layerData.forEach((layer) => {
      let z = layer.baseZ + currentScroll;                 // raw depth
      z = ((z % tunnelDepth) + tunnelDepth) % tunnelDepth; // positive modulo → [0, 15000)
      z = z - tunnelDepth + exitPoint;                     // remap → [-13500, 1500)

      const overlay = calculateOverlay(z);

      // plates near the lens sweep more screen per frame than plates in the fog
      const proximity = Math.min(1, Math.max(0, (z + visibleDepth) / (visibleDepth + exitPoint)));
      const deform = speed * stretchBudget * proximity;

      gsap.set(layer.el, {
        z: z,
        "--overlay": Math.min(1, Math.max(0, overlay)),
        "--stretch": 1 + deform,                   // along the plate's --tilt axis
        "--squash": 1 - deform * SQUASH_RATIO,     // across it
        visibility: overlay >= 1 ? "hidden" : "visible",
      });
    });
  };

  window.addEventListener("wheel", onWheel);
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: true });
  gsap.ticker.add(tick);
  tick(); // paint the resting pose before the first frame

  return function destroy() {
    gsap.ticker.remove(tick);
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("touchstart", onTouchStart);
    window.removeEventListener("touchmove", onTouchMove);
    gsap.killTweensOf(layerData.map((l) => l.el));
    tunnelEl.remove();
  };
}

/* ── Entry ───────────────────────────────────────────────────────── */
if (typeof window !== "undefined" && window.MP && window.MP.register) {
  window.MP.register({ mount, config: CONFIG });
} else if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => mount(CONFIG), { once: true });
} else {
  mount(CONFIG);
}

export { mount, CONFIG };
