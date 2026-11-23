// make-wreck-crashes.mjs — finds real crashes for the Wreck Lab (tools/wreck-lab.html): bots drive
// the nine stages in Practice with damage on, using the real game, and each time one wrecks its
// truck, the crash is kept: the stage, the last five seconds of driving (poses, to replay), and the
// truck's exact state at the wreck (to start the Wreck from). Writes tools/wreck-crashes.json.
//
//   node tools/make-wreck-crashes.mjs [crashes per stage, default 4]
//
// The bots play like earnest players, each a bit differently: they lean to keep the nose right,
// react late or early, now and then lift off the gas, and sometimes go for a flip off a jump and
// let go of it too early or too late. That last one is how most real wrecks happen.

import { readFileSync, writeFileSync } from 'node:fs';
import { Game } from '../src/game.js';
import { rng, packPoses } from './wreck-lab-sim.mjs';

const data = JSON.parse(readFileSync(new URL('../assets/levels.json', import.meta.url)));
const PER_STAGE = Number(process.argv[2]) || 4;
const LEAD = 350;          // steps of driving kept before the wreck (5 s)
const MAX_STEPS = 70 * 150;
const ATTEMPTS = 400;

const memoryStore = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) }; };
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** A bot's style, from a seed. */
function style(seed) {
  const r = rng(seed);
  return {
    seed,
    noseUp: -10 - r() * 20,          // leans forward when the nose is higher than this (degrees)
    noseDown: 20 + r() * 30,         // leans back when it's lower than this
    delay: Math.floor(r() * 10),     // steps late it reacts
    slip: r() * 0.004,               // chance a step of lifting off the gas for a moment
    flip: r() * 0.8,                 // chance of going for a flip off a jump
    release: 200 + r() * 260,        // degrees turned before letting go of a flip
    r,
  };
}

/** Drive one attempt; returns the crash, or null (finished, stuck or out of time). */
function attempt(level, seed) {
  const g = new Game(data, { store: memoryStore(), random: rng(seed * 7 + 1) });
  g.startPractice(level);
  const s = style(seed), r = s.r, poses = [], rots = [];
  let air = 0, flipDir = 0, turned = 0, lastRot = 0, slipLeft = 0, best = 0, since = 0, back = 0;
  for (let i = 0; i < MAX_STEPS && g.screen === 'playing'; i++) {
    const t = g.truck;
    rots.push(t.bodyRot);
    const seen = rots[Math.max(0, rots.length - 1 - s.delay)];
    const down = t.rearContact || t.frontContact;
    air = down ? 0 : air + 1;
    // a flip: decided on leaving a jump, held until it has turned `release` degrees
    if (air === 6 && !flipDir && r() < s.flip) { flipDir = r() < 0.65 ? -1 : 1; turned = 0; }
    if (flipDir) {
      let d = t.bodyRot - lastRot; if (d > 180) d -= 360; if (d < -180) d += 360;
      turned += d * flipDir;
      if (turned > s.release || down) flipDir = 0;
    }
    lastRot = t.bodyRot;
    if (slipLeft > 0) slipLeft--; else if (r() < s.slip) slipLeft = 10 + Math.floor(r() * 40);
    if (back > 0) { // backing up for a run-up
      back--;
      g.keys.up = false; g.keys.down = true; g.keys.left = false; g.keys.right = false;
    } else {
      g.keys.down = false;
      g.keys.up = slipLeft === 0;
      if (flipDir) { g.keys.left = flipDir < 0; g.keys.right = flipDir > 0; } else {
        g.keys.right = seen < s.noseUp; g.keys.left = seen > s.noseDown;
      }
    }
    poses.push([...t.T.map(r1), r1(t.rearWheelRot), r1(t.frontWheelRot)]);
    if (poses.length > LEAD) poses.shift();
    g.step();
    if (g.wreck) {
      const k = g.truck;
      return {
        stage: level, seed, step: i,
        poses,
        truck: {
          T: k.T, P: k.P, rearSpin: k.rearSpin, frontSpin: k.frontSpin,
          rearWheelRot: k.rearWheelRot, frontWheelRot: k.frontWheelRot,
          probePrev: k.probePrev, gravity: k.gravity, bodyRot: k.bodyRot,
        },
      };
    }
    if (g.truck.T[0] > best + 1) { best = g.truck.T[0]; since = 0; } else if (++since > 350 && back === 0) { back = 60 + Math.floor(r() * 80); since = 0; }
  }
  return null;
}

/** What happened, in a few words: how it was lying and how fast it was going. */
function describe(c) {
  const T = c.truck.T, P = c.truck.P;
  const a = ((c.truck.bodyRot % 360) + 540) % 360 - 180; // -180..180, 0 upright
  const v = Math.hypot(T[0] - P[0], T[1] - P[1]) * 70 * 2.5 / 64 * 3.6;
  const lie = Math.abs(a) > 135 ? 'on its roof' : Math.abs(a) > 60 ? (a > 0 ? 'on its nose' : 'on its tail') : 'tipped';
  return { angle: Math.round(a), kmh: Math.round(v), lie };
}

const crashes = [];
for (let level = 0; level < data.levels.length; level++) {
  const found = [];
  for (let seed = 1; seed <= ATTEMPTS && found.length < PER_STAGE; seed++) {
    const c = attempt(level, level * 1000 + seed);
    if (!c) continue;
    Object.assign(c, describe(c));
    // (keep them varied: not two of the same kind at the same place)
    if (found.some((f) => f.lie === c.lie && Math.abs(f.truck.T[0] - c.truck.T[0]) < 200)) continue;
    found.push(c);
  }
  console.log(`Stage ${level + 1}: ${found.map((c) => `${c.lie} ${c.kmh} km/h`).join(', ') || 'none'}`);
  crashes.push(...found);
}
crashes.forEach((c, i) => { c.id = i; c.truck.T = c.truck.T.map(r3); c.truck.P = c.truck.P.map(r3); c.poses = packPoses(c.poses); });
writeFileSync(new URL('./wreck-crashes.json', import.meta.url), JSON.stringify(crashes));
console.log(`${crashes.length} crashes written to tools/wreck-crashes.json`);
