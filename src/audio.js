// audio.js — the game's sound, synthesised live with the Web Audio API (no sound files).
//
// Cues:
//   engine            a continuous voice driven by { throttle, speed, airborne } (each 0..1),
//                     with a quiet hiss of tyres on the ground while the truck is rolling
//   scrape            a continuous voice while the cab drags along the ground (see SCRAPES)
//   start, land, bump, flip, trick, stage, win, wreck, click     one-shot sounds
// SoundWatcher (sound-events.js) decides when cues happen; this file decides how they sound.

export const CUES = ['start', 'land', 'bump', 'flip', 'trick', 'stage', 'win', 'wreck', 'click'];

/** Scrape sounds to choose between (sounds.html plays them; ?scrape=N picks one in the game). */
export const SCRAPES = {
  1: { name: 'Grind', blurb: 'Low and gritty, like the cab grinding through dirt.' },
  2: { name: 'Skid', blurb: 'A metal panel skidding along: brighter, with a faint squeal.' },
  3: { name: 'Scratch', blurb: 'Dry and scratchy, fluttering faster the quicker you slide.' },
};
export const DEFAULT_SCRAPE = 1;

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
    const gf = ctx.createBiquadFilter(); gf.type = 'bandpass'; gf.frequency.value = 900; gf.Q.value = 0.8;
    const gg = ctx.createGain(); gg.gain.value = 0;
    grit.connect(gf).connect(gg).connect(out); grit.start();
    return engineShell(k, [a.o, b.o, grit], out, ({ throttle, speed, airborne }) => {
      const f = 48 + speed * 70 + throttle * 16 + (airborne && throttle ? 24 : 0);
      smooth(a.o.frequency, f, k, 0.08); smooth(b.o.frequency, f / 2, k, 0.08);
      smooth(a.g.gain, 0.10 + throttle * 0.08, k); smooth(b.g.gain, 0.035 + throttle * 0.04, k);
      smooth(lp.frequency, 500 + throttle * 600 + speed * 400, k, 0.1);
      smooth(gf.frequency, 700 + speed * 500, k, 0.1);
      smooth(gg.gain, airborne ? 0 : speed * 0.016, k, 0.06);
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
  stage(k) { melody(k, [72, 76, 79, 84], 0.13, (f, t, i) => bell(k, f, t, 0.15, i === 3 ? 1.4 : 0.6)); },
  win(k) { melody(k, [72, 76, 79, 84, 79, 84, 88], 0.12, (f, t, i) => bell(k, f, t, 0.15, i === 6 ? 1.8 : 0.5)); },
  wreck(k) {
    noise(k, { dur: 0.9, gain: 0.35, f: 1200, f2: 90 });
    tone(k, { f: 120, f2: 30, dur: 0.8, gain: 0.35 });
    melody(k, [64, 60, 55], 0.22, (f, t) => bell(k, f, 0.35 + t, 0.08, 0.8));
  },
  click(k) { tone(k, { f: 1800, f2: 1200, dur: 0.035, gain: 0.08 }); },
};

/**
 * The scrape voices. Each fades in and out gently rather than hitting, and each new scrape picks
 * a slightly different pitch so a run of scrapes doesn't sound the same every time.
 * update({ on, speed, pitch }) is called every frame.
 */
const SCRAPE_VOICES = {
  1(k) { // Grind
    const { ctx } = k;
    const src = ctx.createBufferSource(); src.buffer = k.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.3; bp.frequency.value = 600;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const wob = ctx.createGain(); wob.gain.value = 0.8;
    const lfo = ctx.createOscillator(), la = ctx.createGain(); lfo.frequency.value = 7; la.gain.value = 0.25;
    lfo.connect(la).connect(wob.gain); lfo.start();
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp).connect(lp).connect(wob).connect(g).connect(k.out); src.start();
    return { nodes: [src, lfo], g, update: ({ on, speed, pitch }) => {
      smooth(bp.frequency, (420 + speed * 420) * pitch, k, 0.08);
      smooth(lfo.frequency, 5 + speed * 9, k, 0.1);
      smooth(g.gain, on ? 0.12 + speed * 0.3 : 0, k, on ? 0.07 : 0.14);
    } };
  },
  2(k) { // Skid
    const { ctx } = k;
    const src = ctx.createBufferSource(); src.buffer = k.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 4.5; bp.frequency.value = 1700;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp).connect(g).connect(k.out); src.start();
    const sq = ctx.createOscillator(); sq.type = 'sawtooth'; sq.frequency.value = 330;
    const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.Q.value = 8; sf.frequency.value = 1300;
    const sg = ctx.createGain(); sg.gain.value = 0;
    sq.connect(sf).connect(sg).connect(k.out); sq.start();
    return { nodes: [src, sq], g, extra: sg, update: ({ on, speed, pitch }) => {
      smooth(bp.frequency, (1300 + speed * 900) * pitch, k, 0.08);
      smooth(sq.frequency, (300 + speed * 90) * pitch, k, 0.1);
      smooth(sf.frequency, (1100 + speed * 500) * pitch, k, 0.1);
      smooth(g.gain, on ? 0.18 + speed * 0.35 : 0, k, on ? 0.06 : 0.14);
      smooth(sg.gain, on ? 0.006 + speed * 0.012 : 0, k, on ? 0.1 : 0.12);
    } };
  },
  3(k) { // Scratch
    const { ctx } = k;
    const src = ctx.createBufferSource(); src.buffer = k.noise; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200; hp.Q.value = 0.9;
    const flutter = ctx.createGain(); flutter.gain.value = 0.55;
    const lfo = ctx.createOscillator(), la = ctx.createGain(); lfo.type = 'triangle'; lfo.frequency.value = 18; la.gain.value = 0.45;
    lfo.connect(la).connect(flutter.gain); lfo.start();
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(hp).connect(flutter).connect(g).connect(k.out); src.start();
    return { nodes: [src, lfo], g, update: ({ on, speed, pitch }) => {
      smooth(hp.frequency, (1800 + speed * 1400) * pitch, k, 0.08);
      smooth(lfo.frequency, (14 + speed * 26) * pitch, k, 0.08);
      smooth(g.gain, on ? 0.08 + speed * 0.2 : 0, k, on ? 0.06 : 0.12);
    } };
  },
};

