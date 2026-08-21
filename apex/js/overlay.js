/* ============================================================
   overlay.js — scroll driver + editorial typography timing
   ============================================================ */
import { clamp, lerp, inv, range, damp, smootherstep } from './util.js';

/* headline windows: [fadeInStart, fullFrom, fullUntil, fadeOutEnd] */
const CUES = [
  [0.010, 0.045, 0.125, 0.175],   // SILENCE
  [0.215, 0.260, 0.395, 0.450],   // APEX GT
  [0.505, 0.550, 0.655, 0.700],   // THE LINE
  [0.745, 0.780, 0.825, 0.862],   // FACE TO FACE
];

export class ScrollTimeline {
  constructor(trackEl) {
    this.track = trackEl;
    this.t = 0;
    this.raw = 0;
    this.velocity = 0;
    this.max = 1;
    this.measure();
    addEventListener('resize', () => this.measure(), { passive: true });
  }
  measure() {
    this.max = Math.max(1, this.track.offsetHeight - innerHeight);
  }
  update(dt) {
    const y = window.scrollY || window.pageYOffset || 0;
    this.raw = clamp(y / this.max);
    const prev = this.t;
    // smoothed scrub: fast flicks accelerate the sequence instead of snapping
    this.t = damp(this.t, this.raw, 7.5, dt);
    if (Math.abs(this.raw - this.t) < 0.00015) this.t = this.raw;
    this.velocity = damp(this.velocity, (this.t - prev) / Math.max(dt, 1 / 240), 8, dt);
    return this.t;
  }
}

export class Overlay {
  constructor(root = document) {
    this.ui = root.getElementById('ui');
    this.titles = [...root.querySelectorAll('.title')];
    this.speed = root.getElementById('specSpeed');
    this.cue = root.getElementById('scrollcue');
    this.flash = root.getElementById('flash');
    this.chapters = [...root.querySelectorAll('#chapters li')];
    this.chapterT = this.chapters.map((li) => parseFloat(li.dataset.t));
    this._speedShown = 0;
    this._active = -1;
  }

  update(t, state, dt) {
    /* headlines */
    this.titles.forEach((el, i) => {
      const [a, b, c, d] = CUES[i];
      let o = 0;
      if (t > a && t < d) {
        o = t < b ? smootherstep(inv(a, b, t)) : t > c ? 1 - smootherstep(inv(c, d, t)) : 1;
      }
      const lift = (1 - o) * 26;
      const blur = (1 - o) * 7;
      el.style.opacity = o.toFixed(3);
      el.style.transform = `translate3d(0, ${lift.toFixed(2)}px, 0) scale(${(0.985 + o * 0.015).toFixed(4)})`;
      el.style.filter = o > 0.995 ? 'none' : `blur(${blur.toFixed(2)}px)`;
    });

    /* everything clears out for the final approach */
    const uiFade = 1 - range(t, 0.845, 0.905);
    this.ui.style.opacity = uiFade.toFixed(3);

    /* live speed readout */
    const target = state.speedNorm * 352 * (0.55 + 0.45 * Math.min(1, state.speed / 90));
    this._speedShown = damp(this._speedShown, target, 4, dt);
    const v = Math.round(this._speedShown);
    this.speed.textContent = String(v).padStart(3, '0');

    /* scroll cue */
    this.cue.style.opacity = (1 - range(t, 0.015, 0.06)).toFixed(3);

    /* chapter ticks */
    let active = 0;
    for (let i = 0; i < this.chapterT.length; i++) if (t >= this.chapterT[i] - 0.001) active = i;
    if (active !== this._active) {
      this.chapters.forEach((li, i) => li.classList.toggle('is-on', i === active));
      this._active = active;
    }

    /* the wash that carries into the next section */
    const wash = Math.pow(range(t, 0.962, 0.999), 1.35);
    this.flash.style.opacity = wash.toFixed(3);

    document.body.classList.toggle('is-cine', t > 0.02);
    return { uiFade, wash };
  }
}
