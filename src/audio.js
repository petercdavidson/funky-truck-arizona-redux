// audio.js — the game's sound, synthesised live with the Web Audio API, apart from
// the recorded clips in SAMPLES (assets/audio/), loaded once sound is unlocked.
//
// Cues:
//   engine            a continuous voice driven by { throttle, speed, airborne } (each 0..1),
//                     with a quiet hiss of tyres on the ground while the truck is rolling
//   scrape            a run of hard hits while the cab drags along the ground
//   start, land, bump, flip, trick, flipCount, milestone, stage, win, wreck, click, boing
//                     one-shot sounds
//   missile, enemyMissile, boom, crunch, pickup, jump, boost, takedown, wave
//                     Battle Mode's one-shot sounds (Sandbox uses some too)
//   count, go         Rally's countdown
// SoundWatcher (sound-events.js) decides when cues happen; this file decides how they sound.

export const CUES = ['start', 'land', 'bump', 'flip', 'trick', 'flipCount', 'milestone', 'stage', 'win', 'wreck', 'click', 'boing',
  'missile', 'enemyMissile', 'boom', 'crunch', 'weed', 'bird', 'pickup', 'jump', 'boost', 'takedown', 'wave', 'count', 'go'];


const note = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note number -> Hz

// ---------------------------------------------------------------------------------------------
// Building blocks. `k` is the kit: { ctx, out, noise }.

/** A tone with a quick attack and an exponential fade. f2 glides the pitch to f2 over dur. */
function tone(k, { type = 'sine', f, f2 = f, t = 0, dur = 0.2, gain = 0.3, attack = 0.004, glide = 'exp', dest = k.out, wave = null, vibrato = 0, vibratoRate = 6 }) {
  const { ctx } = k;
  const t0 = ctx.currentTime + t;
  const o = ctx.createOscillator();
  if (wave) o.setPeriodicWave(wave); else o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2 !== f) {
    if (glide === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t0 + dur);
    else o.frequency.linearRampToValueAtTime(f2, t0 + dur);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(dest);
  if (vibrato) {
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = vibratoRate; lg.gain.value = vibrato;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t0); lfo.stop(t0 + dur + 0.05);
  }
  o.start(t0); o.stop(t0 + dur + 0.05);
}

/** A burst of filtered noise. */
function noise(k, { t = 0, dur = 0.2, gain = 0.3, type = 'lowpass', f = 800, f2 = f, Q = 1, attack = 0.003, dest = k.out, buffer = k.noise }) {
  const { ctx } = k;
  const t0 = ctx.currentTime + t;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const flt = ctx.createBiquadFilter();
  flt.type = type; flt.Q.value = Q;
  flt.frequency.setValueAtTime(f, t0);
  if (f2 !== f) flt.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(flt).connect(g).connect(dest);
  src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
}

/** Play notes one after another: notes = [midi, ...], each `step` seconds apart. */
function melody(k, notes, step, voice) {
  notes.forEach((n, i) => { if (n !== null) voice(note(n), i * step, i); });
}

/** A bell: a sine and a quieter inharmonic partial, long decay. */
const bell = (k, f, t, gain = 0.18, dur = 0.9) => {
  tone(k, { f, t, dur, gain });
  tone(k, { f: f * 2.76, t, dur: dur * 0.4, gain: gain * 0.25 });
  tone(k, { f: f * 5.4, t, dur: dur * 0.15, gain: gain * 0.1 });
};

/** A continuous oscillator with a gain, for engine voices. */
function voice(k, { type = 'sawtooth', wave = null, dest }) {
  const o = k.ctx.createOscillator();
  if (wave) o.setPeriodicWave(wave); else o.type = type;
  const g = k.ctx.createGain();
  g.gain.value = 0;
  o.connect(g).connect(dest);
  o.start();
  return { o, g };
}

const smooth = (param, v, k, tc = 0.05) => param.setTargetAtTime(v, k.ctx.currentTime, tc);

