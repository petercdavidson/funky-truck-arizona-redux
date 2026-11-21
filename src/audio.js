// audio.js — the game's sound, synthesised live with the Web Audio API (no sound files).
//
// There are several sound sets to choose from. Each set is a recipe for the same cues:
//   engine            a continuous voice driven by { throttle, speed, airborne } (each 0..1)
//   start, land, bump, scrape, flip, stage, win, wreck, click     one-shot sounds
// SoundWatcher (sound-events.js) decides when cues happen; this file decides how they sound.

import { SOUND_SETS } from './game.js';

export { SOUND_SETS };
export const SOUND_NAMES = { classic: 'Classic', chiptune: 'Chiptune', rumble: 'Rumble', toybox: 'Toybox', off: 'Off' };
export const SOUND_BLURBS = {
  classic: 'Soft and warm: a mellow engine hum, gentle thumps and bell chimes.',
  chiptune: '8-bit: square-wave engine, blips and arpeggio fanfares.',
  rumble: 'Big and gritty: a lumpy V8, gravel, heavy landings and an air horn.',
  toybox: 'Cartoon: a buzzy toy motor, boings, slide whistles and a xylophone.',
  off: 'No sound.',
};
export const CUES = ['start', 'land', 'bump', 'scrape', 'flip', 'stage', 'win', 'wreck', 'click'];

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