// ---------------------------------------------------------------------------------------------

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.engine = null;
    this.scrapeStyle = DEFAULT_SCRAPE;
    this.scrape = null;          // the live scrape voice
    this.scrapeOn = false;
    this.pitch = 1;              // the current scrape's pitch
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
      this.kit = { ctx, out: master, master, noise: white };
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) { this.stopEngine(); this.stopScrape(); }
  }

  setScrapeStyle(n) {
    if (!SCRAPES[n] || n === this.scrapeStyle) return;
    this.stopScrape();
    this.scrapeStyle = n;
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

  /** Keep the scrape voice in step with the cab: { on, speed } (speed 0..1). */
  updateScrape(state, force = false) {
    if ((!this.enabled && !force) || !this.ready) { this.stopScrape(); return; }
    if (!this.scrape) {
      if (!state.on) return;
      this.scrape = SCRAPE_VOICES[this.scrapeStyle](this.kit);
    }
    if (state.on && !this.scrapeOn) this.pitch = Math.pow(2, (Math.random() * 8 - 4) / 12); // ±4 semitones
    this.scrapeOn = state.on;
    this.scrape.update({ on: state.on, speed: state.speed, pitch: this.pitch });
  }

  stopScrape() {
    const v = this.scrape;
    if (!v) return;
    this.scrape = null; this.scrapeOn = false;
    v.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    setTimeout(() => { for (const n of v.nodes) { try { n.stop(); } catch { /* already stopped */ } } v.g.disconnect(); v.extra?.disconnect(); }, 400);
  }

  /** Pause or resume all sound (when the page is hidden, say). */
  suspend(on) {
    if (!this.ctx) return;
    if (on) this.ctx.suspend().catch(() => {}); else this.ctx.resume().catch(() => {});
  }
}