/** Wraps an engine's nodes so stop() fades them out and frees them. */
function engineShell(k, nodes, out, update) {
  return {
    update,
    stop() {
      const now = k.ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setTargetAtTime(0, now, 0.05);
      setTimeout(() => { for (const n of nodes) { try { n.stop(); } catch { /* already stopped */ } } out.disconnect(); }, 400);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The sounds.

const SET = {
  engine(k) {
    const { ctx } = k;
    const out = ctx.createGain(); out.gain.value = 1;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.7;
    lp.connect(out).connect(k.out);
    const a = voice(k, { type: 'triangle', dest: lp }), b = voice(k, { type: 'sawtooth', dest: lp });
    // tyres on the ground: a quiet band of noise that grows with speed
    const grit = ctx.createBufferSource(); grit.buffer = k.noise; grit.loop = true;
    const gf = ctx.createBiquadFilter(); gf.type = 'bandpass'; gf.frequency.value = 260; gf.Q.value = 0.7;
    const gg = ctx.createGain(); gg.gain.value = 0;
    grit.connect(gf).connect(gg).connect(out); grit.start();
    return engineShell(k, [a.o, b.o, grit], out, ({ throttle, speed, airborne }) => {
      const f = 48 + speed * 70 + throttle * 16 + (airborne && throttle ? 24 : 0);
      smooth(a.o.frequency, f, k, 0.08); smooth(b.o.frequency, f / 2, k, 0.08);
      smooth(a.g.gain, 0.10 + throttle * 0.08, k); smooth(b.g.gain, 0.035 + throttle * 0.04, k);
      smooth(lp.frequency, 500 + throttle * 600 + speed * 400, k, 0.1);
      smooth(gf.frequency, 190 + speed * 170, k, 0.1);
      smooth(gg.gain, airborne ? 0 : speed * 0.02, k, 0.06);
    });
  },
  start(k) { bell(k, note(72), 0, 0.12, 0.5); bell(k, note(79), 0.12, 0.12, 0.7); },
  land(k, { force = 0.5 } = {}) {
    tone(k, { f: 110, f2: 38, dur: 0.28, gain: 0.25 + force * 0.4 });
    noise(k, { dur: 0.18, gain: 0.08 + force * 0.15, f: 500, f2: 120 });
  },
  bump(k, { force = 0.5 } = {}) { tone(k, { f: 140, f2: 60, dur: 0.12, gain: 0.1 + force * 0.2 }); },
  flip(k, { degrees = 360 } = {}) {
    const n = Math.max(1, Math.min(4, Math.round(degrees / 360)));
    melody(k, [76, 79, 84, 88].slice(0, n + 1), 0.09, (f, t) => bell(k, f, t, 0.13, 0.7));
  },
  /** Tricks as they're done: flips ring up a turn per flip, other tricks a short chime. */
  trick(k, { names = [] } = {}) {
    const flip = names.find((n) => n.endsWith('flip'));
    if (flip) {
      const turns = { Double: 2, Triple: 3, Quadruple: 4 }[flip.split(' ')[0]] || (flip.includes('x ') ? 4 : 1);
      SET.flip(k, { degrees: turns * 360 });
      return;
    }
    if (names.includes('Clean')) { bell(k, note(91), 0, 0.08, 0.5); return; }
    melody(k, [79, 84], 0.07, (f, t) => bell(k, f, t, 0.1, 0.5));
  },
  /** A turn of a flip counted out in the air: a short blip, a step higher for each turn. */
  flipCount(k, { turns = 1 } = {}) { bell(k, note(83 + 2 * Math.min(turns - 1, 8)), 0, 0.07, 0.3); },
  /** An Endless milestone: a quick rising fanfare. */
  milestone(k) {
    melody(k, [67, 72, 76, 79, 84], 0.07, (f, t, i) => bell(k, f, t, 0.12, i === 4 ? 1.2 : 0.4));
    noise(k, { t: 0.3, dur: 0.5, gain: 0.05, type: 'highpass', f: 5000 });
  },
  /** The title screen's truck, knocked into the air. */
  boing(k) { tone(k, { type: 'triangle', f: 160, f2: 420, dur: 0.22, gain: 0.16, vibrato: 18, vibratoRate: 22 }); },
  stage(k) { melody(k, [72, 76, 79, 84], 0.13, (f, t, i) => bell(k, f, t, 0.15, i === 3 ? 1.4 : 0.6)); },
  win(k) { melody(k, [72, 76, 79, 84, 79, 84, 88], 0.12, (f, t, i) => bell(k, f, t, 0.15, i === 6 ? 1.8 : 0.5)); },
  wreck(k) {
    noise(k, { dur: 0.9, gain: 0.35, f: 1200, f2: 90 });
    tone(k, { f: 120, f2: 30, dur: 0.8, gain: 0.35 });
    melody(k, [64, 60, 55], 0.22, (f, t) => bell(k, f, 0.35 + t, 0.08, 0.8));
  },
  click(k) { tone(k, { f: 1800, f2: 1200, dur: 0.035, gain: 0.08 }); },

  // ---- Battle Mode
  /** Your missile away: a rising whoosh. */
  missile(k) {
    noise(k, { dur: 0.45, gain: 0.22, type: 'bandpass', f: 500, f2: 2600, Q: 1.2 });
    tone(k, { type: 'sawtooth', f: 180, f2: 700, dur: 0.3, gain: 0.05 });
  },
  /** An enemy's missile: lower, and a warning blip. */
  enemyMissile(k) {
    noise(k, { dur: 0.5, gain: 0.16, type: 'bandpass', f: 300, f2: 1200, Q: 1.2 });
    tone(k, { type: 'square', f: note(81), dur: 0.08, gain: 0.04 });
    tone(k, { type: 'square', f: note(81), t: 0.12, dur: 0.08, gain: 0.04 });
  },
  /** An explosion: a crack, a rumble and falling debris. */
  boom(k, { big = false } = {}) {
    const g = big ? 1 : 0.7;
    noise(k, { dur: 0.06, gain: 0.3 * g, type: 'highpass', f: 1500, attack: 0.001 });
    noise(k, { dur: big ? 1.1 : 0.7, gain: 0.5 * g, f: 1800, f2: 60, attack: 0.002 });
    tone(k, { f: big ? 80 : 110, f2: 26, dur: big ? 0.9 : 0.55, gain: 0.45 * g, attack: 0.002 });
    if (big) for (let i = 0; i < 5; i++) noise(k, { t: 0.25 + i * 0.09 + Math.random() * 0.05, dur: 0.05, gain: 0.06, type: 'bandpass', f: 1500 + Math.random() * 1500, Q: 2 });
  },
  /** Trucks crunching into each other. */
  crunch(k, { force = 0.5 } = {}) {
    hit(k, { pitch: 0.7 + Math.random() * 0.2, force });
    noise(k, { t: 0.03, dur: 0.18, gain: 0.08 + force * 0.12, type: 'bandpass', f: 2600, f2: 900, Q: 3 });
  },
  /** A tumbleweed hit: a dry rustle and crackle of twigs, and a soft thump (`soft`: off the ground or another one, quieter). */
  weed(k, { force = 0.5, soft = false } = {}) {
    const g = (soft ? 0.5 : 1) * (0.35 + 0.65 * force);
    noise(k, { dur: 0.16 + 0.1 * force, gain: 0.16 * g, type: 'bandpass', f: 3200 + Math.random() * 800, f2: 1600, Q: 1.2, attack: 0.004 });
    for (let i = 0; i < 3 + Math.round(3 * force); i++) noise(k, { t: Math.random() * 0.12, dur: 0.018, gain: 0.07 * g, type: 'bandpass', f: 2500 + Math.random() * 3000, Q: 4, attack: 0.001 });
    tone(k, { f: 150 + Math.random() * 30, f2: 70, dur: 0.09, gain: 0.07 * g, attack: 0.003 });
  },
  /** A bird hit by the truck or a missile: the recorded clip (assets/audio/bird-hit.wav), a little higher or lower each time. */
  bird(k, { force = 0.6 } = {}) {
    const buf = k.samples?.birdHit;
    if (!buf) return;
    const src = k.ctx.createBufferSource(), g = k.ctx.createGain();
    src.buffer = buf;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    g.gain.value = 0.55 + 0.45 * force;
    src.connect(g).connect(k.out);
    src.start();
  },
  /** A pickup: a quick bright arpeggio. */
  pickup(k) { melody(k, [84, 88, 91, 96], 0.05, (f, t) => bell(k, f, t, 0.1, 0.35)); },
  /** The jump: a springy boing, a puff of air under it. */
  jump(k) {
    tone(k, { type: 'triangle', f: 150, f2: 560, dur: 0.28, gain: 0.18, vibrato: 14, vibratoRate: 26 });
    noise(k, { dur: 0.2, gain: 0.1, f: 900, f2: 300 });
  },
  /** The boost lighting up: a roaring sweep. */
  boost(k) {
    noise(k, { dur: 0.7, gain: 0.22, type: 'bandpass', f: 250, f2: 2200, Q: 0.8 });
    tone(k, { type: 'sawtooth', f: 70, f2: 220, dur: 0.6, gain: 0.07 });
  },
  /** An enemy truck taken out: a fanfare, higher for a combo. */
  takedown(k, { combo = 1 } = {}) {
    const up = 2 * Math.min(combo - 1, 5);
    melody(k, [72 + up, 79 + up, 84 + up], 0.08, (f, t, i) => bell(k, f, 0.15 + t, 0.12, i === 2 ? 0.9 : 0.4));
  },
  /** Rally's countdown: a beep for each of 3, 2, 1... */
  count(k) { tone(k, { type: 'square', f: note(69), dur: 0.22, gain: 0.07 }); tone(k, { f: note(69), dur: 0.3, gain: 0.1 }); },
  /** ...and a higher, longer one for GO. */
  go(k) {
    tone(k, { type: 'square', f: note(81), dur: 0.6, gain: 0.07 }); tone(k, { f: note(81), dur: 0.7, gain: 0.12 });
    noise(k, { t: 0.05, dur: 0.6, gain: 0.08, type: 'bandpass', f: 300, f2: 1400, Q: 0.8 });
  },
  /** A wave coming: a klaxon, twice. */
  wave(k) {
    for (const t of [0, 0.32]) {
      tone(k, { type: 'sawtooth', f: note(62), f2: note(57), dur: 0.26, t, gain: 0.07, glide: 'lin' });
      tone(k, { type: 'square', f: note(50), dur: 0.26, t, gain: 0.03 });
    }
  },
};

const semis = (n) => Math.pow(2, n / 12);

/** One hard hit of the cab on the ground: a crack of noise with a thud under it. */
function hit(k, { pitch = 1, force = 0.6 } = {}) {
  noise(k, { dur: 0.13, gain: 0.34 + force * 0.3, type: 'bandpass', f: 720 * pitch, f2: 320 * pitch, Q: 1.4, attack: 0.002 });
  noise(k, { dur: 0.04, gain: 0.1 + force * 0.08, type: 'bandpass', f: 2000 * pitch, Q: 0.8, attack: 0.001 });
  tone(k, { f: 105 * pitch, f2: 40, dur: 0.15, gain: 0.2 + force * 0.15, attack: 0.002 });
}

/**
 * The scrape: hard hits, one after another while the cab drags, each at a slightly different
 * pitch so a run of them never sounds the same. update({ on, speed }) is called every frame.
 */
function scrapeVoice(k) {
  let next = 0;
  return {
    update({ on, speed }) {
      const now = k.ctx.currentTime;
      if (!on) { next = 0; return; }
      if (now < next) return;
      hit(k, { pitch: semis(Math.random() * 6 - 3), force: 0.4 + speed * 0.6 });
      next = now + 0.16 - speed * 0.07 + Math.random() * 0.04;
    },
  };
}

/**
 * The rocket boost, held: a roar of filtered noise with a low rumble under it, which flutters a
 * little, as a rocket's flame does. update({ on, speed }) each frame (speed 0..1 brightens it).
 */
function boostVoice(k) {
  const { ctx } = k;
  const out = ctx.createGain(); out.gain.value = 0;
  out.connect(k.out);
  const roar = ctx.createBufferSource(); roar.buffer = k.noise; roar.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
  const hiss = ctx.createBiquadFilter(); hiss.type = 'highpass'; hiss.frequency.value = 2500;
  const hg = ctx.createGain(); hg.gain.value = 0.18;
  roar.connect(bp).connect(out);
  roar.connect(hiss).connect(hg).connect(out);
  roar.start(0, Math.random() * 1.5);
  const rumble = voice(k, { type: 'sawtooth', dest: out });
  rumble.o.frequency.value = 48; rumble.g.gain.value = 0.22;
  // the flutter: a slow wobble on the roar's loudness and pitch
  const lfo = ctx.createOscillator(), lg = ctx.createGain();
  lfo.frequency.value = 13; lg.gain.value = 160;
  lfo.connect(lg).connect(bp.frequency); lfo.start();
  let on = false;
  return {
    update({ on: now, speed = 0 }) {
      if (now !== on) { on = now; smooth(out.gain, now ? 0.32 : 0, k, now ? 0.03 : 0.12); }
      if (on) { smooth(bp.frequency, 600 + 900 * speed, k, 0.2); smooth(rumble.o.frequency, 46 + 30 * speed, k, 0.2); }
    },
    stop() {
      smooth(out.gain, 0, k, 0.08);
      setTimeout(() => { for (const n of [roar, rumble.o, lfo]) { try { n.stop(); } catch { /* already stopped */ } } out.disconnect(); }, 500);
    },
  };
}

// ---------------------------------------------------------------------------------------------

/** Recorded clips, in assets/audio/: [name in the kit, file]. */
const SAMPLES = { birdHit: 'bird-hit.wav' };

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.engine = null;
    this.scrape = null;          // the live scrape voice
    this.boost = null;           // the live rocket boost voice
    this.boostIdle = 0;          // frames it has been silent
    this.volume = 0.8;
  }

  /** Browsers only allow sound after a tap or key press, so call this from one. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const master = ctx.createGain();
      master.gain.value = this.volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      master.connect(comp).connect(ctx.destination);
      const white = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = white.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.kit = { ctx, out: master, master, noise: white, samples: {} };
      // The few recorded clips (everything else is made here), loaded once sound can start.
      for (const [name, file] of Object.entries(SAMPLES)) {
        fetch(new URL(`../assets/audio/${file}`, import.meta.url))
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
          .then((data) => new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail)))
          .then((buf) => { this.kit.samples[name] = buf; })
          .catch(() => { /* no clip: that cue stays silent */ });
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) { this.stopEngine(); this.stopScrape(); this.stopBoost(); }
  }

  /** Play a one-shot cue. `force` plays it even with sound switched off (for the preview page). */
  play(cue, opts = {}, force = false) {
    if ((!this.enabled && !force) || !this.ready) return;
    const fn = SET[cue];
    if (fn) fn(this.kit, opts);
  }

  /** Keep the engine voice in step with the truck: { on, throttle, speed, airborne }. */
  updateEngine(state, force = false) {
    if (!state.on || (!this.enabled && !force) || !this.ready) { this.stopEngine(); return; }
    if (!this.engine) this.engine = SET.engine(this.kit);
    this.engine.update(state);
  }

  stopEngine() {
    if (this.engine) { this.engine.stop(); this.engine = null; }
  }

  /** Keep the scrape in step with the cab: { on, speed } (speed 0..1). */
  updateScrape(state, force = false) {
    if ((!this.enabled && !force) || !this.ready) { this.stopScrape(); return; }
    if (!this.scrape) this.scrape = scrapeVoice(this.kit);
    this.scrape.update(state);
  }

  stopScrape() { this.scrape = null; }

  /** Keep the rocket boost's roar in step with it: { on, speed } (speed 0..1). */
  updateBoost(state, force = false) {
    if ((!this.enabled && !force) || !this.ready) { this.stopBoost(); return; }
    if (!state.on && !this.boost) return;
    if (!this.boost) this.boost = boostVoice(this.kit);
    this.boost.update(state);
    // Silent for a while: let it go (made again the next time the boost is lit).
    if (state.on) this.boostIdle = 0; else if (++this.boostIdle > 120) this.stopBoost();
  }

  stopBoost() { if (this.boost) { this.boost.stop(); this.boost = null; } }

  /** Pause or resume all sound (when the page is hidden, say). */
  suspend(on) {
    if (!this.ctx) return;
    if (on) this.ctx.suspend().catch(() => {}); else this.ctx.resume().catch(() => {});
  }
}