/** Pulse wave with the given duty cycle (for chiptune sounds). */
function pulseWave(ctx, duty) {
  const n = 64, re = new Float32Array(n), im = new Float32Array(n);
  for (let i = 1; i < n; i++) im[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
  return ctx.createPeriodicWave(re, im);
}

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
// The sets.

const SETS = {
  classic: {
    engine(k) {
      const out = k.ctx.createGain(); out.gain.value = 1;
      const lp = k.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.7;
      lp.connect(out).connect(k.out);
      const a = voice(k, { type: 'triangle', dest: lp }), b = voice(k, { type: 'sawtooth', dest: lp });
      return engineShell(k, [a.o, b.o], out, ({ throttle, speed, airborne }) => {
        const f = 48 + speed * 70 + throttle * 16 + (airborne && throttle ? 24 : 0);
        smooth(a.o.frequency, f, k, 0.08); smooth(b.o.frequency, f / 2, k, 0.08);
        smooth(a.g.gain, 0.10 + throttle * 0.08, k); smooth(b.g.gain, 0.035 + throttle * 0.04, k);
        smooth(lp.frequency, 500 + throttle * 600 + speed * 400, k, 0.1);
      });
    },
    start(k) { bell(k, note(72), 0, 0.12, 0.5); bell(k, note(79), 0.12, 0.12, 0.7); },
    land(k, { force = 0.5 } = {}) {
      tone(k, { f: 110, f2: 38, dur: 0.28, gain: 0.25 + force * 0.4 });
      noise(k, { dur: 0.18, gain: 0.08 + force * 0.15, f: 500, f2: 120 });
    },
    bump(k, { force = 0.5 } = {}) { tone(k, { f: 140, f2: 60, dur: 0.12, gain: 0.1 + force * 0.2 }); },
    scrape(k) { noise(k, { dur: 0.14, gain: 0.5, type: 'bandpass', f: 1400, f2: 900, Q: 2 }); },
    flip(k, { degrees = 360 } = {}) {
      const n = Math.max(1, Math.min(4, Math.round(degrees / 360)));
      melody(k, [76, 79, 84, 88].slice(0, n + 1), 0.09, (f, t) => bell(k, f, t, 0.13, 0.7));
    },
    stage(k) { melody(k, [72, 76, 79, 84], 0.13, (f, t, i) => bell(k, f, t, 0.15, i === 3 ? 1.4 : 0.6)); },
    win(k) { melody(k, [72, 76, 79, 84, 79, 84, 88], 0.12, (f, t, i) => bell(k, f, t, 0.15, i === 6 ? 1.8 : 0.5)); },
    wreck(k) {
      noise(k, { dur: 0.9, gain: 0.35, f: 1200, f2: 90 });
      tone(k, { f: 120, f2: 30, dur: 0.8, gain: 0.35 });
      melody(k, [64, 60, 55], 0.22, (f, t) => bell(k, f, 0.35 + t, 0.08, 0.8));
    },
    click(k) { tone(k, { f: 1800, f2: 1200, dur: 0.035, gain: 0.08 }); },
  },

  chiptune: {
    engine(k) {
      const out = k.ctx.createGain(); out.gain.value = 1; out.connect(k.out);
      const a = voice(k, { wave: pulseWave(k.ctx, 0.25), dest: out });
      const b = voice(k, { type: 'triangle', dest: out });
      return engineShell(k, [a.o, b.o], out, ({ throttle, speed, airborne }) => {
        // Pitch snaps to semitones, like an 8-bit sound chip.
        const raw = 70 + speed * 110 + throttle * 25 + (airborne && throttle ? 40 : 0);
        const f = note(Math.round(69 + 12 * Math.log2(raw / 440)));
        smooth(a.o.frequency, f, k, 0.01); smooth(b.o.frequency, f / 2, k, 0.01);
        smooth(a.g.gain, 0.035 + throttle * 0.03, k, 0.02); smooth(b.g.gain, 0.08, k, 0.02);
      });
    },
    start(k) { melody(k, [72, 79], 0.08, (f, t) => tone(k, { wave: k.pulse50, f, t, dur: 0.09, gain: 0.2, attack: 0.002 })); },
    land(k, { force = 0.5 } = {}) {
      noise(k, { dur: 0.16, gain: 0.15 + force * 0.2, f: 2000, f2: 300, buffer: k.crunch });
      tone(k, { wave: k.pulse50, f: 200, f2: 60, dur: 0.12, gain: 0.15 + force * 0.15, attack: 0.002 });
    },
    bump(k, { force = 0.5 } = {}) { tone(k, { wave: k.pulse50, f: 160, f2: 90, dur: 0.06, gain: 0.1 + force * 0.15, attack: 0.002 }); },
    scrape(k) { noise(k, { dur: 0.08, gain: 0.12, type: 'highpass', f: 3000, buffer: k.crunch }); },
    flip(k, { degrees = 360 } = {}) {
      const n = Math.max(1, Math.min(4, Math.round(degrees / 360)));
      const notes = [];
      for (let i = 0; i < n; i++) notes.push(72 + i * 2, 76 + i * 2, 79 + i * 2);
      melody(k, notes, 0.045, (f, t) => tone(k, { wave: k.pulse25, f, t, dur: 0.06, gain: 0.17, attack: 0.002 }));
    },
    stage(k) {
      melody(k, [67, 72, 76, 79, null, 76, 79], 0.1, (f, t, i) => tone(k, { wave: k.pulse25, f, t, dur: i === 6 ? 0.4 : 0.1, gain: 0.15, attack: 0.002 }));
      melody(k, [48, null, 55, null, 60], 0.14, (f, t) => tone(k, { type: 'triangle', f, t, dur: 0.14, gain: 0.12, attack: 0.002 }));
    },
    win(k) {
      melody(k, [72, 72, 72, 72, 68, 70, 72, null, 70, 72], 0.11, (f, t, i) => tone(k, { wave: k.pulse25, f, t, dur: i === 9 ? 0.6 : 0.1, gain: 0.15, attack: 0.002 }));
      melody(k, [48, 55, 48, 55, 44, 51, 48], 0.16, (f, t) => tone(k, { type: 'triangle', f, t, dur: 0.15, gain: 0.12, attack: 0.002 }));
    },
    wreck(k) {
      noise(k, { dur: 0.6, gain: 0.3, f: 3000, f2: 200, buffer: k.crunch });
      melody(k, [64, 63, 62, 61, 60, 59, 58, 57], 0.06, (f, t) => tone(k, { wave: k.pulse50, f, t: 0.1 + t, dur: 0.07, gain: 0.15, attack: 0.002 }));
    },
    click(k) { tone(k, { wave: k.pulse50, f: 1000, dur: 0.04, gain: 0.12, attack: 0.001 }); },
  },

  rumble: {
    engine(k) {
      const { ctx } = k;
      const out = ctx.createGain(); out.gain.value = 1; out.connect(k.out);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3; lp.frequency.value = 300;
      const lump = ctx.createGain(); lump.gain.value = 0.6;   // amplitude wobble: a lumpy V8 idle
      lp.connect(lump).connect(out);
      const lfo = ctx.createOscillator(), lfoAmt = ctx.createGain();
      lfo.frequency.value = 14; lfoAmt.gain.value = 0.4;
      lfo.connect(lfoAmt).connect(lump.gain); lfo.start();
      const a = voice(k, { type: 'sawtooth', dest: lp }), b = voice(k, { type: 'square', dest: lp });
      const sub = voice(k, { type: 'sine', dest: out });
      // gravel under the tyres
      const grit = ctx.createBufferSource(); grit.buffer = k.noise; grit.loop = true;
      const gf = ctx.createBiquadFilter(); gf.type = 'bandpass'; gf.frequency.value = 900; gf.Q.value = 0.8;
      const gg = ctx.createGain(); gg.gain.value = 0;
      grit.connect(gf).connect(gg).connect(out); grit.start();
      return engineShell(k, [a.o, b.o, sub.o, lfo, grit], out, ({ throttle, speed, airborne }) => {
        const f = 32 + speed * 55 + throttle * 14 + (airborne && throttle ? 28 : 0);
        smooth(a.o.frequency, f, k, 0.12); smooth(b.o.frequency, f * 1.01, k, 0.12); smooth(sub.o.frequency, f / 2, k, 0.12);
        smooth(lfo.frequency, f / 2.2, k, 0.12);
        smooth(lp.frequency, 220 + throttle * 900 + speed * 500, k, 0.08);
        smooth(a.g.gain, 0.16 + throttle * 0.12, k); smooth(b.g.gain, 0.06 + throttle * 0.05, k); smooth(sub.g.gain, 0.12, k);
        smooth(gg.gain, airborne ? 0 : speed * 0.05, k, 0.06);
      });
    },
    start(k) { tone(k, { type: 'sawtooth', f: 40, f2: 90, dur: 0.5, gain: 0.2 }); noise(k, { dur: 0.4, gain: 0.08, f: 300 }); },
    land(k, { force = 0.5 } = {}) {
      noise(k, { dur: 0.35, gain: 0.25 + force * 0.35, f: 260, f2: 60, Q: 0.7 });
      tone(k, { f: 70, f2: 28, dur: 0.35, gain: 0.3 + force * 0.4 });
      if (force > 0.45) noise(k, { t: 0.02, dur: 0.12, gain: 0.08, type: 'bandpass', f: 2600, Q: 6 });
    },
    bump(k, { force = 0.5 } = {}) {
      noise(k, { dur: 0.16, gain: 0.08 + force * 0.12, type: 'bandpass', f: 700, f2: 300, Q: 3 });
      tone(k, { f: 90, f2: 45, dur: 0.12, gain: 0.08 + force * 0.15 });
    },
    scrape(k) {
      noise(k, { dur: 0.2, gain: 0.7, type: 'bandpass', f: 3200, f2: 2400, Q: 8 });
      tone(k, { type: 'sawtooth', f: 620, f2: 540, dur: 0.15, gain: 0.06 });
    },
    flip(k, { degrees = 360 } = {}) {
      // a short blast on a two-tone air horn; longer for more flips
      const len = 0.18 + Math.min(3, Math.round(degrees / 360)) * 0.12;
      for (const f of [311, 370]) tone(k, { type: 'sawtooth', f, dur: len, gain: 0.12, attack: 0.02 });
    },
    stage(k) {
      for (const [t, len] of [[0, 0.25], [0.32, 0.7]]) for (const f of [311, 370, 466]) tone(k, { type: 'sawtooth', f, t, dur: len, gain: 0.09, attack: 0.02 });
    },
    win(k) {
      for (const [t, len] of [[0, 0.2], [0.26, 0.2], [0.52, 1.1]]) for (const f of [311, 370, 466]) tone(k, { type: 'sawtooth', f, t, dur: len, gain: 0.09, attack: 0.02 });
    },
    wreck(k) {
      noise(k, { dur: 1.4, gain: 0.45, f: 2000, f2: 60, Q: 0.5 });
      tone(k, { f: 60, f2: 22, dur: 1.0, gain: 0.45 });
      for (const t of [0.05, 0.2, 0.38, 0.6]) noise(k, { t, dur: 0.1, gain: 0.1, type: 'bandpass', f: 1800 + Math.random() * 2000, Q: 9 });
    },
    click(k) { noise(k, { dur: 0.03, gain: 0.4, type: 'bandpass', f: 4000, Q: 3, attack: 0.001 }); },
  },

  toybox: {
    engine(k) {
      const { ctx } = k;
      const out = ctx.createGain(); out.gain.value = 1; out.connect(k.out);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5; bp.frequency.value = 900;
      const trem = ctx.createGain(); trem.gain.value = 0.7;
      bp.connect(trem).connect(out);
      const lfo = ctx.createOscillator(), lfoAmt = ctx.createGain();
      lfo.frequency.value = 11; lfoAmt.gain.value = 0.3; lfo.connect(lfoAmt).connect(trem.gain); lfo.start();
      const a = voice(k, { type: 'sawtooth', dest: bp });
      return engineShell(k, [a.o, lfo], out, ({ throttle, speed, airborne }) => {
        const f = 120 + speed * 160 + throttle * 40 + (airborne && throttle ? 70 : 0);
        smooth(a.o.frequency, f, k, 0.06);
        smooth(bp.frequency, f * 4, k, 0.06);
        smooth(lfo.frequency, 9 + speed * 10, k, 0.1);
        smooth(a.g.gain, 0.4 + throttle * 0.35, k);
      });
    },
    start(k) { tone(k, { f: 500, f2: 1000, dur: 0.25, gain: 0.12, glide: 'lin', vibrato: 30 }); },
    land(k, { force = 0.5 } = {}) {
      // boing
      tone(k, { f: 140, f2: 420, dur: 0.07, gain: 0.2 + force * 0.15, glide: 'lin' });
      tone(k, { f: 420, f2: 160, t: 0.06, dur: 0.4, gain: 0.18 + force * 0.15, vibrato: 25, vibratoRate: 14 });
    },
    bump(k, { force = 0.5 } = {}) { tone(k, { f: 300, f2: 180, dur: 0.14, gain: 0.08 + force * 0.1, vibrato: 15, vibratoRate: 18 }); },
    scrape(k) { tone(k, { type: 'square', f: 95, dur: 0.12, gain: 0.12, vibrato: 30, vibratoRate: 40 }); },
    flip(k, { degrees = 360 } = {}) {
      // slide whistle up, higher for more flips
      const n = Math.max(1, Math.min(4, Math.round(degrees / 360)));
      tone(k, { f: 600, f2: 1000 + n * 250, dur: 0.25 + n * 0.08, gain: 0.22, glide: 'lin', vibrato: 12 });
    },
    stage(k) {
      melody(k, [72, 74, 76, 79, 76, 79, 84], 0.09, (f, t) => { tone(k, { f, t, dur: 0.25, gain: 0.16 }); tone(k, { f: f * 4, t, dur: 0.05, gain: 0.05 }); });
    },
    win(k) {
      melody(k, [72, 76, 79, 84, 83, 79, 84, 88], 0.1, (f, t, i) => { tone(k, { f, t, dur: i === 7 ? 0.8 : 0.25, gain: 0.16 }); tone(k, { f: f * 4, t, dur: 0.05, gain: 0.05 }); });
    },
    wreck(k) {
      tone(k, { f: 1400, f2: 300, dur: 0.7, gain: 0.1, glide: 'lin', vibrato: 10 });
      tone(k, { type: 'triangle', f: 700, t: 0.72, dur: 0.12, gain: 0.25, attack: 0.001 });
      for (const t of [0.8, 0.9, 0.97, 1.05]) tone(k, { type: 'triangle', f: 900 + Math.random() * 900, t, dur: 0.06, gain: 0.08, attack: 0.001 });
    },
    click(k) { tone(k, { type: 'triangle', f: 900, dur: 0.05, gain: 0.12, attack: 0.001 }); },
  },
};

// ---------------------------------------------------------------------------------------------

export class Sound {
  constructor() {
    this.ctx = null;
    this.set = 'classic';
    this.engine = null;
    this.engineSet = null;
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
      // Coarse "8-bit" noise: each random value held for 24 samples.
      const crunch = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const c = crunch.getChannelData(0);
      for (let i = 0; i < c.length; i++) c[i] = i % 24 === 0 ? Math.random() * 2 - 1 : c[i - 1];
      this.ctx = ctx;
      this.kit = { ctx, out: master, master, noise: white, crunch, pulse25: pulseWave(ctx, 0.25), pulse50: pulseWave(ctx, 0.5) };
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  setSet(name) {
    if (!SOUND_SETS.includes(name)) return;
    this.set = name;
    this.stopEngine();
  }

  /** Play a one-shot cue in the current set (or in `set`, for the preview page). */
  play(cue, opts = {}, set = this.set) {
    if (set === 'off' || !this.ready) return;
    const fn = SETS[set]?.[cue];
    if (fn) fn(this.kit, opts);
  }

  /** Keep the engine voice in step with the truck: { on, throttle, speed, airborne }. */
  updateEngine(state, set = this.set) {
    if (!state.on || set === 'off' || !this.ready) { this.stopEngine(); return; }
    if (this.engine && this.engineSet !== set) this.stopEngine();
    if (!this.engine) { this.engine = SETS[set].engine(this.kit); this.engineSet = set; }
    this.engine.update(state);
  }

  stopEngine() {
    if (this.engine) { this.engine.stop(); this.engine = null; this.engineSet = null; }
  }

  /** Pause or resume all sound (when the page is hidden, say). */
  suspend(on) {
    if (!this.ctx) return;
    if (on) this.ctx.suspend().catch(() => {}); else this.ctx.resume().catch(() => {});
  }
}
